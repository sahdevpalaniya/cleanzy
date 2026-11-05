// Which deleted-but-open files may be zeroed. Shared by main.js and tests/unit.js so
// the rule that decides "will this close the user's app" is actually tested.
const LOGISH = /(\.log(\.\d+)?$|\.log\b|\/var\/log\/|\/logs?\/|\.out$|\.err$|-slow\.log|journal)/i;
// Truncating a file a process is actively READING or memory-mapping destroys its
// working data and the process dies. Only regular files opened for WRITE that
// look like logs are safe to zero; everything else is listed but never auto-reaped.
const classify = g => {
  if (g.type !== 'REG') return 'unsafe: not a regular file';
  if (!/[wu]$/.test(g.mode)) return 'unsafe: opened read-only, process is reading it';
  if (/^\/(dev\/shm|run|proc|sys)\//.test(g.path) || g.path.startsWith('/memfd:'))
    return 'unsafe: in-memory object, not disk space';
  if (/\.so(\.|$)|\/lib|\/usr\/(bin|lib|share)\//.test(g.path))
    return 'unsafe: deleted binary/library still mapped';
  if (!LOGISH.test(g.path)) return 'risky: scratch/data file — zeroing it may crash ' + g.cmd;
  return 'safe';
};


// Paths that must never be deleted or emptied wholesale, whatever is selected.
// A cleanup tool that can nuke /usr or the whole home directory is a footgun.
const os = require('os');
const path = require('path');
const fsp = require('fs/promises');
const PROTECTED = new Set(['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64',
  '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/usr', '/var', '/opt', '/mnt', '/media', '/snap', '/tmp',
  '/system', '/applications', '/library', '/users', '/private', '/volumes']);   // macOS (compared lower-case)
// one level under these is still the OS or another user (/usr/lib, /etc/ssh, /home/bob).
// /Applications/X.app is not here: the uninstaller moves app bundles to the Trash.
const ONE_LEVEL = /^\/(usr|var|etc|boot|lib|lib64|bin|sbin|opt|srv|system|library|private|home|users)\/[^/]+$/;
// a whole mounted drive is never one item: /mnt/backup, /Volumes/X, /media/<user>/<disk>
const MOUNT = /^\/((mnt|media|volumes)\/[^/]+|(run\/)?media\/[^/]+\/[^/]+)$/;
// relative to the home folder; compared lower-case
const NEVER = {
  exact: ['', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies', 'Videos', 'Library',
    'Library/Application Support', 'Library/Preferences', 'Library/Containers', 'AppData', 'AppData/Local',
    'AppData/Roaming', '.config', '.local', '.local/share'],
  // the subtree and every folder above it (deleting ~/.android would take avd with it)
  tree: ['.ssh', '.gnupg', 'Library/Keychains', 'Library/Mail', 'Library/Application Support/MobileSync',
    '.android/avd', '.android/adbkey*', '.android/debug.keystore', '.flutter', '.password-store',
    '.mozilla', '.thunderbird', '.aws', '.kube'],
};

// -> {win, p}: forward slashes, lower-case, .. and // collapsed; null if not an absolute local path
function norm(p) {
  if (typeof p !== 'string' || !p) return null;
  if (p.startsWith('\\\\?\\')) p = p.slice(4);
  if (/^[\\/]{2}/.test(p)) return null;                   // UNC \\server\share, \\.\device
  const win = /^[A-Za-z]:[\\/]/.test(p);
  if (!win && !p.startsWith('/')) return null;             // relative, C:foo, \foo
  if (win && p.indexOf(':', 2) > 0) return null;           // NTFS stream (Documents::$INDEX_ALLOCATION is Documents)
  // Win32 drops trailing dots/spaces ('Documents.' is Documents)
  const r = win ? path.win32.resolve(p).replace(/\\/g, '/').split('/').map(s => s.replace(/[. ]+$/, '')).join('/') : path.posix.resolve(p);
  return { win, p: r.replace(/(.)\/$/, '$1').toLowerCase() };
}
const within = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : b + '/');
const REAL_HOME = norm(os.homedir())?.p;

// reason string if the path must not be touched, else null
function guard(p, { contentsOnly = false, home = os.homedir() } = {}) {
  const n = norm(p);
  if (!n) return `${p} is not an absolute local path`;
  const w = n.p;
  if (n.win) {
    if (/~\d/.test(w)) return `${p} uses a short 8.3 name; use the full path`;
    // drive roots, top-level folders (C:\Users, C:\Program Files\X) are off limits;
    // under C:\Windows only Temp may be emptied, nothing deleted.
    const parts = w.split('/').filter(Boolean);
    if (parts[1] === 'windows') { if (!(contentsOnly && parts[2] === 'temp')) return `${p} is part of the operating system`; }
    else if (parts.length <= 3) return `${p} is a system location`;
  } else {
    if (PROTECTED.has(w)) return `${p} is a system location`;
    if (MOUNT.test(w)) return `${p} is a whole drive`;
    if (ONE_LEVEL.test(w) || /^\/private\/(var|etc)\/[^/]+$/.test(w)) return `${p} is part of the operating system`;
  }
  if (w === REAL_HOME) return `${p} is your home folder`;
  // other accounts' homes (/home/alice, /Users/alice, C:\Users\alice) get the same protection as ours
  const other = /^(\/home|\/users|[a-z]:\/users)\/[^/]+/.exec(w)?.[0];
  for (const h of new Set([norm(home)?.p, other].filter(Boolean))) {
    const j = r => r ? (h.endsWith('/') ? h : h + '/') + r.toLowerCase() : h;
    if (NEVER.exact.some(r => w === j(r))) return `${p} holds your personal files`;
    for (const r of NEVER.tree) {
      const t = j(r.replace('*', ''));
      if (r.endsWith('*') ? w.startsWith(t) : within(w, t) || within(t, w))
        return `${p} holds keys, mail or tool settings`;
    }
  }
  return null;
}

// guard() compares text: resolve symlinked parents first, so ~/rootlink/etc is checked (and acted on) as /etc
const real = async p => typeof p === 'string' ? path.join(await fsp.realpath(path.dirname(p)).catch(() => path.dirname(p)), path.basename(p)) : p;

module.exports = { classify, LOGISH, guard, real, PROTECTED, NEVER };
