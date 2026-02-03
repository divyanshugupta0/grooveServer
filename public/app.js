let currentUser = null;
let cachedQueries = [];
let autoRefreshTimer = null;
let isRefreshing = false;

const loginView = document.getElementById('login-view');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

function showLogin() {
  loginView.classList.remove('hidden');
  dashboard.classList.add('hidden');
  logoutBtn.style.visibility = 'hidden';
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboard.classList.remove('hidden');
  logoutBtn.style.visibility = 'visible';
}

async function apiFetch(path, options = {}) {
  const token = await currentUser.getIdToken();
  const headers = Object.assign({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  }, options.headers || {});

  const response = await fetch(path, Object.assign({}, options, { headers }));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }
  return response.json();
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  button.disabled = Boolean(busy);
  if (label) {
    button.textContent = busy ? label : button.dataset.label || button.textContent;
    if (!button.dataset.label) button.dataset.label = button.textContent;
  }
}

async function refreshStatus() {
  const statusBox = document.getElementById('status-box');
  const datasetBox = document.getElementById('dataset-status');
  if (statusBox) statusBox.textContent = 'Loading status...';
  const data = await apiFetch('/api/status');
  const stats = data.stats || {};
  const scheduler = data.scheduler || {};
  const runtime = data.runtime || {};
  const dataset = data.dataset || {};
  const lastUpdated = new Date().toLocaleTimeString();
  const enabled = scheduler.enabled === true;

  statusBox.innerHTML = `Scheduler enabled: ${scheduler.enabled ? 'yes' : 'no'}<br>
Running: ${scheduler.running ? 'yes' : 'no'}<br>
Total songs: ${stats.totalSongs || 0}<br>
Last added: ${stats.lastSongAddedAt ? new Date(stats.lastSongAddedAt).toLocaleString() : 'n/a'}<br>
Last run added: ${scheduler.lastRunAdded || 0}<br>
Interval minutes: ${runtime.intervalMinutes || 0}<br>
Updated: ${lastUpdated}`;

  if (datasetBox) {
    const lastRow = dataset.lastRow || {};
    const lastRowLabel = lastRow.name
      ? `${lastRow.name} - ${lastRow.artist || ''}`
      : (lastRow.trackId || 'n/a');
    datasetBox.innerHTML = `Path: ${dataset.path || 'n/a'}<br>
Offset: ${dataset.offset || 0}<br>
Total rows: ${dataset.totalRows || 'n/a'}<br>
Last processed: ${dataset.lastProcessed || 0}<br>
Last added: ${dataset.lastAdded || 0}<br>
Last skipped: ${dataset.lastSkipped || 0}<br>
Last row: ${lastRowLabel}<br>
Last run: ${dataset.lastRunAt ? new Date(dataset.lastRunAt).toLocaleString() : 'n/a'}`;
  }

  const progressBar = document.getElementById('dataset-progress-bar');
  const progressLabel = document.getElementById('dataset-progress-label');
  if (progressBar && progressLabel) {
    const total = Number(dataset.totalRows || 0);
    const offset = Number(dataset.offset || 0);
    if (total > 0) {
      const percent = Math.min(100, Math.round((offset / total) * 100));
      progressBar.style.width = `${percent}%`;
      progressLabel.textContent = `Progress: ${percent}% (${offset}/${total})`;
    } else {
      progressBar.style.width = '0%';
      progressLabel.textContent = 'Progress: --';
    }
  }

  const startBtn = document.getElementById('start-scheduler');
  const stopBtn = document.getElementById('stop-scheduler');
  const runBtn = document.getElementById('run-now');
  if (startBtn) {
    startBtn.disabled = enabled;
    startBtn.style.display = enabled ? 'none' : 'inline-flex';
  }
  if (stopBtn) {
    stopBtn.disabled = !enabled;
    stopBtn.style.display = enabled ? 'inline-flex' : 'none';
  }
  if (runBtn) runBtn.disabled = scheduler.running === true;

  const pill = document.getElementById('scheduler-pill');
  if (pill) {
    pill.textContent = enabled ? 'Started' : 'Stopped';
    pill.classList.toggle('running', enabled);
    pill.classList.toggle('stopped', !enabled);
  }
}

async function loadCategories() {
  const container = document.getElementById('categories-list');
  const data = await apiFetch('/api/categories');
  container.innerHTML = '';
  data.categories.forEach(item => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<span>${item.id}</span><small>${item.count}</small>`;
    container.appendChild(div);
  });
}

async function loadSongs() {
  const container = document.getElementById('songs-list');
  const data = await apiFetch('/api/songs?limit=10');
  container.innerHTML = '';
  data.songs.forEach(song => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<span>${song.name} - ${song.artist}</span><small>${song.language || 'n/a'}</small>`;
    container.appendChild(div);
  });
}

