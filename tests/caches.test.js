const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { guard } = require('../src/main/safety');
const junk = require('../src/main/junk');
const caches = require('../src/scanners/caches');

const FILES = {
  linux: ['.cache/mozilla/firefox/x/cache2/a', '.cache/google-chrome/Default/Cache/a', '.cache/thumbnails/large/a.png',
    '.cache/huggingface/hub/a', '.cache/empty/', '.cache/stray-file',
    '.config/google-chrome/Default/x', '.config/google-chrome/GPUCache/a', '.config/Code/Cache/a', '.config/Code/Code Cache/js/a',
    '.config/Code/User/settings.json', '.config/Slack/Service Worker/CacheStorage/a', '.config/Cleanzy/Cache/a'],
  darwin: ['Library/Caches/com.apple.Safari/a', 'Library/Caches/com.tinyspeck.slackmacgap/a', 'Library/Caches/com.example.fooBar/a',
    'Library/Caches/Google/Chrome/a', 'Library/Application Support/Slack/Cache/a', 'Library/Application Support/Slack/storage/a',
    'Library/Logs/App/a.log', 'Library/Logs/DiagnosticReports/x.crash'],
  win32: ['AppData/Local/Google/Chrome/User Data/Default/Cache/a', 'AppData/Local/Google/Chrome/User Data/Default/Code Cache/a',
    'AppData/Local/Microsoft/Edge/User Data/Default/GPUCache/a', 'AppData/Local/Temp/a.tmp', 'AppData/Local/CrashDumps/a.dmp',
    'AppData/Local/Foo/keep.db', 'AppData/Roaming/Code/Cache/a', 'AppData/Roaming/Code/User/a'],
};
const COMMON = ['Downloads/setup.dmg', 'Downloads/tool.exe', 'Downloads/pkg.deb', 'Downloads/notes.txt', 'Downloads/sub/deep.msi'];

function setup(platform, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanzy-caches-'));
  for (const f of [...FILES[platform], ...COMMON]) {
    const p = path.join(home, f);
    if (f.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(4096, 1));
  }
  const env = platform === 'win32'
    ? { USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData/Local'), APPDATA: path.join(home, 'AppData/Roaming') }
    : { HOME: home, ...(platform === 'linux' ? { XDG_CACHE_HOME: path.join(home, '.cache'), XDG_CONFIG_HOME: path.join(home, '.config') } : {}) };
  const signal = new AbortController().signal;
  const ctx = { platform, home, env, settings: { exclusions: [] }, signal,
    run: async () => ({ out: '', err: 'no', code: 1 }),
    dirSize: p => junk.dirSize(p, signal),
    walk: (root, visit, opts) => junk.walk(root, visit, { signal, ...opts }), ...extra };
  return { home, ctx, h: (...p) => path.join(home, ...p) };
}
const byName = (items, n) => items.find(i => i.name === n);

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`caches common rules on ${platform}`, async () => {
    const { home, ctx, h } = setup(platform);
    const items = await caches.scan(ctx);
    assert.ok(items.length > 3);
    for (const i of items) {
      assert.ok(i.id.startsWith('caches:'), i.id);
      assert.strictEqual(i.module, 'caches');
      assert.ok(i.size > 0, i.id + ' has size');
      assert.ok(['safe', 'check'].includes(i.safety));
      assert.ok(i.why && i.group && i.name);
      if (i.action !== 'cmd')
        for (const p of i.paths) assert.strictEqual(guard(p, { home, contentsOnly: i.action === 'contents' }), null, p);
    }
    assert.strictEqual(new Set(items.map(i => i.id)).size, items.length, 'unique ids');
    const all = items.flatMap(i => i.paths);
    for (const root of [h('.cache'), h('Library', 'Caches'), h('AppData', 'Local'), h('AppData', 'Roaming')])
      assert.ok(!all.includes(root), 'never the cache root itself');
    // installers: top level only, check + trashOnly
    const inst = items.filter(i => /\.(dmg|exe|deb|msi)$/.test(i.name)).map(i => i.name).sort();
    assert.deepStrictEqual(inst, ['pkg.deb', 'setup.dmg', 'tool.exe']);
    for (const n of inst) {
      const i = byName(items, n);
      assert.strictEqual(i.safety, 'check');
      assert.strictEqual(i.trashOnly, true);
      assert.strictEqual(i.group, 'Installers');
    }
    assert.ok(!byName(items, 'notes.txt'));
    fs.rmSync(home, { recursive: true });
  });
}

