// Shell safety: guard, engine, store, walkers, tree patch. Every clean here runs
// in a mkdtemp fixture with a fake trash; nothing touches the real home.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { guard, NEVER } = require('../src/main/safety');
const engine = require('../src/main/engine');
const { create, nextRun } = require('../src/main/store');
const { dirSize, duMap, walk } = require('../src/main/junk');
const { patch } = require('../src/main/tree');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-shell-'));
const put = (root, rel, bytes = 4096) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
};

test('guard: normalisation tricks are refused', () => {
  for (const bad of ['/usr/../etc', '/usr/./lib', '/usr//lib', '//etc', '/etc/', '/etc///', '/home/u/../../usr',
    '\\\\server\\share\\x\\y', '\\\\.\\PhysicalDrive0', '\\\\?\\C:\\Windows\\System32\\x',
    'relative/path', './x', 'C:foo\\bar', '\\foo\\bar', '', null, undefined, 42])
    assert.ok(guard(bad), 'must refuse ' + JSON.stringify(bad));
  assert.strictEqual(guard('\\\\?\\D:\\work\\proj\\node_modules'), null, '\\\\?\\ prefix is stripped, not refused');
});

test('guard: Windows paths are case-insensitive', () => {
  for (const bad of ['c:\\windows\\system32\\drivers', 'C:\\WINDOWS\\Temp', 'c:/Program Files/App', 'C:\\USERS\\ME'])
    assert.ok(guard(bad), 'must refuse ' + bad);
  assert.ok(guard('C:\\Windows\\System32\\drivers', { contentsOnly: true }));
  assert.strictEqual(guard('C:\\Windows\\Temp', { contentsOnly: true }), null);
  assert.strictEqual(guard('c:\\windows\\temp', { contentsOnly: true }), null);
  const home = 'C:\\Users\\Me';
  assert.ok(guard('c:\\users\\me\\appdata\\local', { home, contentsOnly: true }));
  assert.ok(guard('C:\\Users\\me\\.SSH\\id_rsa', { home }));
  assert.strictEqual(guard('C:\\Users\\Me\\AppData\\Local\\Temp', { home, contentsOnly: true }), null);
});

test('guard: darwin set compared case-insensitively', () => {
  for (const bad of ['/system', '/SYSTEM/Library', '/library/caches', '/Users', '/users/bob', '/VOLUMES', '/private/var'])
    assert.ok(guard(bad), 'must refuse ' + bad);
  assert.strictEqual(guard('/Applications/Foo.app'), null, 'the uninstaller trashes app bundles');
  assert.strictEqual(guard('/Users/me/Library/Caches/com.foo', { home: '/Users/me' }), null);
});

test('guard: contentsOnly gets the one-level OS rule too', () => {
  for (const bad of ['/usr/lib', '/etc/ssh', '/opt', '/opt/google', '/var/lib', '/', '/tmp'])
    assert.ok(guard(bad, { contentsOnly: true }), 'must refuse emptying ' + bad);
  assert.strictEqual(guard('/var/cache/apt/archives', { contentsOnly: true }), null);
  assert.strictEqual(guard('/tmp/scratch'), null);
});

test('guard: NEVER list against a fixture home', () => {
  const home = tmp();
  for (const r of NEVER.exact) assert.ok(guard(path.join(home, r), { home }), 'exact ' + r);
  for (const r of NEVER.exact.filter(Boolean))
    assert.strictEqual(guard(path.join(home, r, 'child-cache'), { home }), null, 'below exact ' + r + ' is fine');
  for (const r of NEVER.tree) {
    const p = path.join(home, r.replace('*', ''));
    assert.ok(guard(p, { home }), 'tree ' + r);
    assert.ok(guard(path.join(p + (r.endsWith('*') ? '.pub' : ''), r.endsWith('*') ? '' : 'x'), { home }), 'inside ' + r);
  }
  assert.ok(guard(path.join(home, '.android'), { home }), 'a parent of a protected subtree is protected');
  assert.ok(guard(path.join(home, 'Library/Application Support'), { home, contentsOnly: true }));
  assert.strictEqual(guard(path.join(home, '.android/cache'), { home }), null);
  assert.strictEqual(guard(path.join(home, '.cache/mozilla'), { home }), null);
  assert.ok(guard(os.homedir()), 'the real home is always refused');
  fs.rmSync(home, { recursive: true });
});

