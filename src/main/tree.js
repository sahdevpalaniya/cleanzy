const path = require('path');

// `du -x --block-size=1` output -> Map(path -> bytes). du only lists folders,
// and its sizes are already cumulative.
function parseDu(out) {
  const map = new Map();
  for (const line of out.split('\n')) {
    const i = line.indexOf('\t');
    if (i > 0) map.set(line.slice(i + 1), +line.slice(0, i));
  }
  return map;
}

// Build the folder hierarchy from du output (string) or an already parsed Map.
// du walks children before parents, so one pass gives the whole tree. Files are
// not listed: a folder's own files show up as the gap between its arc and the
// sum of its children's arcs.
function buildTree(out, dir, maxDepth = 9) {
  const sizes = typeof out === 'string' ? parseDu(out) : out;
  if (!sizes.has(dir)) return null;
  const nodes = new Map();
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  for (const [p, size] of sizes)
    if (p === dir || p.startsWith(prefix))
      nodes.set(p, { name: path.basename(p) || p, path: p, size, dir: true, kids: [] });
  const root = nodes.get(dir);
  for (const [p, node] of nodes) if (p !== dir) nodes.get(path.dirname(p))?.kids.push(node);
  // Drop slivers: below 0.1% of the root they are invisible in the chart but
  // dominate the payload (a home dir can hold 100k directories). Opening a
  // folder lists its full contents anyway.
  const floor = Math.max(root.size * 0.001, 512 * 1024);
  (function prune(n, d) {
    n.kids = d >= maxDepth ? [] : n.kids.filter(k => k.size >= floor).sort((a, b) => b.size - a.size);
    n.kids.forEach(k => prune(k, d + 1));
    n.own = n.size - n.kids.reduce((a, k) => a + k.size, 0);  // loose files + pruned slivers
  })(root, 0);
  return root;
}

// After deleting/emptying p, bring the cached sizes up to date without walking
// the disk again: replace everything under p with a fresh `du` of p (empty if
// p is gone) and push the difference up to every ancestor.
function patch(sizes, p, before, fresh) {
  const wasDir = sizes.has(p), prefix = p.endsWith(path.sep) ? p : p + path.sep;
  for (const k of [...sizes.keys()]) if (k === p || k.startsWith(prefix)) sizes.delete(k);
  if (wasDir) for (const [k, v] of fresh) sizes.set(k, v);
  const delta = before - (fresh.get(p) || 0);
  for (let d = path.dirname(p); ; d = path.dirname(d)) {
    if (sizes.has(d)) sizes.set(d, sizes.get(d) - delta);
    if (path.dirname(d) === d) break;
  }
}

module.exports = { buildTree, parseDu, patch };
