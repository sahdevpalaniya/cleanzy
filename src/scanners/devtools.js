// Dev Tools: global tool caches, iOS simulators (mac), project build folders and
// orphaned git worktrees. Every path derives from ctx.home / ctx.env so tests can
// inject a platform over a Linux fixture home.
const fs = require('fs/promises');
const path = require('path');

const DAY = 864e5;

// Global caches. Path keys: a = home (all OSes), u = home (linux+mac), l = home (linux),
// m = home (mac), w = %LOCALAPPDATA%, r = %APPDATA%. One '*' segment is expanded.
// per-IDE JetBrains folders that rebuild themselves; LocalHistory (your undo history) is never one
const JB = ['caches', 'index', 'log', 'tmp', 'jcef_cache'];
const GLOBAL = [
  { name: 'npm cache', safety: 'safe', restore: 'npm install', u: ['.npm/_cacache'], w: ['npm-cache/_cacache'] },
  { name: 'pnpm store', safety: 'safe', restore: 'pnpm install', l: ['.local/share/pnpm/store'], m: ['Library/pnpm/store'], w: ['pnpm/store'] },
  { name: 'Yarn cache', safety: 'safe', restore: 'yarn', a: ['.yarn/berry/cache'], l: ['.cache/yarn'], m: ['Library/Caches/Yarn'], w: ['Yarn/Cache'] },
  { name: 'pip cache', safety: 'safe', restore: 'pip install', l: ['.cache/pip'], m: ['Library/Caches/pip'], w: ['pip/Cache'] },
  { name: 'Homebrew downloads', safety: 'safe', restore: 'brew install', l: ['.cache/Homebrew'], m: ['Library/Caches/Homebrew'] },
  { name: 'CocoaPods cache', safety: 'safe', restore: 'pod install', m: ['Library/Caches/CocoaPods'] },
  { name: 'Gradle caches', safety: 'safe', restore: './gradlew build', a: ['.gradle/caches'] },
  { name: 'Cargo registry', safety: 'safe', restore: 'cargo build', a: ['.cargo/registry/cache', '.cargo/registry/src'] },
  { name: 'Go build cache', safety: 'safe', restore: 'go build', l: ['.cache/go-build'], m: ['Library/Caches/go-build'], w: ['go-build'] },
  { name: 'Flutter / pub cache', safety: 'safe', restore: 'flutter pub get', u: ['.pub-cache/hosted'], w: ['Pub/Cache/hosted'] },
  { name: 'Xcode DerivedData', safety: 'safe', restore: 'Build in Xcode', m: ['Library/Developer/Xcode/DerivedData'],
    why: 'Intermediate build products. Xcode rebuilds them on the next build.' },
  { name: 'Xcode Archives', safety: 'check', m: ['Library/Developer/Xcode/Archives'],
    why: 'Archived app builds, including the dSYMs you need to read old crash reports. Not re-created.' },
  { name: 'iOS DeviceSupport', safety: 'check', restore: 'Reconnect the device', m: ['Library/Developer/Xcode/iOS DeviceSupport'],
    why: 'Debug symbols copied from each iOS version you connected. Copied again when a device reconnects.' },
  { name: 'VS Code cache', safety: 'safe', restore: 'Reopen VS Code', l: ['.config/Code/CachedData', '.config/Code/CachedExtensionVSIXs'],
    m: ['Library/Application Support/Code/CachedData', 'Library/Application Support/Code/CachedExtensionVSIXs'],
    r: ['Code/CachedData', 'Code/CachedExtensionVSIXs'], why: 'Compiled editor code and downloaded extension installers. Rebuilt when VS Code starts.' },
  { name: 'Cursor cache', safety: 'safe', restore: 'Reopen Cursor', l: ['.config/Cursor/CachedData', '.config/Cursor/CachedExtensionVSIXs'],
    m: ['Library/Application Support/Cursor/CachedData', 'Library/Application Support/Cursor/CachedExtensionVSIXs'],
    r: ['Cursor/CachedData', 'Cursor/CachedExtensionVSIXs'], why: 'Compiled editor code and downloaded extension installers. Rebuilt when Cursor starts.' },
  { name: 'JetBrains caches', safety: 'safe', restore: 'Reopen the IDE (re-indexes)', l: JB.map(d => '.cache/JetBrains/*/' + d), m: JB.map(d => 'Library/Caches/JetBrains/*/' + d), w: JB.map(d => 'JetBrains/*/' + d),
    why: 'IDE indexes and caches. Rebuilt when the project is reopened, which takes a few minutes.' },
  { name: 'pre-commit', safety: 'safe', restore: 'pre-commit install', a: ['.cache/pre-commit'] },
  { name: 'Prisma engines', safety: 'safe', restore: 'npx prisma generate', a: ['.cache/prisma'] },
  // only Expo's cache folders: .expo itself holds state.json, a sign-in
  { name: 'Expo cache', safety: 'safe', restore: 'npx expo start', a: ['cache', 'android-apk-cache', 'ios-simulator-app-cache',
    'native-modules-cache', 'schema-cache', 'template-cache', 'versions-cache', 'expo-go'].map(n => '.expo/' + n) },
  { name: 'NuGet packages', safety: 'check', restore: 'dotnet restore', a: ['.nuget/packages'] },
  { name: 'Maven repository', safety: 'check', restore: 'mvn install', a: ['.m2/repository'] },
  { name: 'conda packages', safety: 'check', restore: 'conda install', a: ['miniconda3/pkgs', 'anaconda3/pkgs', '.conda/pkgs',
    'miniforge3/pkgs', 'mambaforge/pkgs', 'opt/anaconda3/pkgs', 'opt/miniconda3/pkgs'] },
  { name: 'Deno cache', safety: 'check', restore: 'deno cache', l: ['.cache/deno'], m: ['Library/Caches/deno'], w: ['deno'] },
  { name: 'Bun cache', safety: 'check', restore: 'bun install', a: ['.bun/install/cache'] },
  { name: 'Puppeteer browsers', safety: 'check', restore: 'npx puppeteer browsers install', a: ['.cache/puppeteer'] },
  // the rest of the known-safe cache list, with the Linux/Windows homes of the same caches
  { name: 'npx cache', safety: 'safe', restore: 'npx <tool>', u: ['.npm/_npx'], w: ['npm-cache/_npx'] },
  { name: 'npm logs', safety: 'safe', u: ['.npm/_logs'], w: ['npm-cache/_logs'], why: 'Debug logs npm wrote after failed commands. Nothing reads them later.' },
  { name: 'Corepack', safety: 'safe', restore: 'corepack enable', a: ['.cache/node/corepack'], w: ['node/corepack'] },
  { name: 'nvm downloads', safety: 'safe', restore: 'nvm install', u: ['.nvm/.cache'] },
  { name: 'pnpm store (old location)', safety: 'safe', restore: 'pnpm install', a: ['.pnpm-store'] },
  { name: 'TypeScript typings cache', safety: 'safe', restore: 'Reopen the editor', l: ['.cache/typescript'], m: ['Library/Caches/typescript'], w: ['Microsoft/TypeScript'] },
  { name: 'node-gyp headers', safety: 'safe', restore: 'npm rebuild', l: ['.cache/node-gyp'], m: ['Library/Caches/node-gyp'], w: ['node-gyp/Cache'] },
  { name: 'Electron downloads', safety: 'safe', restore: 'npm install', l: ['.cache/electron', '.cache/electron-builder'], m: ['Library/Caches/electron', 'Library/Caches/electron-builder'], w: ['electron/Cache', 'electron-builder/Cache'] },
  { name: 'Android build cache', safety: 'safe', restore: './gradlew build', a: ['.android/cache', '.android/build-cache'] },
  { name: 'CocoaPods spec repos', safety: 'check', restore: 'pod repo update', a: ['.cocoapods/repos'] },
  { name: 'Ivy cache', safety: 'check', restore: 'sbt update', a: ['.ivy2/cache'] },
  { name: 'act (GitHub Actions) cache', safety: 'safe', restore: 'act', a: ['.cache/act'] },
  { name: 'Cargo git checkouts', safety: 'safe', restore: 'cargo build', a: ['.cargo/git'] },
  { name: 'pub git cache', safety: 'safe', restore: 'flutter pub get', u: ['.pub-cache/git'], w: ['Pub/Cache/git'] },
  { name: 'Hex packages', safety: 'safe', restore: 'mix deps.get', a: ['.hex/packages'] },
  { name: 'rebar3 cache', safety: 'safe', restore: 'rebar3 compile', a: ['.cache/rebar3'] },
  { name: 'Cabal packages', safety: 'check', restore: 'cabal update', a: ['.cabal/packages'] },
  { name: 'Stack snapshots', safety: 'check', restore: 'stack build', a: ['.stack/pantry', '.stack/snapshots'] },
  { name: 'SwiftPM cache', safety: 'safe', restore: 'swift package resolve', a: ['.swiftpm/cache'], m: ['Library/Caches/org.swift.swiftpm'] },
  { name: 'Bazel cache', safety: 'check', restore: 'bazel build', a: ['.cache/bazel'] },
  { name: 'Ruby gem downloads', safety: 'safe', restore: 'gem install', u: ['.gem/ruby/*/cache', '.local/share/gem/ruby/*/cache'] },
  { name: 'Zsh saved sessions', safety: 'safe', u: ['.zsh_sessions'], why: 'Per-window shell history macOS Terminal restores. Your main history is kept.' },
  { name: 'Ruby gem specs', safety: 'safe', restore: 'gem install', a: ['.gem/specs'] },
  { name: 'Bundler cache', safety: 'safe', restore: 'bundle install', a: ['.bundle/cache'] },
  { name: 'Composer cache', safety: 'safe', restore: 'composer install', a: ['.composer/cache'], l: ['.cache/composer'], w: ['Composer'] },
  { name: 'Go module downloads', safety: 'check', restore: 'go mod download', a: ['go/pkg/mod/cache'] },
  { name: 'Terraform plugins', safety: 'safe', restore: 'terraform init', a: ['.terraform.d/plugin-cache'] },
  { name: 'Vagrant temp', safety: 'safe', a: ['.vagrant.d/tmp'], why: 'Temporary files from Vagrant runs. Nothing reads them later.' },
  { name: 'Vagrant boxes', safety: 'check', restore: 'vagrant box add', a: ['.vagrant.d/boxes'], why: 'Base VM images. Downloaded again (often several GB) by the next vagrant up.' },
  { name: 'pyenv downloads', safety: 'safe', restore: 'pyenv install', u: ['.pyenv/cache'] },
  { name: 'rbenv downloads', safety: 'safe', restore: 'rbenv install', u: ['.rbenv/cache'] },
  { name: 'Oh My Zsh cache', safety: 'safe', restore: 'Open a new terminal', u: ['.oh-my-zsh/cache'] },
  { name: 'opam downloads', safety: 'safe', restore: 'opam install', u: ['.opam/download-cache'] },
  { name: 'uv cache', safety: 'safe', restore: 'uv sync', l: ['.cache/uv'], m: ['Library/Caches/uv'], w: ['uv/cache'] },
  { name: 'Poetry cache', safety: 'safe', restore: 'poetry install', l: ['.cache/pypoetry'], m: ['Library/Caches/pypoetry'], w: ['pypoetry/Cache'] },
  { name: 'Playwright browsers', safety: 'check', restore: 'npx playwright install', l: ['.cache/ms-playwright'], m: ['Library/Caches/ms-playwright'], w: ['ms-playwright'] },
  { name: 'Cypress binaries', safety: 'check', restore: 'npx cypress install', l: ['.cache/Cypress'], m: ['Library/Caches/Cypress'], w: ['Cypress/Cache'] },
  { name: 'Hugging Face models', safety: 'check', restore: 'Downloaded again on next use', a: ['.cache/huggingface'],
    why: 'Downloaded AI models and datasets. Fetched again on next use, often many GB.' },
  { name: 'Xcode documentation cache', safety: 'safe', restore: 'Open Xcode', m: ['Library/Developer/Xcode/DocumentationCache'] },
  { name: 'Simulator caches', safety: 'safe', restore: 'Run a simulator', m: ['Library/Developer/CoreSimulator/Caches'] },
  { name: 'XCTest devices', safety: 'safe', restore: 'Run the tests', m: ['Library/Developer/XCTestDevices'],
    why: 'Simulator clones Xcode made for parallel tests. Made again by the next test run.' },
  { name: 'watchOS / tvOS / visionOS DeviceSupport', safety: 'check', restore: 'Reconnect the device',
    m: ['Library/Developer/Xcode/watchOS DeviceSupport', 'Library/Developer/Xcode/tvOS DeviceSupport', 'Library/Developer/Xcode/visionOS DeviceSupport', 'Library/Developer/Xcode/xrOS DeviceSupport'],
    why: 'Debug symbols copied from each device version you connected. Copied again when a device reconnects.' },
  { name: 'Docker Desktop disk', safety: 'check', restore: 'Start Docker Desktop', m: ['Library/Containers/com.docker.docker'],
    why: 'Docker Desktop\'s whole virtual disk: every image, container and volume. Quit Docker Desktop first. It starts empty.' },
];
for (const g of GLOBAL) g.why ??= g.safety === 'safe'
  ? `Downloaded copies kept by ${g.name.split(' ')[0]}. Fetched again when a project needs them.`
  : `Downloaded copies kept by ${g.name.split(' ')[0]}. Fetched again when needed, which can be large or slow.`;

