const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const junk = require('../src/main/junk');
const { guard } = require('../src/main/safety');
const dev = require('../src/scanners/devtools');

const OLD = new Date(Date.now() - 400 * 864e5);
function mk(home, files, old = true) {
  for (const f of files) {
    const p = path.join(home, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(4096, 1));
    if (old) fs.utimesSync(p, OLD, OLD);
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-dev-'));
function ctx(home, platform = 'linux', o = {}) {
  const signal = new AbortController().signal, calls = [];
  const env = platform === 'win32' ? { LOCALAPPDATA: path.join(home, 'AppData/Local'), APPDATA: path.join(home, 'AppData/Roaming') } : { HOME: home };
  return { platform, home, env, signal, calls, settings: { staleDays: 90, exclusions: [], ...o.settings },
    run: async (cmd, args) => { calls.push([cmd, ...args]); return o.run ? o.run(cmd, args) : { out: '', err: '', code: 0 }; },
    dirSize: p => junk.dirSize(p, signal),
    walk: (root, visit, opts) => junk.walk(root, visit, { signal, ...opts }) };
}
const byPath = (items, home, rel) => items.find(i => i.paths.includes(path.join(home, rel)));

test('projects: markers, safety, restore, staleness, nesting, symlinks, depth', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, [
    'code/a/package.json', 'code/a/package-lock.json', 'code/a/node_modules/x/index.js',
    'code/a/node_modules/x/node_modules/y/index.js', 'code/a/node_modules/x/package.json', 'code/a/.next/cache/a',
    'b/build/out.o',
    'c/Cargo.toml', 'c/target/debug/a',
    'd/target/debug/a',
    'g/build.gradle.kts', 'g/build/a', 'g/.gradle/a',
    'py/requirements.txt', 'py/.venv/lib/a', 'py/__pycache__/a.pyc',
    'n/x/1/2/3/4/package.json', 'n/x/1/2/3/4/node_modules/z/a',     // project at depth 6, artifact at depth 7
    '.hidden/p/package.json', '.hidden/p/node_modules/a',
    'Library/p/package.json', 'Library/p/node_modules/a',
  ]);
  mk(home, ['e/package.json', 'e/node_modules/a'], false);          // recent project
  fs.symlinkSync(path.join(home, 'code'), path.join(home, 'link'));
  let items = await dev.scan(ctx(home));
  const nm = byPath(items, home, 'code/a/node_modules');
  assert.strictEqual(nm.safety, 'check');
  assert.strictEqual(nm.restore, 'npm ci');
  assert.strictEqual(nm.group, 'a · ~/code');
  assert.strictEqual(nm.name, 'Installed packages · node_modules');
  assert.strictEqual(nm.meta.project, path.join(home, 'code/a'));
  assert.ok(nm.mtime > 0 && nm.mtime < Date.now() - 300 * 864e5);
  assert.strictEqual(byPath(items, home, 'code/a/.next').safety, 'safe');
  assert.ok(!items.some(i => i.paths[0].includes(path.join('x', 'node_modules'))), 'nested node_modules reported once');
  assert.ok(!items.some(i => i.paths[0].startsWith(path.join(home, 'b'))), 'bare build/ not offered');
  assert.strictEqual(byPath(items, home, 'c/target').restore, 'cargo build');
  assert.ok(!byPath(items, home, 'd/target'), 'target without marker');
  assert.strictEqual(byPath(items, home, 'g/build').safety, 'safe');
  assert.strictEqual(byPath(items, home, 'g/.gradle').safety, 'check');
  assert.strictEqual(byPath(items, home, 'py/.venv').restore, 'pip install -r requirements.txt');
  assert.strictEqual(byPath(items, home, 'py/__pycache__').safety, 'safe');
  assert.ok(!items.some(i => i.paths[0].startsWith(path.join(home, 'link'))), 'symlink not followed');
  assert.ok(!items.some(i => i.paths[0].startsWith(path.join(home, 'n'))), 'depth cap');
  assert.ok(!items.some(i => /hidden|Library/.test(i.paths[0])), 'dot folders and Library skipped');
  assert.ok(!byPath(items, home, 'e/node_modules'), 'recent project hidden at 90 days');
  for (const i of items) {
    assert.ok(i.id.startsWith('devtools:') && i.size > 0 && i.action === 'trash');
    assert.strictEqual(guard(i.paths[0], { home }), null, i.paths[0]);
  }
  items = await dev.scan(ctx(home, 'linux', { settings: { staleDays: 0 } }));
  assert.ok(byPath(items, home, 'e/node_modules'), 'recent project shown at staleDays 0');
  items = await dev.scan(ctx(home, 'linux', { settings: { staleDays: 0, exclusions: [path.join(home, 'code')] } }));
  assert.ok(!byPath(items, home, 'code/a/node_modules'), 'exclusions respected');
});