// ── engine ────────────────────────────────────────────────────────────
function fixture() {
  const home = tmp(), trashed = [];
  const deps = { trash: async p => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); },
    run: async () => ({ code: 0, out: '', err: '' }), sudo: async (pw, argv) => { deps.sudoCalls.push(argv); return { code: 0, out: '', err: '' }; },
    exclusions: [], home, history: [], sudoCalls: [] };
  deps.addHistory = e => deps.history.push(e);
  const item = (id, rel, o = {}) => ({ id: 'caches:' + id, module: 'caches', group: 'G', name: id,
    paths: [].concat(rel).map(r => path.join(home, r)), size: 4096, mtime: 0, safety: 'safe', why: '', action: 'trash', ...o });
  return { home, trashed, deps, item };
}

test('engine: unknown id is refused', async () => {
  const { deps } = fixture();
  const r = await engine.clean(['caches:/nope'], {}, deps);
  assert.strictEqual(r.count, 0);
  assert.match(r.errors[0].msg, /skipped for safety/);
  assert.strictEqual(typeof r.errors[0].path, 'string');
});

test('engine: only items with the module prefix are remembered', () => {
  const kept = engine.remember('caches', [{ id: 'devtools:x', paths: ['/x'] }, { id: 'caches:y', paths: ['/y'] }, { bogus: 1 }], true);
  assert.deepStrictEqual(kept.map(i => i.id), ['caches:y']);
  assert.ok(!engine.known.has('devtools:x'));
});

test('engine: trash, delete, contents, safeOnly, trashOnly, exclusions, nesting, guard', async () => {
  const { home, trashed, deps, item } = fixture();
  put(home, 'a/f', 8192); put(home, 'b/f', 8192); put(home, 'c/x', 8192); put(home, 'c/y', 8192);
  put(home, 'd/f'); put(home, 'e/f'); put(home, 'n/inner/f'); put(home, 'k/f');
  const items = [
    item('a', 'a'),                                            // trash
    item('b', 'b'),                                            // delete mode
    item('c', 'c', { action: 'contents' }),                    // emptied, folder kept
    item('d', 'd', { safety: 'check' }),                       // skipped by safeOnly
    item('e', 'e', { trashOnly: true }),                       // trashed even in delete mode
    item('gone', 'missing'),                                   // ENOENT is not an error
    item('nest', ['n', 'n/inner']),                            // nested path handled once
    item('home', ''),                                          // the home itself: refused
    item('ssh', '.ssh'),                                       // NEVER list: refused
    item('k', 'k'),                                            // excluded in settings
  ];
  engine.remember('caches', items, true);
  deps.exclusions = [path.join(home, 'k')];
  const id = s => 'caches:' + s;

  let r = await engine.clean([id('a'), id('d'), id('gone')], { mode: 'trash', safeOnly: true }, deps);
  assert.deepStrictEqual(trashed, [path.join(home, 'a')]);
  assert.ok(fs.existsSync(path.join(home, 'd/f')), 'Check First skipped by safeOnly');
  assert.strictEqual(r.count, 1);
  assert.deepStrictEqual(r.errors, [], 'a missing path is not an error');
  assert.ok(r.trashed >= 8192);

  r = await engine.clean([id('b'), id('e'), id('c'), id('nest')], { mode: 'delete' }, deps);
  assert.ok(!fs.existsSync(path.join(home, 'b')), 'delete mode removed b');
  assert.ok(r.freed >= 8192 * 3, 'freed counts deleted bytes: ' + r.freed);
  assert.ok(trashed.includes(path.join(home, 'e')), 'trashOnly ignores delete mode');
  assert.ok(fs.existsSync(path.join(home, 'c')) && fs.readdirSync(path.join(home, 'c')).length === 0, 'contents emptied, folder kept');
  assert.ok(!fs.existsSync(path.join(home, 'n')));
  assert.deepStrictEqual(r.errors, []);

  r = await engine.clean([id('home'), id('ssh'), id('k')], { mode: 'delete' }, deps);
  assert.strictEqual(r.errors.length, 2, 'home and .ssh refused');
  assert.ok(r.errors.every(e => /skipped for safety/.test(e.msg)));
  assert.ok(fs.existsSync(path.join(home, 'k/f')), 'excluded folder untouched');
  assert.ok(!engine.known.has(id('a')), 'cleaned ids are dropped from the allowlist');
  assert.ok(engine.known.has(id('k')));
  assert.strictEqual(deps.history.length, 2);
  assert.deepStrictEqual(Object.keys(deps.history[0]).sort(), ['at', 'count', 'freed', 'items', 'scheduled', 'trashed']);
  fs.rmSync(home, { recursive: true });
});

