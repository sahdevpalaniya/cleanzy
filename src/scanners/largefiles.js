// Large Files: big files in the user's own folders, byte-identical duplicates and
// local AI models (Ollama, LM Studio). Everything here is the user's own data, so
// every row is Check First, never preselected, and only ever goes to the Trash.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MIN = 5 << 20;
const MB = 1 << 20, GB = 1 << 30;
const CATS = { videos: 'Videos', audio: 'Audio', images: 'Images', pdfs: 'PDFs', archives: 'Archives',
  documents: 'Documents', models: 'AI models', other: 'Other' };
const EXT = {
  videos: 'mp4 m4v mov mkv avi wmv flv webm mpg mpeg 3gp mts m2ts vob',
  audio: 'mp3 m4a aac wav flac aif aiff ogg opus wma',
  images: 'jpg jpeg png gif heic heif tif tiff bmp webp psd raw cr2 cr3 nef arw dng',
  pdfs: 'pdf',
  archives: 'zip rar 7z tar gz tgz bz2 xz zst dmg iso img pkg deb rpm msi exe appimage cab',
  documents: 'doc docx xls xlsx ppt pptx key pages numbers odt ods odp rtf txt csv epub',
  models: 'gguf safetensors ckpt',
};
const BY_EXT = Object.fromEntries(Object.entries(EXT).flatMap(([c, s]) => s.split(' ').map(e => [e, c])));
// project dependency folders and managed libraries: never look inside
const SKIP = new Set(['node_modules', 'venv', '.venv', 'target', 'Pods', 'Photos Library', 'iPhoto Library']);
const SKIP_EXT = /\.(photoslibrary|musiclibrary|tvlibrary|lrdata|app)$/i;
const MODEL_FILE = /\.(gguf|safetensors|ckpt|bin)$/i;

function category(p, size) {
  const c = BY_EXT[path.extname(p).slice(1).toLowerCase()];
  if (c) return c;
  if (/\.bin$/i.test(p) && size > GB && p.split(path.sep).some(s => /^models?$/i.test(s))) return 'models';
  return 'other';
}

const userDirs = platform => ['Documents', 'Desktop', 'Downloads', platform === 'darwin' ? 'Movies' : 'Videos', 'Music', 'Pictures'];
const inside = (p, d) => p === d || p.startsWith(d + path.sep);
const bytes = s => s.blocks ? s.blocks * 512 : s.size;
const ollamaDir = ctx => ctx.env?.OLLAMA_MODELS || path.join(ctx.home, '.ollama', 'models');
const lmDirs = ctx => [path.join(ctx.home, '.lmstudio', 'models'), path.join(ctx.home, '.cache', 'lm-studio')];
const claims = ctx => [ollamaDir(ctx), ...lmDirs(ctx)];

const WHY = 'Your own file. It goes to the Trash, so you can put it back.';

async function files(ctx) {
  const out = [], ex = ctx.settings?.exclusions || [];
  for (const d of userDirs(ctx.platform)) {
    await ctx.walk(path.join(ctx.home, d), (p, e, s) => {
      if (ex.some(x => inside(p, x))) return false;
      if (s.isDirectory()) { if (SKIP.has(e.name) || SKIP_EXT.test(e.name)) return false; return; }
      if (!s.isFile() || s.size < MIN) return;
      if (d === 'Downloads' && path.dirname(p) === path.join(ctx.home, d) && /\.(dmg|pkg|exe|msi|deb|rpm|appimage)$/i.test(e.name)) return;   // App Caches lists these as old installers
      const cat = category(p, s.size);
      out.push({ id: 'largefiles:' + p, module: 'largefiles', group: CATS[cat], name: e.name, paths: [p],
        size: bytes(s), mtime: s.mtimeMs, safety: 'check', why: WHY, action: 'trash', trashOnly: true, pre: false,
        meta: { kind: 'file', cat, dir: path.relative(ctx.home, path.dirname(p)), atime: s.atimeMs, bytes: s.size, ino: s.dev + ':' + s.ino } });
    });
  }
  return out;
}