const sub = (base, rel) => path.join(base, ...rel.split('/'));

// candidate paths of one global row for ctx.platform (glob '*' left in place)
function globalPaths(g, ctx) {
  const { platform: os, home, env = {} } = ctx;
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    ...(g.a || []).map(r => sub(home, r)),
    ...(os !== 'win32' ? g.u || [] : []).map(r => sub(home, r)),
    ...(os === 'linux' ? g.l || [] : []).map(r => sub(home, r)),
    ...(os === 'darwin' ? g.m || [] : []).map(r => sub(home, r)),
    ...(os === 'win32' ? g.w || [] : []).map(r => sub(local, r)),
    ...(os === 'win32' ? g.r || [] : []).map(r => sub(roaming, r)),
  ];
}

// roots caches.js must skip: every global path for this platform, glob cut at the '*'
const claims = ctx => GLOBAL.flatMap(g => globalPaths(g, ctx)).map(p => p.split(path.sep + '*')[0]);

async function expand(p) {
  const [head, tail] = p.split(path.sep + '*' + path.sep);
  if (tail === undefined) return [p];
  const ents = await fs.readdir(head, { withFileTypes: true }).catch(() => []);
  return ents.filter(e => e.isDirectory()).map(e => path.join(head, e.name, tail));
}

const inside = (p, d) => p === d || p.startsWith(d + path.sep);
const mtimeOf = async p => (await fs.lstat(p).catch(() => null))?.mtimeMs || 0;
const exists = async p => !!(await fs.lstat(p).catch(() => null));