test('linux: friendly names merge, electron subfolders, model stores are Check First', async () => {
  const { home, ctx, h } = setup('linux');
  const items = await caches.scan(ctx);
  const chrome = byName(items, 'Chrome');
  assert.deepStrictEqual(chrome.paths.sort(), [h('.cache/google-chrome'), h('.config/google-chrome/GPUCache')].sort());
  assert.strictEqual(chrome.group, 'Apps');
  assert.strictEqual(chrome.safety, 'safe');
  assert.strictEqual(chrome.action, 'trash');
  assert.deepStrictEqual(byName(items, 'VS Code').paths.sort(), [h('.config/Code/Cache'), h('.config/Code/Code Cache')].sort());
  assert.deepStrictEqual(byName(items, 'Slack').paths, [h('.config/Slack/Service Worker/CacheStorage')]);
  assert.ok(byName(items, 'Firefox'));
  assert.ok(byName(items, 'Thumbnails'));
  const all = items.flatMap(i => i.paths);
  for (const p of [h('.config/Code'), h('.config/google-chrome'), h('.config/Slack'), h('.config/Cleanzy/Cache'), h('.cache/stray-file')])
    assert.ok(!all.includes(p), p + ' not offered');
  assert.ok(!byName(items, 'Empty'), '0-byte rows skipped');
  assert.ok(!byName(items, 'Huggingface'), 'Dev Tools lists Hugging Face models');
  fs.rmSync(home, { recursive: true });
});

test('darwin: bundle ids humanized, logs and crash reports', async () => {
  const { home, ctx, h } = setup('darwin');
  const items = await caches.scan(ctx);
  assert.ok(byName(items, 'Safari'));
  assert.deepStrictEqual(byName(items, 'Slack').paths.sort(),
    [h('Library/Caches/com.tinyspeck.slackmacgap'), h('Library/Application Support/Slack/Cache')].sort());
  assert.ok(byName(items, 'FooBar'));
  assert.deepStrictEqual(byName(items, 'Logs').paths, [h('Library/Logs/App')]);
  const crash = byName(items, 'Crash reports');
  assert.deepStrictEqual(crash.paths, [h('Library/Logs/DiagnosticReports')]);
  assert.strictEqual(crash.action, 'contents');
  assert.ok(!items.flatMap(i => i.paths).includes(h('Library/Application Support/Slack')));
  assert.ok(!items.some(i => i.action === 'cmd'), 'no linux cmd items');
  fs.rmSync(home, { recursive: true });
});

test('win32: LOCALAPPDATA cache folders, Temp and CrashDumps emptied in place', async () => {
  const { home, ctx, h } = setup('win32');
  const items = await caches.scan(ctx);
  const chrome = byName(items, 'Chrome');
  assert.deepStrictEqual(chrome.paths.sort(), ['Cache', 'Code Cache'].map(c => h('AppData/Local/Google/Chrome/User Data/Default', c)).sort());
  assert.ok(byName(items, 'Edge'));
  assert.deepStrictEqual(byName(items, 'VS Code').paths, [h('AppData/Roaming/Code/Cache')]);
  for (const n of ['Temporary files', 'Crash dumps']) {
    const i = byName(items, n);
    assert.strictEqual(i.action, 'contents');
    assert.strictEqual(i.safety, 'safe');
  }
  assert.ok(!items.flatMap(i => i.paths).some(p => p.includes('Foo')), 'non-cache folders are not offered');
  fs.rmSync(home, { recursive: true });
});

test('claims and exclusions are skipped', async () => {
  const devtools = require('../src/scanners/devtools'), largefiles = require('../src/scanners/largefiles');
  const dc = devtools.claims, lc = largefiles.claims;
  const { home, ctx, h } = setup('linux');
  devtools.claims = () => [h('.cache/mozilla')];
  largefiles.claims = () => [h('.cache/huggingface/hub')];   // claim inside a row drops the whole row
  ctx.settings.exclusions = [h('.cache/thumbnails'), h('Downloads/setup.dmg')];
  try {
    const items = await caches.scan(ctx);
    for (const n of ['Firefox', 'Huggingface', 'Thumbnails', 'setup.dmg']) assert.ok(!byName(items, n), n + ' skipped');
    assert.ok(byName(items, 'Chrome'));
  } finally { devtools.claims = dc; largefiles.claims = lc; fs.rmSync(home, { recursive: true }); }
});

