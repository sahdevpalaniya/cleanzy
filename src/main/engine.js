// The one path for module-initiated deletes. Only items a scan produced (and
// main remembered) can be cleaned; anything else is "skipped for safety".
const fs = require('fs/promises');
const path = require('path');
const { guard, real } = require('./safety');
const { dirSize } = require('./junk');
const { lastTouched } = require('../scanners/devtools');

const known = new Map();   // id -> Item

const isItem = i => i && typeof i.id === 'string' && Array.isArray(i.paths);
// scan results replace a module's entries, handler results add to them
function remember(key, items, replace) {
  if (replace) for (const id of known.keys()) if (id.startsWith(key + ':')) known.delete(id);
  const kept = (items || []).filter(i => isItem(i) && i.id.startsWith(key + ':'));
  for (const i of kept) known.set(i.id, { ...i, module: key });
  return kept;
}

const NAME = /^[a-z0-9-]+$/, REV = /^\d+$/;
// docker ids and refs: never a leading '-', so nothing reads as an option
const DID = /^[0-9a-f]{12,64}$/, REF = /^[\w][\w.\/:@-]*$/;
const CMDS = {
  aptClean: () => ['apt-get', 'clean'],
  journal: () => ['journalctl', '--vacuum-size=100M'],
  snapRev: (name, rev) => NAME.test(name) && REV.test(String(rev)) ? ['snap', 'remove', '--revision', String(rev), name] : null,
  simctl: () => ['xcrun', 'simctl', 'delete', 'unavailable'],
  dockerBuild: () => ['docker', 'builder', 'prune', '-a', '-f'],
  dockerRm: id => DID.test(id) ? ['docker', 'rm', id] : null,                 // no -f: a running container stays
  dockerRmi: (...r) => r.length && r.every(x => REF.test(x)) ? ['docker', 'rmi', ...r] : null,   // no -f: an image in use stays
  dockerVol: (...v) => v.length && v.every(x => REF.test(x)) ? ['docker', 'volume', 'rm', ...v] : null,   // no -f: a mounted volume stays
};
const CMD_TIMEOUT = 5 * 60e3;
const SUDO = new Set(['aptClean', 'journal', 'snapRev']);

// case-insensitive volumes (Windows, macOS default) compare lower-case
const low = s => process.platform === 'linux' ? s : s.toLowerCase();
const inside = (p, d) => (p = low(p), d = low(d), p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep));
const last = s => (s || '').trim().split('\n').filter(Boolean).pop() || 'failed';

async function clean(ids, { mode = 'trash', password, safeOnly = false, scheduled = false } = {},
                     { trash, run, sudo, exclusions = [], home, addHistory, progress } = {}) {
  const res = { freed: 0, trashed: 0, count: 0, errors: [] }, done = [], cleaned = [];
  const err = (p, msg) => res.errors.push({ path: p, msg });
  // an exclusion protects itself and everything below it, so neither it nor a parent of it goes
  exclusions = (Array.isArray(exclusions) ? exclusions : []).filter(x => typeof x === 'string' && x);
  const excluded = p => exclusions.some(x => inside(p, x) || inside(x, p));
  ids = ids || [];
  for (const [n, id] of ids.entries()) {
    const item = known.get(id);
    progress?.(n, ids.length, item?.name);
    if (!item) { err(String(id), 'skipped for safety (not from a scan)'); continue; }
    if (safeOnly && (item.safety !== 'safe' || item.pre === false)) continue;
    if (item.action === 'pkg') { err(item.name, 'remove this from its own tab'); continue; }
    let acted = false;
    if (item.action === 'cmd') {
      const argv = Object.hasOwn(CMDS, item.cmd?.id) && CMDS[item.cmd.id](...(item.cmd.args || []));
      if (!argv) { err(item.name, 'skipped for safety (unknown command)'); continue; }
      let r;
      if (SUDO.has(item.cmd.id)) {
        if (!password) { err(item.name, 'needs password'); continue; }
        r = await sudo(password, argv);
      } else r = await run(argv[0], argv.slice(1), { timeout: CMD_TIMEOUT });   // a stuck daemon must not hold the clean queue forever
      if (r.code) { err(item.name, last(r.err)); continue; }
      res.freed += item.size || 0; acted = true;
    } else if (item.action === 'trash' || item.action === 'contents') {
      const contents = item.action === 'contents';
      // the scan is stale if the project changed since: new edits, or uncommitted changes it did not have
      if (item.meta?.kind === 'project' && run) {
        const pr = item.meta.project;
        const dirty = !item.meta.dirty && !!(await run('git', ['--no-optional-locks', '-C', pr, 'status', '--porcelain']).catch(() => null))?.out?.trim();
        if (dirty || await lastTouched(pr) > (item.mtime || 0)) { err(item.name, 'skipped for safety: the project changed since the scan, rescan'); continue; }
      }
      for (const p0 of item.paths) {
        // a symlinked parent (~/.cache -> ~) must be judged, and acted on, where it really points
        const p = await real(p0);
        const no = guard(p0, { contentsOnly: contents, home }) || guard(p, { contentsOnly: contents, home });
        if (no) { err(p, 'skipped for safety: ' + no); continue; }
        if (exclusions.some(x => inside(p, x)) || done.some(d => inside(p, d))) continue;
        const st = await fs.lstat(p).catch(e => e);
        if (st.code === 'ENOENT') continue;
        if (st instanceof Error) { err(p, st.code || st.message); continue; }
        // lstat: a symlink or junction is not a directory, so its target is never emptied
        if (contents && !st.isDirectory()) { err(p, 'skipped for safety: not a real folder'); continue; }
        done.push(p);
        let targets = [p];
        if (contents) {
          try { targets = (await fs.readdir(p)).map(n => path.join(p, n)); }
          catch (e) { err(p, e.code || e.message); continue; }
        }
        for (const t of targets.filter(t => !excluded(t))) {
          const before = await dirSize(t);
          try {
            if (mode === 'trash' || item.trashOnly) { await trash(t); res.trashed += before; }
            else { await fs.rm(t, { recursive: true, force: true }); res.freed += before - await dirSize(t); }
            acted = true;
          } catch (e) { err(t, e.code || e.message || 'could not remove'); }   // in-use files on Windows
        }
      }
    } else { err(item.name, 'skipped for safety (unknown action)'); continue; }
    if (acted) { res.count++; cleaned.push(item); }
  }
  if (res.count) addHistory?.({ at: Date.now(), freed: res.freed, trashed: res.trashed, count: res.count, scheduled,
    items: cleaned.map(i => ({ name: i.name, size: i.size, module: i.module })) });
  for (const i of cleaned) known.delete(i.id);
  return res;
}

module.exports = { known, remember, clean, CMDS, SUDO };
