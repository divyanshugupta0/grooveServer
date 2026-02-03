const { admin, db } = require('../firebase');
const { chunkString, sha256 } = require('./utils');
const { buildAlbumUpdates } = require('./albums');

const AUDIO_CHUNK_SIZE = parseInt(process.env.AUDIO_CHUNK_SIZE || '150000', 10);
const IMAGE_CHUNK_SIZE = parseInt(process.env.IMAGE_CHUNK_SIZE || '120000', 10);

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || '';
  return { buffer, contentType };
}

async function writeChunks(pathBase, chunks) {
  for (let index = 0; index < chunks.length; index += 1) {
    await db.ref(`${pathBase}/${index}`).set(chunks[index]);
  }
}

async function songExists(songId) {
  const snap = await db.ref(`catalog/songs/${songId}/meta/id`).once('value');
  return Boolean(snap.val());
}

async function saveSong(song, categories, options = {}) {
  const audioResult = await fetchBinary(song.audio_url);
  const audioBase64 = audioResult.buffer.toString('base64');
  const audioChunks = chunkString(audioBase64, AUDIO_CHUNK_SIZE);

  let imagePayload = null;
  let imageChunks = [];
  if (song.img) {
    const imageResult = await fetchBinary(song.img);
    const imageBase64 = imageResult.buffer.toString('base64');
    imageChunks = chunkString(imageBase64, IMAGE_CHUNK_SIZE);
    imagePayload = {
      mime: imageResult.contentType,
      byteSize: imageResult.buffer.length,
      base64Size: imageBase64.length,
      chunkSize: IMAGE_CHUNK_SIZE,
      chunkCount: imageChunks.length,
      sourceUrl: song.img
    };
  }

  const now = Date.now();
  const meta = {
    id: song.id,
    source: song.source,
    sourceId: song.sourceId,
    name: song.name || 'Unknown',
    artist: song.artist || 'Unknown Artist',
    album: song.album || '',
    language: song.language || song.lang || '',
    genre: song.genre || '',
    genres: song.genres || '',
    type: song.type || '',
    tags: song.tags || '',
    duration: song.duration || 0,
    audio_url: song.audio_url || '',
    img: song.img || '',
    popularity: song.popularity ?? null,
    explicit: song.explicit ?? null,
    features: song.features || null,
    dataset: song.dataset || options.dataset || null,
    categories,
    createdAt: now,
    updatedAt: now
  };

  const audioPayload = {
    mime: audioResult.contentType,
    byteSize: audioResult.buffer.length,
    base64Size: audioBase64.length,
    chunkSize: AUDIO_CHUNK_SIZE,
    chunkCount: audioChunks.length,
    checksum: sha256(audioResult.buffer),
    sourceUrl: song.audio_url
  };

  const updates = {};
  updates[`catalog/songs/${song.id}/meta`] = meta;
  updates[`catalog/songs/${song.id}/audio`] = audioPayload;
  if (imagePayload) {
    updates[`catalog/songs/${song.id}/image`] = imagePayload;
  }

  const albumUpdates = buildAlbumUpdates(meta, now);
  Object.assign(updates, albumUpdates.updates);

  categories.forEach(category => {
    updates[`categories/${category}/songs/${song.id}`] = true;
    updates[`categories/${category}/count`] = admin.database.ServerValue.increment(1);
  });

  updates['stats/totalSongs'] = admin.database.ServerValue.increment(1);
  updates['stats/lastSongAddedAt'] = now;

  await db.ref().update(updates);

  await writeChunks(`catalog/songs/${song.id}/audio/chunks`, audioChunks);
  if (imageChunks.length) {
    await writeChunks(`catalog/songs/${song.id}/image/chunks`, imageChunks);
  }

  return { id: song.id, categories, albumId: albumUpdates.albumId };
}

async function getRecentSongs(limit = 10) {
  const snap = await db.ref('catalog/songs')
    .orderByChild('meta/createdAt')
    .limitToLast(limit)
    .once('value');
  const items = [];
  snap.forEach(child => {
    const value = child.val();
    if (value && value.meta) items.push(value.meta);
  });
  return items.reverse();
}

async function getCategories() {
  const snap = await db.ref('categories').once('value');
  const data = snap.val() || {};
  return Object.entries(data).map(([id, value]) => ({
    id,
    count: value && value.count ? value.count : 0
  })).sort((a, b) => b.count - a.count);
}

module.exports = { songExists, saveSong, getRecentSongs, getCategories };
