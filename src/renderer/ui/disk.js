// Disk tab: folder tree (navigation), folder list (selection), treemap, largest
// files and, on Linux, space held by deleted files. Acts through the legacy api
// calls (tree/scan/trash/remove/…); main guard()s every path they get.
(() => {
// ── pure helpers (exported for tests) ────────────────────────────────
// Only a folder whose own name is a cache/build dir gets the pill; never what is inside it.
const CLEANABLE = /^(\.cache|caches?|\.npm|\.yarn|\.pnpm-store|node_modules|\.gradle|__pycache__|\.next|Trash|\.Trash|CachedData|logs?)$/i;
// an emptied folder (no items, or nothing but its own block) has nothing left to clean
const isCleanable = n => !!n && n.dir !== false && !n.file && CLEANABLE.test(n.name) && n.items !== 0 && !(n.size <= 4096);
const splitPath = p => String(p).split(/[\\/]/).filter(Boolean);
const isRoot = p => /^([A-Za-z]:)?[\\/]*$/.test(p);
function parentOf(p) {
  if (isRoot(p)) return p;
  const q = p.replace(/[\\/]+$/, ''), i = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\'));
  if (i < 0) return q;
  return isRoot(q.slice(0, i + 1)) ? q.slice(0, i + 1) : q.slice(0, i);
}
const under = (p, d) => p === d || (p.startsWith(d) && (/[\\/]$/.test(d) || /[\\/]/.test(p[d.length] || '')));
const join = (d, name, sep) => /[\\/]$/.test(d) ? d + name : d + sep + name;
// [[path, label], …] from the scan root down to p
function crumbs(root, p, sep) {
  const out = [[root, isRoot(root) ? root : splitPath(root).pop()]];
  if (p !== root) for (const s of splitPath(p.slice(root.length))) out.push([join(out.at(-1)[0], s, sep), s]);
  return out;
}
function find(n, p) {
  while (n && n.path !== p) n = n.kids?.find(k => under(p, k.path));
  return n || null;
}
// slice-and-dice treemap: split at half the total, recurse along the longer side
function layout(items, x, y, w, h, out) {
  if (!items.length || w <= 0 || h <= 0) return;
  if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return; }
  const sum = items.reduce((a, b) => a + b.size, 0); let acc = 0, i = 0;
  while (i < items.length - 1 && acc + items[i].size < sum / 2) { acc += items[i].size; i++; }
  const a = items.slice(0, i || 1), b = items.slice(i || 1), f = a.reduce((s, v) => s + v.size, 0) / sum;
  if (w >= h) { layout(a, x, y, w * f, h, out); layout(b, x + w * f, y, w * (1 - f), h, out); }
  else { layout(a, x, y, w, h * f, out); layout(b, x, y + h * f, w, h * (1 - f), out); }
}
if (typeof module !== 'undefined') module.exports = { CLEANABLE, isCleanable, splitPath, isRoot, parentOf, under, join, crumbs, find, layout };
if (typeof Shell === 'undefined') return;

// ── tab ──────────────────────────────────────────────────────────────
const DENIED = /EACCES|EPERM/;
const FILE_CAP = 300, COLORS = 8;
const esc = s => UI.esc(s), fmt = b => UI.fmt(b);
const sizeOf = a => a.reduce((t, i) => t + (i.size || 0), 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// same words as the other tabs: installed packages cost a re-download, the rest rebuild on their own
const pill = n => /^logs?$/i.test(n.name)
  ? '<span class="badge check dpill" title="Old log files. Only needed if you are still debugging what wrote them.">Check First</span>'
  : /^(node_modules|\.gradle)$/i.test(n.name)
  ? '<span class="badge check dpill" title="Nothing is lost, but it costs a re-download or a slower next build.">Check First</span>'
  : '<span class="badge safe dpill" title="A cache or build folder. It comes back on its own when needed.">Safe to Clean</span>';
const linux = () => Shell.info.platform === 'linux';

let el, scanRoot = null, focus = null, lastTree = null, scanning = false, busy = false;
let sel = new Map(), open = new Set(), fcache = new Map(), frows = [];
let pane = 'folder', fsort = { key: 'size', dir: -1 };
const q = s => el.querySelector(s);

// The du pass maps only the bigger folders. Opening a folder lists its full
// contents (sizes from the du cache) and joins them into the tree.
async function loadFiles(n) {
  if (!n || n.file || n.filesLoaded) return;
  n.filesLoaded = true;   // set first: clicks can arrive twice
  const r = await api.scan({ dir: n.path, mode: 'level' });
  fcache.set(n.path, r.rows);
  const have = new Set(n.kids.map(k => k.path));
  const extra = r.rows.filter(x => !have.has(x.path) && x.size > 0).sort((a, b) => b.size - a.size);
  n.more = Math.max(0, extra.length - FILE_CAP);
  n.kids = [...n.kids, ...extra.slice(0, FILE_CAP).map(f => ({ name: f.name, path: f.path, size: f.size, dir: f.dir, file: !f.dir, kids: [] }))]
    .sort((a, b) => b.size - a.size);
}

function stage(title, text, spin) {
  const s = q('.dstage');
  s.hidden = false; q('.dlist').hidden = q('.dtiles').hidden = true;
  s.innerHTML = `${spin ? '<span class="spin"></span>' : ''}<h2>${esc(title)}</h2><p>${esc(text)}</p>`;
}

// cached=true rebuilds from the last du (after a delete): no disk walk.
// Rescanning the same folder keeps the open branches and the folder you were in.
async function scan(dir, cached = false, password = null) {
  if (scanning || !dir) return;
  const same = scanRoot?.path === dir, was = same ? focus?.path : null, wasOpen = same ? open : null;
  scanning = true; drawBar();
  if (!cached) stage(`Scanning ${dir}`, 'Adding up the real disk usage of every folder. A first scan of a big folder can take half a minute.', true);
  let r;
  try { r = await api.tree({ dir, cached, password }); } catch { r = null; }
  if (!r?.root) { scanning = false; drawBar(); stage('Could not read that folder', `Nothing readable at ${dir}. Try another folder.`); return; }
  scanRoot = focus = r.root; lastTree = { ...r, cached }; sel.clear(); fcache.clear();
  open = wasOpen || new Set([r.root.path, ...r.root.kids.slice(0, 6).map(k => k.path)]);
  try {
    await loadFiles(r.root);
    // parents before children: a child folder only exists once its parent is listed
    for (const p of [...open].sort((a, b) => a.length - b.length)) await loadFiles(find(scanRoot, p));
    if (was) {
      let p = was;
      while (!find(scanRoot, p) && !isRoot(p) && p.length > dir.length) p = parentOf(p);
      focus = find(scanRoot, p) || scanRoot; await loadFiles(focus);
    }
  } finally { scanning = false; }
  q('.dstage').hidden = true;
  render();
}

async function go(p) {
  if (!scanRoot) return;
  if (!under(p, scanRoot.path)) return scan(p);   // above the scanned folder: scan it
  let n = find(scanRoot, p);
  if (!n) { await loadFiles(find(scanRoot, parentOf(p))); n = find(scanRoot, p); }
  if (!n || n.file) return;
  await loadFiles(n);
  for (let x = p; ; x = parentOf(x)) { open.add(x); if (x === scanRoot.path || isRoot(x)) break; }
  focus = n; render();
  q(`.tr[data-p="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
}
const up = () => { if (focus && !isRoot(focus.path)) go(parentOf(focus.path)); };

function render() { drawStat(); drawCrumb(); drawTree(); drawBar(); pane === 'folder' ? folderView() : treemap(); }

function drawStat() {
  const r = lastTree; if (!r) return;
  q('.dstat').innerHTML = `<b>${fmt(r.root.size)}</b>${r.cached || r.ms < 100 ? '' : ` · ${(r.ms / 1000).toFixed(1)} s`}`
    + (r.denied && linux() ? ` · <button class="link dadm" type="button" title="Some folders need root to read, so their size is missing">${r.denied} unreadable · scan as admin</button>` : '');
}

function drawCrumb() {
  if (!focus) return;
  q('.dcrumb').innerHTML = crumbs(scanRoot.path, focus.path, Shell.info.sep || '/').map(([p, label], i, a) =>
    `${i ? '<i aria-hidden="true">›</i>' : ''}<button type="button" class="${i === a.length - 1 ? 'cur' : ''}" data-p="${esc(p)}" title="${esc(p)}"${i === a.length - 1 ? ' aria-current="location"' : ''}>${esc(label)}</button>`).join('');
  q('.dcrumb').scrollLeft = 1e6;
  q('.dup').disabled = isRoot(focus.path);
}

// ── folder tree: navigation only ─────────────────────────────────────
function drawTree() {
  if (!scanRoot) return;
  const out = [], total = scanRoot.size || 1;
  (function walk(n, d) {
    const kids = n.kids.filter(k => !k.file), isOpen = open.has(n.path), pct = n.size / total * 100;
    out.push(`<div class="tr${n === focus ? ' cur' : ''}" data-p="${esc(n.path)}" style="--d:${d}">
      <button class="cv" type="button" tabindex="-1" aria-label="${isOpen ? 'Collapse' : 'Expand'} ${esc(n.name)}" aria-expanded="${isOpen}"${n.filesLoaded && !kids.length ? ' disabled' : ''}>${UI.icon('chevron', 14)}</button>
      <button class="tn" type="button"${n === focus ? ' aria-current="true"' : ''}><span class="nm">${esc(n.name)}</span>${isCleanable(n) ? pill(n) : ''}
        <span class="sz num" title="${pct < 0.1 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% of ${esc(scanRoot.name)}">${fmt(n.size)}<i style="width:${Math.min(100, pct).toFixed(1)}%"></i></span></button></div>`);
    if (isOpen) kids.forEach(k => walk(k, d + 1));
  })(scanRoot, 0);
  q('.dtree').innerHTML = out.join('');
}

// ── folder list: the only place with checkboxes ──────────────────────
const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  items: (a, b) => (a.dir ? a.items : -1) - (b.dir ? b.items : -1),
  size: (a, b) => a.size - b.size,
  mtime: (a, b) => a.mtime - b.mtime,
};
// folders before files at equal rank, the way a file manager does it
const sortRows = rows => [...rows].sort((a, b) => (b.dir - a.dir) || SORTERS[fsort.key](a, b) * fsort.dir || a.name.localeCompare(b.name));
function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today ' + d.toTimeString().slice(0, 5);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}

async function folderView() {
  const dir = focus?.path, box = q('.dlist'); if (!dir) return;
  q('.dtiles').hidden = true; box.hidden = false;
  if (!fcache.has(dir)) {
    box.innerHTML = `<div class="empty"><span class="spin"></span>Reading ${esc(dir)}…</div>`;
    fcache.set(dir, (await api.scan({ dir, mode: 'level' })).rows || []);
  }
  if (focus?.path !== dir || pane !== 'folder') return;   // moved on while we read
  const keep = box.dataset.dir === dir ? box.scrollTop : 0; box.dataset.dir = dir;
  frows = sortRows(fcache.get(dir));
  const big = Math.max(1, ...frows.map(r => r.size));
  const h = (k, label, cls = '') => `<button type="button" class="${cls}${fsort.key === k ? ' on' : ''}" data-s="${k}">${label}${fsort.key === k ? (fsort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`;
  box.innerHTML = frows.length ? `<div class="fhead"><input type="checkbox" class="fall" aria-label="Select all in this folder"${frows.some(r => !r.prot) && frows.every(r => r.prot || sel.has(r.path)) ? ' checked' : ''}>${h('name', 'Name')}${h('items', 'Contents', 'fc')}${h('size', 'Size')}${h('mtime', 'Modified', 'fm')}</div>`
    + frows.map((r, i) => `<div class="frow${sel.has(r.path) ? ' on' : ''}" data-i="${i}">
      <input type="checkbox" aria-label="Select ${esc(r.name)}"${sel.has(r.path) ? ' checked' : ''}${r.prot ? ' disabled title="Protected: Cleanzy never removes this"' : ''}>
      <button class="fn" type="button" title="${r.dir ? 'Open' : 'Select'} ${esc(r.name)}">${UI.icon(r.dir ? 'reveal' : 'files')}<span class="nm">${esc(r.name)}</span>${isCleanable(r) ? pill(r) : ''}</button>
      <span class="fc muted num">${r.dir ? (r.items < 0 ? '—' : plural(r.items, 'item')) : ''}</span>
      <span class="fs num">${fmt(r.size)}<span class="meter"><i style="width:${(r.size / big * 100).toFixed(1)}%"></i></span></span>
      <span class="fm muted">${when(r.mtime)}</span></div>`).join('')
    : '<div class="empty">This folder is empty</div>';
  box.scrollTop = keep;   // ticking a row must not jump the list
}

// ── treemap ──────────────────────────────────────────────────────────
function treemap() {
  const box = q('.dtiles'); if (!focus) return;
  q('.dlist').hidden = true; box.hidden = false;
  const W = box.clientWidth, H = box.clientHeight;
  if (W < 20 || H < 20) return;
  if (!focus.kids.length) { box.innerHTML = `<div class="empty">${focus.filesLoaded ? 'Nothing inside this folder.' : 'Opening…'}</div>`; return; }
  const out = []; layout(focus.kids.slice(0, 60).map((k, i) => ({ ...k, c: i % COLORS })), 0, 0, W, H, out);
  box.innerHTML = out.map(t => {
    const w = Math.max(0, t.w - 3), h = Math.max(0, t.h - 3);
    return `<button type="button" class="tile${h < 40 || w < 90 ? ' sm' : ''}${sel.has(t.path) ? ' on' : ''}" data-p="${esc(t.path)}"
      style="left:${t.x + 1.5}px;top:${t.y + 1.5}px;width:${w}px;height:${h}px;background:var(--map-${t.c})"
      title="${esc(t.path)} · ${fmt(t.size)}${t.file ? '' : ' · click to open'}"><span class="n">${esc(t.name)}</span><span class="s">${fmt(t.size)}</span></button>`;
  }).join('');
}

// ── selection ────────────────────────────────────────────────────────
// a selected parent already covers its children: count and act on the top-most only
const picked = () => [...sel.values()].filter(n => ![...sel.keys()].some(p => p !== n.path && under(n.path, p)));
function drawBar() {
  if (!el) return;
  const s = picked(), go = q('[data-a=del]');
  q('.dbar .tot').textContent = s.length ? `${s.length} selected · ${fmt(sizeOf(s))}` : 'Tick folders or files to clean them up';
  go.textContent = s.length ? `Clean up ${fmt(sizeOf(s))}…` : 'Clean up…';
  go.disabled = !s.length || busy || scanning;
  q('[data-a=none]').disabled = !s.length;
  q('[data-a=junk]').disabled = !scanRoot;
}
function toggle(n, on = !sel.has(n.path)) {
  if (on && n.prot) return;   // main refuses it anyway
  on ? sel.set(n.path, n) : sel.delete(n.path);
  for (const r of el.querySelectorAll(`.frow, .tile`)) {
    const p = r.classList.contains('tile') ? r.dataset.p : frows[+r.dataset.i]?.path;
    if (p === n.path) { r.classList.toggle('on', on); const c = r.querySelector('input'); if (c) c.checked = on; }
  }
  const all = q('.fall'); if (all) all.checked = frows.some(r => !r.prot) && frows.every(r => r.prot || sel.has(r.path));
  drawBar();
}

// ── delete sheet ─────────────────────────────────────────────────────
function openDelete(items, mode = 'trash') {
  items = items.filter(Boolean);
  if (!items.length || busy) return;
  const total = sizeOf(items), dirs = items.filter(i => i.dir !== false).length, files = items.length - dirs;
  const emptyLbl = !files ? 'Empty folder' : !dirs ? 'Empty file' : 'Empty contents';
  const emptyWhy = !files ? 'The folder stays, everything inside it goes. Best for a cache a program expects to find.'
    : !dirs ? 'The file stays, its contents go. Use this for a log a program is still writing to: it keeps writing and the space frees at once.'
    : 'Folders are emptied but kept and files are cut to zero. Best for caches and for logs a program is still writing to.';
  const verb = m => ({ trash: `Move ${fmt(total)} to Trash`, delete: `Delete ${fmt(total)} permanently`, empty: `${emptyLbl.split(' ')[0]} ${fmt(total)}` }[m]);
  const s = UI.sheet(`<h2>Clean up ${plural(items.length, 'item')}?</h2>
    <ul class="clist">${items.slice(0, 200).map(i => `<li><span class="rmain"><span class="rname">${esc(i.name)}</span><span class="rwhy">${esc(i.path)}</span></span><span class="rsize">${fmt(i.size)}</span></li>`).join('')}
      ${items.length > 200 ? `<li class="muted">…and ${items.length - 200} more</li>` : ''}</ul>
    <div class="ctot"><span>Total</span><b class="num">${fmt(total)}</b></div>
    <p class="muted">Move to Trash keeps it recoverable; the space returns once the Trash is emptied. Delete Permanently has no undo.</p>
    <details${mode === 'empty' ? ' open' : ''}><summary>More options</summary>
      <div class="dopt"><span><b>${emptyLbl}</b><span class="muted">${emptyWhy}</span></span>
        <button class="btn" type="button" data-m="empty">${esc(verb('empty'))}</button></div></details>
    <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button>
      <button class="btn danger" type="button" data-m="delete">Delete Permanently</button>
      <button class="btn primary" type="button" data-m="trash" id="diskGo">${esc(verb('trash'))}</button></div>`, { label: 'Clean up' });
  s.el.querySelector('[data-a=no]').onclick = s.close;
  s.el.addEventListener('click', e => { const m = e.target.closest('[data-m]')?.dataset.m; if (m) { s.close(); run(items, m); } });
  s.el.querySelector('#diskGo').focus();   // Enter never deletes permanently
}

async function run(items, mode) {
  busy = true; drawBar();
  const paths = items.map(i => i.path), base = scanRoot?.path || paths[0], notes = [];
  let errs = [], freed = 0;
  try {
    const before = (await api.df(base)).avail;
    errs = mode === 'trash' ? await api.trash(paths) : mode === 'delete' ? await api.remove(paths)
      : [...await api.emptyDir(items.filter(i => i.dir !== false).map(i => i.path)), ...await api.truncate(items.filter(i => i.dir === false).map(i => i.path))];
    // root-owned leftovers: only a permanent delete retries through sudo
    const blocked = mode === 'delete' && Shell.info.platform !== 'win32' ? errs.filter(e => DENIED.test(e.msg)).map(e => e.path) : [];
    if (blocked.length) {
      const pw = await UI.password({ title: `${plural(blocked.length, 'item')} need administrator rights`,
        why: `${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ' …' : ''} belong to another user (root, mysql …). Your password goes straight to sudo and is never stored.` });
      if (pw) {
        const retry = await api.removeSudo(blocked, pw);
        errs = errs.filter(e => !blocked.includes(e.path)).concat(retry);
        notes.push(`${blocked.length - retry.length} removed as administrator`);
      }
    }
    // blocks a running program still holds: the user just deleted these, so release them
    if (linux() && mode !== 'trash') {
      const held = (await api.ghosts()).filter(g => g.safe && paths.some(p => under(g.path, p)));   // 'risky' ones stay for the Held space sheet
      if (held.length) {
        let e2 = await api.reap(held);
        const stuck = held.filter(g => e2.some(e => e.path === g.path && DENIED.test(e.msg)));
        if (stuck.length) {
          const pw = await UI.password({ title: `${fmt(sizeOf(stuck))} is still held by another user's program`,
            why: 'The file is gone but its blocks are not, because a program owned by another user still has it open. Nothing is restarted and no program is closed.' });
          if (pw) e2 = e2.filter(e => !stuck.some(g => g.path === e.path)).concat(await api.reapSudo(stuck, pw));
        }
        if (!e2.length) notes.push(`released ${fmt(sizeOf(held))} still open in ${[...new Set(held.map(g => g.cmd))].join(', ')}`);
        else errs = errs.concat(e2);
      }
    }
    freed = Math.max(0, (await api.df(base)).avail - before);
  } finally { busy = false; }
  sel.clear();
  await after();
  const failed = new Set(errs.map(e => e.path));
  const tail = errs.length ? ` · ${errs.length} skipped: ${errs[0].msg}` : '';
  if (mode === 'trash') {
    const moved = sizeOf(items.filter(i => !failed.has(i.path)));
    UI.toast((moved ? `Moved ${fmt(moved)} to Trash` : 'Nothing was moved') + tail,
      { kind: errs.length ? 'warn' : 'ok', action: moved ? { label: 'Empty Trash', fn: Shell.emptyTrash } : undefined });
  } else UI.toast([`Freed ${fmt(freed)}`, ...notes].join(' · ') + tail, { kind: errs.length ? 'warn' : 'ok' });
}

