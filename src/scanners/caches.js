// App Caches: per-app cache folders (merged by friendly name), Electron/Chromium
// caches, logs, crash reports, old installers and (Linux) apt/journal/snap junk.
const fs = require('fs/promises');
const path = require('path');
const { guard } = require('../main/safety');
const { parseJournal, snapApps } = require('../main/apps');
const devtools = require('./devtools');
const largefiles = require('./largefiles');

// folder name (lower case; win32 may use 'vendor/app') -> friendly name
const NAMES = {
  'google-chrome': 'Chrome', 'google/chrome': 'Chrome', 'com.google.chrome': 'Chrome', 'chromium': 'Chromium',
  'mozilla': 'Firefox', 'firefox': 'Firefox', 'org.mozilla.firefox': 'Firefox', 'com.apple.safari': 'Safari',
  'microsoft-edge': 'Edge', 'microsoft/edge': 'Edge', 'com.microsoft.edgemac': 'Edge',
  'bravesoftware': 'Brave', 'com.brave.browser': 'Brave', 'opera': 'Opera', 'vivaldi': 'Vivaldi',
  'code': 'VS Code', 'com.microsoft.vscode': 'VS Code', 'code - insiders': 'VS Code Insiders', 'cursor': 'Cursor',
  'slack': 'Slack', 'com.tinyspeck.slackmacgap': 'Slack', 'discord': 'Discord', 'com.hnc.discord': 'Discord',
  'spotify': 'Spotify', 'com.spotify.client': 'Spotify', 'zoom.us': 'Zoom', 'us.zoom.xos': 'Zoom',
  'telegram desktop': 'Telegram', 'ru.keepcoder.telegram': 'Telegram', 'adobe': 'Adobe', 'microsoft teams': 'Teams',
  'thumbnails': 'Thumbnails', 'fontconfig': 'Font cache', 'mesa_shader_cache': 'Graphics shader cache',
  'nvidia': 'Graphics shader cache', 'tracker3': 'File search index', 'gstreamer-1.0': 'GStreamer',
};
// Chromium/Electron cache subfolders of an app's data dir
// rows that are not apps get their own sentence
const WHY = { 'Thumbnails': 'Picture previews, redrawn when you next open the folder.',
  'Font cache': 'Rebuilt automatically the next time an app loads fonts.',
  'Graphics shader cache': 'Rebuilt automatically the next time an app draws on screen.',
  'File search index': 'Rebuilt automatically by the file search indexer.' };
const ELECTRON = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'component_crx_cache',
  path.join('Service Worker', 'CacheStorage'), path.join('Service Worker', 'ScriptCache'), path.join('Crashpad', 'completed')];
const WIN_CACHE = new Set(['Cache', 'Code Cache', 'GPUCache', 'CacheStorage', 'cache2']);   // cache2: Firefox
const MODEL_STORE = /huggingface|ms-playwright|lm-?studio|torch|whisper|gpt4all/i;
const INSTALLER = /\.(dmg|pkg|exe|msi|deb|rpm|appimage)$/i;
// Never-touch names: sign-in, passwords, iCloud, security agents, core OS UI.
// Their "cache" can hold tokens, so clearing it signs you out or trips device management.
const KEEP = /account|appleid|authkit|authentication|authorization|identityservice|keychain|passkit|1password|agilebits|bitwarden|lastpass|dashlane|keepass|authy|yubico|icloud|itunescloud|screentime|cloudkit|familycircle|inputmethod|containermanagerd|crowdstrike|sentinelone|sentinel-labs|com\.eset\.|jamf|paloaltonetworks|anyconnect|secureclient|passwords|homekit|com\.apple\.(akd|home|homed|tcc|sharedfilelist)$|addressbook|callhistory|mobilesync|diagnosticreportsfornewhardware|com\.apple\.(finder|dock|controlcenter|systempreferences|settings|systemsettings)/i;
const GB = 1024 ** 3, MB = 1024 ** 2;

