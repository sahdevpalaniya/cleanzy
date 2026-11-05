const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/renderer/ui/disk.js');

test('treemap layout tiles the canvas with area proportional to size', () => {
  const items = [900, 400, 250, 120, 60, 30, 10, 5, 1].map((size, i) => ({ size, name: 'n' + i }));
  const out = []; d.layout(items, 0, 0, 800, 300, out);
  assert.strictEqual(out.length, items.length);
  assert.ok(Math.abs(out.reduce((a, r) => a + r.w * r.h, 0) - 800 * 300) < 1);
  const tot = items.reduce((a, b) => a + b.size, 0);
  for (const r of out) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 800 + 1e-9 && r.y + r.h <= 300 + 1e-9);
    assert.ok(Math.abs(r.w * r.h / (800 * 300) - r.size / tot) < 1e-6);
  }
  const none = []; d.layout([], 0, 0, 100, 100, none); d.layout(items, 0, 0, 0, 100, none);
  assert.strictEqual(none.length, 0);
  const one = []; d.layout([{ size: 5 }], 2, 3, 10, 20, one);
  assert.deepStrictEqual(one, [{ size: 5, x: 2, y: 3, w: 10, h: 20 }]);
});

test('no tiles overlap', () => {
  const out = []; d.layout([50, 30, 10, 7, 3].map(size => ({ size })), 0, 0, 300, 500, out);
  for (const a of out) for (const b of out) if (a !== b)
    assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9);
});

test('parentOf on POSIX paths', () => {
  assert.strictEqual(d.parentOf('/home/u/proj'), '/home/u');
  assert.strictEqual(d.parentOf('/home/u/proj/'), '/home/u');
  assert.strictEqual(d.parentOf('/home'), '/');
  assert.strictEqual(d.parentOf('/'), '/');
});

test('parentOf on C:\\ paths', () => {
  assert.strictEqual(d.parentOf('C:\\Users\\u\\AppData'), 'C:\\Users\\u');
  assert.strictEqual(d.parentOf('C:\\Users\\u\\'), 'C:\\Users');
  assert.strictEqual(d.parentOf('C:\\Users'), 'C:\\');
  assert.strictEqual(d.parentOf('C:\\'), 'C:\\');
});

test('splitPath splits on either separator', () => {
  assert.deepStrictEqual(d.splitPath('/home/u/a b'), ['home', 'u', 'a b']);
  assert.deepStrictEqual(d.splitPath('C:\\Users\\u\\x'), ['C:', 'Users', 'u', 'x']);
  assert.deepStrictEqual(d.splitPath('/'), []);
});

test('under/inside respects separators and roots', () => {
  assert.ok(d.under('/home/u/a', '/home/u'));
  assert.ok(d.under('/home/u', '/home/u'));
  assert.ok(!d.under('/home/user2', '/home/u'));
  assert.ok(d.under('/x', '/'));
  assert.ok(d.under('C:\\Users\\u', 'C:\\'));
  assert.ok(d.under('C:\\Users\\u\\x', 'C:\\Users\\u'));
  assert.ok(!d.under('C:\\Users\\u2', 'C:\\Users\\u'));
});

test('crumbs walk from the scan root to the folder', () => {
  assert.deepStrictEqual(d.crumbs('/home/u', '/home/u/a/b', '/'), [['/home/u', 'u'], ['/home/u/a', 'a'], ['/home/u/a/b', 'b']]);
  assert.deepStrictEqual(d.crumbs('/', '/var/log', '/'), [['/', '/'], ['/var', 'var'], ['/var/log', 'log']]);
  assert.deepStrictEqual(d.crumbs('C:\\', 'C:\\Users\\u', '\\'), [['C:\\', 'C:\\'], ['C:\\Users', 'Users'], ['C:\\Users\\u', 'u']]);
  assert.deepStrictEqual(d.crumbs('/home/u', '/home/u', '/'), [['/home/u', 'u']]);
});

test('find locates nodes on POSIX and C:\\ trees', () => {
  const mk = (sep, root) => {
    const b = { path: root + sep + 'a' + sep + 'b', kids: [] }, a = { path: root + sep + 'a', kids: [b] }, a2 = { path: root + sep + 'ab', kids: [] };
    return { t: { path: root, kids: [a2, a] }, a, b };
  };
  for (const [sep, root] of [['/', '/home/u'], ['\\', 'C:\\Users\\u']]) {
    const { t, a, b } = mk(sep, root);
    assert.strictEqual(d.find(t, root), t);
    assert.strictEqual(d.find(t, a.path), a);
    assert.strictEqual(d.find(t, b.path), b);
    assert.strictEqual(d.find(t, root + sep + 'zz'), null);
  }
  const r = { path: 'C:\\', kids: [{ path: 'C:\\Windows', kids: [] }] };
  assert.strictEqual(d.find(r, 'C:\\Windows'), r.kids[0]);
});

test('isCleanable: only a folder whose own name matches', () => {
  for (const name of ['.cache', 'cache', 'Caches', '.npm', '.yarn', '.pnpm-store', 'node_modules', '.gradle', '__pycache__', '.next', 'Trash', '.Trash', 'CachedData', 'logs', 'log'])
    assert.ok(d.isCleanable({ name, dir: true }), name);
  assert.ok(!d.isCleanable({ name: 'index.js', path: '/p/node_modules/x/index.js', dir: false }), 'file inside node_modules');
  assert.ok(!d.isCleanable({ name: 'node_modules', dir: false, file: true }), 'a file named like a cache');
  assert.ok(!d.isCleanable({ name: 'lodash', path: '/p/node_modules/lodash', dir: true }), 'folder inside node_modules');
  for (const name of ['build', 'dist', 'snap', 'tmp', 'my.cache', 'cachefiles'])
    assert.ok(!d.isCleanable({ name, dir: true }), name);
});
