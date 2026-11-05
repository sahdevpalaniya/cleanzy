// Installed applications, what they cost on disk, and how to remove them.
// Pure parsers only: everything here reads command output or files. Removal lives
// in src/scanners/uninstaller.js and runs through sys.sudo with the password the app collected.
const fs = require('fs');
const path = require('path');

const SNAP_DIR = '/var/lib/snapd/snaps';

function aptApps(dpkgOut, manualOut) {
  const manual = new Set(manualOut.split('\n').map(s => s.trim()).filter(Boolean));
  const out = [];
  for (const line of dpkgOut.split('\n')) {
    const [name, kb, priority, essential, summary] = line.split('\t');
    if (!name) continue;
    // Only things a person chose to install. The other ~2000 entries are
    // libraries pulled in as dependencies; listing them is noise, and removing
    // one by hand is how you break a desktop.
    if (!manual.has(name)) continue;
    const locked = essential === 'yes' ? 'essential system package'
      : /^(required|important)$/.test(priority) ? `priority: ${priority}`
      : null;
    out.push({ kind: 'apt', id: name, key: 'apt:' + name, name, size: (+kb || 0) * 1024,
               detail: summary || '', locked });
  }
  return out;
}

// `snap list --all` also lists superseded revisions that still sit on disk —
// usually the single biggest easy win on an Ubuntu box.
function snapApps(listOut, statSize = p => { try { return fs.statSync(p).size } catch { return 0 } }) {
  const lines = listOut.split('\n').slice(1);
  const out = [];
  for (const l of lines) {
    const f = l.trim().split(/\s+/);
    if (f.length < 5) continue;
    const [name, version, rev] = f;
    const notes = f.slice(5).join(' ');
    const disabled = /disabled/.test(notes);
    const size = statSize(path.join(SNAP_DIR, `${name}_${rev}.snap`));
    out.push({ kind: 'snap', id: disabled ? `${name}:${rev}` : name,
               key: `snap:${name}:${disabled ? rev : 'current'}`,
               name: disabled ? `${name} (old revision ${rev})` : name,
               size, detail: disabled ? 'superseded revision, safe to drop' : `version ${version}`,
               stale: disabled,
               locked: /base|snapd$/.test(notes) || name === 'snapd' ? 'required by other snaps' : null });
  }
  return out;
}

// "After this operation, 123 MB disk space will be freed."
function parseFreed(aptOut) {
  const m = /After this operation, ([\d.,]+) ([kMGT]?B) .*?(freed|used)/i.exec(aptOut);
  if (!m) return 0;
  const mult = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2]] || 1;
  const n = parseFloat(m[1].replace(/,/g, '')) * mult;
  return m[3].toLowerCase() === 'freed' ? n : -n;
}

function parseRemoved(aptOut) {
  const m = /The following packages will be REMOVED:?\n([\s\S]*?)\n(?=\w|\d+ upgraded)/i.exec(aptOut);
  return m ? m[1].trim().split(/\s+/).map(p => p.replace(/\*$/, '')).filter(Boolean) : [];   // --purge marks names with *
}


// ── desktop entries + icons ──────────────────────────────────────────
// Apps look like apps when they carry their own icon. Ubuntu publishes both in
// .desktop files, and snapd mirrors snap ones into its own applications dir.
// Flatpak exports its .desktop files and icons per installation (system + user).
const desktopDirs = home => ['/usr/share/applications', '/var/lib/snapd/desktop/applications',
  '/usr/local/share/applications', '/var/lib/flatpak/exports/share/applications',
  path.join(home, '.local/share/flatpak/exports/share/applications'), path.join(home, '.local/share/applications')];
const iconDirs = home => ['/usr/share/icons/hicolor', '/usr/share/icons/Yaru', '/usr/share/icons/Adwaita',
  '/var/lib/flatpak/exports/share/icons/hicolor', path.join(home, '.local/share/flatpak/exports/share/icons/hicolor'),
  path.join(home, '.local/share/icons/hicolor')];
const ICON_SIZES = ['scalable', '512x512', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32'];
const ICON_EXT = ['.svg', '.png', '.xpm'];

function parseDesktop(text) {
  const entry = {};
  let inMain = false;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l.startsWith('[')) { inMain = l === '[Desktop Entry]'; continue; }
    if (!inMain) continue;
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim(), v = l.slice(eq + 1).trim();
    if (!(k in entry)) entry[k] = v;            // first wins; ignores Name[xx] locales
  }
  return { name: entry.Name || '', icon: entry.Icon || '',
           exec: (entry.Exec || '').split(/\s+/)[0].split('/').pop(),
           hidden: entry.NoDisplay === 'true' || entry.Hidden === 'true' };
}

