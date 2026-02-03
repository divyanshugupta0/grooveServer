const { admin } = require('../firebase');
const { normalizeCategory } = require('./utils');

function buildAlbumUpdates(song, now) {
  const artistName = song.artist || 'Unknown Artist';
  const albumName = song.album || 'Singles';

  const artistId = normalizeCategory(artistName) || `artist_${song.id}`;
  const albumKey = normalizeCategory(albumName) || 'singles';
  const albumId = `${artistId}__${albumKey}`.slice(0, 80);

  const updates = {};

  updates[`artists/${artistId}/name`] = artistName;
  updates[`artists/${artistId}/updatedAt`] = now;
  updates[`artists/${artistId}/albums/${albumId}`] = {
    id: albumId,
    name: albumName,
    updatedAt: now
  };

  updates[`albums/${albumId}/id`] = albumId;
  updates[`albums/${albumId}/name`] = albumName;
  updates[`albums/${albumId}/artist`] = artistName;
  updates[`albums/${albumId}/artistId`] = artistId;
  updates[`albums/${albumId}/updatedAt`] = now;
  if (song.img) updates[`albums/${albumId}/coverImg`] = song.img;
  updates[`albums/${albumId}/tracks/${song.id}`] = true;
  updates[`albums/${albumId}/trackCount`] = admin.database.ServerValue.increment(1);

  updates[`artists/${artistId}/songCount`] = admin.database.ServerValue.increment(1);

  return { updates, artistId, albumId };
}

module.exports = { buildAlbumUpdates };
