const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const junk = require('../src/main/junk');
const lf = require('../src/scanners/largefiles');

const MB = 1 << 20;
const sha = c => 'sha256:' + c.repeat(64);

function fixture(platform) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-lf-'));
  const put = (f, data) => { const p = path.join(home, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  const vid = platform === 'darwin' ? 'Movies' : 'Videos';
  put('Documents/a.mp4', Buffer.alloc(6 * MB, 1));
  put('Documents/sub/a copy.mp4', Buffer.alloc(6 * MB, 1));
  put('Documents/same-size.mp4', Buffer.alloc(6 * MB, 2));           // same size, other bytes: not a dup
  const tail = Buffer.alloc(6 * MB, 1); tail[tail.length - 1] = 9;
  put('Documents/tail.mp4', tail);                                    // same first 64 KB, other tail: not a dup
  put('Documents/small.pdf', Buffer.alloc(MB, 1));
  put('Downloads/x.zip', Buffer.alloc(5 * MB, 3));
  put('Downloads/.hidden/h.mkv', Buffer.alloc(6 * MB, 4));
  put('Documents/.secret.mov', Buffer.alloc(6 * MB, 4));
  put('Documents/proj/node_modules/big.bin', Buffer.alloc(6 * MB, 5));
  put('Pictures/Photos Library.photoslibrary/originals/a.heic', Buffer.alloc(6 * MB, 6));
  put('Documents/keep/me.iso', Buffer.alloc(6 * MB, 7));
  put('Movies/m.mov', Buffer.alloc(6 * MB, 8));
  put('Videos/v.mkv', Buffer.alloc(6 * MB, 9));
  // Ollama: two tags sharing one blob
  const om = '.ollama/models';
  put(`${om}/manifests/registry.ollama.ai/library/llama3/8b`, JSON.stringify({ config: { digest: sha('c') }, layers: [{ digest: sha('a') }, { digest: sha('e') }] }));
  put(`${om}/manifests/registry.ollama.ai/me/tiny/latest`, JSON.stringify({ config: { digest: sha('d') }, layers: [{ digest: sha('b') }, { digest: sha('e') }] }));
  for (const [c, n] of [['a', 3], ['b', 2], ['c', 0.01], ['d', 0.01], ['e', 4]]) put(`${om}/blobs/sha256-${c.repeat(64)}`, Buffer.alloc(Math.ceil(n * MB), 1));
  put('.lmstudio/models/pub/model-a/model.gguf', Buffer.alloc(2 * MB, 1));
  put('.lmstudio/models/pub/model-a/README.md', 'x');
  put('.cache/lm-studio/models/pub2/m2/w.safetensors', Buffer.alloc(MB, 1));
  return { home, vid };
}

const ctxFor = (platform, home, settings = {}) => {
  const signal = new AbortController().signal;
  return { platform, home, env: {}, settings: { exclusions: [], ...settings }, signal,
    dirSize: p => junk.dirSize(p, signal), walk: (r, v, o) => junk.walk(r, v, { signal, ...o }) };
};

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`large files on ${platform}`, async () => {
    const { home, vid } = fixture(platform);
    const items = await lf.scan(ctxFor(platform, home, { exclusions: [path.join(home, 'Documents/keep')] }));
    const by = n => items.find(i => i.name === n);
    const names = items.map(i => i.name);

    // threshold, categories, skips
    assert.ok(by('a.mp4') && by('x.zip'));
    assert.strictEqual(by('a.mp4').meta.cat, 'videos');
    assert.strictEqual(by('a.mp4').group, 'Videos');
    assert.strictEqual(by('x.zip').meta.cat, 'archives');
    assert.strictEqual(by('x.zip').meta.dir, 'Downloads');
    assert.strictEqual(by('a copy.mp4').meta.dir, path.join('Documents', 'sub'));
    for (const n of ['small.pdf', 'h.mkv', '.secret.mov', 'big.bin', 'a.heic', 'me.iso']) assert.ok(!names.includes(n), n + ' skipped');
    assert.ok(names.includes(platform === 'darwin' ? 'm.mov' : 'v.mkv'), vid + ' scanned');
    assert.ok(!names.includes(platform === 'darwin' ? 'v.mkv' : 'm.mov'));

    // duplicates: identical bytes only
    assert.strictEqual(by('a.mp4').meta.copies, 2);
    assert.strictEqual(by('a.mp4').meta.dupKey, by('a copy.mp4').meta.dupKey);
    for (const n of ['same-size.mp4', 'tail.mp4', 'x.zip']) assert.strictEqual(by(n).meta.dupKey, undefined, n + ' is not a dup');

    // Ollama: shared blob stays, named model:tag
    const o = by('llama3:8b'), t = by('me/tiny:latest');
    assert.ok(o && t, 'ollama rows');
    assert.strictEqual(o.group, 'AI models');
    const shared = path.join(home, '.ollama/models/blobs/sha256-' + 'e'.repeat(64));
    assert.ok(!o.paths.includes(shared) && !t.paths.includes(shared));
    assert.ok(o.paths.includes(path.join(home, '.ollama/models/blobs/sha256-' + 'a'.repeat(64))));
    assert.ok(o.paths[0].endsWith(path.join('library', 'llama3', '8b')));
    assert.match(o.why, /shared/);
    assert.ok(o.size >= 3 * MB && o.size < 4 * MB, 'size counts only what it frees');

    // LM Studio: one row per model folder
    const a = by('pub/model-a'), b = by('pub2/m2');
    assert.deepStrictEqual(a.paths, [path.join(home, '.lmstudio/models/pub/model-a')]);
    assert.deepStrictEqual(b.paths, [path.join(home, '.cache/lm-studio/models/pub2/m2')]);

    // claims, safety on all
    assert.deepStrictEqual(lf.claims({ home, env: {} }),
      [path.join(home, '.ollama/models'), path.join(home, '.lmstudio/models'), path.join(home, '.cache/lm-studio')]);
    for (const i of items) {
      assert.ok(i.id.startsWith('largefiles:'));
      assert.deepStrictEqual([i.safety, i.action, i.trashOnly, i.pre], ['check', 'trash', true, false], i.id);
    }
    assert.strictEqual(new Set(items.map(i => i.id)).size, items.length);
    fs.rmSync(home, { recursive: true });
  });
}

