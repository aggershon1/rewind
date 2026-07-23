const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
}

async function exchangeCodeForTokens(code, redirectUri) {
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!resp.ok) throw new Error(`Token exchange failed: ${await resp.text()}`);
  const data = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function refreshAccessToken(refreshToken) {
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Takes a { accessToken, refreshToken, expiresAt } record, returns a fresh one
// (same object if it wasn't close to expiry, a new one if it just got refreshed).
async function ensureFreshToken(tokenRecord) {
  if (!tokenRecord) throw Object.assign(new Error('not_logged_in'), { status: 401 });
  if (Date.now() < tokenRecord.expiresAt - 60_000) return tokenRecord;
  const fresh = await refreshAccessToken(tokenRecord.refreshToken);
  return fresh;
}

async function spotifyFetch(token, path, options = {}) {
  const resp = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw Object.assign(new Error(`Spotify API error (${resp.status}) on ${path}: ${text}`), { status: resp.status });
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// Spotify's top-items time_range only supports three fixed buckets.
// Map the user's requested week count onto the closest one.
function timeRangeForWeeks(weeks) {
  if (weeks <= 4) return { range: 'short_term', label: '~4 weeks' };
  if (weeks <= 26) return { range: 'medium_term', label: '~6 months' };
  return { range: 'long_term', label: 'several years' };
}

async function fetchHistory(token, weeks) {
  const { range, label } = timeRangeForWeeks(weeks);

  const [recentRaw, topArtists, topTracks] = await Promise.all([
    spotifyFetch(token, '/me/player/recently-played?limit=50'),
    spotifyFetch(token, `/me/top/artists?time_range=${range}&limit=20`),
    spotifyFetch(token, `/me/top/tracks?time_range=${range}&limit=20`),
  ]);

  const cutoff = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
  const recentlyPlayed = (recentRaw.items || [])
    .filter((it) => new Date(it.played_at).getTime() >= cutoff)
    .map((it) => ({
      track: it.track.name,
      artist: it.track.artists.map((a) => a.name).join(', '),
      playedAt: it.played_at,
    }));

  const genreCounts = {};
  for (const artist of topArtists.items || []) {
    for (const g of artist.genres || []) {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
  }
  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([genre, count]) => ({ genre, count }));

  return {
    weeksRequested: weeks,
    timeRangeUsed: range,
    timeRangeLabel: label,
    recentlyPlayed,
    recentlyPlayedNote:
      recentRaw.items && recentRaw.items.length === 50 && recentlyPlayed.length === 50
        ? 'Spotify only returns your last 50 plays, which may cover less than the window you asked for.'
        : null,
    topArtists: (topArtists.items || []).map((a) => ({
      name: a.name,
      genres: a.genres || [],
      image: a.images?.[2]?.url || a.images?.[0]?.url || null,
      url: a.external_urls?.spotify || null,
    })),
    topTracks: (topTracks.items || []).map((t) => ({
      name: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name || null,
      image: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
      url: t.external_urls?.spotify || null,
    })),
    topGenres,
  };
}

// Resolves one AI recommendation ({ type, name, artist, genre, reason }) to a real
// Spotify track URI via search. Tries a precise query first, then a looser one.
async function searchTrackUri(token, rec) {
  const tryQuery = async (q) => {
    const data = await spotifyFetch(token, `/search?q=${encodeURIComponent(q)}&type=track&limit=1`);
    return data?.tracks?.items?.[0] || null;
  };

  const preciseQuery =
    rec.type === 'track'
      ? `track:"${rec.name}"${rec.artist ? ` artist:"${rec.artist}"` : ''}`
      : `artist:"${rec.name}"`;

  let track = await tryQuery(preciseQuery).catch(() => null);
  if (!track) {
    const looseQuery = rec.type === 'track' ? `${rec.name} ${rec.artist || ''}` : rec.name;
    track = await tryQuery(looseQuery).catch(() => null);
  }
  if (!track) return null;

  return { uri: track.uri, name: track.name, artist: track.artists.map((a) => a.name).join(', ') };
}

async function createPlaylist(token, name, description) {
  return spotifyFetch(token, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: false }),
  });
}

// Fully replaces a playlist's contents with the given list of track URIs.
async function replacePlaylistItems(token, playlistId, uris) {
  return spotifyFetch(token, `/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify({ uris }),
  });
}

module.exports = {
  exchangeCodeForTokens,
  ensureFreshToken,
  fetchHistory,
  searchTrackUri,
  createPlaylist,
  replacePlaylistItems,
  timeRangeForWeeks,
};