// After any delete every surface is stale: this map, the Trash, the disk card
// and the scan tabs that may have listed the same folders.
async function after() {
  Shell.markStale(['caches', 'devtools', 'largefiles']);
  fcache.clear();
  await Promise.all([Shell.refreshTrash(), Shell.refreshDisk(), scanRoot && scan(scanRoot.path, true)]);
}

// ── context menu ─────────────────────────────────────────────────────
function menu(x, y, n) {
  UI.menu(x, y, [
    ...(n.dir !== false && !n.file ? [{ label: 'Open', icon: 'chevron', fn: () => go(n.path) },
      { label: 'List largest files inside', icon: 'files', fn: () => largest(n) }] : []),
    { label: 'Show in folder', icon: 'reveal', fn: () => api.reveal(n.path) },
    { label: 'Copy path', icon: 'copy', fn: () => { api.copy(n.path); UI.toast('Path copied'); } },
    { label: 'Move to Trash…', icon: 'trash', fn: () => openDelete([n], 'trash') },
    { label: n.dir !== false && !n.file ? 'Empty folder…' : 'Empty file…', icon: 'trash', fn: () => openDelete([n], 'empty') },
    { label: 'Delete permanently…', icon: 'trash', fn: () => openDelete([n], 'delete') },
  ]);
}
const nodeAt = t => {
  const tr = t.closest('.tr, .tile'); if (tr) return find(scanRoot, tr.dataset.p) || null;
  const fr = t.closest('.frow'); return fr ? frows[+fr.dataset.i] : null;
};

