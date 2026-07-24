const { WEIGHT_DIMENSIONS } = require('./constants');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function buildWeightsSection(weights) {
  if (!weights || !Object.keys(weights).length) return '';
  const lines = Object.entries(weights)
    .filter(([, pct]) => pct > 0)
    .map(([id, pct]) => {
      const dim = WEIGHT_DIMENSIONS.find((d) => d.id === id);
      const label = dim ? dim.label : id;
      const desc = dim ? ` — ${dim.description}` : '';
      return `${label}: ${pct}%${desc}`;
    });
  if (!lines.length) return '';
  return `\n\nTHE LISTENER HAS MANUALLY SET THESE RECOMMENDATION PRIORITIES (each is an independent emphasis level out of 100%, not a strict split — weight your picks and reasoning more heavily toward whichever of these has the higher number; dimensions not listed get only normal/default consideration):\n${lines.join('\n')}`;
}

function buildPrompt(history, likedFeedback = [], dislikedFeedback = [], duplicateFeedback = [], weights = {}) {
  const genreLines = history.topGenres.map((g) => `${g.genre} (x${g.count})`).join(', ') || 'none found';
  const artistLines =
    history.topArtists.map((a) => `${a.name} [${a.genres.slice(0, 3).join(', ')}]`).join('\n') || 'none';
  const repeatedLines =
    history.mostRepeatedTracks.map((t) => `${t.name} — ${t.artist} (played ${t.count}x)`).join('\n') ||
    'none found';
  const recentLines =
    history.recentlyPlayed.map((r) => `${r.track} — ${r.artist}`).join('\n') || 'no plays in this window';

  const likedSection = likedFeedback.length
    ? `\n\nTHIS LISTENER HAS PREVIOUSLY LIKED THESE RECOMMENDATIONS (use them to calibrate taste — lean into the underlying style/genre, but don't just re-suggest the same items again):\n${likedFeedback
        .map((f) => `${f.name}${f.artist ? ` — ${f.artist}` : ''}${f.genre ? ` [${f.genre}]` : ''}`)
        .join('\n')}`
    : '';

  const dislikedSection = dislikedFeedback.length
    ? `\n\nTHIS LISTENER HAS DISLIKED THESE PAST RECOMMENDATIONS, WITH THEIR STATED REASON (avoid similar picks for the same reason — e.g. if disliked for "Don't like this artist", avoid that artist entirely; if "Wrong mood/genre", steer away from that genre):\n${dislikedFeedback
        .map(
          (f) =>
            `${f.name}${f.artist ? ` — ${f.artist}` : ''}${f.genre ? ` [${f.genre}]` : ''} — reason: ${f.dislikeReason || 'not specified'}`
        )
        .join('\n')}`
    : '';

  const duplicatesSection = duplicateFeedback.length
    ? `\n\nTHE LISTENER ALREADY OWNS OR KNOWS THESE TRACKS/ARTISTS WELL — NEVER RECOMMEND THEM AGAIN:\n${duplicateFeedback
        .map((f) => `${f.name}${f.artist ? ` — ${f.artist}` : ''}`)
        .join('\n')}`
    : '';

  const weightsSection = buildWeightsSection(weights);

  return `Here is a listener's Spotify activity, covering roughly the last ${history.weeksRequested} week(s) (Spotify's closest supported window for top artists: ${history.timeRangeLabel}).

TOP GENRES: ${genreLines}

TOP ARTISTS:
${artistLines}

MOST REPEATED TRACKS (ranked by actual play count in this window — the strongest signal of genuine preference):
${repeatedLines}

RECENTLY PLAYED (most recent activity, not weighted by repetition):
${recentLines}${likedSection}${dislikedSection}${duplicatesSection}${weightsSection}

Based on the patterns above — especially the tracks with the highest repeat-play counts, plus genre blends, era, and energy — recommend artists and songs this listener has probably NOT already heard, favoring lesser-known but stylistically-aligned picks over the most obvious mainstream names. Give a mix of artist-level and song-level picks. Weight your picks more toward the style of heavily-repeated tracks than toward tracks that only appear once or twice.

IMPORTANT: include at most ONE pick per artist — do not recommend two different songs by the same artist, and do not recommend both an artist-level pick and a song by that same artist.

Respond with ONLY a JSON array (no markdown fences, no commentary), 8 to 12 items, each shaped like:
{"type": "artist" | "track", "name": "string", "artist": "string or null (the performing artist, only for type=track)", "genre": "string", "reason": "one sentence tying it to something specific in their listening pattern"}`;
}

// Guarantees the one-pick-per-artist rule server-side, since a model can't be trusted
// 100% of the time to follow it just from prompt instructions. Keeps the first
// occurrence of each artist and drops the rest.
function dedupeByArtist(recommendations) {
  const seen = new Set();
  const result = [];
  for (const rec of recommendations) {
    const artistKey = (rec.type === 'artist' ? rec.name : rec.artist || rec.name || '').trim().toLowerCase();
    if (artistKey) {
      if (seen.has(artistKey)) continue;
      seen.add(artistKey);
    }
    result.push(rec);
  }
  return result;
}

async function getRecommendations(history, likedFeedback = [], dislikedFeedback = [], duplicateFeedback = [], weights = {}) {
  const prompt = buildPrompt(history, likedFeedback, dislikedFeedback, duplicateFeedback, weights);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(`Anthropic API error: ${await resp.text()}`);

  const data = await resp.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  const raw = (textBlock?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse recommendations from model output: ${raw.slice(0, 200)}`);
  }

  return dedupeByArtist(parsed);
}

module.exports = { buildPrompt, getRecommendations, dedupeByArtist };
