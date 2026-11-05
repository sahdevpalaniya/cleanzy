// Shared filesystem walkers. Pure Node so they run the same on Linux, macOS and
// Windows. None follows a symlink or crosses onto another filesystem.
const fs = require('fs/promises');
const path = require('path');

// bytes of one stat; a hard-linked inode is counted once per walk
const counter = () => {
  const seen = new Set();
  return s => {
    if (s.nlink > 1 && !s.isDirectory()) {
      const k = s.dev + ':' + s.ino;
      if (seen.has(k)) return 0;
      seen.add(k);
    }
    return s.blocks ? s.blocks * 512 : s.size;   // Windows has no st_blocks
  };
};

// lstat every entry of dir in parallel -> [[fullPath, dirent, stat]]
async function list(dir, hidden) {
  const ents = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(e => hidden || !e.name.startsWith('.'));
  const sts = await Promise.all(ents.map(e => fs.lstat(path.join(dir, e.name)).catch(() => null)));
  return ents.map((e, i) => [path.join(dir, e.name), e, sts[i]]).filter(r => r[2]);
}

// visit(fullPath, dirent, stat, depth) for everything below root; children of
// root have depth 1. Returning false from visit skips that directory's contents.
async function walk(root, visit, { depth = Infinity, signal, hidden = false } = {}) {
  const st = await fs.lstat(root).catch(() => null);
  if (!st?.isDirectory()) return;
  const go = async (dir, d) => {
    for (const [p, e, s] of await list(dir, hidden)) {
      if (signal?.aborted) return;
      const r = await visit(p, e, s, d);
      if (r !== false && s.isDirectory() && s.dev === st.dev && d < depth) await go(p, d + 1);
    }
  };
  await go(root, 1);
}

// Allocated bytes under p, like `du -sx`. Never throws.
async function dirSize(p, signal) {
  const st = await fs.lstat(p).catch(() => null);
  if (!st) return 0;
  const bytes = counter();
  let total = bytes(st);
  if (st.isDirectory()) await walk(p, (_p, _e, s) => {
    if (s.dev !== st.dev) return false;
    total += bytes(s);
  }, { signal, hidden: true });
  return total;
}

// Portable stand-in for `du -x`: Map(dir -> cumulative bytes incl. the dir's own
// blocks), same shape tree.js gets from parseDu.
async function duMap(root, signal) {
  const map = new Map(), bytes = counter();
  const st = await fs.lstat(root).catch(() => null);
  if (!st?.isDirectory()) return map;
  const go = async (dir, own) => {
    let total = own;
    for (const [p, , s] of await list(dir, true)) {
      if (signal?.aborted) break;
      if (s.dev !== st.dev) continue;
      total += s.isDirectory() ? await go(p, bytes(s)) : bytes(s);
    }
    map.set(dir, total);
    return total;
  };
  await go(root, bytes(st));
  return map;
}

// note: keeps every file in memory then sorts; use a bounded heap if a scan ever OOMs.
async function largestFiles(root, n = 100, signal) {
  const out = [];
  await walk(root, (p, _e, s) => { if (s.isFile()) out.push({ path: p, size: s.blocks ? s.blocks * 512 : s.size }); },
    { hidden: true, signal });
  return out.sort((a, b) => b.size - a.size).slice(0, n);
}

module.exports = { dirSize, duMap, largestFiles, walk };
