// Overview tab + first-run onboarding. The pure helpers below are exported for tests.
const OvLib = (() => {
const sum = a => a.reduce((t, i) => t + (i.size || 0), 0);
const isSafe = i => i.safety === 'safe';
const fmt = b => {   // same as UI.fmt, needed outside the renderer
  b = +b || 0;
  if (b < 1000) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { b /= 1000; i++; } while (b >= 1000 && i < u.length - 1);
  return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i];
};
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const isLeftover = i => /leftover/i.test(i.group || '') || i.meta?.kind === 'leftover';
// Linux lists every package; the Uninstaller shows only apps with a launcher until asked
const launcher = i => !['apt', 'snap', 'flatpak'].includes(i.meta?.kind) || i.meta?.launcher;
// what the sidebar and Overview count for a tab, matching what the tab first shows
const shownSize = (key, r) => sum((r?.items || []).filter(i => key !== 'uninstaller' || isLeftover(i) || launcher(i)));
// what one-click "Clean Safe Items" takes: same rule as the shell (no apps, no pkg, no password)
const oneClick = i => isSafe(i) && i.pre !== false && i.module !== 'uninstaller' && i.action !== 'pkg' &&
  !(i.action === 'cmd' && ['aptClean', 'journal', 'snapRev'].includes(i.cmd?.id));

// "That's room for …", rounded down, null under 5 MB
function compare(b) {
  if (!(b >= 5e6)) return null;
  if (b >= 3e9) { const n = Math.floor(b / 3e9); return `That's room for ~${n.toLocaleString('en-US')} hour${n === 1 ? '' : 's'} of HD video`; }
  if (b >= 1e8) return `That's room for ~${plural(Math.floor(b / 8e6), 'song')}`;
  return `That's room for ~${plural(Math.floor(b / 3e6), 'photo')}`;
}

function since(ms, now = Date.now()) {
  const m = Math.floor((now - ms) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${plural(Math.floor(m / 1440), 'day')} ago`;
}

function safeTotal(results) {
  const items = Object.values(results || {}).flatMap(r => r?.items || []).filter(oneClick);
  return { size: sum(items), count: items.length };
}

// one actionable line per category row
function fact(key, r, home = '', now = Date.now()) {
  if (!r) return 'Not scanned yet';
  if (r.scanning) return 'Scanning…';
  const items = r.items || [];
  if (r.error && !items.length) return `Couldn't scan: ${r.error}`;
  if (!items.length) return key === 'largefiles' ? 'No large files found' : 'Nothing to clean';
  const safe = sum(items.filter(isSafe)), check = sum(items) - safe;
  if (key === 'largefiles') {
    const big = items.reduce((a, b) => (b.size > a.size ? b : a));
    let p = big.paths?.[0] || big.name;
    if (home && p.startsWith(home) && /[\\/]/.test(p[home.length])) p = p.slice(home.length + 1);
    return `Largest: ${p} ${fmt(big.size)}`;
  }
  if (key === 'uninstaller') {
    const lo = items.filter(isLeftover), apps = items.filter(i => !isLeftover(i) && launcher(i));
    const old = apps.filter(i => i.meta?.lastUsed && now - i.meta.lastUsed > 182.5 * 864e5).length;
    if (old) return `${plural(old, 'app')} not opened in 6 months`;
    return [apps.length && plural(apps.length, 'app'), lo.length && `${fmt(sum(lo))} of leftovers`].filter(Boolean).join(' · ');
  }
  const head = safe ? `${fmt(safe)} safe to clean` : `${fmt(check)} to check first`;
  const apps = new Set(items.filter(i => i.group === 'Apps').map(i => i.name)).size;
  if (key === 'caches') return apps ? `${head} · ${plural(apps, 'app')}` : head;
  return safe && check ? `${head} · ${fmt(check)} to check first` : head;
}

// disk bar segments, in draw order; "other" is whatever the scans didn't account for
function segments(results, disk) {
  const s = k => sum(results?.[k]?.items || []);
  const un = results?.uninstaller?.items || [];
  const segs = [
    { key: 'caches', label: 'Temporary Files', size: s('caches') },
    { key: 'devtools', label: 'Developer Junk', size: s('devtools') },
    { key: 'largefiles', label: 'Large Files', size: s('largefiles') },
    { key: 'apps', label: 'Apps', size: sum(un.filter(i => !isLeftover(i) && launcher(i))) },
    { key: 'leftovers', label: 'Leftover Files', size: sum(un.filter(isLeftover)) },
  ];
  segs.push({ key: 'other', label: 'Other Files', size: Math.max(0, (disk?.used || 0) - sum(segs)) },
    { key: 'free', label: 'Free', size: disk?.avail || 0 });
  return segs;
}

return { compare, since, safeTotal, fact, segments, fmt, shownSize };
})();
typeof module !== 'undefined' && (module.exports = OvLib);