// com.tinyspeck.slackmacgap -> Slackmacgap, google-chrome -> Google chrome
const friendly = (...segs) => {
  const k = segs.slice(0, 2).join('/').toLowerCase();
  if (NAMES[k]) return NAMES[k];
  const n = segs[0];
  if (NAMES[n.toLowerCase()]) return NAMES[n.toLowerCase()];
  const s = /^[a-z]{2,}\.[\w-]+\.[\w.-]+$/i.test(n) ? n.split('.').pop() : n.replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const ls = async d => (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).map(e => ({ e, p: path.join(d, e.name) }));
const exists = p => fs.lstat(p).then(s => s, () => null);
const inside = (p, d) => p === d || p.startsWith(d + path.sep);

async function scan(ctx) {
  const { platform, home, env = {}, signal } = ctx;
  if (!['linux', 'darwin', 'win32'].includes(platform)) return [];
  const h = (...p) => path.join(home, ...p);
  const skip = [...await devtools.claims?.(ctx) || [], ...await largefiles.claims?.(ctx) || [], ...ctx.settings?.exclusions || []];
  const ok = (p, contentsOnly) => !skip.some(x => inside(p, x) || inside(x, p)) && !guard(p, { home, contentsOnly });

  const apps = new Map();   // friendly name -> [paths]
  const linked = new Set();  // paths listed through a symlinked cache root
  const add = (name, p) => { if (ok(p) && !KEEP.test(path.relative(home, p))) apps.set(name, [...apps.get(name) || [], p]); };
  const rows = [];          // fully-formed system junk rows (size filled below)
  const junk = (name, paths, extra) => {
    paths = paths.filter(p => ok(p, extra.action === 'contents'));
    if (paths.length) rows.push({ group: 'System junk', name, paths, safety: 'safe', action: 'trash', ...extra });
  };

  // per-app cache folders
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || h('AppData', 'Local');
    const sys = [path.join(local, 'Temp'), path.join(local, 'CrashDumps')];
    // note: depth 7 reaches Chrome's User Data/Default/Service Worker/CacheStorage; deeper caches are missed
    await ctx.walk(local, (p, e, s) => {
      if (!s.isDirectory() || sys.includes(p) || skip.some(x => inside(p, x))) return false;   // a claim deeper down must not stop the walk above it
      if (!WIN_CACHE.has(e.name)) return;
      add(friendly(...path.relative(local, p).split(path.sep)), p);
      return false;
    }, { depth: 7 });
    junk('Temporary files', [sys[0]], { action: 'contents', why: 'Leftovers from installers and apps.' });
    junk('Crash dumps', [sys[1]], { action: 'contents', why: 'Memory dumps from apps that crashed.' });
  } else {
    // an XDG_CACHE_HOME that is home itself (or outside it) would turn ~/projects into an "app cache"
    const c = env.XDG_CACHE_HOME, rel = c && path.relative(home, c);
    const root = platform === 'darwin' ? h('Library', 'Caches') : rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? c : h('.cache');
    // a symlinked root (~/.cache -> ~ or a data disk) may list real folders: never Safe, never one-click
    const link = (await exists(root))?.isSymbolicLink();
    for (const { e, p } of await ls(root)) if (e.isDirectory()) { add(friendly(e.name), p); if (link) linked.add(p); }
  }

  // Electron/Chromium caches inside each app's data dir (never the dir itself)
  const data = { linux: env.XDG_CONFIG_HOME || h('.config'), darwin: h('Library', 'Application Support'),
    win32: env.APPDATA || h('AppData', 'Roaming') }[platform];
  for (const { e, p } of await ls(data)) {
    if (signal?.aborted) return [];
    if (!e.isDirectory() || /^cleanzy$/i.test(e.name)) continue;   // our own cache is in use
    for (const sub of ELECTRON) if ((await exists(path.join(p, sub)))?.isDirectory()) add(friendly(e.name), path.join(p, sub));
  }
  // big media caches that live outside the usual cache roots
  const roam = (...p) => path.join(env.APPDATA || h('AppData', 'Roaming'), ...p), MEDIA = ['Media Cache Files', 'Media Cache'];
  const EXTRA = { Telegram: { linux: [h('.local', 'share', 'TelegramDesktop', 'tdata', 'user_data')], win32: [roam('Telegram Desktop', 'tdata', 'user_data')] },
    Adobe: { darwin: MEDIA.map(n => h('Library', 'Application Support', 'Adobe', 'Common', n)), win32: MEDIA.map(n => roam('Adobe', 'Common', n)) } };
  for (const [name, by] of Object.entries(EXTRA)) for (const p of by[platform] || []) if ((await exists(p))?.isDirectory()) add(name, p);
  // sandboxed Linux apps keep their own cache: ~/snap/<app>/common/.cache, ~/.var/app/<id>/cache (Flatpak)
  if (platform === 'linux') for (const [root, tail] of [[h('snap'), ['common', '.cache']], [h('.var', 'app'), ['cache']]])
    for (const { e, p } of await ls(root)) if (e.isDirectory() && (await exists(path.join(p, ...tail)))?.isDirectory()) add(friendly(e.name), path.join(p, ...tail));

  // system junk
  if (platform === 'darwin') {
    const logs = h('Library', 'Logs'), diag = path.join(logs, 'DiagnosticReports');
    junk('Logs', (await ls(logs)).map(x => x.p).filter(p => p !== diag), { why: 'Old diagnostic logs apps wrote while running.' });
    junk('Crash reports', [diag], { action: 'contents', why: 'Reports from apps that crashed. Nothing reads them later.' });
    junk('iPhone / iPad software updates', ['iPhone', 'iPad', 'iPod'].map(d => h('Library', 'iTunes', d + ' Software Updates')),
      { why: 'Firmware Finder downloaded to update a device. Downloaded again when needed.' });
    junk('Message previews', [h('Library', 'Messages', 'Caches', 'Previews')], { why: 'Link and attachment thumbnails. Messages redraws them.' });
    junk('Video editor render cache', [h('Movies', 'CacheClip')], { why: 'Render cache from DaVinci Resolve. Rendered again when needed.' });
    junk('Aerial wallpaper videos', [h('Library', 'Application Support', 'com.apple.wallpaper', 'aerials', 'videos')],
      { safety: 'check', why: 'Screen saver videos. Downloaded again when shown, a few GB each.' });
    junk('Mail downloads', [h('Library', 'Containers', 'com.apple.mail', 'Data', 'Library', 'Mail Downloads')],
      { safety: 'check', pre: false, why: 'Attachments you opened from Mail. They stay in the emails. Quit Mail first.' });
  }
  if (platform === 'linux') {
    const uid = process.getuid?.();
    const mine = [];
    for (const { e, p } of await ls('/var/crash')) if (e.isFile() && (await exists(p))?.uid === uid) mine.push(p);
    junk('Crash reports', mine, { why: 'Reports from apps that crashed. Nothing reads them later.' });
    junk('Old session log', [h('.xsession-errors.old')], { why: 'Desktop session log from your last login. Nothing reads it later.' });
  }
  for (const { e, p } of await ls(h('Downloads'))) {
    // a download the browser never finished; a folder named x.part is the user's, not a download
    if ((e.isFile() && /\.(crdownload|part|partial|opdownload|prlupd-part)$/i.test(e.name)) || (e.isDirectory() && /\.download$/i.test(e.name) && platform === 'darwin'))
      junk(e.name, [p], { group: 'Unfinished downloads', safety: 'check', pre: false, trashOnly: true,
        why: 'A download that never finished. Check the browser is not still downloading it.' });
    if (e.isFile() && INSTALLER.test(e.name))
      junk(e.name, [p], { group: 'Installers', safety: 'check', trashOnly: true, why: 'Installer — you can download it again.' });
  }

  for (const [name, paths] of apps) rows.push({ group: 'Apps', name, paths, safety: 'safe', action: 'trash',
    why: WHY[name] || `Rebuilt automatically the next time ${name} runs.` });

  const out = [];
  for (const r of rows) {
    if (signal?.aborted) return out;
    let size = 0, mtime = 0, own = 0;
    for (const p of r.paths) {
      const st = await exists(p);
      size += await ctx.dirSize(p, ctx);
      mtime = Math.max(mtime, st?.mtimeMs || 0);
      if (st?.isDirectory()) own += st.blocks ? st.blocks * 512 : st.size;
    }
    if (size <= own) continue;   // empty: nothing but the folders themselves
    const base = r.paths.map(p => path.basename(p)).join(' ');
    if (r.group === 'Apps' && (MODEL_STORE.test(base) || (size > 5 * GB && /models/i.test(base))))
      Object.assign(r, { safety: 'check', why: 'Nothing is lost, but it costs a re-download.' });
    if (r.paths.some(p => linked.has(p)))
      Object.assign(r, { safety: 'check', pre: false, why: 'Your cache folder is a link to another place. Check this really is a cache.' });
    // GPU apps (Cleanzy too) rewrite a small shader cache at once: not worth a one-click clean
    if (r.name === 'Graphics shader cache' && size < 5 * MB) r.pre = false;
    out.push({ id: 'caches:' + r.paths[0], module: 'caches', ...r, size, mtime: Math.round(mtime) });
  }
  if (platform === 'linux') out.push(...await linuxCmds(ctx));
  return out;
}

