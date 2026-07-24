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

// Pages backward through /me/player/recently-played (cursor-based, via the `before`
// param) to tally how many times each track was actually played within the requested
// window — real repeat-listen counts, not Spotify's own opaque "top items" ranking.
// Capped at maxPages requests since Spotify's history depth for this endpoint isn't
// unlimited and we don't want a large "weeks" value to trigger unbounded API calls.
async function fetchPlayCounts(token, weeks, { maxPages = 10 } = {}) {
  const cutoffMs = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
  let before;
  let pages = 0;
  let allItems = [];
  let reachedEndOfHistory = false;
  let firstPageItems = [];

  while (pages < maxPages) {
    const data = await spotifyFetch(token, `/me/player/recently-played?limit=50${before ? `&before=${before}` : ''}`);
    const items = data.items || [];
    pages += 1;
    if (pages === 1) firstPageItems = items;
    if (!items.length) {
      reachedEndOfHistory = true;
      break;
    }
    allItems.push(...items);

    const oldestInPage = items[items.length - 1];
    const oldestTs = new Date(oldestInPage.played_at).getTime();
    if (oldestTs < cutoffMs) break; // gone back far enough already

    if (items.length < 50 || !data.cursors?.before) {
      reachedEndOfHistory = true;
      break;
    }
    before = data.cursors.before;
  }

  const withinWindow = allItems.filter((it) => new Date(it.played_at).getTime() >= cutoffMs);

  const counts = new Map();
  for (const it of withinWindow) {
    const t = it.track;
    const key = t.id || `${t.name}::${t.artists.map((a) => a.name).join(',')}`;
    if (!counts.has(key)) {
      counts.set(key, {
        trackId: t.id,
        name: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        uri: t.uri,
        count: 0,
        lastPlayedAt: it.played_at,
      });
    }
    counts.get(key).count += 1;
  }

  const ranked = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const oldestCovered = withinWindow.length ? withinWindow[withinWindow.length - 1].played_at : null;

  return {
    tracks: ranked,
    recentRaw: firstPageItems.map((it) => ({
      track: it.track.name,
      artist: it.track.artists.map((a) => a.name).join(', '),
      playedAt: it.played_at,
    })),
    totalPlaysCounted: withinWindow.length,
    pagesFetched: pages,
    hitPageCap: pages >= maxPages,
    reachedEndOfHistory,
    oldestCovered,
  };
}

async function fetchHistory(token, weeks) {
  const { range, label } = timeRangeForWeeks(weeks);

  const [topArtists, playCounts] = await Promise.all([
    spotifyFetch(token, `/me/top/artists?time_range=${range}&limit=20`),
    fetchPlayCounts(token, weeks),
  ]);

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

  const cutoffDate = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
  let coverageNote = null;
  if (playCounts.hitPageCap) {
    coverageNote = `Only counted your ${playCounts.totalPlaysCounted} most recent plays (hit the per-request page limit) — actual counts over the full ${weeks}-week window may be higher.`;
  } else if (playCounts.reachedEndOfHistory && playCounts.oldestCovered && new Date(playCounts.oldestCovered) > cutoffDate) {
    coverageNote = `Spotify's history for this endpoint only went back to ${new Date(playCounts.oldestCovered).toLocaleDateString()}, short of the full ${weeks}-week window requested.`;
  }

  return {
    weeksRequested: weeks,
    timeRangeUsed: range,
    timeRangeLabel: label,
    mostRepeatedTracks: playCounts.tracks.slice(0, 20),
    playCountCoverage: {
      totalPlaysCounted: playCounts.totalPlaysCounted,
      oldestCovered: playCounts.oldestCovered,
      note: coverageNote,
    },
    recentlyPlayed: playCounts.recentRaw,
    topArtists: (topArtists.items || []).map((a) => ({
      name: a.name,
      genres: a.genres || [],
      image: a.images?.[2]?.url || a.images?.[0]?.url || null,
      url: a.external_urls?.spotify || null,
    })),
    topGenres,
  };
}

// Resolves one AI recommendation ({ type, name, artist, genre, reason }) to a real
// Spotify track via search. Tries a precise query first, then a looser one.
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

  return {
    uri: track.uri,
    id: track.id,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    url: track.external_urls?.spotify || null,
  };
}

// Finds up to `limit` more tracks by the same artist, for the "liked a song -> pull in
// more from that artist" flow. Spotify removed "Get Artist's Top Tracks" for new apps
// in Feb 2026, so this leans on search with an artist: filter instead, matching results
// whose artist credits actually include the requested name.
async function searchArtistTracks(token, artistName, excludeTrackName, limit = 5) {
  const data = await spotifyFetch(
    token,
    `/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=10`
  );
  const items = data?.tracks?.items || [];
  const normalizedArtist = artistName.trim().toLowerCase();
  const normalizedExclude = (excludeTrackName || '').trim().toLowerCase();

  const seen = new Set();
  const matches = [];
  for (const t of items) {
    const artistNames = t.artists.map((a) => a.name.toLowerCase());
    const artistMatches = artistNames.some(
      (n) => n === normalizedArtist || n.includes(normalizedArtist) || normalizedArtist.includes(n)
    );
    if (!artistMatches) continue;
    if (normalizedExclude && t.name.trim().toLowerCase() === normalizedExclude) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    matches.push({
      uri: t.uri,
      id: t.id,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      url: t.external_urls?.spotify || null,
    });
    if (matches.length >= limit) break;
  }
  return matches;
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

// Appends tracks to a playlist without touching what's already there — used for the
// like-triggered "5 more from this artist" addition, distinct from the scheduled
// sync's full replace.
async function addPlaylistItems(token, playlistId, uris) {
  return spotifyFetch(token, `/playlists/${playlistId}/items`, {
    method: 'POST',
    body: JSON.stringify({ uris }),
  });
}

module.exports = {
  exchangeCodeForTokens,
  ensureFreshToken,
  fetchHistory,
  fetchPlayCounts,
  searchTrackUri,
  searchArtistTracks,
  createPlaylist,
  replacePlaylistItems,
  addPlaylistItems,
  timeRangeForWeeks,
};