test('lockfile picks the restore command', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const [d, lock] of [['p', 'pnpm-lock.yaml'], ['y', 'yarn.lock'], ['b', 'bun.lockb'], ['n', null]])
    mk(home, [`${d}/package.json`, `${d}/node_modules/a`, `${d}/dist/a`, ...(lock ? [`${d}/${lock}`] : [])]);
  const items = await dev.scan(ctx(home));
  assert.deepStrictEqual(['p', 'y', 'b', 'n'].map(d => byPath(items, home, d + '/node_modules').restore),
    ['pnpm install', 'yarn', 'bun install', 'npm install']);
  assert.strictEqual(byPath(items, home, 'y/dist').restore, 'yarn build');
});

test('git: recent HEAD hides, uncommitted changes unselect', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, ['r/package.json', 'r/node_modules/a', 'r/.next/a', 'r/.git/config', 's/package.json', 's/node_modules/a']);
  mk(home, ['s/.git/HEAD'], false);
  const c = ctx(home, 'linux', { run: (cmd, args) => ({ out: args[args.indexOf('-C') + 1].endsWith('r') ? ' M index.js\n' : '', code: 0 }) });
  const items = await dev.scan(c);
  const next = byPath(items, home, 'r/.next');
  assert.strictEqual(next.pre, false);
  assert.match(next.check.join(), /uncommitted changes/);
  assert.ok(c.calls.some(a => a.join(' ') === `git --no-optional-locks -C ${path.join(home, 'r')} status --porcelain`));
  assert.ok(!byPath(items, home, 's/node_modules'), 'fresh .git/HEAD keeps the project active');
});

test('worktrees: tool dirs and orphaned gitdir', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, ['.cursor/worktrees/repo/abc/.git', '.cursor/worktrees/repo/abc/a.js', '.claude/worktrees/x/.git',
    'w/orphan/package.json', 'w/orphan/node_modules/a', 'w/live/package.json', 'w/live/node_modules/a', 'w/real/.git/HEAD']);
  fs.writeFileSync(path.join(home, 'w/orphan/.git'), `gitdir: ${path.join(home, 'w/real/.git/worktrees/orphan')}\n`);
  mk(home, ['w/usb/package.json', 'w/usb/node_modules/a']);   // its repo is on an unplugged drive: not an orphan
  fs.writeFileSync(path.join(home, 'w/usb/.git'), 'gitdir: /nonexistent/.git/worktrees/usb\n');
  fs.writeFileSync(path.join(home, 'w/live/.git'), `gitdir: ${path.join(home, 'w/real/.git')}\n`);
  const items = await dev.scan(ctx(home, 'linux', { settings: { staleDays: 0 } }));
  const wt = items.filter(i => i.group === 'Worktrees').map(i => i.paths[0]).sort();
  // tool worktrees git still knows about are someone's live work: only orphans are offered
  assert.deepStrictEqual(wt, [path.join(home, 'w/orphan')]);
  for (const i of items.filter(i => i.group === 'Worktrees')) assert.ok(i.trashOnly && i.safety === 'check');
  assert.ok(!byPath(items, home, 'w/orphan/node_modules'), 'artifacts inside an orphan are not offered twice');
  assert.ok(byPath(items, home, 'w/live/node_modules'), 'live worktree is a normal project');
});

