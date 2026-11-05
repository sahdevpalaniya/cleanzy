// Overview + Settings pure helpers: size comparisons, schedule maths, row facts, disk segments.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { compare, since, safeTotal, fact, segments } = require('../src/renderer/ui/overview');
const { nextRun, preset, PRESETS } = require('../src/renderer/ui/settings');
const store = require('../src/main/store');

const MB = 1e6, GB = 1e9, DAY = 864e5, NOW = Date.UTC(2026, 9, 14);
const it = (module, name, size, safety = 'safe', extra = {}) =>
  ({ id: `${module}:${name}`, module, name, group: extra.group || name, paths: [extra.p || `/h/${name}`], size, safety, action: 'trash', ...extra });

test('compare: null under 5 MB, rounds down, picks the unit', () => {
  for (const b of [0, -1, NaN, undefined, 4.99 * MB]) assert.strictEqual(compare(b), null);
  assert.strictEqual(compare(5 * MB), "That's room for ~1 photo");
  assert.strictEqual(compare(8.99 * MB), "That's room for ~2 photos");
  assert.strictEqual(compare(99 * MB), "That's room for ~33 photos");
  assert.strictEqual(compare(100 * MB), "That's room for ~12 songs");
  assert.strictEqual(compare(2.99 * GB), "That's room for ~373 songs");
  assert.strictEqual(compare(3 * GB), "That's room for ~1 hour of HD video");
  assert.strictEqual(compare(8.9 * GB), "That's room for ~2 hours of HD video");
  assert.strictEqual(compare(3000 * GB), "That's room for ~1,000 hours of HD video");
});

test('nextRun: renderer copy matches store.nextRun', () => {
  const last = new Date(2026, 0, 31, 10).getTime();
  const cases = [null, { every: 0, unit: 'days' }, { every: 3, unit: 'days' }, { every: 2, unit: 'weeks' },
    { every: 1, unit: 'months' }, { every: 3, unit: 'months' }, { every: 12, unit: 'months' }];
  for (const s of cases) assert.strictEqual(nextRun(s, last), store.nextRun(s, last), JSON.stringify(s));
  assert.strictEqual(nextRun({ every: 0, unit: 'weeks' }, last), null);
  assert.strictEqual(nextRun({ every: 3, unit: 'days' }, last), new Date(2026, 1, 3, 10).getTime());
  assert.strictEqual(nextRun({ every: 2, unit: 'weeks' }, last), new Date(2026, 1, 14, 10).getTime());
  // Jan 31 + 1 month overflows the way Date.setMonth does (no Feb 31): lands on Mar 3
  assert.strictEqual(nextRun({ every: 1, unit: 'months' }, last), new Date(2026, 2, 3, 10).getTime());
  assert.strictEqual(nextRun({ every: 3, unit: 'months' }, new Date(2026, 10, 30).getTime()), new Date(2027, 2, 2).getTime());
});

test('preset: stored schedules map to the right choice', () => {
  for (const k of Object.keys(PRESETS)) assert.strictEqual(preset(PRESETS[k]), k);
  assert.strictEqual(preset(undefined), 'off');
  assert.strictEqual(preset({ every: 0, unit: 'months' }), 'off');
  assert.strictEqual(preset({ every: 2, unit: 'weeks' }), 'custom');
  assert.strictEqual(preset({ every: 1, unit: 'days' }), 'custom');
});

test('since: short relative times', () => {
  assert.strictEqual(since(NOW - 20e3, NOW), 'just now');
  assert.strictEqual(since(NOW - 2 * 6e4, NOW), '2 min ago');
  assert.strictEqual(since(NOW - 3 * 36e5, NOW), '3 h ago');
  assert.strictEqual(since(NOW - DAY, NOW), '1 day ago');
  assert.strictEqual(since(NOW - 9 * DAY, NOW), '9 days ago');
});

