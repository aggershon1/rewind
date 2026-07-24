const { searchArtistTracks, createPlaylist, addPlaylistItems } = require('./spotify');
const { PLAYLIST_NAME, PLAYLIST_DESCRIPTION } = require('./constants');

// Mutates `store` in place (playlist.id/url if newly created, feedback.expandedArtists)
// but does NOT save it — the caller persists once, after this returns, to avoid two
// independent load/save cycles racing each other within the same request.
async function expandArtistIfNew(token, store, rec) {
  const artistName = rec.type === 'artist' ? rec.name : rec.artist;
  if (!artistName) return [];

  if (!store.feedback) store.feedback = { liked: [], disliked: [], expandedArtists: [] };
  if (!store.feedback.expandedArtists) store.feedback.expandedArtists = [];

  const key = artistName.trim().toLowerCase();
  if (store.feedback.expandedArtists.includes(key)) return []; // already expanded once — don't re-add duplicates

  const excludeName = rec.type === 'track' ? rec.name : null;
  const found = await searchArtistTracks(token, artistName, excludeName, 5);
  if (!found.length) return [];

  if (!store.playlist.id) {
    const playlist = await createPlaylist(token, PLAYLIST_NAME, PLAYLIST_DESCRIPTION);
    store.playlist.id = playlist.id;
    store.playlist.url = playlist.external_urls?.spotify || null;
  }

  await addPlaylistItems(token, store.playlist.id, found.map((t) => t.uri));
  store.feedback.expandedArtists.push(key);

  return found;
}

module.exports = { expandArtistIfNew };