test('category', () => {
  assert.strictEqual(lf.category('/a/b.PDF', 1), 'pdfs');
  assert.strictEqual(lf.category('/a/b.gguf', 1), 'models');
  assert.strictEqual(lf.category('/a/models/w.bin', 2 ** 31), 'models');
  assert.strictEqual(lf.category('/a/models/w.bin', 1 << 20), 'other');
  assert.strictEqual(lf.category('/a/w.bin', 2 ** 31), 'other');
  assert.strictEqual(lf.category('/a/x.dmg', 1), 'archives');
  assert.strictEqual(lf.category('/a/x.docx', 1), 'documents');
});

test('dupes stops when aborted, and hard links are one file', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-lfd-'));
  const f = n => { const p = path.join(d, n); return p; };
  fs.writeFileSync(f('a'), Buffer.alloc(6 * MB, 1));
  fs.linkSync(f('a'), f('b'));
  const it = n => { const s = fs.statSync(f(n)); return { paths: [f(n)], meta: { kind: 'file', bytes: s.size, ino: s.dev + ':' + s.ino } }; };
  const items = await lf.dupes([it('a'), it('b')]);
  assert.ok(items.every(i => !i.meta.dupKey));
  fs.writeFileSync(f('c'), Buffer.alloc(6 * MB, 1));
  const ac = new AbortController(); ac.abort();
  assert.ok((await lf.dupes([it('a'), it('c')], ac.signal)).every(i => !i.meta.dupKey));
  assert.ok((await lf.dupes([it('a'), it('c')])).every(i => i.meta.copies === 2));
  fs.rmSync(d, { recursive: true });
});

test('missing folders give no rows', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-lfe-'));
  assert.deepStrictEqual(await lf.scan(ctxFor('linux', home)), []);
  fs.rmSync(home, { recursive: true });
});

test('a malformed Ollama manifest is skipped, not fatal', async () => {
  const { home } = fixture('darwin');
  fs.writeFileSync(path.join(home, '.ollama/models/manifests/.DS_Store'), Buffer.from([0, 0, 0, 1, 66, 117]));
  fs.writeFileSync(path.join(home, '.ollama/models/manifests/registry.ollama.ai/me/tiny/broken'), '{"config":');
  const items = await lf.scan(ctxFor('darwin', home));
  assert.ok(items.some(i => i.meta?.kind === 'ollama'), 'good manifests still listed');
  fs.rmSync(home, { recursive: true });
});