// fixture results per platform: the facts read only items, so home + separators are what vary
for (const [platform, p] of [['linux', path.posix], ['darwin', path.posix], ['win32', path.win32]]) {
  const home = platform === 'win32' ? 'C:\\Users\\me' : platform === 'darwin' ? '/Users/me' : '/home/me';
  const R = {
    caches: { items: [it('caches', 'Firefox', 1.5 * GB, 'safe', { group: 'Apps' }), it('caches', 'Firefox', 0.6 * GB, 'safe', { group: 'Apps' }), it('caches', 'Slack', 200 * MB, 'safe', { group: 'Apps' }),
      it('caches', 'Old installers', 300 * MB, 'check'), it('caches', 'APT cache', 1 * GB, 'safe', { action: 'cmd', cmd: { id: 'aptClean' } })] },
    devtools: { items: [it('devtools', 'node_modules', 800 * MB, 'safe', { restore: 'npm install' }), it('devtools', 'Docker', 2 * GB, 'check')] },
    largefiles: { items: [it('largefiles', 'a.iso', 1 * GB, 'check', { p: p.join(home, 'Downloads', 'a.iso') }),
      it('largefiles', 'x.mov', 4 * GB, 'check', { p: p.join(home, 'Movies', 'x.mov') })] },
    uninstaller: { items: [it('uninstaller', 'Zoom', 300 * MB, 'check', { action: 'pkg', meta: { lastUsed: NOW - 200 * DAY } }),
      it('uninstaller', 'Slack', 400 * MB, 'check', { action: 'pkg', meta: { lastUsed: NOW - 2 * DAY } }),
      it('uninstaller', 'OldApp prefs', 50 * MB, 'safe', { group: 'Leftovers' })] },
  };

  test(`fact (${platform}): one actionable line per row`, () => {
    assert.strictEqual(fact('caches', R.caches, home, NOW), '3.3 GB safe to clean · 2 apps');
    assert.strictEqual(fact('devtools', R.devtools, home, NOW), '800 MB safe to clean · 2.0 GB to check first');
    assert.strictEqual(fact('largefiles', R.largefiles, home, NOW), `Largest: ${p.join('Movies', 'x.mov')} 4.0 GB`);
    assert.strictEqual(fact('uninstaller', R.uninstaller, home, NOW), '1 app not opened in 6 months');
    const fresh = { items: R.uninstaller.items.filter(i => i.name !== 'Zoom') };
    assert.strictEqual(fact('uninstaller', fresh, home, NOW), '1 app · 50.0 MB of leftovers');
  });

  test(`fact (${platform}): states before and without results`, () => {
    assert.strictEqual(fact('caches', undefined), 'Not scanned yet');
    assert.strictEqual(fact('caches', { items: [], scanning: true }), 'Scanning…');
    assert.strictEqual(fact('caches', { items: [], error: 'EPERM: operation not permitted' }), "Couldn't scan: EPERM: operation not permitted");
    assert.strictEqual(fact('devtools', { items: [] }), 'Nothing to clean');
    assert.strictEqual(fact('largefiles', { items: [] }), 'No large files found');
    assert.strictEqual(fact('devtools', { items: [it('devtools', 'Docker', 2 * GB, 'check')] }), '2.0 GB to check first');
    // a path outside home stays absolute; a sibling that only shares the prefix is not trimmed
    const out = p.join(home + 'x', 'big.bin');
    assert.strictEqual(fact('largefiles', { items: [it('largefiles', 'big', 9 * GB, 'check', { p: out })] }, home), `Largest: ${out} 9.0 GB`);
  });

  test(`safeTotal (${platform}): one-click rule skips check, password and app items`, () => {
    const t = safeTotal(R);
    assert.strictEqual(t.count, 4);   // Firefox ×2, Slack cache, node_modules; not APT (password), not leftovers (uninstaller)
    assert.strictEqual(t.size, 1.5 * GB + 0.6 * GB + 200 * MB + 800 * MB);
    assert.deepStrictEqual(safeTotal({}), { size: 0, count: 0 });
  });

  test(`segments (${platform}): categories, everything else, free`, () => {
    const disk = { size: 500 * GB, used: 300 * GB, avail: 200 * GB };
    const s = Object.fromEntries(segments(R, disk).map(x => [x.key, x.size]));
    assert.deepStrictEqual(Object.keys(s), ['caches', 'devtools', 'largefiles', 'apps', 'leftovers', 'other', 'free']);
    assert.strictEqual(s.apps, 700 * MB);
    assert.strictEqual(s.leftovers, 50 * MB);
    const known = s.caches + s.devtools + s.largefiles + s.apps + s.leftovers;
    assert.strictEqual(s.other, 300 * GB - known);
    assert.strictEqual(s.free, 200 * GB);
    assert.strictEqual(segments(R, { size: 1, used: 1, avail: 0 }).find(x => x.key === 'other').size, 0, 'never negative');
    assert.strictEqual(segments({}, undefined).reduce((t, x) => t + x.size, 0), 0);
  });
}