// apt archives, journal over 100 MB, disabled snap revisions: password-only, never preselected
async function linuxCmds(ctx, statSize) {
  const out = [];
  const item = (key, name, paths, size, cmd, why) => size > 0 && out.push({
    id: 'caches:' + key, module: 'caches', group: 'System junk', name, paths, size, mtime: 0,
    safety: 'check', why, action: 'cmd', cmd, pre: false });
  const apt = await ctx.run('du', ['-s', '--block-size=1', '/var/cache/apt/archives']).catch(() => null);
  if (apt) item(   // du exits 1 on the root-only partial/ dir but still prints the total
    'aptClean', 'Downloaded packages (apt)', ['/var/cache/apt/archives'],
    parseInt(apt.out, 10) || 0, { id: 'aptClean', args: [] }, 'Removed with apt clean. Downloaded again when needed.');
  const j = await ctx.run('journalctl', ['--disk-usage']).catch(() => null);
  if (j?.code === 0) item('journal', 'System journal over 100 MB', ['/var/log/journal'],
    parseJournal(j.out + j.err) - 100 * MB, { id: 'journal', args: [] }, 'Old system logs. The newest 100 MB are kept.');
  const s = await ctx.run('snap', ['list', '--all']).catch(() => null);
  if (s?.code === 0) for (const a of snapApps(s.out, statSize)) if (a.stale) {
    const [name, rev] = a.id.split(':');
    item(`snap:${name}:${rev}`, a.name, [path.join('/var/lib/snapd/snaps', `${name}_${rev}.snap`)],
      a.size, { id: 'snapRev', args: [name, rev] }, 'An older version snap keeps to roll back to.');
  }
  return out;
}

module.exports = { scan, friendly, linuxCmds, NAMES };
