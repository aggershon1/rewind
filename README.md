# Rewind

Reads your recent Spotify listening (recently-played + top artists/tracks) and asks Claude to
reason over the pattern — genres, eras, recurring artists — to recommend new artists and songs
you probably haven't heard, rather than the obvious "more of the same." It can also maintain a
playlist on your Spotify called **"Rewind Discoveries"** and refresh its contents on a schedule.

It's a real, self-hosted app: a small Node/Express server handles Spotify login and talks to the
Anthropic API, and a plain HTML/JS frontend displays the result. No frameworks, no build step.

## Why it's built this way

Spotify retired its own Recommendations, Related Artists, and Audio Features endpoints for new
API integrations back in November 2024, and tightened Developer Mode further in February 2026
(moving playlist-editing to new endpoint paths in the process). So this app doesn't try to
reconstruct Spotify's old recommendation engine — instead it hands your listening summary to
Claude, lets it reason through the pattern directly, then resolves each pick to a real Spotify
track via search.

## 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Set the **Redirect URI** to exactly: `http://127.0.0.1:8888/callback`
   (must match `SPOTIFY_REDIRECT_URI` in your `.env` character-for-character — note Spotify requires
   the literal IP `127.0.0.1`, not `localhost`, for HTTP loopback redirects).
3. Copy the **Client ID** and **Client Secret**.

**Two current Spotify restrictions to know about**, from their February 2026 Developer Mode changes:
- Your Spotify account (the app owner) needs an active **Premium** subscription for Development
  Mode apps to keep working.
- Development Mode apps are capped at **5 authorized users**. If it's just you, that's a non-issue.

**If you set this app up before playlist features were added:** the login now requests
extra permissions — `playlist-modify-private` (to create/update the Rewind Discoveries
playlist) and, as of this update, `playlist-read-private` + `user-library-read` (to check
recommendations against your other playlists and Liked Songs). Click **Disconnect** in
the app, then **Connect Spotify** again to re-authorize with the current set of scopes.

## 2. Get an Anthropic API key