typeof Shell !== 'undefined' && (() => {
const { compare, since, safeTotal, fact, segments, shownSize } = OvLib;
const KEYS = ['caches', 'devtools', 'largefiles', 'uninstaller'];
const tabBtn = k => document.querySelector(`.tab[data-key="${k}"]`);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let hintOff = false, el;

const draw = () => {
  if (!el) return;
  const f = el.contains(document.activeElement) ? document.activeElement.dataset.f : null;
  if (!Shell.settings.onboarded && !KEYS.some(k => Shell.results[k])) {
    el.innerHTML = `<div class="empty ov-welcome"><img class="logo" src="../../assets/icons/icon-128.png" alt="">
      <h2>Welcome to Cleanzy</h2><p>Find caches and build leftovers you can safely clear.</p>
      <button class="btn primary" type="button" data-f="start">Get started</button></div>`;
    el.querySelector('[data-f=start]').onclick = onboard;
    return;
  }
  const R = Shell.results, d = Shell.disk, t = Shell.trash;
  const scanning = KEYS.some(k => R[k]?.scanning);
  const safe = safeTotal(R), trash = t.denied ? 0 : t.size || 0, total = safe.size + trash;
  const segs = segments(R, d), cmp = compare(total), last = Shell.settings.lastClean;
  const perm = Shell.info.platform === 'darwin' && !hintOff && KEYS.some(k => /EPERM|not permitted/i.test(R[k]?.error || ''));
  const guide = safe.count && !store.get('ov.guided') && KEYS.some(k => R[k]?.at);
  const left = !safe.size && !scanning && (R.caches?.size || 0) + (R.devtools?.size || 0);
  const row = k => {
    const b = tabBtn(k); if (!b) return '';
    const r = R[k];
    return `<li><button class="ov-row${r?.stale ? ' stale' : ''}" type="button" data-f="row-${k}" data-k="${k}">
      ${b.querySelector('svg').outerHTML}
      <span class="rmain"><span class="rname">${UI.esc(b.querySelector('.lbl').textContent)}</span>
        <span class="rwhy">${UI.esc(fact(k, r, Shell.info.home))}</span></span>
      <span class="rsize">${r?.scanning ? '<span class="spin" aria-label="Scanning"></span>' : r ? UI.fmt(shownSize(k, r)) : '—'}</span>
      ${UI.icon('chevron')}</button></li>`;
  };
  el.innerHTML = `
    ${perm ? `<div class="card ov-hint" role="note"><span>Some folders couldn't be read. Cleanzy needs Full Disk Access to see them.</span>
      <button class="link" type="button" data-f="fda">Open Settings</button><button class="btn ghost" type="button" data-f="nothint">Not now</button>
      <p class="muted ov-steps" hidden>Open System Settings › Privacy &amp; Security › Full Disk Access, turn on Cleanzy, then Scan Everything.</p></div>` : ''}
    <section class="card ov-disk" aria-label="Disk usage">
      <div class="ov-dh"><h2>Disk</h2><span class="muted num">${d.size ? `${UI.fmt(d.used)} used of ${UI.fmt(d.size)}` : 'Measuring…'}</span>
        <span class="sp"></span><b class="num">${d.size ? `${UI.fmt(d.avail)} free` : ''}</b></div>
      <div class="ov-bar" role="img" aria-label="${UI.esc(segs.filter(s => s.size).map(s => `${s.label} ${UI.fmt(s.size)}`).join(', '))}">
        ${segs.filter(s => s.size).map(s => `<i class="seg-${s.key}" style="flex:${s.size} 1 0" title="${UI.esc(`${s.label} · ${UI.fmt(s.size)}`)}"></i>`).join('')}</div>
      <ul class="ov-legend">${segs.filter(s => s.size || s.key === 'free').map(s =>
        `<li><i class="seg-${s.key}"></i>${UI.esc(s.label)} <b class="num">${UI.fmt(s.size)}</b></li>`).join('')}</ul>
    </section>
    <div class="ov-grid">
      <section class="card ov-cats" aria-labelledby="ovCatsH">
        <div class="ov-ch"><h2 id="ovCatsH">Categories</h2><span class="sp"></span>
          <button class="btn" type="button" data-f="scan">${scanning ? `${UI.icon('stop')}Stop` : `${UI.icon('refresh')}Scan Everything`}</button></div>
        <ul>${KEYS.map(row).join('')}</ul>
      </section>
      <section class="card ov-rec" aria-labelledby="ovRecH">
        <h2 id="ovRecH">Reclaimable</h2>
        <div class="ov-sum num">
          <div><span>Safe to Clean</span><b>${UI.fmt(safe.size)}</b></div><span class="op" aria-hidden="true">+</span>
          <div><span>Trash</span><b>${t.denied ? '—' : UI.fmt(trash)}</b></div><span class="op" aria-hidden="true">=</span>
          <div class="tot"><span>Total</span><b>${UI.fmt(total)}</b></div></div>
        ${cmp ? `<p class="ov-cmp">${UI.esc(cmp)}</p>` : ''}
        ${last?.at ? `<p class="muted">${UI.esc([last.freed && `Freed ${UI.fmt(last.freed)}`, last.trashed && `Trashed ${UI.fmt(last.trashed)}`].filter(Boolean).join(' · ') || 'Nothing freed')} · last clean ${since(last.at)}</p>` : ''}
        ${guide ? `<div class="ov-guide" role="note"><span>Start here: clean ${safe.count.toLocaleString('en-US')} safe item${safe.count === 1 ? '' : 's'} (${UI.fmt(safe.size)}). They're rebuilt automatically.</span>
          <button class="btn ghost icon" type="button" data-f="noguide" aria-label="Dismiss tip">✕</button></div>` : ''}
        ${left ? `<p class="muted">All safe items are clean. ${UI.fmt(left)} more to check first in
          ${['caches', 'devtools'].filter(k => R[k]?.items?.length).map(k => `<button class="link" type="button" data-f="rev-${k}" data-k="${k}">${UI.esc(tabBtn(k)?.querySelector('.lbl').textContent || k)}</button>`).join(' and ')}.</p>` : ''}
        <div class="acts">
          <button class="btn" type="button" data-f="trash"${!trash || Shell.busy ? ' disabled' : ''}>${UI.icon('trash')}Empty Trash…</button>
          <button class="btn primary${guide ? ' ov-pulse' : ''}" type="button" data-f="clean"${!safe.size || Shell.busy ? ' disabled' : ''}>Clean Safe Items${safe.size ? ` · ${UI.fmt(safe.size)}` : ''}</button></div>
      </section>
    </div>`;
  if (f) el.querySelector(`[data-f="${f}"]`)?.focus();
};

function onboard() {
  const mac = Shell.info.platform === 'darwin';
  const steps = [
    { h: 'Welcome to Cleanzy', p: 'Cleanzy finds caches, build leftovers and big forgotten files, and clears them the safe way.', go: 'Continue' },
    { h: 'Safe by design', p: 'Caches and build output are cleaned for you. Your own files and apps are only removed when you pick them, and everything goes to the Trash first.',
      x: `<ul class="ov-safe"><li><span class="badge safe">Safe to Clean</span> Rebuilt automatically. You won't notice they're gone.</li>
        <li><span class="badge check">Check First</span> Nothing is lost, but it costs a re-download or a slower next build.</li></ul>`, go: 'Continue' },
    { h: 'Ready to scan', p: `The first scan takes a minute. Nothing is removed until you confirm.${mac ? ' If some folders are locked, we\'ll tell you how to allow Full Disk Access.' : ''}`, go: 'Scan my disk' },
  ];
  let n = 0;
  const s = UI.sheet('', { label: 'Welcome' });
  s.el.classList.add('ov-onb');
  const step = () => {
    const st = steps[n];
    s.el.innerHTML = `<div class="ov-dots" aria-label="Step ${n + 1} of 3">${steps.map((_, i) => `<i${i === n ? ' class="on"' : ''}></i>`).join('')}</div>
      <div class="ov-step"><h2>${st.h}</h2><p>${st.p}</p>${st.x || ''}</div>
      <div class="acts">${n ? '<button class="btn ghost" type="button" data-a="back">Back</button>' : ''}
        <button class="btn primary" type="button" data-a="go">${st.go}</button></div>`;
    s.el.querySelector('[data-a=go]').focus();
  };
  s.el.addEventListener('click', async e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'back') { n--; step(); }
    if (a !== 'go') return;
    if (n < 2) { n++; step(); return; }
    s.close();
    await Shell.saveSettings({ onboarded: true });
    Shell.scanAll();
  });
  step();
}