// ── largest files ────────────────────────────────────────────────────
async function largest(n = focus) {
  if (!n) return;
  const s = UI.sheet(`<h2>Largest files in ${esc(n.name)}</h2>
    <p class="muted">Single files anywhere below this folder, biggest first. For a log a program is still writing to, choose Empty file instead of deleting it.</p>
    <label class="dall"><input type="checkbox" class="fall" disabled> Select all</label>
    <ul class="clist dfl"><li><span class="spin"></span> Searching…</li></ul>
    <div class="acts"><span class="muted num fsum"></span><span class="sp"></span><button class="btn ghost" type="button" data-a="no">Done</button>
      <button class="btn danger solid" type="button" data-a="go" disabled>Clean up…</button></div>`, { label: 'Largest files' });
  s.el.classList.add('dwide');
  s.el.querySelector('[data-a=no]').onclick = s.close;
  const files = (await api.scan({ dir: n.path, mode: 'deep' })).rows || [];
  const list = s.el.querySelector('.dfl'), all = s.el.querySelector('.fall'), go = s.el.querySelector('[data-a=go]');
  const base = f => splitPath(f.path).pop();
  list.innerHTML = files.length ? files.map((f, i) => `<li><label class="grow"><input type="checkbox" data-f="${i}" aria-label="Select ${esc(base(f))}">
      <span class="rmain"><span class="rname">${esc(base(f))}</span><span class="rwhy">${esc(f.name)}</span></span><span class="rsize">${fmt(f.size)}</span></label></li>`).join('')
    : '<li class="muted">No files found here.</li>';
  all.disabled = !files.length;
  const chosen = () => [...list.querySelectorAll('input:checked')].map(c => files[+c.dataset.f]);
  const count = () => {
    const c = chosen();
    s.el.querySelector('.fsum').textContent = `${plural(files.length, 'file')} · ${c.length ? `${c.length} selected · ${fmt(sizeOf(c))}` : fmt(sizeOf(files))}`;
    go.disabled = !c.length;
  };
  all.onchange = () => { list.querySelectorAll('input').forEach(c => { c.checked = all.checked; }); count(); };
  list.onchange = count;
  go.onclick = () => { const c = chosen(); s.close(); openDelete(c.map(f => ({ ...f, name: base(f), dir: false }))); };
  count();
}