const GLOBAL_FILES = {
  linux: ['.npm/_cacache/a', '.cache/yarn/a', '.cache/pip/a', '.gradle/caches/a', '.cargo/registry/cache/a', '.cargo/registry/src/a',
    '.config/Code/CachedData/a', '.cache/JetBrains/IdeaIC/caches/a', '.cache/JetBrains/IdeaIC/LocalHistory/a', '.m2/repository/a', '.pub-cache/hosted/a', '.cargo/bin/cargo', '.rustup/a'],
  darwin: ['Library/Caches/Homebrew/a', 'Library/Caches/CocoaPods/a', 'Library/Developer/Xcode/DerivedData/a',
    'Library/Developer/Xcode/Archives/a', 'Library/Application Support/Cursor/CachedExtensionVSIXs/a', 'Library/pnpm/store/a', '.npm/_cacache/a'],
  win32: ['AppData/Local/npm-cache/_cacache/a', 'AppData/Local/JetBrains/IdeaIC2024.1/caches/a', 'AppData/Local/JetBrains/IdeaIC2024.1/options/a',
    'AppData/Roaming/Code/CachedData/a', 'AppData/Local/Yarn/Cache/a', '.gradle/caches/a', '.npm/_cacache/a'],
};
for (const platform of ['linux', 'darwin', 'win32']) {
  test(`global caches resolve under the fixture on ${platform}`, async t => {
    const home = tmp();
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    mk(home, GLOBAL_FILES[platform]);
    mk(home, ['Library/Developer/CoreSimulator/Devices/UDID-1/data/a']);
    const json = JSON.stringify({ devices: { 'com.apple.iOS-15': [{ udid: 'UDID-1', state: 'Shutdown' }, { udid: 'UDID-2', state: 'Booted' }] } });
    const c = ctx(home, platform, { run: () => ({ out: json, code: 0 }) });
    const items = await dev.scan(c);
    const g = items.filter(i => i.group === 'Global caches');
    const want = GLOBAL_FILES[platform].filter(f => !/\.cargo\/bin|\.rustup|options|LocalHistory|^\.npm/.test(f) || platform !== 'win32' && f.startsWith('.npm'))
      .map(f => path.dirname(path.join(home, f)));
    assert.deepStrictEqual(g.flatMap(i => i.paths).sort(), want.sort());
    for (const i of g) {
      assert.ok(i.why && i.action === 'trash' && i.size > 0);
      assert.ok(i.paths.every(p => dev.claims(c).some(r => p === r || p.startsWith(r + path.sep))), i.name + ' is claimed');
    }
    assert.ok(!items.some(i => i.paths.some(p => /\.cargo.bin|\.rustup|options/.test(p))), 'tool installs untouched');
    if (platform === 'linux') assert.strictEqual(g.find(i => i.name === 'Cargo registry').paths.length, 2);
    if (platform === 'darwin') {
      assert.strictEqual(g.find(i => i.name === 'Xcode Archives').safety, 'check');
      assert.strictEqual(g.find(i => i.name === 'Xcode DerivedData').safety, 'safe');
    }
    const sim = items.find(i => i.group === 'Simulators');
    if (platform === 'darwin') {
      assert.deepStrictEqual(c.calls.find(a => a[0] === 'xcrun'), ['xcrun', 'simctl', 'list', 'devices', 'unavailable', '-j']);
      assert.deepStrictEqual(sim.cmd, { id: 'simctl', args: [] });
      assert.deepStrictEqual(sim.paths, [path.join(home, 'Library/Developer/CoreSimulator/Devices/UDID-1')]);
      assert.ok(sim.size > 0 && sim.safety === 'check' && sim.action === 'cmd');
    } else {
      assert.ok(!sim && !c.calls.some(a => a[0] === 'xcrun'));
    }
  });
}

test('claims covers every global row on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const c = { platform, home: '/h', env: { LOCALAPPDATA: '/h/L', APPDATA: '/h/R' } };
    const roots = dev.claims(c);
    for (const g of dev.GLOBAL) for (const p of dev.globalPaths(g, c))
      assert.ok(roots.some(r => p === r || p.startsWith(r + path.sep)), `${platform} ${p}`);
    assert.ok(roots.every(r => !r.includes('*')));
  }
});

test('simulators: empty simctl output offers nothing', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const c = ctx(home, 'darwin', { run: () => ({ out: '{"devices":{}}', code: 0 }) });
  assert.deepStrictEqual(await dev.scan(c), []);
  assert.strictEqual(c.calls.filter(a => a[0] === 'xcrun').length, 1);
});

test('aborted scan stops early and missing home never throws', async () => {
  const ac = new AbortController(); ac.abort();
  const c = { ...ctx('/nonexistent-home-xyz'), signal: ac.signal };
  assert.deepStrictEqual(await dev.scan(c), []);
  assert.deepStrictEqual(await dev.scan(ctx('/nonexistent-home-xyz')), []);
});

