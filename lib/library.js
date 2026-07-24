const { getPlaylistTrackRefs, getSavedTrackRefs } = require('./spotify');

const INDEX_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — avoid re-walking a large library on every request

function normalizeKey(name, artist) {
  return `${(name || '').trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}`;
}

// Builds a fresh index from whatever sources are configured. Returns plain arrays
// (rather than Sets) since this gets persisted to the JSON store; use toLookupSets()
// to get an efficient structure for repeated lookups against it.
async function buildReferenceIndex(token, dedupConfig) {
  const trackIds = new Set();
  const nameArtistKeys = new Set();

  if (dedupConfig.includeSavedTracks) {
    const refs = await getSavedTrackRefs(token).catch((err) => {
      console.error('Could not fetch saved tracks for duplicate index:', err.message);
      return [];
    });
    refs.forEach((r) => {
      trackIds.add(r.id);
      nameArtistKeys.add(normalizeKey(r.name, r.artist));
    });
  }

  for (const playlistId of dedupConfig.referencePlaylistIds || []) {
    const refs = await getPlaylistTrackRefs(token, playlistId).catch((err) => {
      console.error(`Could not index playlist ${playlistId} for duplicates:`, err.message);
      return [];
    });
    refs.forEach((r) => {
      trackIds.add(r.id);
      nameArtistKeys.add(normalizeKey(r.name, r.artist));
    });
  }

  return {
    trackIds: Array.from(trackIds),
    nameArtistKeys: Array.from(nameArtistKeys),
    builtAt: new Date().toISOString(),
  };
}

function isIndexStale(cachedIndex) {
  if (!cachedIndex || !cachedIndex.builtAt) return true;
  return Date.now() - new Date(cachedIndex.builtAt).getTime() > INDEX_MAX_AGE_MS;
}

// Converts the persisted array-based index into Sets once per request, so checking
// many recommendations against it is O(1) each instead of O(n) array scans.
function toLookupSets(index) {
  return {
    trackIdSet: new Set(index?.trackIds || []),
    nameArtistSet: new Set(index?.nameArtistKeys || []),
  };
}

function isDuplicateTrack(lookup, track) {
  if (!lookup) return false;
  if (track.id && lookup.trackIdSet.has(track.id)) return true;
  return lookup.nameArtistSet.has(normalizeKey(track.name, track.artist));
}

module.exports = { buildReferenceIndex, isIndexStale, toLookupSets, isDuplicateTrack, normalizeKey };
