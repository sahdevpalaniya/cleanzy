// Every module, every platform, one fixture home: ids unique and prefixed, paths
// absolute and allowed by guard, and no item's path inside another item's path
// (so one folder is never offered, counted or cleaned twice).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { guard } = require('../src/main/safety');
const junk = require('../src/main/junk');
const { DEFAULTS } = require('../src/main/store');
const MODS = Object.fromEntries(['caches', 'devtools', 'largefiles', 'uninstaller'].map(k => [k, require('../src/scanners/' + k)]));

const FILES = [
  '.cache/mozilla/firefox/x/cache2/a', '.cache/thumbnails/large/a.png', '.cache/google-chrome/Default/Cache/a',
  '.cache/pip/http/a', '.cache/yarn/v6/a', '.cache/lm-studio/models/m.gguf',
  '.npm/_cacache/content/a', '.gradle/caches/a', '.m2/repository/a', '.cargo/registry/cache/a', '.pub-cache/hosted/a',
  '.config/Code/Cache/a', '.config/Code/CachedData/a', '.config/discord/Cache/a',
  '.local/share/Trash/files/old', '.ollama/models/blobs/a', '.lmstudio/models/m/m.gguf',
  'Library/Caches/com.apple.Safari/a', 'Library/Caches/Google/Chrome/a', 'Library/Caches/Homebrew/a', 'Library/Logs/a.log',
  'Library/Developer/Xcode/DerivedData/App-x/a', 'Library/Developer/Xcode/Archives/a', 'Library/Developer/CoreSimulator/Caches/a',
  'Library/Application Support/Code/Cache/a', 'Applications/Foo.app/Contents/Info.plist',
  'AppData/Local/Temp/a.tmp', 'AppData/Local/Google/Chrome/User Data/Default/Cache/a', 'AppData/Local/CrashDumps/a.dmp',
  'AppData/Local/npm-cache/_cacache/a', 'AppData/Roaming/Code/Cache/a',
  'proj/package.json', 'proj/node_modules/p/index.js', 'proj/dist/a.js', 'proj/.next/a', 'proj/index.js',
  'rs/Cargo.toml', 'rs/target/debug/a', 'py/pyproject.toml', 'py/.venv/lib/a', 'py/__pycache__/a.pyc',
  'Documents/big.bin', 'Downloads/setup.dmg', 'Downloads/setup.exe', 'Movies/clip.mp4', 'Pictures/a.jpg',
];

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-overlap-'));
  for (const f of FILES) {
    const p = path.join(home, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(/big|clip|gguf|blobs/.test(f) ? 2 << 20 : /setup/.test(f) ? 6 << 20 : 4096, 1));
  }
  const old = new Date(Date.now() - 400 * 864e5);
  for (const d of ['proj', 'rs', 'py']) fs.utimesSync(path.join(home, d), old, old);
  return home;
}

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`no overlap on ${platform}`, async () => {
    const home = fixture();
    const env = platform === 'win32'
      ? { USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData/Local'), APPDATA: path.join(home, 'AppData/Roaming'), TEMP: path.join(home, 'AppData/Local/Temp') }
      : { HOME: home, ...(platform === 'linux' ? { XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CONFIG_HOME: path.join(home, '.config') } : {}) };
    const signal = new AbortController().signal;
    const ctx = { platform, home, env, settings: { ...DEFAULTS, staleDays: 0 }, signal,
      run: async () => ({ out: '', err: 'not available in tests', code: 1 }),
      sudo: async () => ({ out: '', err: 'not available in tests', code: 1 }),
      fileIcon: async () => null,
      dirSize: p => junk.dirSize(p, signal),
      walk: (root, visit, opts) => junk.walk(root, visit, { signal, ...opts }) };
    const all = [];
    for (const [key, m] of Object.entries(MODS)) {
      const items = await m.scan(ctx);
      assert.ok(Array.isArray(items), key + ' returns an array');
      for (const i of items) {
        assert.ok(i.id.startsWith(key + ':'), `${i.id} is prefixed with ${key}:`);
        assert.ok(['safe', 'check'].includes(i.safety), i.id + ' safety');
        for (const p of i.paths) {
          assert.ok(path.isAbsolute(p), `${i.id}: ${p} is absolute`);
          if (i.action !== 'pkg' && i.action !== 'cmd')
            assert.strictEqual(guard(p, { home, contentsOnly: i.action === 'contents' }), null, `${i.id}: ${p} passes guard`);
        }
        all.push(i);
      }
    }
    const ids = all.map(i => i.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
    const inside = (p, d) => p === d || p.startsWith(d + path.sep);
    for (const a of all) for (const b of all) if (a !== b)
      for (const p of a.paths) for (const q of b.paths)
        assert.ok(!inside(p, q), `${a.id} (${p}) sits inside ${b.id} (${q})`);
    fs.rmSync(home, { recursive: true });
  });
}