test('fixes: deep edits keep a project active, JS build/, no-lockfile node_modules, docker row', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, ['w/package.json', 'w/dist/a', 'w/src/index.js']);
  fs.utimesSync(path.join(home, 'w/src/index.js'), new Date(), new Date());   // edited in place today
  fs.utimesSync(path.join(home, 'w/src'), OLD, OLD);                          // folder mtime unchanged
  mk(home, ['cra/package.json', 'cra/package-lock.json', 'cra/build/main.js', 'nl/package.json', 'nl/node_modules/a']);
  const DK = { version: '29.0', builder: 'ID RECLAIMABLE SIZE\nShared:\t1GB\nReclaimable:\t1.2GB\nTotal:\t1.2GB\n',
    image: [{ ID: 'aaaaaaaaaaaa', Repository: '<none>', Tag: '<none>', Containers: '0', Size: '512MB' },
      { ID: 'bbbbbbbbbbbb', Repository: 'web', Tag: 'latest', Containers: '0', Size: '2GB', CreatedSince: '3 weeks ago' },
      { ID: 'bbbbbbbbbbbb', Repository: 'web', Tag: 'v1', Containers: '0', Size: '2GB' },
      { ID: 'cccccccccccc', Repository: 'db', Tag: 'latest', Containers: '1', Size: '9GB' }].map(j => JSON.stringify(j)).join('\n'),
    ps: JSON.stringify({ ID: 'dddddddddddd', Names: 'old', Image: 'web', Size: '20MB (virtual 2GB)', Status: 'Exited (0) 2 days ago' }),
    volume: ['a'.repeat(64), 'b'.repeat(64), 'pgdata'].map(Name => JSON.stringify({ Name })).join('\n') };
  const items = await dev.scan(ctx(home, 'linux', { run: (cmd, a) => cmd === 'docker' ? { out: DK[a[0]], code: 0 } : { out: '', code: 0 } }));
  assert.ok(!byPath(items, home, 'w/dist'), 'project edited below the top level is not stale');
  assert.strictEqual(byPath(items, home, 'cra/build').restore, 'npm run build');
  const nl = byPath(items, home, 'nl/node_modules');
  assert.strictEqual(nl.pre, false);
  assert.match(nl.check.join(), /No lockfile/);
  assert.strictEqual(byPath(items, home, 'cra/build').pre, undefined);
  const d = Object.fromEntries(items.filter(i => i.group === 'Docker').map(i => [i.id.slice('devtools:docker:'.length), i]));
  assert.deepStrictEqual(Object.keys(d).sort(), ['build', 'ctr:dddddddddddd', 'img:aaaaaaaaaaaa', 'img:bbbbbbbbbbbb', 'vol:anon', 'vol:pgdata']);
  assert.deepStrictEqual([d.build.size, d.build.safety, d.build.cmd.id], [1.2e9, 'safe', 'dockerBuild']);
  assert.deepStrictEqual([d['img:aaaaaaaaaaaa'].safety, d['img:aaaaaaaaaaaa'].cmd.args], ['safe', ['aaaaaaaaaaaa']]);
  assert.deepStrictEqual([d['img:bbbbbbbbbbbb'].size, d['img:bbbbbbbbbbbb'].pre, d['img:bbbbbbbbbbbb'].cmd.args], [2e9, false, ['web:latest', 'web:v1']]);
  assert.deepStrictEqual([d['ctr:dddddddddddd'].size, d['ctr:dddddddddddd'].cmd.id], [20e6, 'dockerRm']);
  assert.deepStrictEqual([d['vol:anon'].cmd.args.length, d['vol:anon'].safety, d['vol:pgdata'].pre], [2, 'check', false]);
  const { CMDS } = require('../src/main/engine');
  assert.deepStrictEqual(CMDS.dockerRmi('web:latest', 'web:v1'), ['docker', 'rmi', 'web:latest', 'web:v1']);
  assert.strictEqual(CMDS.dockerRmi('-f'), null);
  assert.strictEqual(CMDS.dockerVol('pg', '--all'), null);
  assert.strictEqual(CMDS.dockerRm('not-an-id'), null);
  assert.deepStrictEqual(await dev.scanDocker(ctx(home, 'linux', { run: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } })), []);
  assert.strictEqual(dev.GLOBAL.find(g => g.name === 'Flutter / pub cache').safety, 'safe');
});

