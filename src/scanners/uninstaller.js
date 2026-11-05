// Uninstaller: installed apps + what deleted apps left behind.
// linux: apt (manual) / snap / flatpak, removed with the password the app collected.
// darwin: *.app bundles go to the Trash with their ~/Library leftovers (strict bundle-id matching).
// win32: registry Uninstall keys; removal opens the vendor's own uninstaller.
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { guard } = require('../main/safety');
const A = require('../main/apps');

const K = 'uninstaller:';
let last = new Map();   // id -> app item from the last scan; handlers only ever act on these

const ls = d => fs.readdir(d, { withFileTypes: true }).catch(() => []);
const tail = s => (s || '').trim().split('\n').filter(Boolean).pop() || 'failed';
// a missing tool means "nothing installed with it"; any other failure means we don't know
const listed = r => r.code === 0 || r.code === 'ENOENT';
const leftover = (p, size, mtime, bundleId, name, why, extra) => ({ id: K + p, module: 'uninstaller', group: 'Leftovers',
  name, paths: [p], size, mtime, safety: 'check', why, action: 'trash', trashOnly: true, pre: false,
  meta: { kind: 'leftover', bundleId }, ...extra });
// names a linux app's folders may carry ('flatpak' is the runner, not the app)
const names = o => [o.meta.pkgId, o.meta.desktop, o.meta.exec].filter(n => n && n.length > 2 && n !== 'env' && n !== 'flatpak').map(n => n.toLowerCase());
const mtimeOf = p => fs.stat(p).then(s => s.mtimeMs, () => 0);

// ── linux ────────────────────────────────────────────────────────────
async function linux(ctx) {
  const [dpkg, manual, snaps, flat, status] = await Promise.all([
    ctx.run('dpkg-query', ['-W', '-f=${Package}\t${Installed-Size}\t${Priority}\t${Essential}\t${binary:Summary}\n']),
    ctx.run('apt-mark', ['showmanual']),
    ctx.run('snap', ['list', '--all']),
    ctx.run('flatpak', ['list', '--app', '--columns=application,name,size,installation']),
    ctx.run('dpkg-query', ['-W', '-f=${db:Status-Abbrev}\t${Package}\n']),
  ]);
  const snapAll = A.snapApps(snaps.out);
  const flats = A.parseFlatpak(flat.out);
  // size-0 apt packages are metapackages; superseded snap revisions belong to App Caches
  // Ubuntu's tiny transitional apt packages (firefox, chromium-browser) only point at the snap of the same name
  const snapIds = new Set(snapAll.map(s => s.id));
  const list = [...A.aptApps(dpkg.out, manual.out).filter(a => a.size > 0 && !(snapIds.has(a.id) && a.size < 1e6)), ...snapAll.filter(s => !s.stale), ...flats];

  // one dpkg call for every desktop file, instead of one per package
  const entries = [];
  for (const dir of A.desktopDirs(ctx.home))
    for (const d of await ls(dir)) {
      if (!d.name.endsWith('.desktop')) continue;
      const full = path.join(dir, d.name);
      try {
        const e = A.parseDesktop(await fs.readFile(full, 'utf8'));
        if (!e.hidden) entries.push({ ...e, file: d.name, full, pkg: null });
      } catch {}
    }
  if (entries.length) {
    const byPath = new Map();
    for (const line of (await ctx.run('dpkg', ['-S', ...entries.map(e => e.full)])).out.split('\n')) {
      const i = line.indexOf(': ');
      if (i > 0) byPath.set(line.slice(i + 2).trim(), line.slice(0, i).split(':')[0].split(', ')[0]);
    }
    entries.forEach(e => { e.pkg = byPath.get(e.full) || null; });
  }
  const icons = new Map(), dirs = A.iconDirs(ctx.home);
  const items = list.filter(a => a.id !== 'cleanzy').map(a => {   // never offer to remove ourselves
    const e = A.matchEntry(a, entries);
    if (e && !icons.has(e.icon)) { const p = A.resolveIcon(e.icon, undefined, dirs); icons.set(e.icon, p && pathToFileURL(p).href); }
    return { id: `${K}${a.kind}:${a.id}`, module: 'uninstaller', group: 'Apps', name: e?.name || a.name, paths: [],
      size: a.size, mtime: 0, safety: 'check', action: 'pkg',
      why: a.locked ? `Part of the system (${a.locked}).` : { apt: 'Debian package', snap: 'Snap', flatpak: 'Flatpak' }[a.kind],
      meta: { kind: a.kind, pkgId: a.id, locked: a.locked || null, launcher: !!e, icon: e ? icons.get(e.icon) : null,
              exec: e?.exec || '', desktop: e ? e.file.replace(/\.desktop$/, '') : '', installation: a.installation || '', detail: a.detail || '' } };
  });

  // data dirs of snaps / flatpaks that are gone
  const left = [];
  const gone = async (root, have, kind) => {
    for (const d of await ls(root)) {
      if (!d.isDirectory() || have.has(d.name)) continue;
      const p = path.join(root, d.name);
      left.push(leftover(p, await ctx.dirSize(p), await mtimeOf(p), d.name, d.name,
        `Data from the ${d.name} ${kind}, which is no longer installed.`));
    }
  };
  if (listed(snaps)) await gone(path.join(ctx.home, 'snap'), new Set(snapAll.map(s => s.id.split(':')[0])), 'snap');
  if (listed(flat)) await gone(path.join(ctx.home, '.var', 'app'), new Set(flats.map(f => f.id)), 'Flatpak');
  // apt packages removed but not purged ('rc') leave ~/.config/<pkg>, ~/.local/share/<pkg> behind.
  // ~/.cache/<pkg> is skipped: App Caches already offers it. /etc needs sudo, so it is left to apt purge.
  const taken = new Set(items.flatMap(names));
  const rc = new Set(status.out.split('\n').filter(l => l.startsWith('rc')).map(l => (l.split('\t')[1] || '').trim().toLowerCase())
    .filter(n => n.length > 2 && !taken.has(n)));
  if (rc.size) for (const where of ['.config', '.local/share']) {
    const root = path.join(ctx.home, ...where.split('/'));
    for (const d of await ls(root)) {
      const pkg = d.name.toLowerCase(), p = path.join(root, d.name);
      if (!d.isDirectory() || !rc.has(pkg) || guard(p, { home: ctx.home })) continue;
      left.push(leftover(p, await ctx.dirSize(p), await mtimeOf(p), pkg, where, `Left by ${pkg}, which is no longer installed.`));
    }
  }
  return [...items, ...left];
}

