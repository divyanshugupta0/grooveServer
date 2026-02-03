const BASE_URL = process.env.JIOSAAVN_API || 'https://jiosaavn-api-privatecvc2.vercel.app';

function formatTrack(track) {
  if (!track) return null;

  const audioUrl = track.downloadUrl?.find(u => u.quality === '320kbps')?.link
    || track.downloadUrl?.find(u => u.quality === '160kbps')?.link
    || track.downloadUrl?.[track.downloadUrl.length - 1]?.link
    || '';

  const imageUrl = track.image?.find(i => i.quality === '500x500')?.link
    || track.image?.find(i => i.quality === '150x150')?.link
    || track.image?.[0]?.link
    || '';

  const artistName = track.primaryArtists
    ? (typeof track.primaryArtists === 'string'
      ? track.primaryArtists
      : track.primaryArtists.map(a => a.name).join(', '))
    : 'Unknown Artist';

  const sourceId = String(track.id);

  return {
    id: `jio_${sourceId}`,
    source: 'jiosaavn',
    sourceId,
    name: (track.name || 'Unknown').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    artist: artistName.replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    album: (track.album?.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    language: track.language || track.lang || '',
    genre: track.genre || track.genres || track.category || '',
    genres: track.genres || '',
    type: track.type || track.subType || track.subtype || track.releaseType || '',
    tags: track.tags || '',
    img: imageUrl,
    audio_url: audioUrl,
    duration: parseInt(track.duration) || 0
  };
}

async function searchSongs(query, page = 1, limit = 20) {
  const response = await fetch(`${BASE_URL}/search/songs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
  if (!response.ok) {
    throw new Error(`JioSaavn search failed (${response.status})`);
  }
  const data = await response.json();
  const results = data.data?.results || [];
  return results.map(formatTrack).filter(Boolean);
}

module.exports = { searchSongs };
