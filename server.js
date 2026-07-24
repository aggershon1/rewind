require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const { loadStore, saveStore } = require('./lib/store');
const { exchangeCodeForTokens, ensureFreshToken, fetchHistory } = require('./lib/spotify');
const { getRecommendations } = require('./lib/recommend');
const { syncPlaylistCore } = require('./lib/playlistSync');
const { reschedule } = require('./lib/scheduler');

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, ANTHROPIC_API_KEY, PORT } = process.env;

const REQUIRED = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'ANTHROPIC_API_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in before starting the server.');
  process.exit(1);
}

// playlist-modify-private is needed to create and rewrite the "Rewind Discoveries" playlist.
const SCOPES = 'user-read-recently-played user-top-read playlist-modify-private';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Single-user, local app: a plain in-memory value is enough to guard the OAuth
// roundtrip against CSRF. No session cookie needed since tokens live in .data/store.json.
let pendingOAuthState = null;

// ---------- Spotify OAuth ----------

app.get('/login', (req, res) => {
  pendingOAuthState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state: pendingOAuthState,
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect(`/?error=${encodeURIComponent(error)}`);
  if (!state || state !== pendingOAuthState) return res.redirect('/?error=state_mismatch');
  pendingOAuthState = null;

  try {
    const tokens = await exchangeCodeForTokens(code, SPOTIFY_REDIRECT_URI);
    const store = loadStore();
    store.spotify = tokens;
    saveStore(store);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.redirect('/?error=server_error');
  }
});

app.get('/logout', (req, res) => {
  const store = loadStore();
  store.spotify = null; // playlist id/config are left intact so reconnecting resumes cleanly
  saveStore(store);
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  res.json({ loggedIn: !!loadStore().spotify });
});

// ---------- Shared token helper for interactive routes ----------

async function getValidAccessToken() {
  const store = loadStore();
  if (!store.spotify) throw Object.assign(new Error('not_logged_in'), { status: 401 });
  const fresh = await ensureFreshToken(store.spotify);
  store.spotify = fresh;
  saveStore(store);
  return fresh.accessToken;
}

// ---------- Listening history & recommendations ----------

app.get('/api/history', async (req, res) => {
  const weeks = Math.min(52, Math.max(1, parseInt(req.query.weeks, 10) || 4));
  try {
    const token = await getValidAccessToken();
    const data = await fetchHistory(token, weeks);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/recommendations', async (req, res) => {
  const weeks = Math.min(52, Math.max(1, parseInt(req.body?.weeks, 10) || 4));
  try {
    const token = await getValidAccessToken();
    const history = await fetchHistory(token, weeks);
    const store = loadStore();
    const recommendations = await getRecommendations(history, store.feedback?.liked || []);
    res.json({ recommendations, basedOn: { weeksRequested: weeks, timeRangeLabel: history.timeRangeLabel } });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------- Auto-playlist schedule ----------

app.get('/api/playlist-config', (req, res) => {
  const store = loadStore();
  res.json({ config: store.config, playlist: store.playlist, connected: !!store.spotify });
});

app.post('/api/playlist-config', (req, res) => {
  const store = loadStore();
  const body = req.body || {};

  const config = {
    enabled: !!body.enabled,
    cadence: ['daily', 'every3days', 'weekly'].includes(body.cadence) ? body.cadence : store.config.cadence,
    hour: Number.isInteger(body.hour) ? Math.min(23, Math.max(0, body.hour)) : store.config.hour,
    minute: Number.isInteger(body.minute) ? Math.min(59, Math.max(0, body.minute)) : store.config.minute,
    weekday: Number.isInteger(body.weekday) ? Math.min(6, Math.max(0, body.weekday)) : store.config.weekday,
    weeks: Math.min(52, Math.max(1, parseInt(body.weeks, 10) || store.config.weeks)),
  };

  store.config = config;
  saveStore(store);
  reschedule(config);
  res.json({ config });
});

app.post('/api/playlist-sync', async (req, res) => {
  const result = await syncPlaylistCore();
  res.status(result.ok ? 200 : 500).json(result);
});

// ---------- Recommendation feedback (liked picks feed future prompts) ----------

function feedbackKey(name, artist) {
  return `${(name || '').trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}`;
}

const MAX_LIKED = 100;

app.get('/api/feedback', (req, res) => {
  const store = loadStore();
  res.json({ liked: store.feedback?.liked || [] });
});

app.post('/api/feedback', (req, res) => {
  const { name, artist, type, genre, reason, liked } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const store = loadStore();
  if (!store.feedback) store.feedback = { liked: [] };
  const key = feedbackKey(name, artist);
  const existingIndex = store.feedback.liked.findIndex((f) => f.key === key);

  if (liked === false) {
    if (existingIndex !== -1) store.feedback.liked.splice(existingIndex, 1);
  } else {
    const entry = { key, name, artist: artist || null, type: type || null, genre: genre || null, reason: reason || null, likedAt: new Date().toISOString() };
    if (existingIndex !== -1) {
      store.feedback.liked[existingIndex] = entry;
    } else {
      store.feedback.liked.push(entry);
      if (store.feedback.liked.length > MAX_LIKED) {
        store.feedback.liked = store.feedback.liked.slice(store.feedback.liked.length - MAX_LIKED);
      }
    }
  }

  saveStore(store);
  res.json({ liked: store.feedback.liked });
});

// ---------- Startup ----------

reschedule(loadStore().config);

const port = PORT || 8888;
app.listen(port, () => {
  console.log(`Rewind running at http://127.0.0.1:${port}`);
});