test('engine: cmd items are validated and need a password', async () => {
  const { deps, item } = fixture();
  engine.remember('caches', [
    item('apt', [], { action: 'cmd', cmd: { id: 'aptClean' } }),
    item('snap', [], { action: 'cmd', cmd: { id: 'snapRev', args: ['code', '260'] } }),
    item('evil', [], { action: 'cmd', cmd: { id: 'snapRev', args: ['code; rm -rf /', '1'] } }),
    item('rm', [], { action: 'cmd', cmd: { id: 'rm', args: ['-rf', '/'] } }),
    item('proto', [], { action: 'cmd', cmd: { id: 'constructor' } }),
    item('pkg', [], { action: 'pkg' }),
  ], true);
  const ids = ['apt', 'snap', 'evil', 'rm', 'proto', 'pkg'].map(s => 'caches:' + s);
  let r = await engine.clean(ids.slice(0, 2), {}, deps);
  assert.deepStrictEqual(r.errors.map(e => e.msg), ['needs password', 'needs password']);
  assert.strictEqual(deps.sudoCalls.length, 0);
  r = await engine.clean(ids, { password: 'pw' }, deps);
  assert.deepStrictEqual(deps.sudoCalls, [['apt-get', 'clean'], ['snap', 'remove', '--revision', '260', 'code']]);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.errors.length, 4, 'bad snap name, unknown cmd, prototype key, pkg all refused');
});

test('engine: docker commands time out and every item reports progress', async () => {
  const { item } = fixture();
  engine.remember('caches', [item('a', [], { action: 'cmd', cmd: { id: 'dockerRmi', args: ['mongo:7'] } }),
    item('b', [], { action: 'cmd', cmd: { id: 'dockerRmi', args: ['node:22'] } })], true);
  const runs = [], seen = [];
  await engine.clean(['caches:a', 'caches:b'], {}, {
    run: async (c, a, o) => (runs.push(o), { code: 0, out: '', err: '' }),
    progress: (i, n, name) => seen.push([i, n, name]) });
  assert.ok(runs.every(o => o?.timeout > 0), 'a stuck daemon cannot hold the queue forever');
  assert.deepStrictEqual(seen, [[0, 2, 'a'], [1, 2, 'b']]);
});

// ── store ─────────────────────────────────────────────────────────────
test('store round-trip', () => {
  const dir = tmp();
  const s = create(dir);
  assert.strictEqual(s.get().theme, 'system');
  s.set({ theme: 'dark', schedule: { every: 2 }, bogus: 1 });
  s.addHistory({ at: 1, freed: 5 });
  const t = create(dir);
  assert.strictEqual(t.get().theme, 'dark');
  assert.deepStrictEqual(t.get().schedule, { every: 2, unit: 'days' }, 'schedule merged as an object');
  assert.ok(!('bogus' in t.get()));
  assert.strictEqual(t.history()[0].freed, 5);
  assert.deepStrictEqual(t.clearHistory(), []);
  assert.deepStrictEqual(create(dir).history(), []);
  for (let i = 0; i < 250; i++) t.addHistory({ at: i });
  assert.strictEqual(t.history().length, 200);
  assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')));
  fs.rmSync(dir, { recursive: true });
});

test('nextRun', () => {
  const t = new Date(2026, 0, 31, 12).getTime();
  assert.strictEqual(nextRun({ every: 0, unit: 'days' }, t), null);
  assert.strictEqual(nextRun(undefined, t), null);
  assert.strictEqual(nextRun({ every: 3, unit: 'days' }, t), new Date(2026, 1, 3, 12).getTime());
  assert.strictEqual(nextRun({ every: 1, unit: 'weeks' }, t), new Date(2026, 1, 7, 12).getTime());
  assert.strictEqual(nextRun({ every: 1, unit: 'months' }, t), new Date(2026, 0, 31 + 31, 12).getTime(), 'setMonth semantics');
  assert.ok(nextRun({ every: 1, unit: 'days' }, 0) < Date.now());
});