// ── held space (Linux): deleted files a running program still holds ──
function held() {
  let ghosts = [], chosen = new Set(), showAll = false;
  const s = UI.sheet(`<h2>Space held by deleted files</h2>
    <p class="muted">These files were deleted, but a program still has them open, so Linux keeps their blocks until it closes them. That's why free space doesn't go up until you reboot. Emptying a file through /proc frees the space now, without restarting anything. <b>Safe</b> means a log file open for writing: the program won't notice.</p>
    <div class="hhead"><b class="num hamt">…</b><span class="muted">safe to reclaim</span><span class="sp"></span>
      <label class="dall"><input type="checkbox" class="hall"> Select all safe</label></div>
    <ul class="clist dgl"><li><span class="spin"></span> Looking…</li></ul>
    <button class="link hmore" type="button" hidden></button>
    <p class="note hrisk" hidden></p>
    <div class="acts"><button class="btn ghost" type="button" data-a="re">Rescan</button><span class="sp"></span>
      <button class="btn ghost" type="button" data-a="no">Done</button>
      <button class="btn danger solid" type="button" id="diskReap" disabled>Reclaim</button></div>`, { label: 'Space held by deleted files' });
  s.el.classList.add('dwide');
  const $s = x => s.el.querySelector(x), go = $s('#diskReap');
  const hard = g => /^unsafe/.test(g.why);
  const count = () => {
    const c = [...chosen].map(i => ghosts[i]), risky = c.filter(g => !g.safe);
    go.textContent = c.length ? `Reclaim ${fmt(sizeOf(c))}` : 'Reclaim';
    go.disabled = !c.length;
    $s('.hrisk').hidden = !risky.length;
    $s('.hrisk').textContent = `${plural(risky.length, 'file')} ${risky.length === 1 ? 'is' : 'are'} not a log. Emptying ${risky.length === 1 ? 'it' : 'them'} will likely close ${[...new Set(risky.map(g => g.cmd))].join(', ')}.`;
  };
  const draw = () => {
    const inUse = ghosts.filter(hard), rows = ghosts.filter(g => showAll || !hard(g)).slice(0, 150);
    $s('.hamt').textContent = fmt(sizeOf(ghosts.filter(g => g.safe)));
    $s('.dgl').innerHTML = rows.length ? rows.map(g => {
      const i = ghosts.indexOf(g), kind = g.safe ? ['safe', 'Safe'] : hard(g) ? ['', 'In use'] : ['check', 'Risky'];
      return `<li><label class="grow"><input type="checkbox" data-g="${i}"${chosen.has(i) ? ' checked' : ''}${hard(g) ? ' disabled' : ''} aria-label="Reclaim ${esc(g.cmd)} ${esc(g.path)}">
        <span class="rmain"><span class="rname">${esc(g.cmd)} <span class="muted">pid ${g.pid} · ${esc(g.user)}</span> <span class="badge ${kind[0]}">${kind[1]}</span></span>
          <span class="rwhy">${esc(g.safe ? 'Log file open for writing. Safe to empty.' : g.why.replace(/^(unsafe|risky): /, ''))}</span>
          <span class="rwhy">${esc(g.path)}</span></span><span class="rsize">${fmt(g.size)}</span></label></li>`;
    }).join('') : `<li class="muted">${ghosts.length ? 'Only in-use items, which cannot be emptied.' : 'No deleted-but-open files. Everything you freed is already back.'}</li>`;
    $s('.hmore').hidden = !inUse.length;
    $s('.hmore').textContent = `${showAll ? 'Hide' : 'Show'} ${plural(inUse.length, 'in-use item')}`;
    $s('.hall').checked = ghosts.some(g => g.safe) && ghosts.every((g, i) => !g.safe || chosen.has(i));
    count();
  };
  const load = async () => {
    ghosts = await api.ghosts();
    chosen = new Set(ghosts.flatMap((g, i) => g.safe ? [i] : []));
    draw();
  };
  $s('.dgl').onchange = e => { const i = +e.target.dataset.g; e.target.checked ? chosen.add(i) : chosen.delete(i); count(); };
  $s('.hall').onchange = e => { chosen = new Set(e.target.checked ? ghosts.flatMap((g, i) => g.safe ? [i] : []) : []); draw(); };
  $s('.hmore').onclick = () => { showAll = !showAll; draw(); };
  $s('[data-a=re]').onclick = load;
  $s('[data-a=no]').onclick = s.close;
  go.onclick = async () => {
    const c = [...chosen].map(i => ghosts[i]); if (!c.length) return;
    go.disabled = true;
    const before = (await api.df('/')).avail;
    let errs = await api.reap(c);
    const stuck = c.filter(g => errs.some(e => e.path === g.path && DENIED.test(e.msg)));
    if (stuck.length) {
      const pw = await UI.password({ title: `${fmt(sizeOf(stuck))} is held by another user's program`,
        why: 'Releasing blocks held by a program owned by root or another user needs your password. Nothing is restarted and no program is closed.' });
      if (pw) errs = errs.filter(e => !stuck.some(g => g.path === e.path)).concat(await api.reapSudo(stuck, pw));
    }
    const freed = Math.max(0, (await api.df('/')).avail - before);
    UI.toast(errs.length ? `${plural(errs.length, 'file')} not emptied: ${errs[0].msg}` : `Reclaimed ${fmt(freed)}. Nothing restarted.`, { kind: errs.length ? 'warn' : 'ok' });
    Shell.refreshDisk();
    await load();
  };
  load();
}