Create one at [console.anthropic.com](https://console.anthropic.com) if you don't have one. This app
calls the API directly with your key and pays per request — unrelated to any claude.ai subscription.

## 3. Configure

```bash
cp .env.example .env
```

Fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `ANTHROPIC_API_KEY`. Everything else has
a sane default.

## 4. Run it

Requires Node 18+ (for built-in `fetch`).

```bash
npm install
npm start
```

Visit **http://127.0.0.1:8888**, click **Connect Spotify**, approve access, then set how many weeks
back you want and hit **Analyze**, followed by **Get recommendations**.

## How recommendations are actually built

A few things drive what Claude sees, and what you see back:

1. **Real play counts, not Spotify's own ranking.** Rather than using Spotify's opaque
   "top tracks" algorithm, Rewind pages backward through `/me/player/recently-played`
   (it supports cursor pagination via `before`, which most integrations skip) and tallies
   how many times each track was actually played within your chosen week window. That
   ranked list — genuine repeat-listen counts — is the primary signal in the prompt, not
   just "was this played at some point in the window." This is capped at 10 pages (500
   plays) per request to keep API usage sane; if you hit that cap, or if Spotify's own
   history for this endpoint doesn't go back as far as you asked, the app tells you.
2. **One pick per artist.** Both a prompt instruction and a hard server-side filter —
   the model is told not to repeat an artist, and the app drops any duplicate anyway, so
   you'll never see two songs by the same act in one batch.
3. **Play it right in the browser.** Each recommendation is resolved to a real Spotify
   track and shown with Spotify's own embedded player (no separate playback setup or
   extra permissions needed — it uses whatever Spotify session your browser already
   has, and falls back to a 30-second preview if you're not logged in there).
4. **Like, dislike, and reasons — all remembered.** Every pick has a **Like** and
   **Dislike** button. Disliking one asks why (not your style, don't like the artist,
   already overplayed, wrong mood, or other), and both liked and disliked history —
   reasons included — get folded into every future prompt, interactive or scheduled, so
   the model steers toward what's worked and away from what hasn't.
5. **Liking a track pulls in more from that artist automatically.** The first time you
   like a pick, Rewind searches for up to 5 more songs by the same artist, adds them
   straight to your Rewind Discoveries playlist, and lists them right there in the UI —
   each with its own Like button. Liking one of *those* only records feedback; it won't
   trigger another expansion round, so it can't cascade. This only fires once per
   artist — liking a second song by an artist you've already expanded won't add
   duplicates.
6. **Manual weighting sliders.** Before hitting "Get recommendations," you can turn on
   any of six dimensions — Lyrical themes, Aggressiveness, Intensity, Obscurity, Mood,
   Sonic similarity — each with its own 0–100% slider. The combined total is hard-capped
   at 100%: dragging past what's left just snaps back to the remaining amount. Whatever
   you set gets folded into the prompt as explicit relative-priority instructions.
7. **Duplicate detection against your own library.** Rewind can check every
   recommendation against your Liked Songs and any playlists you select (a playlist
   named "Starred" gets auto-suggested if one exists) — flagging matches in the UI and
   skipping them entirely when building the Rewind Discoveries playlist. Automatic
   matching can miss things (live versions, alternate titles), so there's also a manual
   **"Already have this"** button for anything the automatic check doesn't catch. Either
   way, once something's flagged, it's remembered and excluded from future
   recommendations too.

## Weighting, and avoiding what you already have

- **Weighting sliders** live just above the "Get recommendations" button. They're
  optional — leave everything off and recommendations work exactly as before. Only
  dimensions you've explicitly enabled get sent; the rest get "normal" consideration.
- **Duplicate checking** lives in its own settings panel ("05 — avoid duplicates"). It
  needs two additional Spotify permissions (`playlist-read-private`, `user-library-read`)
  beyond what earlier versions requested — **if you set this app up before this feature,
  you'll need to Disconnect and Connect Spotify again** to grant them.
- The duplicate index (a list of track IDs from your selected sources) is cached for an
  hour to avoid re-walking a large library on every request; there's a "Refresh index
  now" button if you want it rebuilt immediately after changing your Liked Songs or
  playlists.
- For very large libraries, indexing is capped at 40 pages per source (2,000–4,000
  tracks depending on the endpoint) to keep a single request from running away — more
  than enough for realistic personal libraries, but worth knowing about if you have an
  unusually massive Liked Songs collection.

## How the "weeks" window works

Spotify's `recently-played` endpoint returns real timestamps, so play counts respect your
exact window (subject to the pagination cap above). Its `top artists` endpoint (used only
for the genre breakdown) supports just three fixed buckets — roughly 4 weeks, 6 months, or
several years — so Rewind snaps your chosen week count to whichever is closest for that
part specifically.

## Auto-Record: a synced playlist on a schedule

The **"04 — auto-record"** panel lets Rewind maintain a real Spotify playlist, refreshed on a
schedule you set (daily / every 3 days / weekly, at whatever time you pick):

- **Each refresh replaces the playlist's contents** with a fresh batch — it's a rotating discovery
  playlist, not one that accumulates. If you want to keep a track, save or move it elsewhere before
  the next cycle. (This includes tracks added via the like-triggered artist expansion above — if you
  like something between scheduled syncs, the next full sync still replaces the whole playlist.)
- The first sync creates the playlist (private, named "Rewind Discoveries"); later syncs reuse it.
- **"Sync now"** runs the whole pipeline immediately, so you can see it work without waiting for
  the schedule.
- Every recommendation goes through Spotify's search API to find a matching real track — a small
  number may not resolve to anything (obscure names, typos in an artist's spelling) and get
  skipped silently; the rest still populate the playlist.

**Important:** the schedule only fires while `node server.js` (i.e. `npm start`) is an actively
running process on this computer. It's not a cloud job — closing the terminal, restarting your
computer, or your laptop sleeping will all cause a scheduled run to be skipped (it won't "catch up"
later; it just waits for the next scheduled time while the process happens to be running). Your
schedule setting and playlist ID persist across restarts in `.data/store.json`, so nothing is lost —
it just won't run unattended unless something keeps the process alive. Options if you want it to
run truly hands-off:
- Leave the terminal open / the app running.
- Use a lightweight process manager like [pm2](https://pm2.keymetrics.io/) (`npm i -g pm2`, then
  `pm2 start server.js --name rewind`) so it restarts automatically and survives terminal closes
  (though not a full computer shutdown).
- Deploy it to a small always-on host (a spare Raspberry Pi, a $5/mo VPS, Render, Railway, etc.) —
  see the deployment notes below for what changes.

## Where things are stored

`.data/store.json` (created automatically, git-ignored) holds your Spotify refresh token, the
playlist ID once created, and your schedule settings — all in plain text on your local disk. That's
a reasonable trade-off for a single-user local tool, but don't commit it or share the file, and
don't deploy this as-is somewhere multi-user without adding real encryption/auth around it.

## Deploying beyond localhost

This is set up for local use. If you deploy it somewhere real:
- Update `SPOTIFY_REDIRECT_URI` to your real HTTPS domain, and update the Redirect URI in the
  Spotify dashboard to match exactly.
- `.data/store.json` needs to live on persistent disk (not an ephemeral filesystem that resets on
  redeploy), or swap it for a real database.
- Set `NODE_ENV=production` and serve behind HTTPS.

## Project structure

```
server.js                 Express server: routes only, wires up the lib/ modules below
lib/store.js               Local JSON-file persistence (tokens, playlist id, schedule, feedback, dedup config)
lib/spotify.js              Spotify OAuth + API calls (history, search, playlist writes, library pagination)
lib/library.js               Builds/caches the "tracks you already have" index for duplicate detection
lib/recommend.js            Builds the prompt, calls the Anthropic API, dedupes by artist
lib/expand.js                Like-triggered "5 more from this artist" playlist expansion
lib/constants.js             Shared playlist name/description
lib/playlistSync.js         The core sync routine: history → recommendations → playlist
lib/scheduler.js            node-cron wiring, rebuilt whenever the schedule changes
public/index.html          Page markup
public/css/style.css       Styling
public/js/app.js            Frontend logic
.env.example                Config template — copy to .env
```
