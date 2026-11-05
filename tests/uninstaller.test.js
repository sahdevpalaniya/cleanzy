const test = require('node:test');
const assert = require('node:assert');
const { aptApps, snapApps, parseFreed, parseRemoved, parseJournal } = require('../src/main/apps');
const MB = 1024 * 1024;

test('installed apps: parsing + what must never be offered for removal', () => {
  const dpkgOut = [
    'code\t1019647\toptional\tno\tCode editing. Redefined.',
    'libc6\t13000\trequired\tno\tGNU C Library',
    'bash\t6000\trequired\tyes\tGNU Bourne Again SHell',
    'cowsay\t100\toptional\tno\tconfigurable talking cow',
  ].join('\n');
  const apt = aptApps(dpkgOut, 'code\nbash\ncowsay\n');
  assert.deepStrictEqual(apt.map(a => a.id), ['code', 'bash', 'cowsay'], 'auto-installed libc6 is not listed');
  assert.strictEqual(apt[0].size, 1019647 * 1024, 'dpkg reports KiB');
  assert.ok(apt.find(a => a.id === 'bash').locked, 'essential package is locked');
  assert.strictEqual(apt.find(a => a.id === 'cowsay').locked, null);

  const snapOut = ['Name  Version  Rev  Tracking  Publisher  Notes',
    'code  7debcd0   264  latest/stable  vscode  classic',
    'code  7debcd0   260  latest/stable  vscode  disabled',
    'core18 20260901  3084 latest/stable canonical base'].join('\n');
  const snaps = snapApps(snapOut, p => p.includes('_260') ? 300 * MB : 100 * MB);
  assert.strictEqual(snaps.find(s => s.stale).id, 'code:260', 'superseded revision is targetable by revision');
  assert.strictEqual(snaps.find(s => s.stale).size, 300 * MB);
  assert.ok(snaps.find(s => s.id === 'core18').locked, 'base snaps are locked');
  // an apt package and a snap can share a name; selection must still tell them apart
  const keys = [...aptApps('code\t100\toptional\tno\tapt one', 'code'), ...snaps].map(a => a.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'every app has a unique key: ' + keys.join(', '));
  assert.ok(keys.includes('apt:code') && keys.includes('snap:code:current') && keys.includes('snap:code:260'));
  assert.strictEqual(snaps.find(s => s.id === 'code').stale, false);
});

test('apt plan parsing', () => {
  assert.strictEqual(parseFreed('After this operation, 123 MB disk space will be freed.'), 123e6);
  assert.strictEqual(parseFreed('After this operation, 1.5 GB disk space will be freed.'), 1.5e9);
  assert.ok(parseFreed('After this operation, 40.0 MB of additional disk space will be used.') < 0, 'an install is not a saving');
  assert.strictEqual(parseFreed('nothing to report'), 0);
  assert.deepStrictEqual(
    parseRemoved('The following packages will be REMOVED:\n  cowsay cowsay-off\n0 upgraded, 0 newly installed'),
    ['cowsay', 'cowsay-off']);
});

test('journal size', () => {
  assert.strictEqual(parseJournal('Archived and active journals take up 8.0M in the file system.'), 8 * MB);
  assert.strictEqual(parseJournal('Archived and active journals take up 1.5G in the file system.'), 1.5 * 1024 ** 3);
  assert.strictEqual(parseJournal('No journal files were found.'), 0);
});

// ── module: src/scanners/uninstaller.js ──────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../src/main/apps');
const U = require('../src/scanners/uninstaller');
const junk = require('../src/main/junk');
const H = U.handlers;

const mk = (home, files) => {
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(home, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body ?? 'x');
  }
};
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-uninst-'));
const ctxFor = (platform, home, run, extra) => {
  const calls = [];
  const signal = new AbortController().signal;
  return { platform, home, env: { HOME: home }, signal, calls,
    run: async (cmd, args) => { calls.push([cmd, ...args]); return (run && run(cmd, args)) || { out: '', err: 'nope', code: 1 }; },
    sudo: async (pw, args) => { calls.push(['sudo', pw, ...args]); return { out: '', err: '', code: 0 }; },
    fileIcon: async () => null, dirSize: p => junk.dirSize(p, signal), ...extra };
};

