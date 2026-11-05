const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard, Tray, Menu, Notification,
        nativeImage } = require('electron');
const fs = require('fs/promises');
const fsc = require('fs').constants;
const os = require('os');
const path = require('path');
const { classify, guard, real } = require('./safety');
const { buildTree, parseDu, patch } = require('./tree');
const { run, sudo } = require('./sys');
const junk = require('./junk');
const engine = require('./engine');
const { create, nextRun } = require('./store');

// Linux uses du/find/lsof; macOS and Windows fall back to the pure-Node walkers
// in junk.js and the UI hides the Linux-only tools (held space, apt/snap).
const LINUX = process.platform === 'linux';
const MODS = Object.fromEntries(['caches', 'devtools', 'largefiles', 'uninstaller'].map(k => [k, require('../scanners/' + k)]));

app.setName('Cleanzy');
// One-time carry-over from the old "Cleaner" name: settings, history and the Linux autostart entry.
try {
  const fss = require('fs'), ud = app.getPath('userData');
  fss.mkdirSync(ud, { recursive: true });
  fss.copyFileSync(path.join(path.dirname(ud), 'Cleaner', 'cleaner.json'), path.join(ud, 'cleanzy.json'), fss.constants.COPYFILE_EXCL);
} catch {}
if (LINUX) require('fs').rmSync(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'cleaner.desktop'), { force: true });
const store = create(app.getPath('userData'));

// du prints "denied" lines to stderr and still exits 1 -- we keep the partial result.
const denied = s => s.split('\n').filter(l => /denied|No such/i.test(l)).length;
const E = (p, msg) => ({ path: p, msg });
const last = s => (s || '').trim().split('\n').filter(Boolean).pop();
const fmt = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : Math.round(b / 1e3) + ' KB';
const THEMES = ['system', 'light', 'dark'];

// ── modules + deletion engine ────────────────────────────────────────
const running = new Set();
const ctx = signal => ({ platform: process.platform, home: os.homedir(), env: process.env, settings: store.get(),
  signal, run, sudo,
  fileIcon: p => app.getFileIcon(p).then(i => i.toDataURL(), () => null),
  dirSize: (p, c) => junk.dirSize(p, (c || {}).signal || signal),
  walk: (root, visit, opts) => junk.walk(root, visit, { signal, ...opts }) });

const under = (p, d) => p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
const isItems = a => Array.isArray(a) && a.every(i => i && typeof i.id === 'string' && Array.isArray(i.paths));
async function callMod(key, fn = 'scan', arg) {
  const m = Object.hasOwn(MODS, key) && MODS[key];
  if (!m) throw new Error('unknown module ' + key);
  const ac = new AbortController();
  running.add(ac);
  try {
    let r;
    if (fn === 'scan') {
      r = await m.scan(ctx(ac.signal));
      // an excluded folder (or anything inside or around it) never shows up, whatever module found it
      const ex = (store.get().exclusions || []).filter(x => typeof x === 'string' && x);
      if (Array.isArray(r)) r = r.filter(i => !(i.paths || []).some(p => ex.some(x => under(p, x) || under(x, p))));
    }
    else if (Object.hasOwn(m.handlers || {}, fn)) r = await m.handlers[fn](ctx(ac.signal), arg);
    else throw new Error(`unknown handler ${key}.${fn}`);
    // everything a module hands back as items becomes cleanable, nothing else does
    if (isItems(r)) r = engine.remember(key, r, fn === 'scan');
    else if (isItems(r?.items)) r = { ...r, items: engine.remember(key, r.items, fn === 'scan') };
    return r;
  } finally { running.delete(ac); }
}
ipcMain.handle('mod', async (_e, key, fn, arg) => {
  try { return await callMod(key, fn, arg); }
  catch (e) { return { error: e.message || String(e) }; }
  finally { rebuildTray(); }
});
ipcMain.handle('stop', () => { for (const ac of running) ac.abort(); });

