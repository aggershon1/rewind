const { loadStore, saveStore } = require('./store');
const { ensureFreshToken, fetchHistory, searchTrackUri, createPlaylist, replacePlaylistItems } = require('./spotify');
const { getRecommendations } = require('./recommend');

const PLAYLIST_NAME = 'Rewind Discoveries';
const PLAYLIST_DESCRIPTION = 'Auto-refreshed by Rewind — new picks based on your recent Spotify listening.';

async function syncPlaylistCore() {
  const store = loadStore();

  if (!store.spotify) {
    return { ok: false, error: 'Not connected to Spotify yet.' };
  }

  try {
    const freshToken = await ensureFreshToken(store.spotify);
    store.spotify = freshToken;

    const weeks = store.config.weeks || 4;
    const history = await fetchHistory(freshToken.accessToken, weeks);
    const recommendations = await getRecommendations(history, store.feedback?.liked || []);

    const resolved = [];
    for (const rec of recommendations) {
      const match = await searchTrackUri(freshToken.accessToken, rec);
      if (match && !resolved.some((r) => r.uri === match.uri)) resolved.push(match);
    }

    if (!resolved.length) {
      throw new Error('None of the recommended tracks or artists could be matched on Spotify.');
    }

    if (!store.playlist.id) {
      const playlist = await createPlaylist(freshToken.accessToken, PLAYLIST_NAME, PLAYLIST_DESCRIPTION);
      store.playlist.id = playlist.id;
      store.playlist.url = playlist.external_urls?.spotify || null;
    }

    await replacePlaylistItems(freshToken.accessToken, store.playlist.id, resolved.map((r) => r.uri));

    store.playlist.lastSyncAt = new Date().toISOString();
    store.playlist.lastSyncStatus = 'ok';
    store.playlist.lastSyncError = null;
    store.playlist.lastTrackCount = resolved.length;
    saveStore(store);

    return { ok: true, playlist: store.playlist, trackCount: resolved.length };
  } catch (err) {
    store.playlist.lastSyncAt = new Date().toISOString();
    store.playlist.lastSyncStatus = 'error';
    store.playlist.lastSyncError = err.message;
    saveStore(store);
    console.error('Playlist sync failed:', err);
    return { ok: false, error: err.message, playlist: store.playlist };
  }
}

module.exports = { syncPlaylistCore, PLAYLIST_NAME };