async function scanGlobal(ctx, excluded) {
  return (await Promise.all(GLOBAL.map(async g => {
    const paths = [];
    for (const p of (await Promise.all(globalPaths(g, ctx).map(expand))).flat())
      if (!excluded(p) && (await fs.lstat(p).catch(() => null))?.isDirectory()) paths.push(p);
    if (!paths.length || ctx.signal?.aborted) return null;
    const size = (await Promise.all(paths.map(p => ctx.dirSize(p, ctx)))).reduce((a, b) => a + b, 0);
    if (!size) return null;
    return { id: 'devtools:global:' + g.name, module: 'devtools', group: 'Global caches', name: g.name, paths, size,
      mtime: Math.max(...await Promise.all(paths.map(mtimeOf))), safety: g.safety, why: g.why,
      ...(g.restore ? { restore: g.restore } : {}), action: 'trash', meta: { kind: 'global' } };
  }))).filter(Boolean);
}

// mac only; simctl itself skips booted devices, the filter is belt and braces
async function scanSimulators(ctx) {
  if (ctx.platform !== 'darwin') return [];
  const r = await ctx.run('xcrun', ['simctl', 'list', 'devices', 'unavailable', '-j']).catch(() => null);
  let udids = [];
  try { udids = Object.values(JSON.parse(r.out).devices || {}).flat().filter(d => d.udid && d.state !== 'Booted').map(d => d.udid); } catch {}
  if (!udids.length) return [];
  const base = path.join(ctx.home, 'Library', 'Developer', 'CoreSimulator', 'Devices');
  const paths = udids.filter(u => /^[\w-]+$/.test(u)).map(u => path.join(base, u));
  const size = (await Promise.all(paths.map(p => ctx.dirSize(p, ctx)))).reduce((a, b) => a + b, 0);
  return [{ id: 'devtools:simctl', module: 'devtools', group: 'Simulators', name: `Unavailable simulators (${udids.length})`,
    paths, size, mtime: 0, safety: 'check', why: 'Unavailable simulators — permanent, Xcode re-creates on demand',
    action: 'cmd', cmd: { id: 'simctl', args: [] }, meta: { count: udids.length } }];
}

