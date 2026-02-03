const JAMENDO_API = process.env.JAMENDO_API || 'https://api.jamendo.com/v3.0';
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || '';

function formatJamendoTrack(track) {
  const sourceId = String(track.id);
  return {
    id: `jam_${sourceId}`,
    source: 'jamendo',
    sourceId,
    name: track.name || 'Unknown',
    artist: track.artist_name || 'Unknown Artist',
    album: track.album_name || '',
    genre: track.genre || '',
    tags: track.tags || '',
    type: track.type || track.subtype || '',
    img: track.image || track.album_image || '',
    audio_url: track.audio || '',
    duration: parseInt(track.duration) || 0
  };
}

async function searchJamendo(query, limit = 20) {
  if (!JAMENDO_CLIENT_ID) return [];
  const url = `${JAMENDO_API}/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${limit}&search=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Jamendo search failed (${response.status})`);
  }
  const data = await response.json();
  return (data.results || []).map(formatJamendoTrack).filter(Boolean);
}

module.exports = { searchJamendo };
