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
  const recentNote = document.getElementById('recentNote');
  const recentStrip = document.getElementById('recentStrip');

  const recsBtn = document.getElementById('recsBtn');
  const recsLoading = document.getElementById('recsLoading');
  const recsList = document.getElementById('recsList');

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

  let weeks = 4;

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
    rangeNote.textContent = `Snapped to Spotify's "${data.timeRangeLabel}" bucket for top items. Recently-played is filtered to your exact ${data.weeksRequested}-week window.`;

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

    // Top tracks
    topTracksEl.innerHTML = data.topTracks
      .map(
        (t) => `<li><span class="track-name">${t.name}</span><span class="track-artist">— ${t.artist}</span></li>`
      )
      .join('');

    // Recently played
    recentNote.textContent = data.recentlyPlayedNote || `${data.recentlyPlayed.length} play(s) in the last ${data.weeksRequested} week(s).`;
    recentStrip.innerHTML = data.recentlyPlayed
      .map(
        (r) => `
      <div class="recent-item">
        <span class="track-name">${r.track}</span>
        <span class="track-artist">${r.artist}</span>
        <span class="played-at">${timeAgo(r.playedAt)}</span>
      </div>`
      )
      .join('') || '<p class="fine-print">Nothing played in this window yet.</p>';

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

  async function runRecommendations() {
    recsLoading.classList.remove('hidden');
    recsList.innerHTML = '';
    recsBtn.disabled = true;
    try {
      const resp = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeks }),
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Request failed');
      const data = await resp.json();
      recsList.innerHTML = (data.recommendations || [])
        .map(
          (r) => `
        <li>
          <span class="mixtape-name">${r.name}${r.artist ? ` — ${r.artist}` : ''}</span>
          <span class="mixtape-type">${r.type}</span>
          <span class="mixtape-genre">${r.genre || ''}</span>
          <p class="mixtape-reason">${r.reason || ''}</p>
        </li>`
        )
        .join('');
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
      } else {
        loggedOut.classList.remove('hidden');
        authArea.innerHTML = '<a href="/login" class="btn btn-primary">Connect Spotify</a>';
      }
    });
})();
