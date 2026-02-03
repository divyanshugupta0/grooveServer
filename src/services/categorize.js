const { normalizeCategory } = require('./utils');

const DESI_LANGS = new Set([
  'hindi',
  'urdu',
  'punjabi',
  'tamil',
  'telugu',
  'bengali',
  'marathi',
  'gujarati',
  'kannada',
  'malayalam'
]);

function normalizeLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const map = {
    hi: 'hindi',
    hin: 'hindi',
    en: 'english',
    eng: 'english',
    pa: 'punjabi',
    pun: 'punjabi',
    ur: 'urdu',
    ta: 'tamil',
    te: 'telugu',
    bn: 'bengali',
    mr: 'marathi',
    gu: 'gujarati',
    kn: 'kannada',
    ml: 'malayalam'
  };
  return map[raw] || raw.replace(/[^a-z0-9]+/g, '');
}

function splitGenres(value) {
  return String(value || '')
    .split(/[,&/|]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function categorizeSong(song, queryCategories = []) {
  const categories = new Set();
  const lang = normalizeLanguage(song.language || song.lang || '');
  const text = `${song.name || ''} ${song.artist || ''} ${song.album || ''} ${song.genre || ''} ${song.tags || ''}`.toLowerCase();

  if (lang) {
    categories.add(`language_${normalizeCategory(lang)}`);
  }

  if (lang === 'hindi') {
    categories.add('indian_hindi');
    if (text.includes('bollywood') || text.includes('movie') || text.includes('film')) {
      categories.add('hindi_bollywood');
    }
  }

  if (DESI_LANGS.has(lang) || text.includes('desi') || text.includes('indian')) {
    if (text.includes('rap') || text.includes('hip hop')) {
      categories.add('indian_rap');
    }
  }

  splitGenres(song.genre || song.genres || '').forEach(genre => {
    const key = normalizeCategory(genre);
    if (key) categories.add(`genre_${key}`);
  });

  (queryCategories || []).forEach(cat => {
    const key = normalizeCategory(cat);
    if (key) categories.add(key);
  });

  return Array.from(categories);
}

module.exports = { categorizeSong, normalizeLanguage };