// note: one global queue, so a scheduled clean and a user clean never run the same ids at once
let cleaning = Promise.resolve();
const doClean = (ids, opts) => (cleaning = cleaning.then(() => cleanNow(ids, opts), () => cleanNow(ids, opts)));
async function cleanNow(ids, opts) {
  const r = await engine.clean(ids, opts, { trash: p => shell.trashItem(p), run, sudo,
    exclusions: store.get().exclusions || [], home: os.homedir(), addHistory: e => store.addHistory(e),
    progress: (i, n, name) => win?.webContents.send('cleanProgress', { i, n, name }) });
  if (r.count) store.set({ lastClean: { at: Date.now(), freed: r.freed, trashed: r.trashed, count: r.count } });
  rebuildTray();
  return r;
}
ipcMain.handle('clean', (_e, { ids, mode, password, safeOnly } = {}) =>
  doClean(Array.isArray(ids) ? ids : [], { mode: mode === 'delete' ? 'delete' : 'trash', password, safeOnly: !!safeOnly }));

ipcMain.handle('info', () => ({ platform: process.platform, home: os.homedir(), sep: path.sep, version: require('../../package.json').version }));
ipcMain.handle('settings', () => store.get());
ipcMain.handle('setSettings', async (_e, p = {}) => {
  // a new schedule starts counting from now, not from 1970
  const s = store.set(p.schedule ? { ...p, lastScheduled: Date.now() } : p);
  if ('theme' in p) nativeTheme.themeSource = THEMES.includes(s.theme) ? s.theme : 'system';
  if ('launchAtLogin' in p) await applyLogin(!!s.launchAtLogin).catch(() => {});
  if ('tray' in p) rebuildTray();
  return s;
});
ipcMain.handle('history', () => store.history());
ipcMain.handle('clearHistory', () => store.clearHistory());
ipcMain.handle('openFDA', () => process.platform === 'darwin'
  && shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));
ipcMain.handle('copy', (_e, t) => clipboard.writeText(String(t)));
ipcMain.handle('sizeOf', (_e, p) => junk.dirSize(String(p)));

// ── Trash ────────────────────────────────────────────────────────────
const TRASH = () => path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'Trash');
const MAC_TRASH = () => path.join(os.homedir(), '.Trash');
const RECYCLE = '(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Measure-Object -Property Size -Sum | % Sum';

ipcMain.handle('trashInfo', async () => {
  if (process.platform === 'darwin') {
    const p = MAC_TRASH();
    // without Full Disk Access macOS refuses to list ~/.Trash
    const no = await fs.readdir(p).then(() => null, e => e.code);
    return { size: no ? 0 : await junk.dirSize(p), path: p, denied: no === 'EPERM' || no === 'EACCES' };
  }
  if (process.platform === 'win32') {
    const { out } = await run('powershell', ['-NoProfile', '-Command', RECYCLE]);
    return { size: +out.trim() || 0, path: '', denied: false };
  }
  const { out } = await run('du', ['-s', '--block-size=1', '--', TRASH()]);
  return { size: +out.split('\t')[0] || 0, path: TRASH(), denied: false };
});