Shell.tab({ key: 'overview', label: 'Home', group: 'clean', icon: 'overview',
  mount(v) {
    el = v;
    el.classList.add('ov');
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-f]'); if (!b) return;
      const f = b.dataset.f;
      if (b.dataset.k) {
        const k = b.dataset.k;
        Shell.show(k, (Shell.results[k]?.items || []).some(i => i.safety === 'safe') ? { filter: 'safe', preselectSafe: true } : {});
      }
      else if (f === 'scan') KEYS.some(k => Shell.results[k]?.scanning) ? Shell.stop() : Shell.scanAll();
      else if (f === 'clean') Shell.cleanSafe();
      else if (f === 'trash') Shell.emptyTrash();
      else if (f === 'noguide') { store.set('ov.guided', '1'); draw(); }
      else if (f === 'nothint') { hintOff = true; draw(); }
      else if (f === 'fda') { api.openFDA?.(); el.querySelector('.ov-steps').hidden = false; }   // steps stay as the fallback
    });
    Shell.bus.addEventListener('cleaned', () => store.set('ov.guided', '1'));   // any clean path, not only this button
    for (const ev of ['results', 'settings', 'cleaned', 'storage']) Shell.bus.addEventListener(ev, draw);
    draw();
    if (!Shell.settings.onboarded) onboard();
  },
  onShow: () => draw() });
})();
