const { searchSongs } = require('../sources/jiosaavn');
const { searchJamendo } = require('../sources/jamendo');

function defaultQueries() {
  return [
    { query: 'indian rap latest', forceDesi: true, categories: ['indian_rap'] },
    { query: 'hindi bollywood hits', forceDesi: true, categories: ['hindi_bollywood', 'indian_hindi'] },
    { query: 'hindi songs latest', forceDesi: true, categories: ['indian_hindi'] },
    { query: 'punjabi hits latest', forceDesi: true, categories: ['punjabi'] }
  ];
}

async function searchMusic(query, forceDesi = false, page = 1, limit = 20) {
  try {
    const results = await searchSongs(query, page, limit);
    if (results.length === 0 && page === 1) {
      if (forceDesi) return [];
      return await searchJamendo(query, limit);
    }
    return results;
  } catch (error) {
    if (forceDesi || page > 1) return [];
    try {
      return await searchJamendo(query, limit);
    } catch (fallbackError) {
      return [];
    }
  }
}

module.exports = { defaultQueries, searchMusic };
