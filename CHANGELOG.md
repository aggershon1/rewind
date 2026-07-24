# Changelog

All notable changes to Rewind are documented here.

## Unreleased — Configurable count and track-promotion detection

### Added
- **Configurable recommendation count**: choose 10/20/30/50 per batch (interactive and
  scheduled sync each have their own control). Since one-pick-per-artist still applies,
  a request for 50 may honestly return fewer if that many distinct, well-justified
  artists aren't there — the response reports `requestedCount` alongside the actual
  list so the UI can say so explicitly rather than silently under-delivering.
- **Track-promotion detection** ("06 — track promotions"): pick a playlist you use to
  keep favorites (Starred, or anything else), and Rewind checks it — on page load and
  before every scheduled sync — for tracks it once recommended that have newly appeared
  there. A match is treated as a strong implicit Like, including the same
  artist-expansion bonus a manual Like triggers. The first check on a given playlist
  only captures a baseline, so pre-existing contents don't flood in as false positives.
- New module `lib/migration.js` (`checkMigrations`) and a durable `everRecommended` log
  in the store (capped at 500 entries) so a promotion can be recognized even weeks after
  the original recommendation.
- New endpoints: `GET/POST /api/migration/config`, `POST /api/migration/check`.
- `POST /api/recommendations` and `POST /api/playlist-config` both accept an optional
  `count`/`recommendationCount`, clamped to 1–50.

### Changed
- `getRecommendations` signature grew a `count` argument; `max_tokens` for the Anthropic
  call now scales with the requested count instead of a fixed value.
- No new Spotify OAuth scope required — track-promotion detection reuses the
  `playlist-read-private` permission added for duplicate detection.

## Unreleased — Weighting sliders and duplicate detection

### Fixed
- The "avoid duplicates" panel silently showed "No playlists found" whenever the
  `/api/library/playlists` request actually failed (most commonly: the Spotify token
  doesn't yet have the new `playlist-read-private` scope because the app wasn't
  reconnected after this update) — the error was fetched but never checked before being
  used. Now checks `response.ok` first and displays the real error, with a hint to
  reconnect Spotify when the failure looks scope-related.

### Added
- **Manual weighting sliders**: six toggleable dimensions (Lyrical themes,
  Aggressiveness, Intensity, Obscurity, Mood, Sonic similarity), each with its own 0–100%
  slider. The combined total is hard-capped at 100% client-side (dragging past what's
  left snaps to the remaining amount) and re-validated server-side. Enabled dimensions
  are folded into the prompt as explicit relative-priority instructions.
- **Duplicate detection against your library**: checks every recommendation against your
  Liked Songs and any playlists you select in the new "05 — avoid duplicates" panel (a
  playlist named "Starred" is auto-suggested if found). Flagged matches show a distinct
  tag in the UI and are skipped entirely when populating the Rewind Discoveries playlist,
  both in the interactive list and the scheduled auto-sync.
- **Manual "Already have this" button**: a third action alongside Like/Dislike, for
  anything the automatic library check misses (live versions, alternate titles, etc.).
  Auto-detected and manually-flagged duplicates share the same list and both feed future
  prompts as "never recommend this again."
- New endpoints: `GET/POST /api/library/config`, `GET /api/library/playlists`,
  `POST /api/library/refresh-index`. `POST /api/feedback` gained `duplicate`/`unduplicate`
  actions. `POST /api/recommendations` now accepts an optional `weights` object.
- New module `lib/library.js`: builds and caches a lookup index (track IDs + normalized
  name/artist keys) from Liked Songs and selected playlists, rebuilt hourly or on demand.
- Two new Spotify OAuth scopes: `playlist-read-private`, `user-library-read`.

### Changed
- `getRecommendations` signature grew two more arguments (`duplicateFeedback`, `weights`).
- The duplicate-check index is capped at 40 pages per source (~2,000–4,000 tracks) to
  bound worst-case request time for very large libraries.

## Unreleased — Play widget, dislikes, and artist expansion

### Fixed
- **False Spotify matches.** The play widget could show a completely unrelated song —
  e.g. a recommended "Pig Roast — Justice for the Damned" resolving to an unrelated
  Kottonmouth Kings track. Cause: the search fallback trusted whatever the top search
  result was, with no check that its artist actually matched what was recommended. Fixed
  by validating each candidate's artist against the expected one (checking several
  results, not just the first) and returning no match at all — rather than a wrong one —
  when nothing lines up. The UI now shows "No confident Spotify match found" in that case.

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
