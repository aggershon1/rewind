const cron = require('node-cron');
const { syncPlaylistCore } = require('./playlistSync');

let currentTask = null;

function buildCronExpr({ cadence, hour, minute, weekday }) {
  const h = Number.isInteger(hour) ? hour : 8;
  const m = Number.isInteger(minute) ? minute : 0;
  const wd = Number.isInteger(weekday) ? weekday : 1;

  switch (cadence) {
    case 'daily':
      return `${m} ${h} * * *`;
    case 'every3days':
      // Approximate: fires on day-of-month 1, 4, 7, 10... rather than exactly
      // "3 days since last run." Resets each month, but close enough for a
      // "every few days" cadence without a heavier scheduling dependency.
      return `${m} ${h} */3 * *`;
    case 'weekly':
    default:
      return `${m} ${h} * * ${wd}`;
  }
}

function reschedule(config) {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  if (!config.enabled) {
    console.log('Auto-playlist sync is turned off.');
    return;
  }
  const expr = buildCronExpr(config);
  currentTask = cron.schedule(expr, () => {
    console.log('Running scheduled playlist sync…');
    syncPlaylistCore();
  });
  console.log(`Auto-playlist sync scheduled (cron: "${expr}"). This only fires while this process is running.`);
}

module.exports = { reschedule, buildCronExpr };
