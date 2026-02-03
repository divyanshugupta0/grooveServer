const path = require('path');
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');

const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '.env')
];
const envPath = envCandidates.find(candidate => fs.existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

const { db } = require('./firebase');
const { requireAuth } = require('./middleware/auth');
const { initScheduler, runOnce, setEnabled, getSchedulerState } = require('./scheduler');
const { getRecentSongs, getCategories } = require('./services/catalog');
const { importDatasetBatch } = require('./services/dataset');

const app = express();
const PORT = process.env.PORT || 5555;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', requireAuth, async (req, res) => {
  const [statsSnap, schedSnap, datasetSnap] = await Promise.all([
    db.ref('stats').once('value'),
    db.ref('scheduler').once('value'),
    db.ref('dataset/state').once('value')
  ]);

  res.json({
    stats: statsSnap.val() || {},
    scheduler: schedSnap.val() || {},
    dataset: datasetSnap.val() || {},
    runtime: getSchedulerState(),
    uptime: process.uptime()
  });
});

app.get('/api/categories', requireAuth, async (req, res) => {
  const categories = await getCategories();
  res.json({ categories });
});

app.get('/api/songs', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)));
  const songs = await getRecentSongs(limit);
  res.json({ songs });
});

app.get('/api/queries', requireAuth, async (req, res) => {
  const snap = await db.ref('settings/queries').once('value');
  const data = snap.val();
  res.json({ queries: data || [] });
});

app.post('/api/queries', requireAuth, async (req, res) => {
  const queries = Array.isArray(req.body.queries) ? req.body.queries : [];
  await db.ref('settings/queries').set(queries);
  res.json({ ok: true });
});

app.post('/api/dataset/import', requireAuth, async (req, res) => {
  const maxRows = req.body && req.body.maxRows ? parseInt(req.body.maxRows, 10) : undefined;
  const result = await importDatasetBatch({ maxRows });
  res.json(result);
});

app.post('/api/dataset/resume', requireAuth, async (req, res) => {
  const stateSnap = await db.ref('dataset/state').once('value');
  const state = stateSnap.val() || {};
  if (typeof state.lastRowIndex === 'number') {
    const targetOffset = Math.max(state.offset || 0, state.lastRowIndex + 1);
    if (targetOffset !== (state.offset || 0)) {
      await db.ref('dataset/state/offset').set(targetOffset);
    }
  }
  const maxRows = req.body && req.body.maxRows ? parseInt(req.body.maxRows, 10) : undefined;
  const result = await importDatasetBatch({ maxRows });
  res.json(result);
});

app.post('/api/scheduler/run', requireAuth, async (req, res) => {
  const result = await runOnce(true);
  res.json(result);
});

app.post('/api/scheduler/start', requireAuth, async (req, res) => {
  await setEnabled(true);
  res.json({ ok: true });
});

app.post('/api/scheduler/stop', requireAuth, async (req, res) => {
  await setEnabled(false);
  res.json({ ok: true });
});

app.listen(PORT, async () => {
  await initScheduler();
  console.log(`Firefly Groove server running on port ${PORT}`);
});