// ── walkers ───────────────────────────────────────────────────────────
test('dirSize: hard links once, symlinks never followed', async () => {
  const r = tmp(), out = tmp();
  put(r, 'f', 1 << 20);
  fs.linkSync(path.join(r, 'f'), path.join(r, 'hard'));
  put(out, 'big', 4 << 20);
  fs.symlinkSync(out, path.join(r, 'link'));
  const size = await dirSize(r);
  assert.ok(size >= 1 << 20 && size < 2 << 20, 'hard link counted once, symlink not followed: ' + size);
  const m = await duMap(r);
  assert.strictEqual(m.get(r), size, 'duMap agrees with dirSize');
  const seen = [];
  await walk(r, p => { seen.push(path.basename(p)); });
  assert.deepStrictEqual(seen.sort(), ['f', 'hard', 'link']);
  const ac = new AbortController(); ac.abort();
  assert.ok(await dirSize(r, ac.signal) < size, 'aborted walk returns early');
  // other filesystems: /proc is never the same dev as a tmp dir
  const st = fs.statSync('/proc', { throwIfNoEntry: false });
  if (st && st.dev !== fs.statSync(r).dev) {
    let crossed = false;
    await walk('/', p => { if (p.startsWith('/proc/')) crossed = true; return p === '/proc' ? undefined : false; }, { depth: 2 });
    assert.ok(!crossed, 'walk does not cross st.dev');
  }
  fs.rmSync(r, { recursive: true }); fs.rmSync(out, { recursive: true });
});

test('tree patch terminates at / and C:\\', () => {
  const s = new Map([['/', 100], ['/a', 50]]);
  patch(s, '/a', 50, new Map());
  assert.strictEqual(s.get('/'), 50);
  const w = new Map([['C:\\', 100], ['C:\\x', 40]]);
  patch(w, 'C:\\x', 40, new Map());   // must return, whatever path flavour the host has
  assert.ok(w.size >= 1);
});

test('engine: a contents item that is a symlink never empties its target', async () => {
  const { home, deps, item } = fixture();
  put(home, 'Documents/thesis.txt');
  fs.mkdirSync(path.join(home, 'Library/Logs'), { recursive: true });
  fs.symlinkSync(path.join(home, 'Documents'), path.join(home, 'Library/Logs/DiagnosticReports'));
  engine.remember('caches', [item('diag', 'Library/Logs/DiagnosticReports', { action: 'contents' })], true);
  const r = await engine.clean(['caches:diag'], { mode: 'delete' }, deps);
  assert.ok(fs.existsSync(path.join(home, 'Documents/thesis.txt')), 'link target untouched');
  assert.strictEqual(r.count, 0);
  assert.match(r.errors[0].msg, /not a real folder/);
  fs.rmSync(home, { recursive: true });
});

test('engine: safeOnly skips pre:false; exclusions ignore junk values', async () => {
  const { home, deps, item } = fixture();
  put(home, 'dist/f'); put(home, 'ok/f');
  engine.remember('caches', [item('dist', 'dist', { pre: false }), item('ok', 'ok')], true);
  deps.exclusions = [null, 42, ''];
  const r = await engine.clean(['caches:dist', 'caches:ok'], { mode: 'delete', safeOnly: true }, deps);
  assert.ok(fs.existsSync(path.join(home, 'dist/f')), 'pre:false is never cleaned unattended');
  assert.ok(!fs.existsSync(path.join(home, 'ok')));
  assert.strictEqual(r.count, 1);
  fs.rmSync(home, { recursive: true });
});

test('guard: Win32 trailing dots/spaces and 8.3 names are refused', () => {
  const home = 'C:\\Users\\me';
  for (const bad of ['C:\\Users\\me\\Documents.', 'C:\\Users\\me\\Documents ', 'C:\\Users\\me\\DOCUME~1'])
    assert.ok(guard(bad, { home }), 'must refuse ' + bad);
  assert.ok(guard('/home/x/.aws/credentials', { home: '/home/x' }));
});
