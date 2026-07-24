const PLAYLIST_NAME = 'Rewind Discoveries';
const PLAYLIST_DESCRIPTION = 'Auto-refreshed by Rewind — new picks based on your recent Spotify listening.';

// Manual recommendation-weighting dimensions. Keep in sync with the matching list in
// public/js/app.js (duplicated rather than shared, since this project intentionally
// has no build step).
const WEIGHT_DIMENSIONS = [
  { id: 'lyricalThemes', label: 'Lyrical themes', description: 'Similar subject matter or messaging in the lyrics.' },
  { id: 'aggressiveness', label: 'Aggressiveness', description: 'Heavier, harsher, more aggressive-sounding picks.' },
  { id: 'intensity', label: 'Intensity', description: 'Higher energy, faster pacing, more dynamic tension.' },
  { id: 'obscurity', label: 'Obscurity', description: 'Lesser-known, more underground artists over popular ones.' },
  { id: 'mood', label: 'Mood', description: "Matches the emotional tone or atmosphere of what you've been playing." },
  { id: 'sonicSimilarity', label: 'Sonic similarity', description: 'Similar production style and instrumentation.' },
];

module.exports = { PLAYLIST_NAME, PLAYLIST_DESCRIPTION, WEIGHT_DIMENSIONS };