function renderQueries() {
  const container = document.getElementById('queries-list');
  container.innerHTML = '';
  cachedQueries.forEach((query, index) => {
    const div = document.createElement('div');
    div.className = 'list-item';
    const categories = (query.categories || []).join(', ') || 'none';
    div.innerHTML = `<span>${query.query}</span><small>${categories}</small>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = async () => {
      cachedQueries.splice(index, 1);
      await saveQueries();
    };
    div.appendChild(removeBtn);
    container.appendChild(div);
  });
}

async function loadQueries() {
  const data = await apiFetch('/api/queries');
  cachedQueries = Array.isArray(data.queries) ? data.queries : [];
  renderQueries();
}

async function saveQueries() {
  await apiFetch('/api/queries', {
    method: 'POST',
    body: JSON.stringify({ queries: cachedQueries })
  });
  await loadQueries();
}

async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  const tasks = [
    refreshStatus(),
    loadCategories(),
    loadSongs(),
    loadQueries()
  ];
  await Promise.all(tasks.map(task => task.catch(err => console.warn(err))));
  isRefreshing = false;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  if (!firebase.apps.length) {
    loginError.textContent = 'Firebase is not initialized. Check public/config.js.';
    return;
  }
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (error) {
    loginError.textContent = error.message || 'Login failed';
  }
});

document.getElementById('query-form').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('query-text').value.trim();
  const categoriesText = document.getElementById('query-categories').value.trim();
  const forceDesi = document.getElementById('query-force-desi').checked;
  if (!query) return;
  const categories = categoriesText
    ? categoriesText.split(',').map(item => item.trim()).filter(Boolean)
    : [];

  cachedQueries.push({ query, categories, forceDesi });
  document.getElementById('query-text').value = '';
  document.getElementById('query-categories').value = '';
  document.getElementById('query-force-desi').checked = false;

  await saveQueries();
});

document.getElementById('run-now').addEventListener('click', async () => {
  const button = document.getElementById('run-now');
  try {
    setButtonBusy(button, true, 'Running...');
    await apiFetch('/api/scheduler/run', { method: 'POST' });
    await refreshStatus();
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById('start-scheduler').addEventListener('click', async () => {
  const button = document.getElementById('start-scheduler');
  try {
    setButtonBusy(button, true, 'Starting...');
    await apiFetch('/api/scheduler/start', { method: 'POST' });
    await refreshStatus();
  } finally {
    setButtonBusy(button, false);
  }
});

document.getElementById('stop-scheduler').addEventListener('click', async () => {
  const button = document.getElementById('stop-scheduler');
  try {
    setButtonBusy(button, true, 'Stopping...');
    await apiFetch('/api/scheduler/stop', { method: 'POST' });
    await refreshStatus();
  } finally {
    setButtonBusy(button, false);
  }
});

const datasetButton = document.getElementById('dataset-import');
if (datasetButton) {
  datasetButton.addEventListener('click', async () => {
    try {
      setButtonBusy(datasetButton, true, 'Importing...');
      await apiFetch('/api/dataset/import', { method: 'POST' });
      await refreshStatus();
    } finally {
      setButtonBusy(datasetButton, false);
    }
  });
}

const datasetResumeButton = document.getElementById('dataset-resume');
if (datasetResumeButton) {
  datasetResumeButton.addEventListener('click', async () => {
    try {
      setButtonBusy(datasetResumeButton, true, 'Resuming...');
      await apiFetch('/api/dataset/resume', { method: 'POST' });
      await refreshStatus();
    } finally {
      setButtonBusy(datasetResumeButton, false);
    }
  });
}

logoutBtn.addEventListener('click', async () => {
  await firebase.auth().signOut();
});

function bootFirebase() {
  const config = window.firebaseConfig || window.Config;
  if (!config) {
    loginError.textContent = 'Missing public/config.js Firebase config. Expected window.firebaseConfig.';
    return;
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }
  firebase.auth().onAuthStateChanged(async user => {
    currentUser = user;
    if (user) {
      showDashboard();
      await refreshAll();
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = setInterval(() => {
        refreshStatus().catch(err => console.warn(err));
      }, 10000);
    } else {
      showLogin();
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  });
}

showLogin();
bootFirebase();