// ── mount ────────────────────────────────────────────────────────────
function openMenu(b) {
  const r = b.getBoundingClientRect(), home = Shell.info.home || '/';
  UI.menu(r.left, r.bottom + 4, [
    { label: 'Home folder', icon: 'reveal', fn: () => scan(home) },
    { label: 'Whole disk', icon: 'disk', fn: () => scan(home.match(/^[A-Za-z]:\\/)?.[0] || '/') },
    { label: 'Choose folder…', icon: 'search', fn: async () => { const p = await api.pick(); if (p) scan(p); } },
  ]);
}

Shell.tab({ key: 'disk', label: 'Storage Map', group: 'review', icon: 'disk',
  mount(view) {
    el = view; el.classList.add('disk');
    el.innerHTML = `<div class="dtool">
        <button class="btn ghost dup" type="button" title="Up one folder (Backspace)">${UI.icon('chevron')}Up</button>
        <nav class="dcrumb" aria-label="Folder path"></nav>
        <span class="dstat muted num"></span>
        <span class="sp"></span>
        ${linux() ? '<button class="link dheld" type="button" title="Advanced: space held by deleted files">Held space…</button>' : ''}
        <button class="btn dfiles" type="button" title="Largest single files below this folder">Largest files</button>
        <button class="btn dmap" type="button" aria-pressed="false" title="Show this folder as a map">Map</button>
        <button class="btn dopen" type="button" aria-haspopup="menu">Open folder… ▾</button>
      </div>
      <div class="dmain">
        <div class="dtree" aria-label="Folders"></div>
        <div class="dright"><div class="dlist"></div><div class="dtiles" hidden></div><div class="dstage empty" hidden></div></div>
      </div>
      <div class="bar dbar"><div class="in">
        <button class="btn ghost" type="button" data-a="junk" title="Select every cache and build folder found so far">Select all cleanable</button>
        <button class="btn ghost" type="button" data-a="none">Clear</button>
        <span class="sp"></span><span class="tot num"></span>
        <button class="btn primary" type="button" data-a="del" title="Clean up the selection (Delete)">Clean up…</button></div></div>`;
    drawBar();

    q('.dup').onclick = up;
    q('.dopen').onclick = e => openMenu(e.currentTarget);
    q('.dfiles').onclick = () => largest();
    q('.dheld')?.addEventListener('click', held);
    q('.dmap').onclick = e => {
      pane = pane === 'map' ? 'folder' : 'map';
      e.currentTarget.setAttribute('aria-pressed', pane === 'map');
      if (focus) pane === 'map' ? treemap() : folderView();
    };
    q('.dcrumb').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.p); };
    q('.dstat').onclick = async e => {
      if (!e.target.closest('.dadm')) return;
      const pw = await UI.password({ title: 'Scan system folders too',
        why: 'Folders owned by root or other users (/var/lib/docker, /root, logs …) can only be measured as administrator. Your password goes straight to sudo and is never stored.' });
      if (pw) scan(scanRoot.path, false, pw);
    };
    q('.dtree').onclick = async e => {
      const row = e.target.closest('.tr'); if (!row) return;
      const n = find(scanRoot, row.dataset.p); if (!n) return;
      if (e.target.closest('.cv') || n === focus) {
        open.has(n.path) ? open.delete(n.path) : (open.add(n.path), await loadFiles(n));
        drawTree();
        q(`.tr[data-p="${CSS.escape(n.path)}"] .tn`)?.focus();
      } else go(n.path);
    };
    q('.dlist').addEventListener('change', e => {
      if (e.target.matches('.fall')) { for (const r of frows) toggle(r, e.target.checked); return; }
      const r = frows[+e.target.closest('.frow')?.dataset.i]; if (r) toggle(r, e.target.checked); });
    q('.dlist').onclick = e => {
      const s = e.target.closest('[data-s]');
      if (s) { const k = s.dataset.s; fsort = fsort.key === k ? { key: k, dir: -fsort.dir } : { key: k, dir: k === 'name' ? 1 : -1 }; return folderView(); }
      const row = e.target.closest('.frow'); if (!row || e.target.matches('input')) return;
      const r = frows[+row.dataset.i];
      r.dir ? go(r.path) : toggle(r);
    };
    q('.dtiles').onclick = e => {
      const t = e.target.closest('.tile'); if (!t) return;
      const n = find(scanRoot, t.dataset.p); if (!n) return;
      n.file ? toggle(n) : go(n.path);
    };
    el.addEventListener('contextmenu', e => {
      const n = scanRoot && nodeAt(e.target); if (!n) return;
      e.preventDefault(); menu(e.clientX, e.clientY, n);
    });
    q('.dbar').onclick = e => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'del') openDelete(picked());
      else if (a === 'none') { sel.clear(); render(); }
      else if (a === 'junk' && scanRoot) {
        // the top-most cleanable folder of each branch: the parent already covers its children
        (function walk(n, inside) { const j = isCleanable(n) && !inside; if (j) sel.set(n.path, n); n.kids.forEach(k => walk(k, inside || j)); })(scanRoot, false);
        render();
      }
    };
    let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => pane === 'map' && !q('.dtiles').hidden && treemap(), 80); }).observe(q('.dtiles'));
    addEventListener('keydown', e => {
      if (Shell.current !== 'disk' || document.querySelector('.scrim, .menu') || !focus) return;
      const a = document.activeElement;
      if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox') return;
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); up(); }
      else if (e.key === 'Delete' && sel.size) { e.preventDefault(); openDelete(picked()); }
    });
  },
  onShow() {
    if (!scanRoot && !scanning) api.home().then(h => scan(h));
    else if (pane === 'map') requestAnimationFrame(treemap);
    return () => { if (scanRoot) { fcache.clear(); scan(scanRoot.path); } };
  },
});
})();
