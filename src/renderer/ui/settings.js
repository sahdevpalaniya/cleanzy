// Settings tab. nextRun is a copy of store.nextRun (the renderer can't require it); tests keep them identical.
const SetLib = (() => {
function nextRun(s, last) {
  if (!s?.every) return null;
  const d = new Date(last || 0);
  if (s.unit === 'months') d.setMonth(d.getMonth() + s.every);
  else d.setDate(d.getDate() + s.every * (s.unit === 'weeks' ? 7 : 1));
  return d.getTime();
}
const PRESETS = { off: { every: 0, unit: 'days' }, weekly: { every: 1, unit: 'weeks' }, monthly: { every: 1, unit: 'months' }, quarterly: { every: 3, unit: 'months' } };
// which schedule choice a stored schedule shows as
const preset = s => !s?.every ? 'off' : Object.keys(PRESETS).find(k => PRESETS[k].every === s.every && PRESETS[k].unit === s.unit) || 'custom';
return { nextRun, PRESETS, preset };
})();
typeof module !== 'undefined' && (module.exports = SetLib);

typeof Shell !== 'undefined' && (() => {
const { nextRun, PRESETS, preset } = SetLib;
const STALE = window.STALE = [[0, 'Show all projects'], [30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year'], [730, '2 years']];   // shared with Dev Tools
const date = ms => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const when = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let el, history = [];

const radios = (name, cur, opts) => opts.map(([v, l, sub]) => `<label class="st-opt"><input type="radio" name="${name}" value="${v}"${cur === v ? ' checked' : ''}>
  <span>${l}${sub ? `<small class="muted">${sub}</small>` : ''}</span></label>`).join('');
const toggle = (k, l) => `<label class="st-tog"><span>${l}</span><input type="checkbox" role="switch" data-k="${k}"${Shell.settings[k] ? ' checked' : ''}></label>`;

function schedText() {
  const s = Shell.settings, n = nextRun(s.schedule, s.lastScheduled), l = s.lastClean;
  return [n ? `Next clean: ${date(n)}.` : 'Scheduled cleaning is off.',
    l?.at ? `Last clean ${date(l.at)}: ${[l.freed && `freed ${UI.fmt(l.freed)}`, l.trashed && `trashed ${UI.fmt(l.trashed)}`].filter(Boolean).join(', ') || 'nothing to free'}, ${l.count} item${l.count === 1 ? '' : 's'}.` : '']
    .filter(Boolean).join(' ');
}

function draw() {
  const s = Shell.settings, sc = s.schedule || PRESETS.off, p = preset(sc);
  el.innerHTML = `<div class="st">
    <section class="card"><fieldset><legend><h2>Appearance</h2></legend>
      <div class="st-row">${radios('theme', s.theme, [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']])}</div></fieldset></section>

    <section class="card"><fieldset><legend><h2>Cleaning</h2></legend>
      ${radios('deleteMode', s.deleteMode, [['trash', 'Move to Trash (recommended)', 'You can restore anything until you empty the Trash.'],
        ['delete', 'Delete permanently', 'Frees space at once. Apps and your own files still go to the Trash.']])}
      <p class="muted">Every clean asks first and offers both. This picks the highlighted button.</p></fieldset></section>

    <section class="card"><h2 id="stSchH">Schedule</h2>
      <div class="st-line"><label for="stSch">Clean automatically</label>
        <select id="stSch">${[['off', 'Off'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Every 3 months'], ['custom', 'Custom…']]
          .map(([v, l]) => `<option value="${v}"${p === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <span class="st-custom"${p === 'custom' ? '' : ' hidden'}>every <input id="stEvery" type="number" min="1" max="365" value="${sc.every || 1}" aria-label="Every">
          <select id="stUnit" aria-label="Unit">${['days', 'weeks', 'months'].map(u => `<option${sc.unit === u ? ' selected' : ''}>${u}</option>`).join('')}</select></span></div>
      <p class="st-sched" aria-live="polite">${UI.esc(schedText())}</p>
      <p class="muted">Scheduled cleans only touch Safe items.</p></section>

    <section class="card"><h2>Developer projects</h2>
      <div class="st-line"><label for="stStale">${+s.staleDays ? 'Hide projects used in the last' : 'Projects:'}</label>
        <select id="stStale">${STALE.map(([v, l]) => `<option value="${v}"${+s.staleDays === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="muted">Their build folders stay out of Developer Junk while you're working on them.</p></section>

    <section class="card"><h2>Excluded folders</h2>
      <p class="muted">Scans and cleans leave these alone.</p>
      ${(s.exclusions || []).length ? `<ul class="st-list">${s.exclusions.map((x, i) => `<li><span class="st-path" title="${UI.esc(x)}">${UI.esc(x)}</span><span class="st-size num muted"></span>
        <button class="btn ghost" type="button" data-rm="${i}" aria-label="Remove ${UI.esc(x)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No exclusions yet.</p>'}
      <div><button class="btn" type="button" id="stAdd">Add folder…</button></div></section>

    <section class="card"><div class="st-line"><h2>Cleaning history</h2><span class="sp"></span>
      <button class="btn ghost" type="button" id="stClear"${history.length ? '' : ' disabled'}>Clear history</button></div>
      ${history.length ? `<table class="st-hist"><thead><tr><th scope="col">Date</th><th scope="col">Freed</th><th scope="col">Items</th></tr></thead><tbody>
        ${history.map(h => `<tr><td>${UI.esc(when(h.at))}${h.scheduled ? ' <span class="badge safe">Scheduled</span>' : ''}</td>
          <td class="num">${UI.esc([h.freed && `${UI.fmt(h.freed)} freed`, h.trashed && `${UI.fmt(h.trashed)} to Trash`].filter(Boolean).join(' · ') || '—')}</td>
          <td><details><summary>${h.count} item${h.count === 1 ? '' : 's'}</summary><ul>${(h.items || []).map(i =>
            `<li><span>${UI.esc(i.name)}</span><span class="num muted">${UI.fmt(i.size)}</span></li>`).join('')}</ul></details></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nothing cleaned yet.</p>'}</section>

    <section class="card"><h2>App</h2>
      ${toggle('launchAtLogin', 'Launch at login')}${toggle('tray', Shell.info.platform === 'darwin' ? 'Keep in menu bar' : 'Keep in tray')}${Shell.settings.tray ? toggle('quitOnClose', 'Quit when window closes (instead of staying in the tray)') : ''}</section>

    <p class="muted st-priv">No telemetry. Everything stays on this computer.</p></div>`;
  el.querySelectorAll('.st-list li').forEach((li, i) => api.sizeOf(s.exclusions[i]).then(n => { li.querySelector('.st-size').textContent = UI.fmt(n); }, () => {}));
}

const custom = () => ({ every: Math.max(1, Math.min(365, Math.floor(+el.querySelector('#stEvery').value) || 1)), unit: el.querySelector('#stUnit').value });
async function save(patch) {
  await Shell.saveSettings(patch);
  el.querySelector('.st-sched').textContent = schedText();
}

Shell.tab({ key: 'settings', label: 'Settings', group: 'footer', icon: 'settings',
  mount(v) {
    el = v;
    draw();
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.type === 'radio') save({ [t.name]: t.value });
      else if (t.dataset.k) save({ [t.dataset.k]: t.checked }).then(() => t.dataset.k === 'tray' && draw());   // Quit-on-close only applies with a tray
      else if (t.id === 'stStale') { el.querySelector('[for=stStale]').textContent = +t.value ? 'Hide projects used in the last' : 'Projects:'; save({ staleDays: +t.value }); }
      else if (t.id === 'stSch') {
        el.querySelector('.st-custom').hidden = t.value !== 'custom';
        save({ schedule: t.value === 'custom' ? custom() : PRESETS[t.value] });
      } else if (t.id === 'stEvery' || t.id === 'stUnit') save({ schedule: custom() });
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rm != null) {
        const ex = [...Shell.settings.exclusions]; ex.splice(+b.dataset.rm, 1);
        await Shell.saveSettings({ exclusions: ex }); draw(); el.querySelector('#stAdd').focus();
      } else if (b.id === 'stAdd') {
        const p = await api.pick();
        if (p && !Shell.settings.exclusions.includes(p)) { await Shell.saveSettings({ exclusions: [...Shell.settings.exclusions, p] }); draw(); }
        el.querySelector('#stAdd').focus();
      } else if (b.id === 'stClear') {
        const s = UI.sheet(`<h2>Clear cleaning history?</h2><p>This removes the record of ${history.length} clean${history.length === 1 ? '' : 's'}. Nothing on disk changes.</p>
          <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button><button class="btn danger solid" type="button" data-a="go">Clear history</button></div>`, { label: 'Clear history' });
        s.el.querySelector('[data-a=no]').onclick = s.close;
        s.el.querySelector('[data-a=go]').onclick = async () => { history = await api.clearHistory(); s.close(); draw(); };
      }
    });
    Shell.bus.addEventListener('cleaned', async () => { history = await api.history(); if (!el.hidden) draw(); });
    api.history().then(h => { history = h; draw(); });
  },
  async onShow() { history = await api.history(); draw(); } });
})();
