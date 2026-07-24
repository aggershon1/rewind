# Changelog

All notable changes to Rewind are documented here.

## Unreleased — Play counts & liked-feedback memory

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