function resolveIcon(icon, exists = p => { try { return fs.statSync(p).isFile() } catch { return false } }, dirs = iconDirs(process.env.HOME || '')) {
  if (!icon) return null;
  if (icon.startsWith('/')) return exists(icon) ? icon : null;
  for (const ext of ICON_EXT) {
    const px = `/usr/share/pixmaps/${icon}${ext}`;
    if (exists(px)) return px;
  }
  for (const dir of dirs)
    for (const size of ICON_SIZES)
      for (const ext of ICON_EXT) {
        const p = `${dir}/${size}/apps/${icon}${ext}`;
        if (exists(p)) return p;
      }
  return null;
}

// Match a package/snap to its desktop entry: snaps are prefixed `<snap>_`,
// apt packages usually name the file or the binary after themselves.
function matchEntry(app, entries) {
  const id = app.id.split(':')[0];
  if (app.kind === 'snap')
    return entries.find(e => e.file.startsWith(id + '_')) || entries.find(e => e.pkg === id);
  if (app.kind === 'flatpak') return entries.find(e => e.file === id + '.desktop');
  return entries.find(e => e.pkg === id)
      || entries.find(e => e.file === id + '.desktop')
      || entries.find(e => e.exec === id)
      || entries.find(e => e.name.toLowerCase() === id.toLowerCase());
}

// "Archived and active journals take up 1.2G in the file system."
function parseJournal(out) {
  const m = /take up ([\d.]+)([BKMGT])/i.exec(out);
  return m ? Math.round(parseFloat(m[1]) * 1024 ** 'BKMGT'.indexOf(m[2].toUpperCase())) : 0;
}

// `flatpak list --app --columns=application,name,size,installation` (tab separated; size is "1.2 GB")
function parseFlatpak(out) {
  const U = { B: 1, BYTES: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return out.split('\n').map(l => l.split('\t')).filter(f => f.length >= 4 && /^[\w.-]+$/.test(f[0])).map(([id, name, size, inst]) => {
    const m = /([\d.,]+)\s*([kMGT]?B|bytes)/i.exec(size.replace(/\u00a0/g, ' '));
    return { kind: 'flatpak', id, name: name.trim() || id, installation: inst.trim() === 'user' ? 'user' : 'system',
             size: m ? Math.round(parseFloat(m[1].replace(',', '.')) * (U[m[2].toUpperCase()] || 1)) : 0 };
  });
}

// `reg query <Uninstall key> /s`: one block per subkey, "    Name    REG_TYPE    Value" lines.
// Hidden updates/components and entries without a name or uninstaller are not apps.
function parseReg(out) {
  const apps = [];
  let cur = null;
  const flush = () => {
    const v = cur?.v;
    if (v && v.DisplayName && v.UninstallString && v.SystemComponent !== '0x1' && !v.ParentKeyName) apps.push({
      key: cur.key, name: v.DisplayName, size: (parseInt(v.EstimatedSize, 16) || 0) * 1024, publisher: v.Publisher || '',
      uninstallString: v.UninstallString, quietUninstallString: v.QuietUninstallString || '', installLocation: v.InstallLocation || '' });
  };
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { flush(); cur = { key: line.trim(), v: {} }; continue; }
    const m = /^\s+(\S.*?)\s{4}(REG_\w+)(?:\s{4}(.*))?$/.exec(line);
    if (m && cur) cur.v[m[1]] = (m[3] || '').trim();
  }
  flush();
  return apps;
}

// CFBundleIdentifier / CFBundleName out of an XML Info.plist.
function plistXml(text) {
  const get = k => (new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(text) || [])[1] || '';
  return { id: get('CFBundleIdentifier'), name: get('CFBundleDisplayName') || get('CFBundleName') };
}

// The reverse-DNS bundle id inside a ~/Library entry name, or ''.
// "com.foo.Bar.plist" / "com.foo.Bar.savedState" / "TEAMID1234.com.foo.Bar" / "group.com.foo" -> com.foo.bar
function libId(name) {
  const s = name.replace(/\.(plist|savedState|binarycookies|lockfile)$/i, '').replace(/^([A-Z0-9]{10}\.|group\.)/, '');
  return /^[a-z][\w-]*\.[\w-]+\.[\w.-]+$/i.test(s) ? s.toLowerCase() : '';
}

module.exports = { parseJournal, aptApps, snapApps, parseFreed, parseRemoved, parseDesktop, resolveIcon,
                   matchEntry, parseFlatpak, parseReg, plistXml, libId, desktopDirs, iconDirs, SNAP_DIR };
