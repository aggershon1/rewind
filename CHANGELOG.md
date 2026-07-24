# Changelog

All notable changes to Rewind are documented here.

## Unreleased — Play widget, dislikes, and artist expansion

### Added
- **Play button in the browser**: each recommendation is now resolved to a real Spotify
  track and rendered with Spotify's own embedded player widget — no extra OAuth scopes,
  uses whatever Spotify session the browser already has, falls back to a 30-second
  preview otherwise.
- **Dislike button with reasons**: alongside Like, each pick can be disliked with a quick
  reason ("Not my style," "Don't like this artist," "Already know it well," "Wrong
  mood/genre," "Other"). Disliked picks and their reasons are folded into every future
  prompt so the model actively steers away from them.
- **Automatic artist expansion on like**: the first time you like a pick, Rewind
  searches for up to 5 more songs by that artist, adds them straight to the Rewind
  Discoveries playlist, and displays them inline with their own Like button. Liking one
  of those only records feedback — no further expansion, so it can't cascade. Runs at
  most once per artist (tracked in `feedback.expandedArtists`).
- **One pick per artist, guaranteed**: enforced both as a prompt instruction and a
  server-side filter (`dedupeByArtist`) that drops any repeat artist regardless of what
  the model returns.
- New endpoints: `lib/expand.js` (`expandArtistIfNew`), extended `POST /api/feedback` to
  take an `action` of `like` / `unlike` / `dislike` / `undislike` instead of a single
  boolean, plus new Spotify helpers `searchArtistTracks` and `addPlaylistItems`.

### Changed
- `store.feedback` now also holds `disliked` (with reasons) and `expandedArtists`.
- `getRecommendations` signature grew a third argument (`dislikedFeedback`) and now
  returns an artist-deduped list.
- `POST /api/recommendations` response now includes a `spotify: { id, uri, url }` field
  per recommendation (null if no match was found) for the play widget and open-in-Spotify
  link.

## v1.1 — Play counts & liked-feedback memory

### Added
- Recommendations are now ranked by **real play counts**, tallied by paginating through
  Spotify's `recently-played` endpoint (via its `before` cursor) rather than relying on
  Spotify's own opaque "top tracks" ranking. Capped at 10 pages (500 plays) per request.
- A **Like** button on each AI recommendation. Liked picks persist locally in
  `.data/store.json` and are included in every future recommendation prompt — both the
  interactive "Get recommendations" button and the scheduled auto-playlist sync — so
  recommendations calibrate to your taste over time instead of resetting each session.
- Coverage notes shown when play-count pagination hits its page cap, or when Spotify's
  own history for the endpoint doesn't reach as far back as the requested window.
- New endpoints: `GET /api/feedback`, `POST /api/feedback`.

### Changed
- The "Top tracks" panel is now **"Most repeated tracks,"** showing each track's actual
  play count (`×N`) instead of Spotify's algorithmic ranking.
- `lib/spotify.js`'s `fetchHistory` now returns `mostRepeatedTracks` and
  `playCountCoverage` in place of the old `topTracks` and `recentlyPlayedNote` fields.

## v1.0 — Initial release

### Added
- Spotify OAuth login (Authorization Code flow) and a small Express/Node backend.
- Listening-history pull: recently-played tracks, top artists, and derived top genres,
  windowed by a user-selectable number of weeks.
- AI-generated artist/song recommendations via the Anthropic API, reasoning over
  listening patterns rather than Spotify's discontinued Recommendations endpoint.
- **Auto-Record**: a scheduled background job (daily / every 3 days / weekly) that
  creates and refreshes a private "Rewind Discoveries" playlist on Spotify with a fresh
  batch of picks each cycle.
- Manual "Sync now" trigger for the auto-playlist, independent of the schedule.
- Tape-deck/mixtape-themed UI: VU-meter loading states, a tape-counter week selector,
  genre bars, and a numbered mixtape-style recommendation list.