// One row per Ollama model tag. A blob another tag also uses stays behind, so
// the row's size and paths count only what removing this tag really frees.
async function ollama(ctx) {
  const root = ollamaDir(ctx), mans = [];
  await ctx.walk(path.join(root, 'manifests'), async (p, _e, s) => {
    if (!s.isFile()) return;
    let j; try { j = JSON.parse(await fs.readFile(p, 'utf8')); } catch { return; }   // .DS_Store, half-pulled manifest
    const digests = j && [j.config, ...(j.layers || [])].map(l => l?.digest).filter(d => /^sha256:[0-9a-f]+$/.test(d || ''));
    if (digests?.length) mans.push({ p, s, digests: [...new Set(digests)] });
  }, { hidden: true });
  const uses = new Map();
  for (const m of mans) for (const d of m.digests) uses.set(d, (uses.get(d) || 0) + 1);
  const out = [];
  for (const m of mans) {
    const parts = path.relative(path.join(root, 'manifests'), m.p).split(path.sep);   // host/ns/model/tag
    const name = (parts.slice(0, -1).join('/') + ':' + parts.at(-1)).replace(/^registry\.ollama\.ai\/(library\/)?/, '');
    const paths = [m.p];
    let size = bytes(m.s), shared = 0;
    for (const d of m.digests) {
      const b = path.join(root, 'blobs', d.replace(':', '-'));
      const st = await fs.lstat(b).catch(() => null);
      if (!st) continue;
      if (uses.get(d) > 1) { shared += bytes(st); continue; }
      paths.push(b); size += bytes(st);
    }
    out.push({ id: 'largefiles:' + m.p, module: 'largefiles', group: CATS.models, name, paths, size, mtime: m.s.mtimeMs,
      safety: 'check', action: 'trash', trashOnly: true, pre: false, restore: `ollama pull ${name}`,
      why: 'Ollama model. Download it again with ollama pull.' + (shared ? ` Layers shared with another model stay (${shared >= GB ? (shared / GB).toFixed(1) + ' GB' : Math.round(shared / MB) + ' MB'}).` : ''),
      meta: { kind: 'ollama', cat: 'models', dir: path.relative(ctx.home, root) } });
  }
  return out;
}

// One row per LM Studio model folder (publisher/model): the folder that holds model files.
async function lmstudio(ctx) {
  const dirs = new Set();
  for (const r of lmDirs(ctx))
    await ctx.walk(r, (p, _e, s) => { if (s.isFile() && MODEL_FILE.test(p)) dirs.add(path.dirname(p)); }, { hidden: true, depth: 5 });
  const roots = [...dirs].sort((a, b) => a.length - b.length).filter((d, i, a) => !a.slice(0, i).some(o => inside(d, o)) && !lmDirs(ctx).includes(d));
  const out = [];
  for (const d of roots) {
    const st = await fs.lstat(d).catch(() => null);   // removed mid-scan
    if (!st) continue;
    out.push({ id: 'largefiles:' + d, module: 'largefiles', group: CATS.models,
      name: path.relative(lmDirs(ctx).find(r => inside(d, r)), d).split(path.sep).filter(s => s !== 'models').join('/'),
      paths: [d], size: await ctx.dirSize(d, ctx), mtime: st.mtimeMs, safety: 'check', action: 'trash', trashOnly: true, pre: false,
      why: 'LM Studio model. Download it again from LM Studio.', meta: { kind: 'lmstudio', cat: 'models', dir: path.relative(ctx.home, path.dirname(d)) } });
  }
  return out;
}

async function sha1(p, len) {
  const h = crypto.createHash('sha1');
  for await (const c of require('fs').createReadStream(p, len ? { end: len - 1 } : {})) h.update(c);
  return h.digest('hex');
}

// Byte-identical files: same size, then same sha1 of the first 64 KB, then same full sha1.
// Hard links to one inode count once. Sets meta.dupKey and meta.copies on each copy.
async function dupes(items, signal) {
  const by = async (list, key) => {
    const m = new Map();
    for (const i of list) {
      if (signal?.aborted) return [];
      const k = await key(i).catch(() => null);
      if (k != null) m.has(k) ? m.get(k).push(i) : m.set(k, [i]);
    }
    return [...m].filter(([, g]) => g.length > 1);
  };
  const seen = new Set();
  const fl = items.filter(i => i.meta?.kind === 'file' && i.meta.bytes >= MIN && !seen.has(i.meta.ino) && seen.add(i.meta.ino));
  for (const [, g] of await by(fl, async i => i.meta.bytes))
    for (const [, g2] of await by(g, i => sha1(i.paths[0], 64 << 10)))
      for (const [h, g3] of await by(g2, i => sha1(i.paths[0])))
        for (const i of g3) Object.assign(i.meta, { dupKey: h, copies: g3.length });
  return items;
}

async function scan(ctx) {
  const items = [...await files(ctx), ...await ollama(ctx), ...await lmstudio(ctx)];
  return dupes(items, ctx.signal);
}

module.exports = { scan, claims, handlers: {}, category, dupes, userDirs, CATS };