test('parsers: desktop entries, icons, matching', () => {
  const e = A.parseDesktop('[Desktop Entry]\nName=Visual Studio Code\nName[de]=Code DE\nIcon=vscode\nExec=/usr/share/code/code --unity %F\n[Desktop Action new]\nName=New Window\nExec=other');
  assert.deepStrictEqual(e, { name: 'Visual Studio Code', icon: 'vscode', exec: 'code', hidden: false }, 'first Name wins, actions ignored');
  assert.strictEqual(A.parseDesktop('[Desktop Entry]\nName=x\nNoDisplay=true').hidden, true);
  assert.strictEqual(A.parseDesktop('').name, '');
  const have = new Set(['/usr/share/pixmaps/foo.png', '/d/hicolor/48x48/apps/bar.svg', '/abs/icon.png']);
  assert.strictEqual(A.resolveIcon('foo', p => have.has(p), ['/d/hicolor']), '/usr/share/pixmaps/foo.png');
  assert.strictEqual(A.resolveIcon('bar', p => have.has(p), ['/d/hicolor']), '/d/hicolor/48x48/apps/bar.svg');
  assert.strictEqual(A.resolveIcon('/abs/icon.png', p => have.has(p), []), '/abs/icon.png');
  assert.strictEqual(A.resolveIcon('/abs/missing.png', p => have.has(p), []), null);
  assert.strictEqual(A.resolveIcon('', () => true), null);
  const entries = [{ file: 'code_code.desktop', pkg: null, exec: 'code', name: 'Code' },
    { file: 'gimp.desktop', pkg: 'gimp', exec: 'gimp-2.10', name: 'GIMP' },
    { file: 'org.gnome.Maps.desktop', pkg: null, exec: 'flatpak', name: 'Maps' },
    { file: 'vlc.desktop', pkg: null, exec: 'vlc', name: 'VLC media player' }];
  assert.strictEqual(A.matchEntry({ kind: 'snap', id: 'code' }, entries).file, 'code_code.desktop');
  assert.strictEqual(A.matchEntry({ kind: 'apt', id: 'gimp' }, entries).name, 'GIMP');
  assert.strictEqual(A.matchEntry({ kind: 'apt', id: 'vlc' }, entries).name, 'VLC media player', 'by binary name');
  assert.strictEqual(A.matchEntry({ kind: 'flatpak', id: 'org.gnome.Maps' }, entries).name, 'Maps');
  assert.strictEqual(A.matchEntry({ kind: 'apt', id: 'libfoo' }, entries), undefined);
  assert.strictEqual(A.matchEntry({ kind: 'snap', id: 'cod' }, entries), undefined, 'prefix must end at the underscore');
  assert.deepStrictEqual(aptApps('', ''), []);
  assert.deepStrictEqual(snapApps('Name Version Rev Tracking Publisher Notes\n'), [], 'header only');
});