// artifact folder -> marker test, safety, restore
const PY = ['pyproject.toml', 'requirements.txt', 'setup.py'];
const has = (names, list) => list.some(n => names.has(n));
const gradle = names => [...names].some(n => n.startsWith('build.gradle'));
const pm = n => n.has('pnpm-lock.yaml') ? 'pnpm' : n.has('yarn.lock') ? 'yarn' : n.has('bun.lockb') || n.has('bun.lock') ? 'bun' : 'npm';
const install = n => ({ pnpm: 'pnpm install', yarn: 'yarn', bun: 'bun install', npm: n.has('package-lock.json') ? 'npm ci' : 'npm install' })[pm(n)];
const runBuild = n => (pm(n) === 'npm' ? 'npm run' : pm(n)) + ' build';
const pyRestore = n => n.has('poetry.lock') ? 'poetry install' : n.has('uv.lock') ? 'uv sync'
  : n.has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install .';
const JS_BUILD = { ok: n => n.has('package.json'), safety: 'safe', restore: runBuild, why: 'Build output. Your build script writes it again.' };
const PY_CACHE = { ok: n => has(n, PY), safety: 'safe', why: 'Python cache. Recreated automatically the next time the code runs.' };
const ARTIFACTS = {
  node_modules: { ok: n => n.has('package.json'), safety: 'check', restore: install, why: 'Installed packages. Downloaded again by the restore command.' },
  venv: { ok: n => has(n, PY), safety: 'check', restore: pyRestore, why: 'Python virtual environment. Rebuilt by reinstalling the packages.' },
  target: { ok: n => has(n, ['Cargo.toml', 'pom.xml']), safety: 'check', restore: n => n.has('Cargo.toml') ? 'cargo build' : 'mvn package',
    why: 'Compiled build output and dependencies. A full rebuild can take a while.' },
  Pods: { ok: n => n.has('Podfile'), safety: 'check', restore: () => 'pod install', why: 'CocoaPods dependencies. Downloaded again by the restore command.' },
  '.gradle': { ok: gradle, safety: 'check', restore: () => './gradlew build', why: 'Gradle project cache. Downloaded and rebuilt on the next build.' },
  build: { ok: n => gradle(n) || n.has('package.json'), safety: 'safe', restore: n => gradle(n) ? './gradlew build' : runBuild(n), why: 'Build output. The next build writes it again.' },
  dist: JS_BUILD, out: JS_BUILD,
  '.next': JS_BUILD, '.nuxt': JS_BUILD, '.svelte-kit': JS_BUILD, '.angular': JS_BUILD, '.turbo': JS_BUILD, '.parcel-cache': JS_BUILD,
  __pycache__: PY_CACHE, '.pytest_cache': PY_CACHE, '.mypy_cache': PY_CACHE, '.ruff_cache': PY_CACHE,
  '.tox': { ok: n => has(n, PY), safety: 'check', restore: () => 'tox', why: 'tox test environments. Rebuilt the next time tox runs.' },
  DerivedData: { ok: n => [...n].some(x => /\.(xcodeproj|xcworkspace)$/.test(x)), safety: 'safe', restore: () => 'Build in Xcode',
    why: 'Intermediate build products. Xcode rebuilds them on the next build.' },
  '.dart_tool': { ok: n => n.has('pubspec.yaml'), safety: 'safe', restore: () => 'flutter pub get', why: 'Dart tool cache. Recreated by the restore command.' },
};
const ext = re => n => [...n].some(x => re.test(x));
const SAFE = (ok, restore, why = 'Build output. The next build writes it again.') => ({ ok, safety: 'safe', restore: () => restore, why });
Object.assign(ARTIFACTS, {
  '.output': { ...JS_BUILD, ok: ext(/^nuxt\.config\./) }, '.astro': JS_BUILD,
  '.build': SAFE(n => n.has('Package.swift'), 'swift build'),
  _build: SAFE(n => n.has('mix.exs') || n.has('dune-project'), 'mix compile / dune build'),
  deps: SAFE(n => n.has('mix.exs') && n.has('mix.lock'), 'mix deps.get', 'Elixir dependencies. Downloaded again by the restore command.'),
  bin: SAFE(ext(/\.(cs|fs|vb)proj$|\.sln$/), 'dotnet build'), obj: SAFE(ext(/\.(cs|fs|vb)proj$|\.sln$/), 'dotnet build'),
  vendor: SAFE(n => n.has('composer.json') && n.has('composer.lock'), 'composer install', 'PHP packages. Downloaded again by the restore command.'),
  '.stack-work': SAFE(n => n.has('stack.yaml'), 'stack build'),
  'dist-newstyle': SAFE(ext(/\.cabal$/), 'cabal build'),
  '.zig-cache': SAFE(n => n.has('build.zig'), 'zig build'), 'zig-cache': SAFE(n => n.has('build.zig'), 'zig build'), 'zig-out': SAFE(n => n.has('build.zig'), 'zig build'),
  '.godot': SAFE(n => n.has('project.godot'), 'Open the project in Godot', 'Godot import cache. Re-imported when the project opens.'),
});
ARTIFACTS.target = { ...ARTIFACTS.target, ok: n => has(n, ['Cargo.toml', 'pom.xml', 'build.sbt']),
  restore: n => n.has('Cargo.toml') ? 'cargo build' : n.has('build.sbt') ? 'sbt compile' : 'mvn package' };
