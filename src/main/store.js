// Settings + cleaning history in <userData>/cleanzy.json. Read once; every write
// goes to a tmp file first and is renamed over, so a crash never leaves half a file.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { theme: 'system', deleteMode: 'trash', schedule: { every: 0, unit: 'days' }, lastScheduled: 0,
  lastClean: null, staleDays: 90, exclusions: [], launchAtLogin: false, tray: false, quitOnClose: true, onboarded: false };

function create(dir) {
  const file = path.join(dir, 'cleanzy.json');
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  const settings = { ...DEFAULTS, ...d.settings, schedule: { ...DEFAULTS.schedule, ...d.settings?.schedule } };
  let history = Array.isArray(d.history) ? d.history : [];
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ settings, history }));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    get: () => settings,
    set(patch = {}) {
      for (const k of Object.keys(patch)) if (Object.hasOwn(DEFAULTS, k))
        settings[k] = k === 'schedule' ? { ...settings.schedule, ...patch.schedule } : patch[k];
      save();
      return settings;
    },
    history: () => history,
    addHistory(e) { history = [e, ...history].slice(0, 200); save(); },
    clearHistory() { history = []; save(); return history; },
  };
}

// when the next scheduled clean is due (ms), or null when the schedule is off
function nextRun(s, last) {
  if (!s?.every) return null;
  const d = new Date(last || 0);
  if (s.unit === 'months') d.setMonth(d.getMonth() + s.every);
  else d.setDate(d.getDate() + s.every * (s.unit === 'weeks' ? 7 : 1));
  return d.getTime();
}

module.exports = { create, nextRun, DEFAULTS };