test('parsers: flatpak list, registry, Info.plist, Library ids', () => {
  const fl = A.parseFlatpak('org.gnome.Maps\tMaps\t12.5 MB\tsystem\ncom.spotify.Client\tSpotify\t1.2 GB\tuser\nbad line\n');
  assert.deepStrictEqual(fl.map(f => [f.id, f.name, f.size, f.installation]),
    [['org.gnome.Maps', 'Maps', 12.5e6, 'system'], ['com.spotify.Client', 'Spotify', 1.2e9, 'user']]);
  const reg = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip',
    '    DisplayName    REG_SZ    7-Zip 23.01 (x64)',
    '    Publisher    REG_SZ    Igor Pavlov',
    '    EstimatedSize    REG_DWORD    0x1622',
    '    UninstallString    REG_SZ    "C:\\Program Files\\7-Zip\\Uninstall.exe"',
    '    InstallLocation    REG_SZ    C:\\Program Files\\7-Zip\\',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KB123',
    '    DisplayName    REG_SZ    Security Update',
    '    UninstallString    REG_SZ    x.exe',
    '    ParentKeyName    REG_SZ    OperatingSystem',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hidden',
    '    DisplayName    REG_SZ    Runtime',
    '    UninstallString    REG_SZ    y.exe',
    '    SystemComponent    REG_DWORD    0x1',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NoName',
    '    UninstallString    REG_SZ    z.exe',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}',
    '    DisplayName    REG_SZ    Some App',
    '    UninstallString    REG_SZ    MsiExec.exe /X{GUID}',
    '    QuietUninstallString    REG_SZ    ',
  ].join('\r\n');
  const apps = A.parseReg(reg);
  assert.deepStrictEqual(apps.map(a => a.name), ['7-Zip 23.01 (x64)', 'Some App'], 'updates, components and nameless keys are skipped');
  assert.strictEqual(apps[0].size, 0x1622 * 1024, 'EstimatedSize is KB');
  assert.strictEqual(apps[0].uninstallString, '"C:\\Program Files\\7-Zip\\Uninstall.exe"');
  assert.strictEqual(apps[0].publisher, 'Igor Pavlov');
  assert.strictEqual(apps[1].size, 0);
  assert.deepStrictEqual(A.plistXml('<plist><dict><key>CFBundleIdentifier</key>\n\t<string>com.foo.Foo</string><key>CFBundleName</key><string>Foo</string></dict></plist>'),
    { id: 'com.foo.Foo', name: 'Foo' });
  assert.deepStrictEqual(A.plistXml('<key>CFBundleName</key><string>N</string><key>CFBundleDisplayName</key><string>Nice</string>'), { id: '', name: 'Nice' });
  assert.strictEqual(A.libId('com.foo.Bar.plist'), 'com.foo.bar');
  assert.strictEqual(A.libId('com.foo.Bar.savedState'), 'com.foo.bar');
  assert.strictEqual(A.libId('ABCDE12345.com.foo.Bar'), 'com.foo.bar', 'team id prefix');
  assert.strictEqual(A.libId('group.com.foo.shared'), 'com.foo.shared');
  assert.strictEqual(A.libId('Google'), '');
  assert.strictEqual(A.libId('com.foo'), '', 'two parts is a vendor, not an app');
});

function macHome() {
  const home = tmpHome();
  const plist = (id, name) => `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleName</key><string>${name}</string></dict></plist>`;
  mk(home, {
    'Applications/Foo.app/Contents/Info.plist': plist('com.foo.Foo', 'Foo'),
    'Applications/Foo.app/Contents/MacOS/Foo': Buffer.alloc(8192, 1),
    'Applications/FooBeta.app/Contents/Info.plist': plist('com.foo.Foo.beta', 'FooBeta'),
    'Applications/Bin.app/Contents/Info.plist': 'bplist00binary',
    'Applications/Mail.app/Contents/Info.plist': plist('com.apple.mail', 'Mail'),
    'Applications/Evil.app/Contents/Info.plist': plist('com.x"; do shell script "rm -rf ~', 'Evil'),
    'Applications/Utilities/Tool.app/Contents/Info.plist': plist('com.tool.Tool', 'Tool'),
    'Applications/Broken.app/README': 'no plist',
    'Library/Preferences/com.foo.Foo.plist': '',
    'Library/Containers/com.foo.Foo/Data/x': Buffer.alloc(4096),
    'Library/Caches/com.foo.Foo.helper/a': '',
    'Library/Application Support/Foo/db': Buffer.alloc(4096),
    'Library/Group Containers/ABCDE12345.com.foo.Foo/a': '',
    'Library/Preferences/com.foo.Foo.beta.plist': '',
    'Library/Application Support/com.bin.Bin/a': '',
    'Library/Caches/com.gone.App/a': Buffer.alloc(4096),
    'Library/Preferences/com.gone.App.plist': '',
    'Library/Preferences/com.apple.finder.plist': '',
    'Library/Preferences/com.foo.Other.plist': '',
    'Library/Preferences/loginwindow.plist': '',
    'Library/Saved Application State/com.gone.App.savedState/w': '',
  });
  return home;
}
const macRun = (cmd, args) => {
  if (cmd === 'plutil') return { out: JSON.stringify({ CFBundleIdentifier: 'com.bin.Bin', CFBundleName: 'Bin' }), err: '', code: 0 };
  if (cmd === 'mdls') return { out: args.slice(3).map(p => p.endsWith('Foo.app') ? '2024-03-01 10:00:00 +0000' : '(null)').join('\0'), err: '', code: 0 };
};

