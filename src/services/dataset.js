const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { parse } = require('csv-parse');
const { db } = require('../firebase');
const { searchMusic } = require('./fetcher');
const { categorizeSong } = require('./categorize');
const { songExists, saveSong } = require('./catalog');

const DATASET_PATH = process.env.CSV_DATASET_PATH || '';
const DATASET_URL = process.env.CSV_DATASET_URL || '';
const BATCH_SIZE = parseInt(process.env.DATASET_BATCH_SIZE || '30', 10);
const PROGRESS_EVERY = Math.max(1, parseInt(process.env.DATASET_PROGRESS_EVERY || '5', 10));

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBoolean(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function mapDatasetRow(row) {
  const durationMs = parseInt(row.duration_ms || row.durationMs || row.duration || '0', 10);
  const durationSec = Number.isFinite(durationMs) && durationMs > 0
    ? Math.round(durationMs / 1000)
    : 0;

  const features = {
    danceability: parseFloat(row.danceability || '0') || 0,
    energy: parseFloat(row.energy || '0') || 0,
    key: parseInt(row.key || '0', 10) || 0,
    loudness: parseFloat(row.loudness || '0') || 0,
    mode: parseInt(row.mode || '0', 10) || 0,
    speechiness: parseFloat(row.speechiness || '0') || 0,
    acousticness: parseFloat(row.acousticness || '0') || 0,
    instrumentalness: parseFloat(row.instrumentalness || '0') || 0,
    liveness: parseFloat(row.liveness || '0') || 0,
    valence: parseFloat(row.valence || '0') || 0,
    tempo: parseFloat(row.tempo || '0') || 0,
    time_signature: parseInt(row.time_signature || '0', 10) || 0
  };

  return {
    datasetId: row.track_id || row.id || '',
    name: row.track_name || row.name || '',
    artist: row.artists || row.artist || '',
    album: row.album_name || row.album || '',
    genre: row.track_genre || row.genre || '',
    popularity: parseInt(row.popularity || '0', 10) || 0,
    explicit: parseBoolean(row.explicit),
    duration: durationSec,
    features
  };
}

function buildQuery(mapped) {
  const name = mapped.name || '';
  const artist = mapped.artist || '';
  return `${name} ${artist}`.trim();
}

function scoreCandidate(candidate, mapped) {
  const targetName = normalizeText(mapped.name);
  const targetArtist = normalizeText(mapped.artist);
  const targetAlbum = normalizeText(mapped.album);

  const songName = normalizeText(candidate.name);
  const songArtist = normalizeText(candidate.artist);
  const songAlbum = normalizeText(candidate.album);

  let score = 0;
  if (targetName && (songName.includes(targetName) || targetName.includes(songName))) score += 2;
  if (targetArtist && (songArtist.includes(targetArtist) || targetArtist.includes(songArtist))) score += 2;
  if (targetAlbum && songAlbum.includes(targetAlbum)) score += 1;
  return score;
}

function pickBestMatch(results, mapped) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let best = results[0];
  let bestScore = -1;
  results.forEach(candidate => {
    const score = scoreCandidate(candidate, mapped);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });
  return best;
}

function mergeSongData(candidate, mapped) {
  return {
    ...candidate,
    name: mapped.name || candidate.name,
    artist: mapped.artist || candidate.artist,
    album: mapped.album || candidate.album,
    genre: mapped.genre || candidate.genre,
    popularity: mapped.popularity,
    explicit: mapped.explicit,
    duration: mapped.duration || candidate.duration,
    features: mapped.features,
    dataset: {
      trackId: mapped.datasetId,
      source: 'csv'
    }
  };
}

async function ensureDatasetAvailable() {
  if (!DATASET_PATH) {
    return { status: 'missing_path' };
  }
  if (fs.existsSync(DATASET_PATH)) {
    return { status: 'ok' };
  }
  if (!DATASET_URL) {
    return { status: 'missing_file' };
  }

  fs.mkdirSync(path.dirname(DATASET_PATH), { recursive: true });
  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Dataset download failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('Dataset download returned empty body');
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(DATASET_PATH));
  return { status: 'downloaded' };
}

