const { loadStore, saveStore } = require('./store');
const { ensureFreshToken, fetchHistory, searchTrackUri, createPlaylist, replacePlaylistItems } = require('./spotify');
const { getRecommendations } = require('./recommend');
const { PLAYLIST_NAME, PLAYLIST_DESCRIPTION } = require('./constants');
const { buildReferenceIndex, isIndexStale, toLookupSets, isDuplicateTrack } = require('./library');

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
    const recommendations = await getRecommendations(
      history,
      store.feedback?.liked || [],
      store.feedback?.disliked || [],
      store.feedback?.duplicates || []
    );

    if (!store.dedup) store.dedup = { referencePlaylistIds: [], includeSavedTracks: true, cachedIndex: null };
    if (isIndexStale(store.dedup.cachedIndex) && (store.dedup.includeSavedTracks || store.dedup.referencePlaylistIds.length)) {
      store.dedup.cachedIndex = await buildReferenceIndex(freshToken.accessToken, store.dedup).catch((err) => {
        console.error('Could not build duplicate-check index during sync (continuing without it):', err);
        return store.dedup.cachedIndex;
      });
    }
    const lookup = store.dedup.cachedIndex ? toLookupSets(store.dedup.cachedIndex) : null;

    const resolved = [];
    for (const rec of recommendations) {
      const match = await searchTrackUri(freshToken.accessToken, rec);
      if (!match || resolved.some((r) => r.uri === match.uri)) continue;
      if (lookup && isDuplicateTrack(lookup, match)) continue; // already in the listener's library/reference playlists
      resolved.push(match);
    }

    if (!resolved.length) {
      throw new Error('None of the recommended tracks or artists could be matched on Spotify (or all were already in your library).');
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

module.exports = { syncPlaylistCore };
