const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

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

module.exports = { loadStore, saveStore };