ARTIFACTS.build = { ...ARTIFACTS.build, ok: n => gradle(n) || has(n, ['package.json', 'pubspec.yaml', 'CMakeLists.txt']),
  restore: n => gradle(n) ? './gradlew build' : n.has('pubspec.yaml') ? 'flutter build' : n.has('CMakeLists.txt') ? 'cmake --build build' : runBuild(n) };
ARTIFACTS['.venv'] = ARTIFACTS.venv;
// often committed (electron-builder's build/ holds icons): Safe only when git says it is ignored output
const MAYBE_SOURCE = new Set(['build', 'dist', 'out', 'bin', 'vendor']);
const SKIP = new Set(['Library', 'AppData', 'Applications', 'snap', 'node_modules', '.git']);

// lastTouched = newest mtime of the project's own entries two levels deep and git activity.
// note: editors that save in place only bump the file, so src/index.js counts but
// src/a/b.js does not; a full walk of non-artifact folders is the upgrade if that misses.
async function lastTouched(dir) {
  const own = async d => (await fs.readdir(d).catch(() => [])).filter(n => !Object.hasOwn(ARTIFACTS, n) && n !== '.git' && n !== 'node_modules').map(n => path.join(d, n));
  const top = await own(dir);
  const ps = [...top, ...(await Promise.all(top.map(own))).flat()]
    .concat(['HEAD', 'index', 'FETCH_HEAD'].map(n => path.join(dir, '.git', n)));
  return Math.max(0, ...await Promise.all(ps.map(mtimeOf)));
}

// git worktree whose 'gitdir:' target is gone while its repo's .git is still there
// (a repo on an unplugged drive is not an orphan)
async function orphan(dir) {
  const txt = await fs.readFile(path.join(dir, '.git'), 'utf8').catch(() => '');
  const m = /^gitdir:\s*(.+)$/m.exec(txt), g = m && path.resolve(dir, m[1].trim());
  return !!g && !await exists(g) && await exists(path.resolve(g, '../..'));
}

const WT_WHY = 'Orphaned git worktree — commit or push anything you need first';
const worktree = async (ctx, p) => ({ id: 'devtools:wt:' + p, module: 'devtools', group: 'Worktrees',
  name: path.relative(ctx.home, p), paths: [p], size: await ctx.dirSize(p, ctx), mtime: await lastTouched(p),
  safety: 'check', why: WT_WHY, action: 'trash', trashOnly: true, meta: { kind: 'worktree' } });

async function scanWorktrees(ctx, excluded) {
  const out = [];
  for (const tool of ['.cursor', '.codex', '.claude']) {
    await ctx.walk(path.join(ctx.home, tool, 'worktrees'), async (p, _e, s) => {
      if (!s.isDirectory() || excluded(p)) return false;
      if (await exists(path.join(p, '.git'))) { if (await orphan(p)) out.push(p); return false; }
    }, { depth: 2, hidden: true });
  }
  return Promise.all(out.map(p => worktree(ctx, p)));
}