test('darwin: apps, last opened, leftovers of deleted apps', async () => {
  const home = macHome();
  const ctx = ctxFor('darwin', home, macRun);
  const items = await U.scan(ctx);
  const apps = items.filter(i => i.group === 'Apps'), left = items.filter(i => i.group === 'Leftovers');
  assert.deepStrictEqual(apps.map(a => a.name).sort(), ['Bin', 'Evil', 'Foo', 'FooBeta', 'Tool'], 'apple apps and plist-less bundles are skipped');
  const foo = apps.find(a => a.name === 'Foo');
  assert.strictEqual(foo.id, 'uninstaller:' + path.join(home, 'Applications/Foo.app'));
  assert.deepStrictEqual([foo.action, foo.trashOnly, foo.safety, foo.meta.bundleId], ['trash', true, 'check', 'com.foo.Foo']);
  assert.strictEqual(foo.meta.lastUsed, Date.parse('2024-03-01T10:00:00+00:00'));
  assert.strictEqual(apps.find(a => a.name === 'Bin').meta.lastUsed, 0, 'never opened');
  assert.ok(foo.size >= 8192);
  assert.ok(ctx.calls.filter(c => c[0] === 'mdls').length === 1, 'one mdls call for every app');
  assert.deepStrictEqual(left.map(l => path.relative(home, l.paths[0])).sort(),
    ['Library/Caches/com.gone.App', 'Library/Preferences/com.gone.App.plist', 'Library/Saved Application State/com.gone.App.savedState']);
  for (const l of left) assert.deepStrictEqual([l.safety, l.trashOnly, l.pre, l.action, l.meta.bundleId], ['check', true, false, 'trash', 'com.gone.app']);
  fs.rmSync(home, { recursive: true });
});

test('darwin: plan() matches leftovers strictly', async () => {
  const home = macHome();
  const ctx = ctxFor('darwin', home, macRun);
  const items = await U.scan(ctx);
  const foo = items.find(a => a.name === 'Foo');
  const r = await H.plan(ctx, foo.id);
  assert.strictEqual(r.items[0], foo, 'the app itself comes first');
  const got = Object.fromEntries(r.items.slice(1).map(i => [path.relative(home, i.paths[0]), i.pre]));
  assert.deepStrictEqual(got, {
    'Library/Preferences/com.foo.Foo.plist': true,
    'Library/Containers/com.foo.Foo': true,
    'Library/Caches/com.foo.Foo.helper': false,
    'Library/Application Support/Foo': false,
    'Library/Group Containers/ABCDE12345.com.foo.Foo': false,
  });
  assert.deepStrictEqual(r.shared.map(s => path.relative(home, s.path)), ['Library/Preferences/com.foo.Foo.beta.plist'],
    "another installed app's file is shared, never offered");
  assert.ok(r.items.every(i => i.id.startsWith('uninstaller:') && i.trashOnly));
  await assert.rejects(H.plan(ctx, 'uninstaller:/Applications/Nope.app'), /not from a scan/);
  fs.rmSync(home, { recursive: true });
});

test('darwin: quit() and running()', async () => {
  const home = macHome();
  const ctx = ctxFor('darwin', home, (cmd) => cmd === 'pgrep' ? { out: '1', err: '', code: 0 } : macRun(...arguments));
  const items = await U.scan(ctx);
  const evil = items.find(a => a.name === 'Evil'), foo = items.find(a => a.name === 'Foo');
  ctx.calls.length = 0;
  assert.strictEqual((await H.quit(ctx, evil.id)).ok, false, 'bad bundle id is rejected');
  assert.strictEqual((await H.quit(ctx, 'uninstaller:nope')).ok, false);
  assert.ok(!ctx.calls.some(c => c[0] === 'osascript'), 'osascript never ran');
  await H.quit(ctx, foo.id);
  assert.deepStrictEqual(ctx.calls.at(-1), ['osascript', '-e', 'tell application id "com.foo.Foo" to quit']);
  assert.strictEqual(await H.running(ctx, foo.id), true);
  assert.ok(ctx.calls.at(-1)[2].endsWith('/Foo\\.app/Contents/MacOS/'), 'path is regex-escaped');
  assert.strictEqual((await H.quit({ ...ctx, platform: 'linux' }, foo.id)).ok, false, 'darwin only');
  fs.rmSync(home, { recursive: true });
});

