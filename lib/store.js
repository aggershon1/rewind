const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const MAX_EVER_RECOMMENDED = 500;

const DEFAULT_STORE = {
  // { accessToken, refreshToken, expiresAt } once connected, else null
  spotify: null,
  playlist: {
    id: null,
    url: null,
    lastSyncAt: null,
    lastSyncStatus: null, // 'ok' | 'error'
    lastSyncError: null,
    lastTrackCount: null,
  },
  config: {
    enabled: false,
    cadence: 'weekly', // 'daily' | 'every3days' | 'weekly'
    hour: 8,
    minute: 0,
    weekday: 1, // 0=Sun..6=Sat, used only when cadence === 'weekly'
    weeks: 4,
    recommendationCount: 12, // used by the scheduled auto-playlist sync
  },
  feedback: {
    // [{ key, name, artist, type, genre, reason, likedAt }, ...], newest last
    liked: [],
    // [{ key, name, artist, type, genre, dislikeReason, dislikedAt }, ...]
    disliked: [],
    // [{ key, name, artist, type, genre, source: 'manual'|'auto', flaggedAt }, ...] —
    // things the listener already owns/knows, whether flagged by hand or auto-detected
    // against their library
    duplicates: [],
    // lowercased artist names already auto-expanded via a like, so we only add
    // the "5 more from this artist" batch once per artist rather than every like
    expandedArtists: [],
  },
  dedup: {
    referencePlaylistIds: [], // playlist IDs to check recommendations against
    includeSavedTracks: true, // also check the Liked Songs library
    cachedIndex: null, // { trackIds: [...], nameArtistKeys: [...], builtAt } — rebuilt hourly
  },
  migration: {
    targetPlaylistId: null, // playlist to watch for tracks the listener "graduates" into
    knownTrackIds: [], // snapshot from the last check
    baselineSet: false, // true once we've captured an initial snapshot (avoids a false-positive flood on first check)
    lastCheckedAt: null,
  },
  // Durable log of every track Rewind has ever surfaced as a recommendation, so a
  // migration check weeks later can still recognize it. Capped at MAX_EVER_RECOMMENDED.
  everRecommended: [], // [{ trackId, name, artist, genre, firstSeenAt }, ...]
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) return structuredClone(DEFAULT_STORE);
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    // Merge with defaults so fields added in later versions don't crash an older store file.
    return {
      spotify: parsed.spotify ?? DEFAULT_STORE.spotify,
      playlist: { ...DEFAULT_STORE.playlist, ...(parsed.playlist || {}) },
      config: { ...DEFAULT_STORE.config, ...(parsed.config || {}) },
      feedback: {
        ...DEFAULT_STORE.feedback,
        ...(parsed.feedback || {}),
        liked: parsed.feedback?.liked || [],
        disliked: parsed.feedback?.disliked || [],
        duplicates: parsed.feedback?.duplicates || [],
        expandedArtists: parsed.feedback?.expandedArtists || [],
      },
      dedup: { ...DEFAULT_STORE.dedup, ...(parsed.dedup || {}) },
      migration: { ...DEFAULT_STORE.migration, ...(parsed.migration || {}) },
      everRecommended: parsed.everRecommended || [],
    };
  } catch (err) {
    console.error('Could not read local store, starting fresh:', err.message);
    return structuredClone(DEFAULT_STORE);
  }
}

function saveStore(data) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Logs a resolved recommendation so a migration check (possibly weeks later) can still
// recognize it if the listener moves it into their "graduation" playlist. Mutates
// store in place; caller persists via saveStore().
function recordRecommended(store, entry) {
  if (!entry.trackId) return;
  if (!store.everRecommended) store.everRecommended = [];
  if (store.everRecommended.some((r) => r.trackId === entry.trackId)) return;
  store.everRecommended.push({ ...entry, firstSeenAt: new Date().toISOString() });
  if (store.everRecommended.length > MAX_EVER_RECOMMENDED) {
    store.everRecommended = store.everRecommended.slice(store.everRecommended.length - MAX_EVER_RECOMMENDED);
  }
}

module.exports = { loadStore, saveStore, recordRecommended };
