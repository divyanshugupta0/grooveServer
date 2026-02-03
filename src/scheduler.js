const { db } = require('./firebase');
const { searchMusic, defaultQueries } = require('./services/fetcher');
const { categorizeSong } = require('./services/categorize');
const { songExists, saveSong } = require('./services/catalog');
const { importDatasetBatch } = require('./services/dataset');

const INTERVAL_MINUTES = parseInt(process.env.RUN_INTERVAL_MINUTES || '360', 10);
const MAX_SONGS_PER_RUN = parseInt(process.env.MAX_SONGS_PER_RUN || '50', 10);
const DOWNLOAD_CONCURRENCY = parseInt(process.env.DOWNLOAD_CONCURRENCY || '2', 10);

let timer = null;
let running = false;

async function ensureSchedulerDefaults() {
  const enabledSnap = await db.ref('scheduler/enabled').once('value');
  if (enabledSnap.val() === null) {
    await db.ref('scheduler/enabled').set(true);
  }
}

async function loadQueries() {
  const snap = await db.ref('settings/queries').once('value');
  const data = snap.val();
  if (!data) return defaultQueries();
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

async function asyncPool(limit, array, iterator) {
  const ret = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);

    if (limit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

async function runOnce(manual = false) {
  if (running) return { status: 'busy' };
  running = true;
  const startedAt = Date.now();

  await db.ref('scheduler').update({
    running: true,
    lastRunStartedAt: startedAt,
    lastRunBy: manual ? 'manual' : 'auto'
  });

  try {
    const datasetResult = await importDatasetBatch({});
    const queries = await loadQueries();
    const candidates = [];

    for (const query of queries) {
      if (candidates.length >= MAX_SONGS_PER_RUN * 3) break;
      const results = await searchMusic(query.query, Boolean(query.forceDesi));
      results.forEach(song => {
        if (!song || !song.audio_url) return;
        candidates.push({ song, categories: query.categories || [] });
      });
    }

    let added = 0;
    let skipped = 0;

    await asyncPool(DOWNLOAD_CONCURRENCY, candidates, async item => {
      if (added >= MAX_SONGS_PER_RUN) return;
      if (!item.song || !item.song.id) return;

      const exists = await songExists(item.song.id);
      if (exists) {
        skipped += 1;
        return;
      }

      const categories = categorizeSong(item.song, item.categories || []);
      await saveSong(item.song, categories);
      added += 1;
    });

    await db.ref('scheduler').update({
      lastRunCompletedAt: Date.now(),
      lastRunAdded: added,
      lastRunSkipped: skipped,
      lastError: null,
      lastDatasetStatus: datasetResult.status || null,
      lastDatasetAdded: datasetResult.added || 0,
      lastDatasetSkipped: datasetResult.skipped || 0
    });

    return { status: 'ok', added, skipped, dataset: datasetResult };
  } catch (error) {
    await db.ref('scheduler').update({
      lastRunCompletedAt: Date.now(),
      lastError: error.message || String(error)
    });
    return { status: 'error', error: error.message || String(error) };
  } finally {
    running = false;
    await db.ref('scheduler').update({ running: false });
  }
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    runOnce(false).catch(() => null);
  }, INTERVAL_MINUTES * 60 * 1000);
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function initScheduler() {
  await ensureSchedulerDefaults();
  const enabledSnap = await db.ref('scheduler/enabled').once('value');
  if (enabledSnap.val() === true) {
    startScheduler();
    runOnce(false).catch(() => null);
  }
}

async function setEnabled(enabled) {
  await db.ref('scheduler/enabled').set(Boolean(enabled));
  if (enabled) {
    startScheduler();
  } else {
    stopScheduler();
  }
}

function getSchedulerState() {
  return {
    running,
    intervalMinutes: INTERVAL_MINUTES,
    maxSongsPerRun: MAX_SONGS_PER_RUN
  };
}

module.exports = { initScheduler, runOnce, startScheduler, stopScheduler, setEnabled, getSchedulerState };