ipcMain.handle('emptyTrash', async () => {
  if (process.platform === 'darwin') {
    const errors = [], p = MAC_TRASH();
    for (const n of await fs.readdir(p).catch(() => [])) {
      const c = path.join(p, n), no = guard(c);
      if (no) { errors.push(E(c, 'refused — ' + no)); continue; }
      await fs.rm(c, { recursive: true, force: true }).catch(e => errors.push(E(c, e.code || e.message)));
    }
    return { errors };
  }
  if (process.platform === 'win32') {
    const { err, code } = await run('powershell', ['-NoProfile', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue']);
    return { errors: code ? [E('Recycle Bin', last(err) || 'could not empty')] : [] };
  }
  const errors = await tracked([TRASH()], async () => {
    const { err, code } = await run('gio', ['trash', '--empty']);
    return code ? [E(TRASH(), last(err) || 'could not empty trash')] : [];
  });
  return { errors };
});

// ── disk map (legacy handlers, used by the Disk tab) ─────────────────
ipcMain.handle('home', () => os.homedir());
ipcMain.handle('platform', () => process.platform);
ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('df', async (_e, p) => {
  if (!LINUX) {
    const s = await fs.statfs(p === '/' ? path.parse(os.homedir()).root : p).catch(() => null);
    if (!s) return { size: 0, used: 0, avail: 0, mount: p };
    const size = s.blocks * s.bsize, avail = s.bavail * s.bsize;
    return { size, used: size - s.bfree * s.bsize, avail, mount: path.parse(os.homedir()).root };
  }
  const { out } = await run('df', ['-B1', '--output=size,used,avail,target', p]);
  const f = (out.split('\n')[1] || '').trim().split(/\s+/);
  return { size: +f[0] || 0, used: +f[1] || 0, avail: +f[2] || 0, mount: f[3] || '/' };
});

// Sizes of every folder from the last full `du`, so opening a folder, going up
// or down, and refreshing after a delete never walk the disk again.
let sizes = new Map(), cacheRoot = null, lastDenied = 0;
const covers = p => cacheRoot != null && under(p, cacheRoot);
const duSize = async p => LINUX ? +(await run('du', ['-sx', '--block-size=1', '--', p])).out.split('\t')[0] || 0
  : junk.dirSize(p);
const duTree = async p => LINUX ? parseDu((await run('du', ['-x', '--block-size=1', '--', p])).out) : junk.duMap(p);

// mode 'level' = one level down (drill-down), 'deep' = biggest individual files anywhere below
ipcMain.handle('scan', async (_e, { dir, mode }) => {
  const t0 = Date.now();
  dir = path.resolve(String(dir));   // absolute: never starts with '-', so find can't read it as an option
  if (mode === 'deep' && !LINUX) {
    const bin = process.platform === 'darwin' ? MAC_TRASH() : null;   // already in the Trash: not a candidate
    const rows = (await junk.largestFiles(dir)).filter(f => !bin || !under(f.path, bin)).map(f => ({ ...f, name: path.relative(dir, f.path), dir: false }));
    return { rows, denied: 0, ms: Date.now() - t0 };
  }
  if (mode === 'deep') {
    // dir goes in as $1, never spliced into the script: a folder named $(…) must stay a name
    const { out } = await run('bash', ['-c',
      `find "$1" -xdev -path "$2" -prune -o -type f -printf '%b\\t%p\\0' 2>/dev/null | sort -zrn | head -zn 100`, '_', dir, TRASH()]);
    const rows = out.split('\0').filter(Boolean).map(l => {
      const i = l.indexOf('\t'), p = l.slice(i + 1);
      return { path: p, name: path.relative(dir, p), size: +l.slice(0, i) * 512, dir: false };
    });
    return { rows, denied: 0, ms: Date.now() - t0 };
  }
  // A listing is readdir + lstat; folder sizes come from the cache. Files use
  // st_blocks, the same number du reports.
  const ents = await fs.readdir(dir).catch(() => null);
  // Unreadable without root: list its sub-folders from a root scan's cache.
  if (!ents) return { denied: 1, ms: Date.now() - t0, rows: [...sizes]
    .filter(([p]) => p !== dir && path.dirname(p) === dir)
    .map(([p, size]) => ({ path: p, name: path.basename(p), size, dir: true, mtime: 0, items: -1 }))
    .sort((a, b) => b.size - a.size) };
  const rows = await Promise.all(ents.map(async name => {
    const p = path.join(dir, name);
    const st = await fs.lstat(p).catch(() => null);
    const isDir = !!st && st.isDirectory();
    return { path: p, name, dir: isDir, mtime: st ? st.mtimeMs : 0, prot: !!guard(p),   // prot: the UI greys out its checkbox
      size: isDir ? (sizes.get(p) ?? await duSize(p)) : (st ? (st.blocks ? st.blocks * 512 : st.size) : 0),
      // "3 items", the way a file manager shows it — only meaningful for folders
      items: isDir ? await fs.readdir(p).then(a => a.length, () => -1) : -1 };
  }));
  rows.sort((a, b) => b.size - a.size);
  return { rows, denied: 0, ms: Date.now() - t0 };
});

// Full recursive tree for the rings chart + folder tree. cached=true rebuilds
// from the last du (instant) when it already covers dir.
// With a password, du runs as root so system folders (/var/lib/docker, /root,
// /var/log/…) are counted instead of reported as unreadable.
ipcMain.handle('tree', async (_e, { dir, cached, password, maxDepth = 9 }) => {
  const t0 = Date.now();
  if (!(cached && covers(dir))) {
    if (!LINUX) { sizes = await junk.duMap(dir); cacheRoot = dir; lastDenied = 0; }
    else {
      const args = ['du', '-x', '--block-size=1', '--', dir];
      const { out, err } = password ? await sudo(password, args) : await run(args[0], args.slice(1));
      sizes = parseDu(out); cacheRoot = dir; lastDenied = denied(err);
    }
  }
  return { root: buildTree(sizes, dir, maxDepth), denied: lastDenied, ms: Date.now() - t0 };
});

// Run a delete-like operation, then patch the cached sizes for what it touched.
// Nested picks are patched once, through the outermost path.
async function tracked(paths, op) {
  const mine = paths.filter(p => typeof p === 'string' && covers(p));
  const top = mine.filter(p => !mine.some(q => q !== p && under(p, q)));
  const before = new Map();
  for (const p of top) before.set(p, sizes.get(p) ?? await fs.lstat(p).then(s => s.blocks * 512, () => 0));
  const errors = await op();
  for (const p of top) patch(sizes, p, before.get(p), await duTree(p));
  return errors;
}
const list = a => Array.isArray(a) ? a : [];

// Deleted-but-still-open files: the reason "df" does not drop after an rm.
// lsof +L1 columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NLINK NODE NAME
async function ghosts() {
  if (!LINUX) return [];
  const { out } = await run('lsof', ['-nP', '+L1']);
  const self = process.pid;
  const seen = new Map();
  for (const l of out.split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length < 10) continue;
    const raw = f[3] || '';
    const fd = raw.replace(/[^0-9]/g, '');
    const size = +f[6];
    const pid = +f[1];
    if (!fd || !Number.isFinite(size) || size <= 0 || pid === self) continue;
    const key = pid + ':' + fd;
    if (seen.has(key)) continue;
    const g = { cmd: f[0], pid, user: f[2], fd, mode: raw.replace(/[0-9]/g, ''),
                type: f[4], size, path: f.slice(9).join(' ').replace(/ \(deleted\)$/, '') };
    g.why = classify(g);
    g.safe = g.why === 'safe';
    seen.set(key, g);
  }
  return [...seen.values()].sort((a, b) => b.size - a.size);
}
ipcMain.handle('ghosts', ghosts);
// The renderer's {pid, fd} is only a request: it must still be a deleted, open file
// lsof lists right now and not one classify() calls unsafe, or we refuse to zero it.
async function vetted(entries) {
  const live = await ghosts(), ok = [], errors = [];
  for (const g of list(entries)) {
    const m = live.find(x => String(x.pid) === String(g?.pid) && x.fd === String(g?.fd));
    if (!m || /^unsafe/.test(m.why)) errors.push(E(String(g?.path), 'refused — ' + (m ? m.why : 'no longer a deleted open file')));
    else ok.push(m);
  }
  return { ok, errors };
}

ipcMain.handle('remove', (_e, paths) => tracked(list(paths), async () => {
  const errors = [];
  for (const p0 of list(paths)) {
    const p = await real(p0), no = guard(p);
    if (no) { errors.push(E(p, 'refused — ' + no)); continue; }
    try { await fs.rm(p, { recursive: true, force: true }); }
    catch (e) { errors.push(E(p, e.code || e.message)); }
  }
  return errors;
}));

// Recoverable delete. The OS speaks its own trash format (freedesktop .trashinfo,
// ~/.Trash, Recycle Bin) so we do not reimplement it.
ipcMain.handle('trash', (_e, paths) => tracked([...list(paths), TRASH()], async () => {
  const errors = [];
  for (const p0 of list(paths)) {
    const p = await real(p0), no = guard(p);
    if (no) { errors.push(E(p, 'refused — ' + no)); continue; }
    await shell.trashItem(p).catch(e => errors.push(E(p, e.message || 'could not move to trash')));
  }
  return errors;
}));

// Empty a folder but keep the folder itself — what you actually want for a cache
// or log directory that a running program still expects to exist.
ipcMain.handle('emptyDir', (_e, paths) => tracked(list(paths), async () => {
  const errors = [];
  for (const p0 of list(paths)) {
    const p = await real(p0), no = guard(p, { contentsOnly: true });
    if (no) { errors.push(E(p, 'refused — ' + no)); continue; }
    try {
      // a symlink/junction to elsewhere is not this folder: never empty its target
      if (!(await fs.lstat(p)).isDirectory()) throw new Error('not a real folder');
      for (const name of await fs.readdir(p))
        await fs.rm(path.join(p, name), { recursive: true, force: true })
          .catch(e => errors.push(E(path.join(p, name), e.code || e.message)));
    } catch (e) { errors.push(E(p, e.code || e.message)); }
  }
  return errors;
}));

// Cheapest way to tell a wrong password from a failed command: ask sudo to do nothing.
ipcMain.handle('checkPassword', async (_e, password) => {
  if (!LINUX && process.platform !== 'darwin') return false;
  const { code } = await sudo(String(password), ['true']);
  return code === 0;
});

// resolved like the paths checked against them (macOS /tmp is /private/tmp)
const SUDO_OK = () => [os.homedir(), '/var/log', '/var/cache', '/var/tmp', '/tmp'].map(d => { try { return require('fs').realpathSync(d); } catch { return d; } });
// Root-owned leftovers, run through sudo with the password the app collected.
// Used only after the unprivileged attempt failed.
ipcMain.handle('removeSudo', (_e, { paths, password } = {}) => tracked(list(paths), async () => {
  const errors = [];
  for (const p0 of list(paths)) {
    const p = await real(p0);
    const no = guard(p) || (!SUDO_OK().some(d => typeof p === 'string' && under(path.resolve(p), d)) && `${p} is outside your home folder, logs, caches and temp`);
    if (no) { errors.push(E(p, 'refused — ' + no)); continue; }
    const { err, code } = await sudo(password, ['rm', '-rf', '--', p]);
    if (code) errors.push(E(p, last(err) || 'could not delete'));
  }
  return errors;
}));

// Truncate keeps the inode, so a running process (your DB) frees the space
// immediately and keeps writing to the same fd. No restart needed.
ipcMain.handle('truncate', (_e, paths) => tracked(list(paths), async () => {
  const errors = [];
  for (const p0 of list(paths)) {
    const p = await real(p0), no = guard(p);
    if (no) { errors.push(E(p, 'refused — ' + no)); continue; }
    let fh;
    try {
      fh = await fs.open(p, fsc.O_RDWR | (fsc.O_NOFOLLOW || 0));
      if (!(await fh.stat()).isFile()) throw new Error('not a regular file');
      await fh.truncate(0);
    } catch (e) { errors.push(E(p, e.code || e.message)); }
    finally { await fh?.close().catch(() => {}); }
  }
  return errors;
}));

// Reclaim space held by already-deleted files via /proc/<pid>/fd/<fd>.
const procFd = g => /^\d+$/.test(String(g?.pid)) && /^\d+$/.test(String(g?.fd)) ? `/proc/${g.pid}/fd/${g.fd}` : null;
ipcMain.handle('reap', async (_e, entries) => {
  const { ok, errors } = await vetted(entries);
  for (const g of ok) {
    const p = procFd(g);
    if (!p) { errors.push(E(String(g?.path), 'refused — bad process id')); continue; }
    let fh;
    try {
      fh = await fs.open(p, 'r+');
      // last-line guard: never zero anything that is not a plain file on disk
      if (!(await fh.stat()).isFile()) throw new Error('not a regular file');
      await fh.truncate(0);
    } catch (e) { errors.push(E(g.path, `${g.cmd}[${g.pid}]: ${e.code || e.message}`)); }
    finally { await fh?.close().catch(() => {}); }
  }
  return errors;
});
ipcMain.handle('reapSudo', async (_e, { entries, password } = {}) => {
  const { ok, errors } = await vetted(entries);
  for (const g of ok) {
    const p = procFd(g);
    if (!p) { errors.push(E(String(g?.path), 'refused — bad process id')); continue; }
    // truncate follows /proc/<pid>/fd/<n> to the still-open inode and frees its blocks
    const { err, code } = await sudo(password, ['truncate', '-s', '0', p]);
    if (code) errors.push(E(g.path, `${g.cmd}[${g.pid}]: ${last(err) || 'could not reclaim'}`));
  }
  return errors;
});

// ── scheduled clean, tray, login item ────────────────────────────────
async function scheduler() {
  const s = store.get();
  const due = nextRun(s.schedule, s.lastScheduled);
  if (due == null || Date.now() < due) return;
  store.set({ lastScheduled: Date.now() });   // first, so a crash mid-clean never loops
  for (const k of ['caches', 'devtools']) await callMod(k).catch(() => {});
  // Safe items only, and nothing that would need a password nobody is there to type
  const ids = [...engine.known.values()]
    .filter(i => (i.module === 'caches' || i.module === 'devtools') && i.safety === 'safe' && i.pre !== false
      && !(i.action === 'cmd' && engine.SUDO.has(i.cmd?.id))
      // a project's build output only when the recency setting already hid the projects in use
      && (i.meta?.kind !== 'project' || s.staleDays > 0))
    .map(i => i.id);
  const r = await doClean(ids, { mode: 'trash', safeOnly: true, scheduled: true });
  if (r.count && Notification.isSupported())
    new Notification({ title: 'Cleanzy', body: `Cleaned ${fmt(r.freed + r.trashed)}` }).show();
  win?.webContents.send('menu', 'cleaned');
}

let win = null, tray = null, quitting = false;
const showWin = () => { if (win) { win.show(); win.focus(); } };
const send = cmd => win?.webContents.send('menu', cmd);

function rebuildTray() {
  if (!app.isReady()) return;
  if (!store.get().tray) { tray?.destroy(); tray = null; return; }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png')).resize({ width: 18, height: 18 }));
    tray.setToolTip('Cleanzy');
    tray.on('click', showWin);
  }
  // the same one-click rule as the header's Clean Safe Items
  const rec = [...engine.known.values()].filter(i => i.safety === 'safe' && i.pre !== false && i.module !== 'uninstaller'
    && i.action !== 'pkg' && !(i.action === 'cmd' && ['aptClean', 'journal', 'snapRev'].includes(i.cmd?.id))).reduce((a, i) => a + (i.size || 0), 0);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Space you can free: ' + fmt(rec), enabled: false },
    { type: 'separator' },
    { label: 'Scan Now', click: () => send('scanAll') },
    { label: 'Clean Safe Items…', click: () => { showWin(); send('cleanSafe'); } },   // the confirm sheet still appears
    { label: 'Open Cleanzy', click: showWin },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

async function applyLogin(on) {
  if (process.platform !== 'linux') return app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  const f = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'cleanzy.desktop');
  if (!on) return fs.rm(f, { force: true });
  await fs.mkdir(path.dirname(f), { recursive: true });
  const appArg = app.isPackaged ? '' : ` "${app.getAppPath()}"`;   // dev runs need the app folder
  await fs.writeFile(f, `[Desktop Entry]\nType=Application\nName=Cleanzy\nExec="${process.execPath}"${appArg} --hidden\nX-GNOME-Autostart-enabled=true\n`);
}

app.whenReady().then(() => {
  const s = store.get();
  if (LINUX && s.launchAtLogin) applyLogin(true).catch(() => {});   // rewrites the autostart entry under the new name
  nativeTheme.themeSource = THEMES.includes(s.theme) ? s.theme : 'system';
  // shortcuts live in the renderer; drop the default menu so Ctrl+R never reloads the page
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#0c0e13' : '#eef1f7',
    // macOS: native glass behind the sidebar (src/renderer/ui/shell.css [data-platform=darwin])
    ...(process.platform === 'darwin' && { vibrancy: 'sidebar', visualEffectState: 'active', titleBarStyle: 'hiddenInset' }),
    show: !(process.argv.includes('--hidden') && s.tray),
    title: 'Cleanzy', icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', e => {
    if (!quitting && tray && !store.get().quitOnClose) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  rebuildTray();
  scheduler().catch(() => {});
  setInterval(() => scheduler().catch(() => {}), 3600e3);
});
app.on('activate', showWin);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