function getDatasetFileStats() {
  if (!DATASET_PATH || !fs.existsSync(DATASET_PATH)) return null;
  const stat = fs.statSync(DATASET_PATH);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

async function countDatasetRows() {
  const stream = fs.createReadStream(DATASET_PATH);
  const parser = parse({
    columns: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });
  const iterator = stream.pipe(parser);
  let total = 0;
  for await (const _record of iterator) {
    total += 1;
  }
  return total;
}

async function importDatasetBatch(options = {}) {
  let ensured;
  try {
    ensured = await ensureDatasetAvailable();
  } catch (error) {
    await db.ref('dataset/state').update({
      running: false,
      lastError: error.message || String(error)
    });
    return { status: 'error', error: error.message || String(error) };
  }
  if (ensured.status === 'missing_path' || ensured.status === 'missing_file') {
    await db.ref('dataset/state').update({
      running: false,
      lastError: ensured.status
    });
    return { status: ensured.status };
  }

  const maxRows = parseInt(options.maxRows || BATCH_SIZE, 10);
  const stateSnap = await db.ref('dataset/state').once('value');
  const state = stateSnap.val() || {};
  const stats = getDatasetFileStats();
  if (stats) {
    const needsTotal = !state.totalRows
      || state.fileSize !== stats.size
      || state.fileMtimeMs !== stats.mtimeMs;
    if (needsTotal) {
      const totalRows = await countDatasetRows();
      await db.ref('dataset/state').update({
        totalRows,
        fileSize: stats.size,
        fileMtimeMs: stats.mtimeMs,
        totalRowsUpdatedAt: Date.now()
      });
    }
  }
  const offset = parseInt(state.offset || '0', 10) || 0;

  let processed = 0;
  let added = 0;
  let skipped = 0;
  let lastRow = null;
  let error = null;
  const startTime = Date.now();

  await db.ref('dataset/state').update({
    running: true,
    lastRunStartedAt: startTime,
    path: DATASET_PATH,
    lastDownloadStatus: ensured.status
  });

  const stream = fs.createReadStream(DATASET_PATH);
  const parser = parse({
    columns: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });

  const iterator = stream.pipe(parser);
  let index = -1;

  try {
    for await (const record of iterator) {
      index += 1;
      if (index < offset) continue;
      if (processed >= maxRows) {
        stream.destroy();
        break;
      }

      processed += 1;
      const mapped = mapDatasetRow(record);
      lastRow = {
        index,
        trackId: mapped.datasetId,
        name: mapped.name,
        artist: mapped.artist,
        album: mapped.album,
        genre: mapped.genre
      };
      const query = buildQuery(mapped);
      if (!query) {
        skipped += 1;
        continue;
      }

      const results = await searchMusic(query, false);
      const candidate = pickBestMatch(results, mapped);
      if (!candidate || !candidate.audio_url) {
        skipped += 1;
        continue;
      }

      const merged = mergeSongData(candidate, mapped);
      const exists = await songExists(merged.id);
      if (exists) {
        skipped += 1;
        continue;
      }

      const categories = categorizeSong(merged, [mapped.genre].filter(Boolean));
      await saveSong(merged, categories, { dataset: merged.dataset });
      added += 1;

      if (processed % PROGRESS_EVERY === 0) {
        await db.ref('dataset/state').update({
          offset: offset + processed,
          lastRowIndex: lastRow.index,
          lastRow,
          lastHeartbeatAt: Date.now()
        });
      }
    }
  } catch (err) {
    error = err;
  }

  const now = Date.now();
  await db.ref('dataset/state').update({
    running: false,
    offset: offset + processed,
    lastRunAt: now,
    lastProcessed: processed,
    lastAdded: added,
    lastSkipped: skipped,
    path: DATASET_PATH,
    lastRowIndex: lastRow ? lastRow.index : state.lastRowIndex || null,
    lastRow: lastRow || state.lastRow || null,
    lastError: error ? (error.message || String(error)) : null
  });

  if (error) {
    return { status: 'error', error: error.message || String(error) };
  }
  return { status: 'ok', processed, added, skipped, offset: offset + processed };
}

module.exports = { importDatasetBatch };