const DPKG = 'zzqpkg\t1000\toptional\tno\tCode\nbash\t6000\trequired\tyes\tshell\ncowsay\t100\toptional\tno\tcow\nlibc6\t13000\trequired\tno\tlibc\n';
const linuxRun = (snapCode = 0, flatCode = 0) => (cmd, args) => ({
  'dpkg-query': { out: DPKG, code: 0 }, 'apt-mark': { out: 'zzqpkg\nbash\ncowsay\n', code: 0 },
  snap: snapCode === 'ENOENT' ? { out: '', code: snapCode } : { out: 'Name Version Rev Tracking Publisher Notes\nfirefox 1 10 latest/stable mozilla -\nfirefox 1 9 latest/stable mozilla disabled\n', code: snapCode },
  flatpak: { out: 'org.have.App\tHave\t10 MB\tuser\norg.sys.App\tSys\t1.0 GB\tsystem\n', code: flatCode },
  'apt-get': { out: 'The following packages will be REMOVED:\n  cowsay* cowsay-off*\nAfter this operation, 2 MB disk space will be freed.\n', code: 0 },
}[cmd] || { out: '', err: 'nope', code: 1 });
const linHome = () => { const h = tmpHome(); mk(h, { 'snap/firefox/x': '', 'snap/gone/x': Buffer.alloc(4096), '.var/app/org.have.App/x': '', '.var/app/org.old.App/x': '',
  '.local/share/applications/cowsay.desktop': '[Desktop Entry]\nName=Cow Say\nIcon=cowsay\nExec=cowsay' }); return h; };

test('linux: apt/snap/flatpak apps and leftovers', async () => {
  const home = linHome();
  const ctx = ctxFor('linux', home, linuxRun());
  const items = await U.scan(ctx);
  const ids = items.filter(i => i.group === 'Apps').map(i => i.id);
  for (const id of ['apt:zzqpkg', 'apt:bash', 'apt:cowsay', 'flatpak:org.have.App', 'flatpak:org.sys.App'])
    assert.ok(ids.includes('uninstaller:' + id), id + ' listed: ' + ids);
  assert.ok(!ids.some(i => /libc6|:9$/.test(i)), 'no auto deps, no old snap revisions');
  const cow = items.find(i => i.id === 'uninstaller:apt:cowsay');
  assert.deepStrictEqual([cow.name, cow.meta.launcher, cow.action, cow.safety], ['Cow Say', true, 'pkg', 'check']);
  assert.strictEqual(items.find(i => i.id === 'uninstaller:apt:zzqpkg').meta.launcher, false);
  assert.deepStrictEqual(items.find(i => i.id === 'uninstaller:flatpak:org.have.App').meta.installation, 'user');
  const left = items.filter(i => i.group === 'Leftovers').map(i => path.relative(home, i.paths[0])).sort();
  assert.deepStrictEqual(left, ['.var/app/org.old.App', 'snap/gone']);
  for (const l of items.filter(i => i.group === 'Leftovers')) assert.deepStrictEqual([l.action, l.safety, l.trashOnly], ['trash', 'check', true]);

  // a failing snap/flatpak (not missing) must not turn every data dir into a "leftover"
  const unsure = await U.scan(ctxFor('linux', home, linuxRun(1, 1)));
  assert.strictEqual(unsure.filter(i => i.group === 'Leftovers').length, 0);
  // tool not installed at all: everything it left behind is a leftover
  const missing = await U.scan(ctxFor('linux', home, linuxRun('ENOENT', 0)));
  assert.deepStrictEqual(missing.filter(i => i.group === 'Leftovers').map(i => path.basename(i.paths[0])).sort(), ['firefox', 'gone', 'org.old.App']);
  fs.rmSync(home, { recursive: true });
});

