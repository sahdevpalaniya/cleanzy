// npm run e2e -- launches the real app against a throwaway HOME (E2E_DIR, default <tmp>/cleanzy-e2e-home),
// walks every tab with the keyboard shortcuts, runs Scan Everything, then Clean Safe Items through the real
// confirmation sheet, and checks what moved and what stayed. The child refuses to start unless HOME is the
// fixture, and only fixture items are left in the results before cleaning (fixed system paths such as
// /var/crash are dropped), so nothing outside the fixture is ever cleaned.
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.versions.electron) {
  // ── parent (plain node) ──
  const assert = require('assert');
  const { spawnSync } = require('child_process');
  const home = path.resolve(process.env.E2E_DIR || path.join(os.tmpdir(), 'cleanzy-e2e-home'));
  fs.rmSync(home, { recursive: true, force: true });
  const put = (rel, bytes = 4096, fill = 7) => {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, fill));
    return p;
  };
  const gone = rel => !fs.existsSync(path.join(home, rel));
  // caches + logs
  put('.cache/thumbnails/large/a.png', 2 << 20);
  put('.cache/myapp/logs/debug.log', 1 << 20);
  put('.config/Slack/Cache/data_0', 1 << 20);
  put('Library/Logs/old.log'); put('AppData/Local/Temp/x.tmp');   // mac / windows equivalents, inert on Linux
  // a stale node project
  put('proj/package.json', 20); put('proj/package-lock.json', 20);
  put('proj/node_modules/p/index.js'); put('proj/.next/cache/a');
  const index = put('proj/index.js', 30);
  // large files + a byte-identical duplicate pair + an old installer
  put('Documents/big.bin', 60 << 20, 1);
  put('Pictures/dup-a.jpg', 8 << 20, 2); put('Documents/dup-b.jpg', 8 << 20, 2);
  put('Downloads/setup.deb', 6 << 20, 3);
  // never touch
  put('Documents/notes.txt', 100); put('.ssh/id_ed25519', 400); put('Music/song.txt', 100);
  fs.mkdirSync(path.join(home, '.local/share/Trash/files'), { recursive: true });
  const old = new Date(Date.now() - 400 * 864e5);
  const touch = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) touch(path.join(d, e.name)); fs.utimesSync(d, old, old); };
  for (const p of fs.readdirSync(path.join(home, 'proj'))) { const q = path.join(home, 'proj', p); fs.statSync(q).isDirectory() ? touch(q) : fs.utimesSync(q, old, old); }
  fs.utimesSync(path.join(home, 'proj'), old, old);

  const env = { ...process.env, HOME: home, E2E_HOME: home, USERPROFILE: home, XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local') };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(require('electron'), ['--no-sandbox', __filename], { env, stdio: 'inherit', timeout: 300e3 });

  assert.strictEqual(r.status, 0, `app run failed (status ${r.status}, signal ${r.signal})`);
  for (const rel of ['.cache/thumbnails', '.cache/myapp', '.config/Slack/Cache', 'proj/.next']) assert.ok(gone(rel), rel + ' was cleaned');
  const inTrash = fs.readdirSync(path.join(home, '.local/share/Trash/files'));
  assert.ok(inTrash.some(n => n.startsWith('thumbnails')), 'thumbnails went to the fixture Trash: ' + inTrash);
  for (const rel of ['proj/node_modules/p/index.js', 'proj/package.json', 'Documents/big.bin', 'Pictures/dup-a.jpg',
    'Documents/dup-b.jpg', 'Downloads/setup.deb', 'Documents/notes.txt', '.ssh/id_ed25519', 'Music/song.txt'])
    assert.ok(!gone(rel), rel + ' is untouched');
  assert.strictEqual(fs.readFileSync(index, 'utf8'), Buffer.alloc(30, 7).toString(), 'proj/index.js untouched');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('e2e ok');
} else {
  // ── child (electron) ──
  if (os.homedir() !== process.env.E2E_HOME) { console.error('e2e: HOME is not the fixture, refusing to run'); process.exit(2); }
  const { app, BrowserWindow } = require('electron');
  const home = process.env.E2E_HOME, errs = [];
  process.on('uncaughtException', e => errs.push('main: ' + (e.stack || e)));
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (_ev, level, msg, line, src) => { if (level >= 3) errs.push(`renderer: ${msg} (${src}:${line})`); });
    wc.on('render-process-gone', (_ev, d) => errs.push('renderer gone: ' + d.reason));
  });
  require('../src/main/main.js');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fail = msg => { errs.push(msg); console.error('FAIL', msg); };
  app.whenReady().then(async () => {
    let w;
    while (!(w = BrowserWindow.getAllWindows()[0])) await sleep(50);
    const js = s => w.webContents.executeJavaScript(s);
    const until = async (expr, ms = 120e3) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) if (await js(expr).catch(() => false)) return true;
      fail('timed out waiting for ' + expr); return false;
    };
    const key = async (keyCode, modifiers = []) => {
      for (const type of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode, modifiers });
      await sleep(150);
    };
    const ctrl = process.platform === 'darwin' ? 'meta' : 'control';
    const click = sel => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
    try {
      await until(`!!(window.Shell && Shell.info.platform && document.querySelector('#side .tab'))`, 30e3);
      w.show(); w.focus(); w.webContents.focus();
      const dup = await js(`(() => { const a = [...document.querySelectorAll('[id]')].map(e => e.id); return a.filter((x, i) => a.indexOf(x) !== i); })()`);
      if (dup.length) fail('duplicate ids: ' + dup);

      // first run: onboarding sheet; Escape leaves it for later
      if (!await until(`!!document.querySelector('.scrim')`, 10e3)) throw new Error('no onboarding sheet on first run');
      await key('Escape');
      await until(`!document.querySelector('.scrim')`, 5e3);

      // every tab by keyboard: Ctrl+1..n, Ctrl+, for Settings
      const keys = await js(`[...document.querySelectorAll('#side .tab')].map(b => b.dataset.key).filter(k => k !== 'about')`);
      for (const [n, k] of keys.entries()) {
        await key(String(n + 1), [ctrl]);
        if (!await js(`Shell.current === '${k}' && !document.getElementById('view-${k}').hidden`)) fail(`Ctrl+${n + 1} did not open ${k}`);
      }
      await key('1', [ctrl]); await key(',', [ctrl]);
      if (await js(`Shell.current`) !== 'settings') fail('Ctrl+, did not open Settings');
      await key('1', [ctrl]);

      // Scan Everything
      await key('R', [ctrl, 'shift']);
      await until(`!!Shell.results.caches`, 10e3) || fail('Shift+Ctrl+R did not start Scan Everything');
      await until(`!Shell.busy && !document.querySelector('#side .spin') && Shell.results.uninstaller?.at`, 180e3);
      const got = JSON.parse(await js(`JSON.stringify(Object.fromEntries(Object.entries(Shell.results).map(([k, r]) =>
        [k, { error: r.error, items: r.items.map(i => ({ id: i.id, safety: i.safety, paths: i.paths, dup: i.meta?.dupKey })) }])))`));
      const has = (k, re, safety) => got[k]?.items.some(i => i.paths.some(p => re.test(p)) && (!safety || i.safety === safety)) || fail(`${k} did not find ${re} (${safety || 'any'})`);
      for (const k of ['caches', 'devtools', 'largefiles', 'uninstaller']) if (!got[k] || got[k].error) fail(`${k} scan failed: ${got[k]?.error}`);
      has('caches', /\.cache\/thumbnails$/, 'safe'); has('caches', /\.cache\/myapp$/, 'safe');
      has('caches', /Slack\/Cache$/, 'safe'); has('caches', /Downloads\/setup\.deb$/, 'check');
      has('devtools', /proj\/node_modules$/, 'check'); has('devtools', /proj\/\.next$/, 'safe');
      has('largefiles', /Documents\/big\.bin$/, 'check');
      if (got.largefiles?.items.filter(i => i.dup).length !== 2) fail('largefiles did not pair the duplicates');
      if (got.largefiles?.items.some(i => i.paths.some(p => p.endsWith('setup.deb')))) fail('setup.deb listed twice (Large Files)');

      // only fixture items may be cleaned (a path-less command row — docker, apt — is never one)
      await js(`for (const r of Object.values(Shell.results)) r.items = r.items.filter(i => i.paths.length && i.paths.every(p => p.startsWith(${JSON.stringify(home + path.sep)})))`);
      await js(`Shell.markStale([])`);
      // Clean Safe Items → popover → confirmation sheet → Move to Trash
      await until(`!document.getElementById('cleanSafe').disabled`, 5e3);
      await click('#cleanSafe');
      await until(`!!document.querySelector('.pop [data-a=go]')`, 5e3);
      await click('.pop [data-a=go]');
      await until(`!!document.querySelector('.sheet [data-a=go]')`, 5e3);
      const sheet = await js(`document.querySelector('.sheet').textContent`);
      if (/node_modules|big\.bin|setup\.deb/.test(sheet)) fail('Check First items in the one-click clean sheet');
      await click('.sheet [data-a=go]');
      await until(`!!document.querySelector('#toast .toast')`, 60e3);
      console.log('e2e toast:', await js(`document.querySelector('#toast').textContent`));
      await until(`!Shell.busy && !document.querySelector('#side .spin')`);
    } catch (e) { fail('e2e: ' + (e.stack || e)); }
    if (errs.length) console.error(errs.join('\n'));
    app.exit(errs.length ? 1 : 0);
  });
}