// ── darwin ───────────────────────────────────────────────────────────
const LIB = ['Caches', 'Preferences', 'Containers', 'Group Containers', 'Saved Application State',
  'Application Support', 'Logs', 'HTTPStorages', 'WebKit', 'LaunchAgents'];
const vendor = id => id.split('.').slice(0, 2).join('.');

async function bundle(ctx, app) {
  const p = path.join(app, 'Contents', 'Info.plist');
  const buf = await fs.readFile(p).catch(() => null);
  if (!buf) return null;
  if (buf.subarray(0, 6).toString() !== 'bplist') return A.plistXml(buf.toString('utf8'));
  const { out, code } = await ctx.run('plutil', ['-convert', 'json', '-o', '-', p]);
  try { const j = code === 0 && JSON.parse(out); return { id: j.CFBundleIdentifier || '', name: j.CFBundleDisplayName || j.CFBundleName || '' }; }
  catch { return null; }
}

async function darwinApps(ctx) {
  const found = [];
  // /Applications and ~/Applications, plus one folder level (Utilities, Setapp …)
  for (const root of ['/Applications', path.join(ctx.home, 'Applications')])
    for (const d of await ls(root)) {
      const p = path.join(root, d.name);
      if (d.name.endsWith('.app')) found.push(p);
      else if (d.isDirectory()) for (const s of await ls(p)) if (s.name.endsWith('.app')) found.push(path.join(p, s.name));
    }
  const apps = [];
  for (const p of found) {
    if (ctx.signal?.aborted) break;
    const real = await fs.realpath(p).catch(() => p);
    if (real.startsWith('/System/')) continue;
    const b = await bundle(ctx, p);
    const name = b?.name || path.basename(p, '.app');
    if (!b?.id || /^com\.apple\./i.test(b.id) || name === 'Cleanzy') continue;
    apps.push({ p, id: b.id, name });
  }
  return apps;
}