// ~/.cache symlinked to home: its "app caches" are real folders. They are never Safe or one-click,
// and engine.clean judges the resolved path, so ~/.cache/Documents is refused as ~/Documents.
test('symlinked cache root never cleans real folders', async () => {
  const engine = require('../src/main/engine');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-link-'));
  for (const f of ['Documents/a.txt', 'proj/x.js']) { fs.mkdirSync(path.join(home, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(home, f), Buffer.alloc(8192, 1)); }
  fs.symlinkSync(home, path.join(home, '.cache'));
  const signal = new AbortController().signal;
  const items = await MODS.caches.scan({ platform: 'linux', home, env: { HOME: home }, settings: DEFAULTS, signal,
    run: async () => ({ out: '', err: '', code: 1 }), dirSize: p => junk.dirSize(p, signal), walk: (r, v, o) => junk.walk(r, v, { signal, ...o }) });
  const docs = items.find(i => i.paths.includes(path.join(home, '.cache', 'Documents')));
  assert.ok(docs, 'listed through the link');
  for (const i of items.filter(i => i.paths.some(p => p.startsWith(path.join(home, '.cache') + path.sep))))
    assert.ok(i.safety === 'check' && i.pre === false, i.name + ' is Check First, not preselected');
  engine.remember('caches', items, true);
  const ids = items.map(i => i.id), deps = { trash: async p => fs.rmSync(p, { recursive: true }), run: async () => ({ out: '', code: 0 }), home };
  assert.strictEqual((await engine.clean(ids, { mode: 'delete', safeOnly: true, scheduled: true }, deps)).count, 0, 'scheduler takes nothing');
  const r = await engine.clean([docs.id], { mode: 'delete' }, deps);
  assert.ok(r.errors.some(e => /skipped for safety/.test(e.msg)), 'refused as ~/Documents');
  assert.ok(fs.existsSync(path.join(home, 'Documents', 'a.txt')), 'Documents untouched');
  fs.rmSync(home, { recursive: true });
});

// a project edited (or dirtied) after the scan is not cleaned from stale scan data
test('engine re-checks a project before trashing its build output', async () => {
  const engine = require('../src/main/engine');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-proj-'));
  const pr = path.join(home, 'p'), nm = path.join(pr, 'node_modules');
  fs.mkdirSync(nm, { recursive: true }); fs.writeFileSync(path.join(nm, 'a'), 'x'); fs.writeFileSync(path.join(pr, 'index.js'), 'x');
  const item = (id, mtime, dirty = false) => ({ id: 'devtools:' + id, name: 'node_modules', paths: [nm], size: 1, mtime, safety: 'check', action: 'trash', meta: { kind: 'project', project: pr, dirty } });
  const deps = git => ({ trash: async p => fs.rmSync(p, { recursive: true }), run: async () => ({ out: git, code: 0 }), home });
  engine.remember('devtools', [item('old', 1), item('clean', Date.now() + 1e6)], true);
  let r = await engine.clean(['devtools:old'], {}, deps(''));
  assert.match(r.errors[0].msg, /changed since the scan/, 'edited since the scan');
  r = await engine.clean(['devtools:clean'], {}, deps(' M index.js\n'));
  assert.match(r.errors[0].msg, /changed since the scan/, 'uncommitted changes since the scan');
  assert.ok(fs.existsSync(nm));
  engine.remember('devtools', [item('ok', Date.now() + 1e6)], true);
  assert.strictEqual((await engine.clean(['devtools:ok'], {}, deps(''))).count, 1);
  assert.ok(!fs.existsSync(nm));
  fs.rmSync(home, { recursive: true });
});