test('real dev claims (pip, Homebrew) never appear', async () => {
  for (const [platform, f] of [['linux', '.cache/pip/http/a'], ['darwin', 'Library/Caches/Homebrew/a']]) {
    const { home, ctx, h } = setup(platform);
    const p = h(f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x');
    const claimed = await require('../src/scanners/devtools').claims(ctx);
    const items = await caches.scan(ctx);
    for (const c of claimed) assert.ok(!items.some(i => i.paths.some(q => q === c || q.startsWith(c + path.sep))), c);
    fs.rmSync(home, { recursive: true });
  }
});

test('linux cmd items from fake run output', async () => {
  const OUT = {
    du: { out: '734003200\t/var/cache/apt/archives\n', err: 'du: cannot read directory partial', code: 1 },
    journalctl: { out: 'Archived and active journals take up 1.5G in the file system.\n', err: '', code: 0 },
    snap: { out: 'Name Version Rev Tracking Publisher Notes\ncore22 2024 1380 latest/stable canonical** base\n' +
      'firefox 120.0 3358 latest/stable mozilla** disabled\nfirefox 121.0 3504 latest/stable mozilla** -\n', err: '', code: 0 },
  };
  const calls = [];
  const { home, ctx } = setup('linux', { run: async (c, a) => { calls.push([c, ...a]); return OUT[c]; } });
  const items = (await caches.scan(ctx)).filter(i => i.action === 'cmd');
  assert.ok(!items.some(i => i.cmd.id === 'snapRev'), 'a snap with no file on disk (0 bytes) is not offered');
  items.push(...(await caches.linuxCmds(ctx, () => 5e6)).filter(i => i.cmd.id === 'snapRev'));
  const apt = items.find(i => i.cmd.id === 'aptClean');
  assert.strictEqual(apt.size, 734003200);
  assert.strictEqual(apt.id, 'caches:aptClean');
  const j = items.find(i => i.cmd.id === 'journal');
  assert.strictEqual(j.size, Math.round(1.5 * 1024 ** 3) - 100 * 1024 ** 2);
  const snaps = items.filter(i => i.cmd.id === 'snapRev');
  assert.strictEqual(snaps.length, 1);
  assert.deepStrictEqual(snaps[0].cmd.args, ['firefox', '3358']);
  assert.strictEqual(snaps[0].id, 'caches:snap:firefox:3358');
  assert.strictEqual(snaps[0].size, 5e6);
  for (const i of [apt, j]) {
    assert.strictEqual(i.safety, 'check');
    assert.strictEqual(i.pre, false);
    assert.ok(i.why && !/password/i.test(i.why), 'a real reason, not a repeat of the password badge');
  }
  assert.ok(calls.some(c => c.join(' ') === 'snap list --all'));
  fs.rmSync(home, { recursive: true });
});

test('friendly names', () => {
  assert.strictEqual(caches.friendly('google-chrome'), 'Chrome');
  assert.strictEqual(caches.friendly('com.apple.Safari'), 'Safari');
  assert.strictEqual(caches.friendly('com.example.someApp'), 'SomeApp');
  assert.strictEqual(caches.friendly('Google', 'Chrome', 'User Data'), 'Chrome');
  assert.strictEqual(caches.friendly('gnome-software'), 'Gnome software');
});

test('aborted signal stops early', async () => {
  const ac = new AbortController(); ac.abort();
  const { home, ctx } = setup('linux', { signal: ac.signal });
  assert.deepStrictEqual(await caches.scan(ctx), []);
  fs.rmSync(home, { recursive: true });
});

test('unsupported platform returns []', async () => {
  assert.deepStrictEqual(await caches.scan({ platform: 'aix', home: '/x', env: {} }), []);
});

test('Telegram and Adobe media caches', async () => {
  for (const [platform, rels] of [['linux', ['.local/share/TelegramDesktop/tdata/user_data/a']],
    ['darwin', ['Library/Application Support/Adobe/Common/Media Cache Files/a']],
    ['win32', ['AppData/Roaming/Telegram Desktop/tdata/user_data/a', 'AppData/Roaming/Adobe/Common/Media Cache/a']]]) {
    const { home, ctx, h } = setup(platform);
    for (const r of rels) { fs.mkdirSync(path.dirname(h(r)), { recursive: true }); fs.writeFileSync(h(r), Buffer.alloc(4096, 1)); }
    const items = await caches.scan(ctx);
    for (const r of rels) assert.ok(items.some(i => i.paths.includes(path.dirname(h(r)))), platform + ' ' + r);
    fs.rmSync(home, { recursive: true });
  }
});

test('XDG_CACHE_HOME pointing at home never turns home folders into caches', async () => {
  const { home, ctx, h } = setup('linux');
  fs.mkdirSync(h('projects'), { recursive: true }); fs.writeFileSync(h('projects', 'thesis.docx'), Buffer.alloc(4096, 1));
  ctx.env.XDG_CACHE_HOME = home;
  const items = await caches.scan(ctx);
  assert.ok(!items.some(i => i.paths.some(p => p.startsWith(h('projects')))));
  assert.ok(items.some(i => i.paths.some(p => p.startsWith(h('.cache')))), 'falls back to ~/.cache');
  fs.rmSync(home, { recursive: true, force: true });
});
