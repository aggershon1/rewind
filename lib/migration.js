const { getPlaylistTrackRefs } = require('./spotify');
const { expandArtistIfNew } = require('./expand');

function feedbackKey(name, artist) {
  return `${(name || '').trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}`;
}

// Compares the current contents of store.migration.targetPlaylistId against the
// last-seen snapshot. Any track that's newly present AND was something Rewind has
// recommended before gets treated as an implicit Like (with the same artist-expansion
// bonus a manual Like triggers). Mutates `store` in place; caller persists via
// saveStore() — this never saves itself, matching the pattern used elsewhere.
async function checkMigrations(token, store) {
  if (!store.migration?.targetPlaylistId) return { newlyLiked: [] };

  const currentRefs = await getPlaylistTrackRefs(token, store.migration.targetPlaylistId);
  const currentIds = currentRefs.map((r) => r.id);

  // First-ever check on this playlist: just capture the baseline rather than treating
  // everything already in there as a brand-new "promotion" (which would be a flood of
  // false positives for a playlist that already had content before this feature existed).
  if (!store.migration.baselineSet) {
    store.migration.knownTrackIds = currentIds;
    store.migration.baselineSet = true;
    store.migration.lastCheckedAt = new Date().toISOString();
    return { newlyLiked: [], baselineJustSet: true };
  }

  const knownIds = new Set(store.migration.knownTrackIds || []);
  const newlyAdded = currentRefs.filter((r) => !knownIds.has(r.id));

  const recommendedById = new Map((store.everRecommended || []).map((r) => [r.trackId, r]));

  if (!store.feedback) store.feedback = { liked: [], disliked: [], duplicates: [], expandedArtists: [] };

  const newlyLiked = [];
  for (const track of newlyAdded) {
    const rec = recommendedById.get(track.id);
    if (!rec) continue; // not something Rewind ever recommended — not our signal to react to

    const key = feedbackKey(rec.name, rec.artist);
    const alreadyLiked = (store.feedback.liked || []).some((f) => f.key === key);
    if (alreadyLiked) continue;

    store.feedback.liked = (store.feedback.liked || []).filter((f) => f.key !== key);
    store.feedback.disliked = (store.feedback.disliked || []).filter((f) => f.key !== key);
    store.feedback.duplicates = (store.feedback.duplicates || []).filter((f) => f.key !== key);
    store.feedback.liked.push({
      key,
      name: rec.name,
      artist: rec.artist || null,
      type: 'track',
      genre: rec.genre || null,
      reason: 'Moved to your graduation playlist',
      likedAt: new Date().toISOString(),
    });

    let expansionTracks = [];
    try {
      expansionTracks = await expandArtistIfNew(token, store, { name: rec.name, artist: rec.artist, type: 'track' });
    } catch (err) {
      console.error('Artist expansion failed during migration check (like was still recorded):', err);
    }

    newlyLiked.push({ name: rec.name, artist: rec.artist, expansionTracks });
  }

  store.migration.knownTrackIds = currentIds;
  store.migration.lastCheckedAt = new Date().toISOString();
  return { newlyLiked };
}

module.exports = { checkMigrations };
