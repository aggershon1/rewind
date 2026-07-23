const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function buildPrompt(history) {
  const genreLines = history.topGenres.map((g) => `${g.genre} (x${g.count})`).join(', ') || 'none found';
  const artistLines =
    history.topArtists.map((a) => `${a.name} [${a.genres.slice(0, 3).join(', ')}]`).join('\n') || 'none';
  const trackLines = history.topTracks.map((t) => `${t.name} — ${t.artist}`).join('\n') || 'none';
  const recentLines =
    history.recentlyPlayed.map((r) => `${r.track} — ${r.artist}`).join('\n') || 'no plays in this window';

  return `Here is a listener's Spotify activity, covering roughly the last ${history.weeksRequested} week(s) (Spotify's closest supported window: ${history.timeRangeLabel}).

TOP GENRES: ${genreLines}

TOP ARTISTS:
${artistLines}

TOP TRACKS:
${trackLines}

RECENTLY PLAYED (within the requested window):
${recentLines}

Based on the patterns above — genre blends, era, energy, and any artists that recur — recommend artists and songs this listener has probably NOT already heard, favoring lesser-known but stylistically-aligned picks over the most obvious mainstream names. Give a mix of artist-level and song-level picks.

Respond with ONLY a JSON array (no markdown fences, no commentary), 8 to 12 items, each shaped like:
{"type": "artist" | "track", "name": "string", "artist": "string or null (the performing artist, only for type=track)", "genre": "string", "reason": "one sentence tying it to something specific in their listening pattern"}`;
}

async function getRecommendations(history) {
  const prompt = buildPrompt(history);

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error(`Anthropic API error: ${await resp.text()}`);

  const data = await resp.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  const raw = (textBlock?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '');

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse recommendations from model output: ${raw.slice(0, 200)}`);
  }
}

module.exports = { buildPrompt, getRecommendations };