async function darwin(ctx) {
  const apps = await darwinApps(ctx);
  // one mdls call for every app: values come back NUL separated, "(null)" when never opened
  const used = apps.length ? (await ctx.run('mdls', ['-raw', '-name', 'kMDItemLastUsedDate', ...apps.map(a => a.p)])).out.split('\0') : [];
  const items = await Promise.all(apps.map(async (a, i) => {
    const lastUsed = Date.parse((used[i] || '').trim().replace(/^(\S+) (\S+) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4')) || 0;
    return { id: K + a.p, module: 'uninstaller', group: 'Apps', name: a.name, paths: [a.p], size: await ctx.dirSize(a.p),
      mtime: lastUsed, safety: 'check', why: 'Moves the app to the Trash. You can put it back from there.',
      action: 'trash', trashOnly: true, meta: { kind: 'app', bundleId: a.id, lastUsed, icon: await ctx.fileIcon(a.p) } };
  }));
  // Leftovers: Library entries named after an app that is no longer installed.
  // note: any installed app from the same vendor (com.google.*) hides them; strict per-app matching is in plan().
  const have = new Set(apps.map(a => vendor(a.id.toLowerCase())));
  const left = [];
  for (const dir of LIB) {
    const root = path.join(ctx.home, 'Library', dir);
    for (const d of await ls(root)) {
      if (dir === 'Preferences' && !d.name.endsWith('.plist')) continue;
      const id = A.libId(d.name);
      if (!id || id.startsWith('com.apple.') || have.has(vendor(id))) continue;
      const p = path.join(root, d.name);
      if (guard(p, { home: ctx.home })) continue;
      left.push(leftover(p, await ctx.dirSize(p), await mtimeOf(p), id, dir, `Left by ${id}, which is no longer installed.`));
    }
  }
  return [...items, ...left];
}

// ── win32 ────────────────────────────────────────────────────────────
const REG = ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];

async function win(ctx) {
  const seen = new Map();
  for (const k of REG)
    for (const a of A.parseReg((await ctx.run('reg', ['query', k, '/s'])).out))
      if (!seen.has(a.name.toLowerCase())) seen.set(a.name.toLowerCase(), a);   // same app in the 32- and 64-bit views
  return [...seen.values()].filter(a => !/^cleanzy$/i.test(a.name)).map(a => ({ id: K + 'win:' + a.key, module: 'uninstaller', group: 'Apps', name: a.name, paths: [],
    size: a.size, mtime: 0, safety: 'check', action: 'pkg', why: a.publisher,
    meta: { kind: 'win', uninstallString: a.uninstallString, quietUninstallString: a.quietUninstallString,
            publisher: a.publisher, installLocation: a.installLocation } }));
}

async function scan(ctx) {
  const items = ctx.platform === 'linux' ? await linux(ctx) : ctx.platform === 'darwin' ? await darwin(ctx)
    : ctx.platform === 'win32' ? await win(ctx) : [];
  last = new Map(items.filter(i => i.group === 'Apps').map(i => [i.id, i]));
  return items;
}

// ── handlers ─────────────────────────────────────────────────────────
const app = id => { const a = last.get(id); if (!a) throw new Error('skipped for safety (not from a scan)'); return a; };

// Strict matching: an entry named exactly after the bundle id is the app's own (pre-ticked);
// helpers (id.*), team/group containers and display-name matches are offered unticked;
// anything that also matches another installed app is shared and never offered.
async function plan(ctx, id) {
  const a = app(id);
  if (a.meta.kind === 'apt') {
    if (a.meta.locked) return { items: [a], alsoRemoved: [], freed: 0, errors: [`${a.name}: refused — ${a.meta.locked}`] };
    const { out, err } = await ctx.run('apt-get', ['-s', 'remove', '--purge', a.meta.pkgId]);
    const all = A.parseRemoved(out);
    return { ...await dotLeft(ctx, a), alsoRemoved: all.filter(p => p !== a.meta.pkgId), freed: A.parseFreed(out) || a.size,   // -s rarely prints a size
      errors: all.length ? [] : [tail(err || 'apt could not plan this removal')] };
  }
  if (a.meta.kind === 'win') return { items: [a], alsoRemoved: [], freed: a.size, errors: [] };
  if (a.meta.kind !== 'app') return { ...await dotLeft(ctx, a), alsoRemoved: [], freed: a.size, errors: a.meta.locked ? [`${a.name}: refused — ${a.meta.locked}`] : [] };
  const b = a.meta.bundleId.toLowerCase(), n = a.name.toLowerCase();
  const others = [...last.values()].filter(o => o !== a && o.meta.kind === 'app');
  const mine = (nm, ob, on) => {
    const low = nm.toLowerCase(), lid = A.libId(nm);
    if ([ob, ob + '.plist', ob + '.savedstate', ob + '.binarycookies'].includes(low)) return 'exact';
    if (lid && (lid === ob || lid.startsWith(ob + '.')) || low.includes(ob)) return 'related';
    return low === on || low === on + '.plist' ? 'name' : '';
  };
  const items = [a], shared = [];
  for (const dir of LIB) {
    const root = path.join(ctx.home, 'Library', dir);
    for (const d of await ls(root)) {
      const how = mine(d.name, b, n);
      if (!how) continue;
      const p = path.join(root, d.name);
      if (guard(p, { home: ctx.home })) continue;
      const size = await ctx.dirSize(p);
      if (others.some(o => mine(d.name, o.meta.bundleId.toLowerCase(), o.name.toLowerCase()))) { shared.push({ name: dir, path: p, size }); continue; }
      items.push(leftover(p, size, await mtimeOf(p), a.meta.bundleId, dir,
        how === 'exact' ? `${a.name}'s own ${dir.toLowerCase()}.` : `Looks like ${a.name}'s (matched by name). Check first.`,
        { group: a.name, pre: how === 'exact' }));
    }
  }
  return { items, shared, alsoRemoved: [], freed: 0, errors: [] };
}

// linux packages: ~/.config, ~/.cache, ~/.local/share folders named after the package, launcher or binary.
// Named exactly after the package id: pre-ticked; other name matches unticked; matching another app: shared.
// note: default XDG roots only; a custom XDG_CONFIG_HOME is missed
async function dotLeft(ctx, a) {
  if (a.meta.locked) return { items: [a], shared: [] };
  const mine = names(a), others = [...last.values()].filter(o => o !== a && o.meta.kind !== 'win' && o.meta.kind !== 'app');
  const items = [a], shared = [];
  for (const root of ['.config', '.cache', '.local/share'].map(r => path.join(ctx.home, ...r.split('/'))))
    for (const d of await ls(root)) {
      const low = d.name.toLowerCase();
      if (!d.isDirectory() || !mine.includes(low)) continue;
      const p = path.join(root, d.name);
      if (guard(p, { home: ctx.home })) continue;
      const size = await ctx.dirSize(p), where = path.relative(ctx.home, root);
      if (others.some(o => names(o).includes(low))) { shared.push({ name: where, path: p, size }); continue; }
      const exact = low === a.meta.pkgId.toLowerCase();
      items.push(leftover(p, size, await mtimeOf(p), a.meta.pkgId, where,
        exact ? `${a.name}'s own settings or cache.` : `Looks like ${a.name}'s (matched by name). Check first.`, { group: a.name, pre: exact }));
    }
  return { items, shared };
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function running(ctx, id) {
  const a = last.get(id);
  if (!a || ctx.platform === 'win32') return false;
  const m = a.meta;
  if (m.kind === 'flatpak') return (await ctx.run('flatpak', ['ps', '--columns=application'])).out.split('\n').some(l => l.trim() === m.pkgId);
  // -f matches the full command line; the 15-char process name would miss long binary names
  const pat = m.kind === 'app' ? reEsc(a.paths[0] + '/Contents/MacOS/') : m.kind === 'snap' ? reEsc(`/snap/${m.pkgId}/`)
    : m.exec && m.exec !== 'env' ? `(^|/)${reEsc(m.exec)}( |$)` : null;
  return !!pat && (await ctx.run('pgrep', ['-f', pat])).code === 0;
}

async function quit(ctx, id) {
  const a = last.get(id), bid = a?.meta.bundleId || '';
  if (ctx.platform !== 'darwin' || !/^[\w.-]+$/.test(bid)) return { ok: false, error: 'skipped for safety (bad app id)' };
  const { code, err } = await ctx.run('osascript', ['-e', `tell application id "${bid}" to quit`]);
  return code ? { ok: false, error: tail(err) } : { ok: true };
}

const NAME = { apt: /^[a-z0-9][a-z0-9+.-]*$/, snap: /^[a-z0-9][a-z0-9-]*$/, flatpak: /^[A-Za-z0-9][\w.-]*$/ };
async function remove(ctx, { ids, password } = {}) {
  const errors = [], E = (p, msg) => errors.push({ path: p, msg });
  const apt = [];
  for (const id of ids || []) {
    const a = last.get(id), m = a?.meta;
    if (!a || !NAME[m.kind] || !NAME[m.kind].test(m.pkgId)) { E(String(id), 'skipped for safety (not from a scan)'); continue; }
    if (m.locked) { E(a.name, 'refused — ' + m.locked); continue; }
    const user = m.kind === 'flatpak' && m.installation === 'user';
    if (!user && !password) { E(a.name, 'needs password'); continue; }
    if (m.kind === 'apt') { apt.push(a); continue; }
    const r = m.kind === 'snap' ? await ctx.sudo(password, ['snap', 'remove', '--purge', m.pkgId])
      : user ? await ctx.run('flatpak', ['uninstall', '-y', '--user', m.pkgId])
      : await ctx.sudo(password, ['flatpak', 'uninstall', '-y', '--system', m.pkgId]);
    r.code ? E(a.name, tail(r.err)) : last.delete(id);
  }
  if (apt.length) {
    const r = await ctx.sudo(password, ['apt-get', '-y', 'remove', '--purge', ...apt.map(a => a.meta.pkgId)]);
    if (r.code) E(apt.map(a => a.name).join(', '), tail(r.err)); else apt.forEach(a => last.delete(a.id));
  }
  return errors;
}

// The vendor's own uninstaller, with its own UI (no silent flags): it knows what it installed.
async function winUninstall(ctx, id) {
  const a = last.get(id);
  if (ctx.platform !== 'win32' || a?.meta.kind !== 'win') return { started: false, error: 'skipped for safety (not from a scan)' };
  (ctx.spawn || spawn)('cmd', ['/c', a.meta.uninstallString], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return { started: true };
}

module.exports = { scan, handlers: { plan, running, quit, remove, winUninstall }, LIB };