test('linux: plan() and remove() act only on scanned, unlocked apps', async () => {
  const home = linHome();
  const ctx = ctxFor('linux', home, linuxRun());
  await U.scan(ctx);
  const p = await H.plan(ctx, 'uninstaller:apt:cowsay');
  assert.deepStrictEqual([p.alsoRemoved, p.freed, p.errors], [['cowsay-off'], 2e6, []]);
  assert.match((await H.plan(ctx, 'uninstaller:apt:bash')).errors[0], /refused/);
  ctx.calls.length = 0;
  const errs = await H.remove(ctx, { ids: ['uninstaller:apt:evil; rm -rf /', 'uninstaller:apt:bash', 'uninstaller:apt:cowsay',
    'uninstaller:flatpak:org.have.App', 'uninstaller:flatpak:org.sys.App', 'uninstaller:snap:firefox'], password: 'pw' });
  assert.deepStrictEqual(errs.map(e => e.msg), ['skipped for safety (not from a scan)', 'refused — essential system package']);
  assert.deepStrictEqual(ctx.calls, [
    ['flatpak', 'uninstall', '-y', '--user', 'org.have.App'],
    ['sudo', 'pw', 'flatpak', 'uninstall', '-y', '--system', 'org.sys.App'],
    ['sudo', 'pw', 'snap', 'remove', '--purge', 'firefox'],
    ['sudo', 'pw', 'apt-get', '-y', 'remove', '--purge', 'cowsay']]);
  // removed apps are forgotten: a second call can't replay them
  assert.strictEqual((await H.remove(ctx, { ids: ['uninstaller:apt:cowsay'], password: 'pw' }))[0].msg, 'skipped for safety (not from a scan)');
  await U.scan(ctx);
  assert.deepStrictEqual((await H.remove(ctx, { ids: ['uninstaller:apt:zzqpkg'] })).map(e => e.msg), ['needs password']);
  fs.rmSync(home, { recursive: true });
});

test('win32: registry apps, winUninstall opens the vendor uninstaller', async () => {
  const home = tmpHome();
  const reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip\r\n    DisplayName    REG_SZ    7-Zip\r\n    EstimatedSize    REG_DWORD    0x10\r\n    UninstallString    REG_SZ    "C:\\7z\\Uninstall.exe"\r\n';
  const spawned = [];
  const ctx = ctxFor('win32', home, cmd => cmd === 'reg' ? { out: reg, err: '', code: 0 } : null,
    { spawn: (...a) => { spawned.push(a); return { unref() {} }; } });
  const items = await U.scan(ctx);
  assert.strictEqual(items.length, 1, 'same app in several hives is listed once');
  assert.deepStrictEqual([items[0].name, items[0].size, items[0].action], ['7-Zip', 16 * 1024, 'pkg']);
  assert.deepStrictEqual(await H.winUninstall(ctx, items[0].id), { started: true });
  assert.deepStrictEqual(spawned[0].slice(0, 2), ['cmd', ['/c', '"C:\\7z\\Uninstall.exe"']]);
  assert.strictEqual((await H.winUninstall(ctx, 'uninstaller:win:forged')).started, false);
  assert.deepStrictEqual(await U.scan({ ...ctx, platform: 'aix' }), [], 'unsupported platform');
  fs.rmSync(home, { recursive: true });
});

test('linux: plan() offers the app\'s own config/cache folders', async () => {
  const home = linHome();
  mk(home, { '.config/cowsay/a': 'x', '.cache/Cowsay/a': 'x', '.local/share/cowsay-extra/a': 'x', '.config/other/a': 'x' });
  const ctx = ctxFor('linux', home, linuxRun());
  await U.scan(ctx);
  const p = await H.plan(ctx, 'uninstaller:apt:cowsay');
  const left = p.items.slice(1).map(i => [path.relative(home, i.paths[0]), i.pre, i.trashOnly]).sort();
  assert.deepStrictEqual(left, [['.cache/Cowsay', true, true], ['.config/cowsay', true, true]]);
  assert.strictEqual((await H.plan(ctx, 'uninstaller:apt:bash')).items.length, 1, 'locked: nothing offered');
  fs.rmSync(home, { recursive: true });
});

test('linux: removed-but-not-purged apt packages leave Leftovers', async () => {
  const home = linHome();
  mk(home, { '.config/oldpkg/x': '', '.local/share/OldPkg/y': '', '.config/cowsay/x': '', '.cache/oldpkg/z': '' });
  const base = linuxRun();
  const ctx = ctxFor('linux', home, (cmd, args) => cmd === 'dpkg-query' && args[1].includes('Status-Abbrev')
    ? { out: 'rc \toldpkg\nrc \tcowsay\nii \tbash\n', code: 0 } : base(cmd, args));
  const left = (await U.scan(ctx)).filter(i => i.group === 'Leftovers' && i.meta.bundleId === 'oldpkg');
  assert.deepStrictEqual(left.map(i => path.relative(home, i.paths[0])).sort(), ['.config/oldpkg', '.local/share/OldPkg'],
    'only folders of the removed package; never one an installed app is named after, never ~/.cache (App Caches has it)');
  for (const l of left) assert.deepStrictEqual([l.safety, l.trashOnly, l.pre], ['check', true, false]);
  fs.rmSync(home, { recursive: true });
});