test('build/dist/out are Safe only when git ignores them', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, ['app/package.json', 'app/build/icon.icns', 'app/dist/a.js', 'ios/App.xcodeproj/x', 'ios/DerivedData/a']);
  const items = await dev.scan(ctx(home, 'linux', { settings: { staleDays: 0 }, run: (cmd, args) => ({ out: '', err: '',
    code: args.includes('check-ignore') ? (args.at(-1).endsWith('dist') ? 0 : 1) : 0 }) }));
  const b = byPath(items, home, 'app/build'), d = byPath(items, home, 'app/dist');
  assert.deepStrictEqual([b.safety, b.pre], ['check', false]);
  assert.strictEqual(d.safety, 'safe');
  assert.strictEqual(byPath(items, home, 'ios/DerivedData').safety, 'safe');
});

test('tool leftovers: old CLI builds, superseded extensions, state for deleted projects', async t => {
  const home = tmp();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const v = d => path.join(home, '.local/share/claude/versions', d);
  mk(home, ['.local/share/claude/versions/2.1.9', '.local/share/claude/versions/2.1.10', '.local/share/claude/versions/2.1.11',
    '.vscode/extensions/ms-python.python-2024.1.0/a', '.vscode/extensions/ms-python.python-2024.10.0/a',
    '.vscode/extensions/anthropic.claude-code-2.1.2-linux-x64/a', '.vscode/extensions/anthropic.claude-code-2.1.10-linux-x64/a',
    '.vscode/extensions/solo.only-1.0.0/a', 'live/x', '.config/Code/User/workspaceStorage/aa/workspace.json',
    '.config/Code/User/workspaceStorage/bb/workspace.json']);
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  fs.symlinkSync(v('2.1.10'), path.join(home, '.local/bin/claude'));   // runs the middle one: it and the newest stay
  const ws = (h, p) => fs.writeFileSync(path.join(home, '.config/Code/User/workspaceStorage', h, 'workspace.json'), JSON.stringify({ folder: require('url').pathToFileURL(p).href }));
  ws('aa', path.join(home, 'gone')); ws('bb', path.join(home, 'live'));
  const items = await dev.scanTools(ctx(home, 'linux'), () => false);
  const get = k => items.find(i => i.id === 'devtools:tool:' + k);
  assert.deepStrictEqual(get('cli:claude').paths, [v('2.1.9')]);
  assert.deepStrictEqual(get('ext:VS Code').paths.map(p => path.basename(p)).sort(), ['anthropic.claude-code-2.1.2-linux-x64', 'ms-python.python-2024.1.0']);
  assert.deepStrictEqual(get('ws:VS Code').paths, [path.join(home, '.config/Code/User/workspaceStorage/aa')]);
  assert.strictEqual(get('ws:VS Code').safety, 'check');
  fs.rmSync(path.join(home, '.local/bin/claude'));   // no link to read: offer no CLI build
  assert.ok(!(await dev.scanTools(ctx(home, 'linux'), () => false)).some(i => i.id.includes('cli:')));
});

test('node_modules: packages in neither package.json nor the lockfile are offered alone', async t => {
  const home = tmp(); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  mk(home, ['p/package.json', 'p/node_modules/kept/i.js', 'p/node_modules/gone/i.js', 'p/node_modules/@s/kept/i.js', 'p/node_modules/@s/gone/i.js', 'p/node_modules/.bin/x']);
  fs.writeFileSync(path.join(home, 'p/package-lock.json'), JSON.stringify({ lockfileVersion: 3,
    packages: { '': {}, 'node_modules/kept': {}, 'node_modules/@s/kept': {} } }));
  fs.utimesSync(path.join(home, 'p/package-lock.json'), OLD, OLD);
  const items = await dev.scan(ctx(home));
  const x = items.find(i => i.id.startsWith('devtools:extraneous:'));
  assert.deepStrictEqual(x.paths.map(p => path.relative(path.join(home, 'p/node_modules'), p)).sort(), ['@s/gone', 'gone']);
  assert.deepStrictEqual([x.safety, x.pre, x.action], ['check', false, 'trash']);
});