let hidden = 0;   // recent projects the last scan left out, for the empty state
// what each build folder is, in words anyone can read; the real folder name stays beside it
const LABEL = { node_modules: 'Installed packages', venv: 'Python environment', '.venv': 'Python environment', target: 'Compiled build output',
  Pods: 'CocoaPods libraries', '.gradle': 'Gradle cache', build: 'Build output', dist: 'Build output', out: 'Build output',
  '.next': 'Next.js build', '.nuxt': 'Nuxt build', '.svelte-kit': 'SvelteKit build', '.angular': 'Angular cache', '.turbo': 'Turborepo cache',
  '.parcel-cache': 'Parcel cache', __pycache__: 'Python bytecode cache', '.tox': 'Python test environments', DerivedData: 'Xcode build data',
  '.dart_tool': 'Dart tool cache', '.output': 'Nuxt output', '.astro': 'Astro build', '.build': 'Swift build', _build: 'Elixir build',
  deps: 'Elixir dependencies', vendor: 'Vendored packages', '.stack-work': 'Haskell build' };
// installed but in neither package.json nor package-lock.json: what `npm prune` removes.
// Only with package-lock.json beside it: without one, a transitive dependency looks unused.
async function extraneous(dir) {
  const lock = await fs.readFile(path.join(dir, 'package-lock.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!lock?.packages) return [];   // lockfile v1 (npm 6) has no flat list
  const nm = path.join(dir, 'node_modules'), out = [];
  const used = k => lock.packages[k] && !lock.packages[k].extraneous;
  for (const e of await fs.readdir(nm, { withFileTypes: true }).catch(() => [])) {
    if (e.name.startsWith('.') || !e.isDirectory()) continue;
    const kids = e.name.startsWith('@') ? (await fs.readdir(path.join(nm, e.name)).catch(() => [])).map(k => e.name + '/' + k) : [e.name];
    for (const k of kids) if (!used('node_modules/' + k)) out.push(path.join(nm, k));
  }
  return out;
}
const label = n => LABEL[n] ? `${LABEL[n]} · ${n}` : n;
// "old-site · ~/Projects": the project's own name first, where it lives second
const projectName = (home, dir) => { const r = path.relative(home, dir); if (!r) return '~'; const parent = path.dirname(r);
  return `${path.basename(r)} · ${parent === '.' ? '~' : '~/' + parent}`; };

async function scanProjects(ctx, excluded) {
  const { home } = ctx;
  const listing = new Map();   // dir -> Set(names), one readdir per parent
  const names = async d => listing.get(d) || listing.set(d, new Set(await fs.readdir(d).catch(() => []))).get(d);
  const found = new Map();     // project dir -> [artifact paths]
  const orphans = [];
  const skipRoots = [...claims(ctx), sub(home, 'go/pkg'), sub(home, 'miniconda3'), sub(home, 'anaconda3')];
  await ctx.walk(home, async (p, e, s) => {
    if (e.name === '.git' && s.isFile() && await orphan(path.dirname(p))) orphans.push(path.dirname(p));
    if (!s.isDirectory()) return;
    if (excluded(p) || skipRoots.some(r => inside(p, r))) return false;
    const a = Object.hasOwn(ARTIFACTS, e.name) && ARTIFACTS[e.name];
    if (a && a.ok(await names(path.dirname(p)))) {
      const d = path.dirname(p);
      found.has(d) || found.set(d, []);
      found.get(d).push(p);
      return false;
    }
    if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.venv') || a) return false;
  }, { depth: 6, hidden: true });

  const now = Date.now(), stale = (ctx.settings?.staleDays || 0) * DAY, items = [];
  hidden = 0;
  for (const [dir, arts] of found) {
    if (ctx.signal?.aborted) break;
    if (orphans.some(o => inside(dir, o))) continue;   // offered whole as a worktree
    const touched = await lastTouched(dir);
    if (stale && now - touched < stale) { hidden++; continue; }   // active project: never shown
    let dirty = false;
    // --no-optional-locks: status must not rewrite .git/index, which lastTouched reads
    if (await exists(path.join(dir, '.git'))) dirty = !!(await ctx.run('git', ['--no-optional-locks', '-C', dir, 'status', '--porcelain']).catch(() => null))?.out?.trim();
    const n = await names(dir);
    for (const p of arts) {
      const a = ARTIFACTS[path.basename(p)], size = await ctx.dirSize(p, ctx);
      if (!size) continue;
      // without a lockfile a reinstall can resolve newer versions than the ones on disk
      const noLock = path.basename(p) === 'node_modules' && !has(n, ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
      // check-ignore: 0 ignored, 1 not ignored, 128 not a git repo
      const ci = MAYBE_SOURCE.has(path.basename(p)) ? (await ctx.run('git', ['-C', dir, 'check-ignore', '-q', p]).catch(() => null))?.code : 0;
      const tracked = ci !== 0, noGit = ci === 128;
      // made by a root docker build: trashing it fails, so the clean would skip it every time
      const root = process.getuid?.() > 0 && (await fs.stat(p).catch(() => null))?.uid === 0;
      const check = [dirty && 'The project has uncommitted changes. Commit or stash them first.',
        noLock && 'No lockfile: a reinstall may pick newer versions than the ones on disk.',
        noGit ? 'Not in git: it may hold source files. Look inside before cleaning.'
          : tracked && 'Not ignored by git: it may hold committed files. Look inside before cleaning.',
        root && `Owned by root, so it can't be moved to the Trash. Remove it with: sudo rm -rf "${p}"`].filter(Boolean);
      items.push({ id: 'devtools:' + p, module: 'devtools', group: projectName(home, dir), name: label(path.basename(p)), paths: [p], size,
        mtime: touched, safety: tracked || root ? 'check' : a.safety, why: a.why, ...(check.length ? { check } : {}),
        ...(a.restore ? { restore: a.restore(n) } : {}), action: 'trash', ...(check.length ? { pre: false } : {}),
        meta: { kind: 'project', project: dir, dirty } });
    }
    const extra = arts.some(p => path.basename(p) === 'node_modules') && n.has('package-lock.json') ? await extraneous(dir) : [];
    if (extra.length) items.push({ id: 'devtools:extraneous:' + dir, module: 'devtools', group: projectName(home, dir),
      name: `Unused packages in node_modules (${extra.length})`, paths: extra, size: (await Promise.all(extra.map(p => ctx.dirSize(p, ctx)))).reduce((a, b) => a + b, 0),
      mtime: touched, safety: 'check', restore: 'npm install', action: 'trash', pre: false,
      why: 'Installed, but not in package.json or package-lock.json. Same as npm prune.',
      check: [`${extra.slice(0, 5).map(p => path.relative(path.join(dir, 'node_modules'), p)).join(', ')}${extra.length > 5 ? ` and ${extra.length - 5} more` : ''}. Make sure nothing imports them without listing them.`],
      meta: { kind: 'project', project: dir, dirty } });
  }
  for (const o of orphans) if (!ctx.signal?.aborted) items.push(await worktree(ctx, o));
  return items;
}

// Docker, one row per thing it would remove. `docker system df` is not used: it sizes
// every volume and takes minutes with a few hundred of them. Each query below is ~1 s.
const UNIT = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 };
const dsize = s => { const m = /([\d.]+)\s*([kmgt]i?b|b)/i.exec(s || ''); return m ? Math.round(+m[1] * UNIT[m[2].toUpperCase()]) : 0; };
const jsonl = s => s.split('\n').flatMap(l => { try { const j = JSON.parse(l); return j && (j.ID || j.Name) ? [j] : []; } catch { return []; } });
const ANON = /^[0-9a-f]{64}$/;
async function scanDocker(ctx) {
  // a stuck daemon makes this hang forever; give up after 15 s
  const dk = async (...a) => { const r = await ctx.run('docker', a, { timeout: 15e3 }).catch(() => null); return r && !r.code ? r.out : null; };
  if (await dk('version', '--format', '{{.Server.Version}}') == null) return [];
  const [build, imgs, ctrs, vols] = await Promise.all([dk('builder', 'du'), dk('image', 'ls', '--format', 'json'),
    dk('ps', '-a', '--size', '--filter', 'status=exited', '--filter', 'status=created', '--format', 'json'),
    dk('volume', 'ls', '--filter', 'dangling=true', '--format', 'json')]);
  const out = [];
  const row = (key, name, size, cmd, safety, why, extra) => out.push({ id: 'devtools:docker:' + key, module: 'devtools', group: 'Docker',
    name, paths: [], size, mtime: 0, safety, why, action: 'cmd', cmd, ...(safety === 'safe' ? {} : { pre: false }), ...extra });

  const bc = dsize(/^Reclaimable:\s*(.+)$/m.exec(build || '')?.[1]);
  if (bc) row('build', 'Build cache', bc, { id: 'dockerBuild', args: [] }, 'safe',
    'Layers saved by earlier docker builds. The next build is slower while it fills again.', { restore: 'docker build' });

  // one image can carry several tags: one row, every tag removed, the image goes with the last one
  const byId = new Map();
  for (const i of jsonl(imgs || '')) {
    const g = byId.get(i.ID) || byId.set(i.ID, { ...i, refs: [] }).get(i.ID);
    if (i.Repository !== '<none>') g.refs.push(i.Tag === '<none>' ? i.Repository : `${i.Repository}:${i.Tag}`);
  }
  for (const i of byId.values()) {
    if (i.Containers !== '0') continue;   // used by a container, or an old docker that reports N/A: leave it
    const dangling = !i.refs.length;
    row('img:' + i.ID, dangling ? `Untagged image ${i.ID}` : i.refs.join(', '), dsize(i.Size), { id: 'dockerRmi', args: dangling ? [i.ID] : i.refs },
      dangling ? 'safe' : 'check', dangling ? 'Left behind when a newer build took its tag. Nothing uses it.'
        : `Image no container uses, created ${i.CreatedSince}. Pulled or built again when needed. Layers shared with other images stay.`,
      { restore: dangling ? undefined : 'docker pull / docker build' });
  }

  for (const c of jsonl(ctrs || ''))
    row('ctr:' + c.ID, `Stopped container ${c.Names} (${c.Image})`, dsize(c.Size), { id: 'dockerRm', args: [c.ID] }, 'check',
      `${c.Status}. Anything written inside it (not in a volume) is lost.`);

  // volumes are data (databases live here): never Safe. Sizes need root or `system df -v`, so none are shown.
  const vs = jsonl(vols || '').map(v => v.Name).filter(Boolean), anon = vs.filter(v => ANON.test(v));
  if (anon.length) row('vol:anon', `Anonymous volumes no container uses (${anon.length})`, 0, { id: 'dockerVol', args: anon }, 'check',
    'Unnamed volumes left by removed containers. Size not measured. Their data is deleted for good.', { meta: { count: anon.length } });
  for (const v of vs.filter(v => !ANON.test(v)))
    row('vol:' + v, `Volume ${v}`, 0, { id: 'dockerVol', args: [v] }, 'check',
      'Named volume no container uses — often a database. Size not measured. Its data is deleted for good.');
  return out;
}

// Leftovers tools never clean up after themselves: old self-updating CLI
// builds, superseded editor extensions, editor state for projects that are gone.
const ver = s => (/\d+(\.\d+)+/.exec(s) || ['0'])[0];
const newer = (a, b) => ver(a).localeCompare(ver(b), undefined, { numeric: true });
const EDITORS = { 'VS Code': ['Code', '.vscode'], 'VS Code Insiders': ['Code - Insiders', '.vscode-insiders'], Cursor: ['Cursor', '.cursor'] };
async function scanTools(ctx, excluded) {
  const { home, platform, env = {} } = ctx, out = [];
  const row = async (key, name, paths, safety, why, restore) => {
    paths = paths.filter(p => !excluded(p));
    const size = (await Promise.all(paths.map(p => ctx.dirSize(p, ctx)))).reduce((a, b) => a + b, 0);
    if (size) out.push({ id: 'devtools:tool:' + key, module: 'devtools', group: 'Tool leftovers', name, paths, size,
      mtime: Math.max(0, ...await Promise.all(paths.map(mtimeOf))), safety, why, action: 'trash', ...(restore ? { restore } : {}),
      ...(safety === 'safe' ? {} : { pre: false }), meta: { kind: 'global' } });
  };
  // ~/.local/share/<cli>/versions: keep the one ~/.local/bin/<cli> runs and the newest; unreadable link -> offer nothing
  for (const cli of ['claude', 'cursor-agent']) {
    if (platform === 'win32') break;
    const dir = path.join(home, '.local', 'share', cli, 'versions');
    const cur = await fs.realpath(path.join(home, '.local', 'bin', cli)).catch(() => null);
    if (!cur || path.dirname(cur) !== dir) continue;
    const all = (await fs.readdir(dir).catch(() => [])).sort(newer);
    const old = all.filter(v => v !== path.basename(cur) && v !== all[all.length - 1]);
    await row('cli:' + cli, `Old ${cli} versions (${old.length})`, old.map(v => path.join(dir, v)), 'safe',
      `Earlier builds the updater left behind. The one you run (${path.basename(cur)}) and the newest stay.`);
  }
  for (const [name, [cfg, dot]] of Object.entries(EDITORS)) {
    // publisher.name-1.2.3[-platform]: every version but the newest of each extension
    const xdir = path.join(home, dot, 'extensions'), by = new Map();
    for (const e of await fs.readdir(xdir).catch(() => [])) {
      const m = /^([^.]+\.[^-]+(?:-[a-z][\w]*)*)-\d+\.\d+\.\d+/i.exec(e);
      if (m) by.set(m[1].toLowerCase(), [...by.get(m[1].toLowerCase()) || [], e]);
    }
    const stale = [...by.values()].flatMap(v => v.sort(newer).slice(0, -1)).map(e => path.join(xdir, e));
    await row('ext:' + name, `${name}: old extension versions (${stale.length})`, stale, 'safe',
      `Versions ${name} replaced with an update. The current version of every extension stays.`, `Restart ${name}`);
    // workspaceStorage/<hash>/workspace.json points at a folder; gone folder (on a disk that is mounted) -> dead state
    const user = { linux: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), cfg), darwin: path.join(home, 'Library', 'Application Support', cfg),
      win32: path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), cfg) }[platform];
    const ws = path.join(user || '', 'User', 'workspaceStorage'), dead = [];
    for (const h of await fs.readdir(ws).catch(() => [])) {
      const j = await fs.readFile(path.join(ws, h, 'workspace.json'), 'utf8').then(JSON.parse, () => null);
      const uri = j?.folder || j?.workspace;
      if (!uri?.startsWith('file://')) continue;   // remote / WSL / untitled: cannot tell, leave it
      let p; try { p = require('url').fileURLToPath(uri); } catch { continue; }
      if (!await exists(p) && await exists(path.parse(p).root + p.split(path.sep).filter(Boolean)[0])) dead.push(path.join(ws, h));
    }
    await row('ws:' + name, `${name}: data for deleted projects (${dead.length})`, dead, 'check',
      `Editor state (open tabs, local history, extension data) for folders that no longer exist.`);
  }
  return out;
}

async function scan(ctx) {
  const ex = (ctx.settings?.exclusions || []).filter(Boolean);
  const excluded = p => ex.some(d => inside(p, d));
  const out = [], docker = scanDocker(ctx);   // runs alongside the walk: the daemon can be slow
  for (const step of [scanGlobal, scanTools, scanSimulators, scanWorktrees, scanProjects]) {
    if (ctx.signal?.aborted) break;
    out.push(...await step(ctx, excluded));
  }
  if (!ctx.signal?.aborted) out.push(...await docker);
  const seen = new Set();   // a worktree base can also turn up as an orphan in the walk
  return out.filter(i => !seen.has(i.id) && seen.add(i.id));
}

module.exports = { scanTools, scan, handlers: { hidden: () => hidden }, scanDocker, claims, GLOBAL, ARTIFACTS, globalPaths, lastTouched, orphan };
