(function () {
  const authArea = document.getElementById('authArea');
  const loggedOut = document.getElementById('loggedOut');
  const dashboard = document.getElementById('dashboard');
  const errorNote = document.getElementById('errorNote');

  const weeksDisplay = document.getElementById('weeksDisplay');
  const weeksDown = document.getElementById('weeksDown');
  const weeksUp = document.getElementById('weeksUp');
  const analyzeBtn = document.getElementById('analyzeBtn');

  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loadingText');
  const resultsArea = document.getElementById('resultsArea');

  const rangeNote = document.getElementById('rangeNote');
  const genreBars = document.getElementById('genreBars');
  const topArtistsEl = document.getElementById('topArtists');
  const topTracksEl = document.getElementById('topTracks');
  const repeatCoverageNote = document.getElementById('repeatCoverageNote');
  const recentNote = document.getElementById('recentNote');
  const recentStrip = document.getElementById('recentStrip');

  const recsBtn = document.getElementById('recsBtn');
  const recsLoading = document.getElementById('recsLoading');
  const recsList = document.getElementById('recsList');
  const weightRowsEl = document.getElementById('weightRows');
  const weightTotalEl = document.getElementById('weightTotal');

  const autoEnabled = document.getElementById('autoEnabled');
  const autoStatusLabel = document.getElementById('autoStatusLabel');
  const cadenceSelect = document.getElementById('cadenceSelect');
  const weekdayField = document.getElementById('weekdayField');
  const weekdaySelect = document.getElementById('weekdaySelect');
  const timeInput = document.getElementById('timeInput');
  const autoWeeksSelect = document.getElementById('autoWeeksSelect');
  const saveScheduleBtn = document.getElementById('saveScheduleBtn');
  const syncNowBtn = document.getElementById('syncNowBtn');
  const syncStatus = document.getElementById('syncStatus');

  const includeSavedTracksEl = document.getElementById('includeSavedTracks');
  const playlistChecklistEl = document.getElementById('playlistChecklist');
  const saveLibraryConfigBtn = document.getElementById('saveLibraryConfigBtn');
  const refreshIndexBtn = document.getElementById('refreshIndexBtn');
  const indexStatus = document.getElementById('indexStatus');

  let weeks = 4;
  let likedMap = new Map();
  let dislikedMap = new Map();
  let duplicateMap = new Map();

  const DISLIKE_REASONS = ['Not my style', "Don't like this artist", 'Already know it well', 'Wrong mood/genre', 'Other'];

  // Keep in sync with WEIGHT_DIMENSIONS in lib/constants.js
  const WEIGHT_DIMENSIONS = [
    { id: 'lyricalThemes', label: 'Lyrical themes', description: 'Similar subject matter or messaging in the lyrics.' },
    { id: 'aggressiveness', label: 'Aggressiveness', description: 'Heavier, harsher, more aggressive-sounding picks.' },
    { id: 'intensity', label: 'Intensity', description: 'Higher energy, faster pacing, more dynamic tension.' },
    { id: 'obscurity', label: 'Obscurity', description: 'Lesser-known, more underground artists over popular ones.' },
    { id: 'mood', label: 'Mood', description: 'Matches the emotional tone/atmosphere of what you\'ve been playing.' },
    { id: 'sonicSimilarity', label: 'Sonic similarity', description: 'Similar production style and instrumentation.' },
  ];

  function feedbackKey(name, artist) {
    return `${(name || '').trim().toLowerCase()}::${(artist || '').trim().toLowerCase()}`;
  }
  function enc(v) {
    return encodeURIComponent(v || '');
  }

  // ---------- Recommendation weighting sliders ----------

  function renderWeightRows() {
    weightRowsEl.innerHTML = WEIGHT_DIMENSIONS.map(
      (d) => `
      <div class="weight-row" data-id="${d.id}">
        <label class="weight-checkbox" title="${d.description}">
          <input type="checkbox" class="weight-enable" />
          <span>${d.label}</span>
        </label>
        <input type="range" class="weight-slider" min="0" max="100" value="0" disabled />
        <span class="weight-value">0%</span>
      </div>`
    ).join('');
  }
  renderWeightRows();

  function currentWeightTotal(excludeRow) {
    let total = 0;
    weightRowsEl.querySelectorAll('.weight-row').forEach((row) => {
      if (row === excludeRow) return;
      if (!row.querySelector('.weight-enable').checked) return;
      total += parseInt(row.querySelector('.weight-slider').value, 10) || 0;
    });
    return total;
  }

  function updateWeightTotalDisplay() {
    weightTotalEl.textContent = String(currentWeightTotal(null));
  }

  function getWeightState() {
    const weights = {};
    weightRowsEl.querySelectorAll('.weight-row').forEach((row) => {
      const enabled = row.querySelector('.weight-enable').checked;
      const val = parseInt(row.querySelector('.weight-slider').value, 10) || 0;
      if (enabled && val > 0) weights[row.dataset.id] = val;
    });
    return weights;
  }

  weightRowsEl.addEventListener('change', (e) => {
    if (!e.target.classList.contains('weight-enable')) return;
    const row = e.target.closest('.weight-row');
    const slider = row.querySelector('.weight-slider');
    slider.disabled = !e.target.checked;
    if (!e.target.checked) {
      slider.value = 0;
      row.querySelector('.weight-value').textContent = '0%';
    } else if (slider.value === '0') {
      const remaining = 100 - currentWeightTotal(row);
      const starting = Math.max(0, Math.min(50, remaining));
      slider.value = String(starting);
      row.querySelector('.weight-value').textContent = `${starting}%`;
    }
    updateWeightTotalDisplay();
  });

  weightRowsEl.addEventListener('input', (e) => {
    if (!e.target.classList.contains('weight-slider')) return;
    const row = e.target.closest('.weight-row');
    const maxAllowed = 100 - currentWeightTotal(row);
    if (parseInt(e.target.value, 10) > maxAllowed) e.target.value = String(Math.max(0, maxAllowed));
    row.querySelector('.weight-value').textContent = `${e.target.value}%`;
    updateWeightTotalDisplay();
  });

  function setWeeks(n) {
    weeks = Math.min(52, Math.max(1, n));
    weeksDisplay.textContent = String(weeks).padStart(2, '0');
  }

  weeksDown.addEventListener('click', () => setWeeks(weeks - 1));
  weeksUp.addEventListener('click', () => setWeeks(weeks + 1));

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  function renderHistory(data) {
    rangeNote.textContent = `Genres use Spotify's "${data.timeRangeLabel}" top-artists bucket. Track play counts are tallied directly from your history over your exact ${data.weeksRequested}-week window.`;

    // Genre bars
    genreBars.innerHTML = '';
    const max = Math.max(1, ...data.topGenres.map((g) => g.count));
    data.topGenres.forEach((g) => {
      const pct = Math.round((g.count / max) * 100);
      const bar = document.createElement('div');
      bar.className = 'genre-bar';
      bar.innerHTML = `
        <div class="genre-bar-fill" style="height:${Math.max(pct, 8)}%"></div>
        <span class="genre-bar-label" title="${g.genre}">${g.genre}</span>
      `;
      genreBars.appendChild(bar);
    });
    if (!data.topGenres.length) {
      genreBars.innerHTML = '<p class="fine-print">No genre data available for this window.</p>';
    }

    // Top artists
    topArtistsEl.innerHTML = data.topArtists
      .map(
        (a) => `
      <a class="artist-card" href="${a.url || '#'}" target="_blank" rel="noopener">
        ${a.image ? `<img src="${a.image}" alt="${a.name}" />` : ''}
        <span class="name">${a.name}</span>
      </a>`
      )
      .join('');

    // Most repeated tracks (ranked by actual play count)
    const coverage = data.playCountCoverage || {};
    repeatCoverageNote.textContent =
      coverage.note || `Counted ${coverage.totalPlaysCounted || 0} play(s) across this window.`;
    topTracksEl.innerHTML =
      data.mostRepeatedTracks
        .map(
          (t) =>
            `<li><span class="track-name">${t.name}</span><span class="track-artist">— ${t.artist}</span><span class="play-count">×${t.count}</span></li>`
        )
        .join('') || '<li class="fine-print">No repeated plays found in this window.</li>';

    // Recently played (raw, most recent plays — not filtered to the week window)
    recentNote.textContent = `${data.recentlyPlayed.length} of your most recent plays (for reference — see "Most repeated tracks" above for window-based counts).`;
    recentStrip.innerHTML = data.recentlyPlayed
      .map(
        (r) => `
      <div class="recent-item">
        <span class="track-name">${r.track}</span>
        <span class="track-artist">${r.artist}</span>
        <span class="played-at">${timeAgo(r.playedAt)}</span>
      </div>`
      )
      .join('') || '<p class="fine-print">Nothing played recently.</p>';

    resultsArea.classList.remove('hidden');
    recsList.innerHTML = '';
  }

  async function runAnalysis() {
    loading.classList.remove('hidden');
    resultsArea.classList.add('hidden');
    loadingText.textContent = 'reading your last plays…';
    try {
      const resp = await fetch(`/api/history?weeks=${weeks}`);
      if (!resp.ok) throw new Error((await resp.json()).error || 'Request failed');
      const data = await resp.json();
      renderHistory(data);
    } catch (err) {
      alert(`Couldn't load your history: ${err.message}`);
    } finally {
      loading.classList.add('hidden');
    }
  }

  async function loadFeedbackMaps() {
    try {
      const resp = await fetch('/api/feedback');
      const data = await resp.json();
      likedMap = new Map((data.liked || []).map((f) => [f.key, f]));
      dislikedMap = new Map((data.disliked || []).map((f) => [f.key, f]));
      duplicateMap = new Map((data.duplicates || []).map((f) => [f.key, f]));
    } catch {
      likedMap = new Map();
      dislikedMap = new Map();
      duplicateMap = new Map();
    }
  }

  function embedHtml(spotify) {
    if (!spotify?.id) return '';
    return `<div class="embed-wrap"><iframe src="https://open.spotify.com/embed/track/${spotify.id}" width="100%" height="80" frameborder="0" allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture" loading="lazy"></iframe></div>`;
  }

  function actionAreaHtml(key) {
    const liked = likedMap.has(key);
    const disliked = dislikedMap.has(key);
    const duplicate = duplicateMap.has(key);

    if (liked) {
      return `<button type="button" class="like-btn liked" data-action="unlike">♥ Liked</button>`;
    }
    if (disliked) {
      const r = dislikedMap.get(key)?.dislikeReason;
      return `
        <span class="disliked-tag">👎 Disliked${r ? ` — ${r}` : ''}</span>
        <button type="button" class="undo-btn" data-action="undislike">Undo</button>`;
    }
    if (duplicate) {
      const src = duplicateMap.get(key)?.source === 'auto' ? ' — detected automatically' : '';
      return `
        <span class="duplicate-tag">📀 Already have this${src}</span>
        <button type="button" class="undo-btn" data-action="unduplicate">Not actually a duplicate</button>`;
    }
    return `
      <button type="button" class="like-btn" data-action="like">♡ Like</button>
      <button type="button" class="dislike-btn" data-action="show-dislike">👎 Dislike</button>
      <button type="button" class="duplicate-btn" data-action="duplicate">📀 Already have this</button>
      <div class="dislike-reasons hidden">
        ${DISLIKE_REASONS.map((r) => `<button type="button" class="reason-chip" data-action="dislike" data-reason="${r}">${r}</button>`).join('')}
      </div>`;
  }

  function renderRecs(recommendations) {
    recsList.innerHTML = (recommendations || [])
      .map((r) => {
        const key = feedbackKey(r.name, r.artist);
        if (r.duplicate && !duplicateMap.has(key)) {
          duplicateMap.set(key, { key, name: r.name, artist: r.artist, source: 'auto' });
        }
        return `
        <li data-key="${key}" data-name="${enc(r.name)}" data-artist="${enc(r.artist)}" data-type="${enc(r.type)}" data-genre="${enc(r.genre)}" data-reason="${enc(r.reason)}">
          <span class="mixtape-name">${r.name}${r.artist ? ` — ${r.artist}` : ''}</span>
          <span class="mixtape-type">${r.type}</span>
          <span class="mixtape-genre">${r.genre || ''}</span>
          <p class="mixtape-reason">${r.reason || ''}</p>
          ${embedHtml(r.spotify)}
          ${r.spotify?.url ? `<a class="open-spotify" href="${r.spotify.url}" target="_blank" rel="noopener">Open in Spotify ↗</a>` : '<p class="no-match-note">No confident Spotify match found for this pick.</p>'}
          <div class="action-area">${actionAreaHtml(key)}</div>
          <div class="expansion-list"></div>
        </li>`;
      })
      .join('');
  }

  function renderExpansionTracks(li, tracks) {
    const container = li.querySelector('.expansion-list');
    if (!tracks.length) return;
    container.innerHTML =
      `<p class="fine-print expansion-note">+ ${tracks.length} more from this artist — added to your Rewind Discoveries playlist:</p>` +
      tracks
        .map((t) => {
          const key = feedbackKey(t.name, t.artist);
          const liked = likedMap.has(key);
          return `
        <div class="expansion-item" data-key="${key}" data-name="${enc(t.name)}" data-artist="${enc(t.artist)}" data-type="track" data-genre="" data-reason="" data-expansion="true">
          <span class="track-name">${t.name}</span>
          <span class="track-artist">— ${t.artist}</span>
          ${embedHtml(t)}
          <button type="button" class="like-btn ${liked ? 'liked' : ''}" data-action="${liked ? 'unlike' : 'like'}">${liked ? '♥ Liked' : '♡ Like'}</button>
        </div>`;
        })
        .join('');
  }

  recsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'show-dislike') {
      btn.parentElement.querySelector('.dislike-reasons')?.classList.toggle('hidden');
      return;
    }

    const scope = btn.closest('.expansion-item') || btn.closest('li');
    const isExpansionScope = scope.classList.contains('expansion-item');

    const payload = {
      name: decodeURIComponent(scope.dataset.name),
      artist: decodeURIComponent(scope.dataset.artist),
      type: decodeURIComponent(scope.dataset.type || ''),
      genre: decodeURIComponent(scope.dataset.genre || ''),
      reason: decodeURIComponent(scope.dataset.reason || ''),
      action: btn.dataset.action,
      isExpansion: isExpansionScope,
    };
    if (btn.dataset.action === 'dislike') payload.dislikeReason = btn.dataset.reason;

    btn.disabled = true;
    try {
      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Save failed');
      const data = await resp.json();
      likedMap = new Map((data.liked || []).map((f) => [f.key, f]));
      dislikedMap = new Map((data.disliked || []).map((f) => [f.key, f]));
      duplicateMap = new Map((data.duplicates || []).map((f) => [f.key, f]));

      if (isExpansionScope) {
        const key = scope.dataset.key;
        const liked = likedMap.has(key);
        const likeBtn = scope.querySelector('.like-btn');
        likeBtn.classList.toggle('liked', liked);
        likeBtn.dataset.action = liked ? 'unlike' : 'like';
        likeBtn.textContent = liked ? '♥ Liked' : '♡ Like';
      } else {
        scope.querySelector('.action-area').innerHTML = actionAreaHtml(scope.dataset.key);
        if (btn.dataset.action === 'like' && data.expansionTracks?.length) {
          renderExpansionTracks(scope, data.expansionTracks);
        }
      }
    } catch (err) {
      alert(`Couldn't save that: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  async function runRecommendations() {
    recsLoading.classList.remove('hidden');
    recsList.innerHTML = '';
    recsBtn.disabled = true;
    try {
      await loadFeedbackMaps();
      const resp = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeks, weights: getWeightState() }),
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Request failed');
      const data = await resp.json();
      renderRecs(data.recommendations);
    } catch (err) {
      alert(`Couldn't get recommendations: ${err.message}`);
    } finally {
      recsLoading.classList.add('hidden');
      recsBtn.disabled = false;
    }
  }

  analyzeBtn.addEventListener('click', runAnalysis);
  recsBtn.addEventListener('click', runRecommendations);

  // ---------- Auto-playlist schedule ----------

  function updateCadenceUI() {
    weekdayField.classList.toggle('hidden', cadenceSelect.value !== 'weekly');
    autoStatusLabel.textContent = autoEnabled.checked ? 'on' : 'off';
  }
  cadenceSelect.addEventListener('change', updateCadenceUI);
  autoEnabled.addEventListener('change', updateCadenceUI);

  function renderSyncStatus(playlist) {
    if (!playlist || !playlist.lastSyncAt) {
      syncStatus.textContent = 'Not synced yet.';
      return;
    }
    const when = new Date(playlist.lastSyncAt).toLocaleString();
    if (playlist.lastSyncStatus === 'ok') {
      syncStatus.innerHTML =
        `Last synced ${when} — ${playlist.lastTrackCount} track(s).` +
        (playlist.url ? ` <a href="${playlist.url}" target="_blank" rel="noopener">Open in Spotify</a>` : '');
    } else {
      syncStatus.textContent = `Last attempt (${when}) failed: ${playlist.lastSyncError || 'unknown error'}`;
    }
  }

  async function loadPlaylistConfig() {
    try {
      const resp = await fetch('/api/playlist-config');
      const data = await resp.json();
      const c = data.config;
      autoEnabled.checked = !!c.enabled;
      cadenceSelect.value = c.cadence;
      weekdaySelect.value = String(c.weekday);
      timeInput.value = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
      autoWeeksSelect.value = String(c.weeks);
      updateCadenceUI();
      renderSyncStatus(data.playlist);
    } catch (err) {
      syncStatus.textContent = `Couldn't load schedule: ${err.message}`;
    }
  }

  saveScheduleBtn.addEventListener('click', async () => {
    const [hour, minute] = timeInput.value.split(':').map((n) => parseInt(n, 10));
    const body = {
      enabled: autoEnabled.checked,
      cadence: cadenceSelect.value,
      weekday: parseInt(weekdaySelect.value, 10),
      hour,
      minute,
      weeks: parseInt(autoWeeksSelect.value, 10),
    };
    saveScheduleBtn.disabled = true;
    try {
      const resp = await fetch('/api/playlist-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error('Save failed');
      syncStatus.textContent = 'Schedule saved.';
    } catch (err) {
      alert(`Couldn't save schedule: ${err.message}`);
    } finally {
      saveScheduleBtn.disabled = false;
    }
  });

  syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.disabled = true;
    syncStatus.textContent = 'Syncing…';
    try {
      const resp = await fetch('/api/playlist-sync', { method: 'POST' });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Sync failed');
      renderSyncStatus(data.playlist);
    } catch (err) {
      syncStatus.textContent = `Sync failed: ${err.message}`;
    } finally {
      syncNowBtn.disabled = false;
    }
  });

  // ---------- Duplicate-avoidance library settings ----------

  async function loadLibrarySettings() {
    try {
      const [playlistsResp, configResp] = await Promise.all([
        fetch('/api/library/playlists'),
        fetch('/api/library/config'),
      ]);

      if (!playlistsResp.ok) {
        const err = await playlistsResp.json().catch(() => ({}));
        const msg = err.error || `Request failed (${playlistsResp.status})`;
        const scopeHint = /scope|403|permission/i.test(msg)
          ? ' This usually means the app needs a fresh login — click Disconnect, then Connect Spotify again.'
          : '';
        playlistChecklistEl.innerHTML = `<p class="fine-print">Couldn't load your playlists: ${msg}${scopeHint}</p>`;
        indexStatus.textContent = '';
        return;
      }
      if (!configResp.ok) {
        const err = await configResp.json().catch(() => ({}));
        indexStatus.textContent = `Couldn't load duplicate-check settings: ${err.error || configResp.status}`;
        return;
      }

      const playlistsData = await playlistsResp.json();
      const configData = await configResp.json();

      includeSavedTracksEl.checked = configData.includeSavedTracks !== false;

      const selected = new Set(configData.referencePlaylistIds || []);
      const noPriorSelection = selected.size === 0;

      playlistChecklistEl.innerHTML =
        (playlistsData.playlists || [])
          .map((p) => {
            const looksStarred = /starred/i.test(p.name);
            const checked = selected.has(p.id) || (noPriorSelection && looksStarred);
            return `
          <label class="playlist-item">
            <input type="checkbox" value="${p.id}" ${checked ? 'checked' : ''} />
            <span>${p.name}</span>
            <span class="fine-print">(${p.trackCount} tracks)</span>
          </label>`;
          })
          .join('') || '<p class="fine-print">No playlists found on your account.</p>';

      indexStatus.textContent = configData.indexBuiltAt
        ? `Index last built ${new Date(configData.indexBuiltAt).toLocaleString()} — ${configData.indexSize} tracks.`
        : 'Not indexed yet — click "Refresh index now," or it will build automatically the next time you get recommendations.';
    } catch (err) {
      indexStatus.textContent = `Couldn't load library settings: ${err.message}`;
    }
  }

  saveLibraryConfigBtn.addEventListener('click', async () => {
    const referencePlaylistIds = Array.from(
      playlistChecklistEl.querySelectorAll('input[type="checkbox"]:checked')
    ).map((el) => el.value);

    saveLibraryConfigBtn.disabled = true;
    try {
      const resp = await fetch('/api/library/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referencePlaylistIds, includeSavedTracks: includeSavedTracksEl.checked }),
      });
      if (!resp.ok) throw new Error('Save failed');
      indexStatus.textContent = 'Selection saved — the index will rebuild the next time it\'s needed.';
    } catch (err) {
      alert(`Couldn't save: ${err.message}`);
    } finally {
      saveLibraryConfigBtn.disabled = false;
    }
  });

  refreshIndexBtn.addEventListener('click', async () => {
    refreshIndexBtn.disabled = true;
    indexStatus.textContent = 'Indexing your library and selected playlists…';
    try {
      const resp = await fetch('/api/library/refresh-index', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Refresh failed');
      indexStatus.textContent = `Indexed ${data.indexSize} tracks as of ${new Date(data.indexBuiltAt).toLocaleString()}.`;
    } catch (err) {
      indexStatus.textContent = `Refresh failed: ${err.message}`;
    } finally {
      refreshIndexBtn.disabled = false;
    }
  });

  // Surface OAuth errors from the callback redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) {
    errorNote.textContent = `Spotify login didn't go through (${params.get('error')}). Try again.`;
    errorNote.classList.remove('hidden');
  }

  // Initial auth check
  fetch('/api/me')
    .then((r) => r.json())
    .then((data) => {
      if (data.loggedIn) {
        dashboard.classList.remove('hidden');
        authArea.innerHTML = '<a href="/logout" class="btn btn-ghost">Disconnect</a>';
        setWeeks(4);
        loadPlaylistConfig();
        loadLibrarySettings();
      } else {
        loggedOut.classList.remove('hidden');
        authArea.innerHTML = '<a href="/login" class="btn btn-primary">Connect Spotify</a>';
      }
    });
})();
