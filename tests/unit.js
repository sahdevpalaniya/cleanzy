// node tests/unit.js  -- checks the space-reclaim path (treemap tests live in tests/disk.test.js)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

// --- du parsing: one level, dir itself excluded ---
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cleanzy-'));
fs.mkdirSync(path.join(tmp,'sub'));
fs.writeFileSync(path.join(tmp,'big.log'), Buffer.alloc(3*1024*1024));
fs.writeFileSync(path.join(tmp,'sub','small'), 'x');
const du=execFileSync('du',['-xa','--max-depth=1','--block-size=1','--',tmp]).toString();
const parsed=du.split('\n').filter(l=>l.includes('\t')).map(l=>{
  const i=l.indexOf('\t');return{size:+l.slice(0,i),path:l.slice(i+1)}}).filter(r=>r.path!==tmp);
assert.ok(parsed.some(r=>r.path.endsWith('big.log')&&r.size>=3*1024*1024),'file size read');
assert.ok(parsed.some(r=>r.path.endsWith('/sub')),'subdir listed');

// --- the whole point: truncate frees blocks while a writer holds the fd ---
const p=path.join(tmp,'held.log');
const fd=fs.openSync(p,'w+');
fs.writeSync(fd, Buffer.alloc(8*1024*1024));
const blocksBefore=fs.fstatSync(fd).blocks;
fs.ftruncateSync(fd,0);
assert.ok(blocksBefore>0 && fs.fstatSync(fd).blocks===0, 'truncate releases blocks, fd still open');
fs.writeSync(fd, Buffer.from('still writable'));   // writer keeps working, no restart
assert.ok(fs.fstatSync(fd).size>0);
fs.closeSync(fd);

// --- deleted-but-open file is still reclaimable via /proc/<pid>/fd/<n> ---
const g=path.join(tmp,'ghost.log');
const gfd=fs.openSync(g,'w+');
fs.writeSync(gfd, Buffer.alloc(4*1024*1024));
fs.unlinkSync(g);                                   // rm: df does NOT drop yet
assert.ok(fs.fstatSync(gfd).blocks>0, 'deleted file still occupies blocks');
const proc=`/proc/${process.pid}/fd/${gfd}`;
const rfd=fs.openSync(proc,'r+'); fs.ftruncateSync(rfd,0); fs.closeSync(rfd);
assert.strictEqual(fs.fstatSync(gfd).blocks, 0, 'reclaimed without killing the process');
fs.closeSync(gfd);

fs.rmSync(tmp,{recursive:true,force:true});

// --- safety gate: the rule that decides whether an app gets killed ---
const { classify } = require('../src/main/safety');
const S = o => classify({ type:'REG', mode:'u', cmd:'x', ...o });
assert.strictEqual(S({path:'/var/log/mysql/mysql-slow.log'}), 'safe');
assert.strictEqual(S({path:'/home/u/app/storage/logs/laravel.log'}), 'safe');
assert.strictEqual(S({path:'/var/log/syslog.1'}), 'safe');
for (const [o, tag] of [
  [{path:'/var/log/x.log', mode:'r'},        'read-only log'],
  [{path:'/var/log/x.log', type:'unix'},     'socket'],
  [{path:'/var/log/x.log', type:'FIFO'},     'pipe'],
  [{path:'/dev/shm/chrome.1234'},            'shared memory'],
  [{path:'/memfd:pulseaudio'},               'memfd'],
  [{path:'/usr/lib/x86_64-linux-gnu/libc.so.6'}, 'mapped library'],
  [{path:'/tmp/.org.chromium.Xyz', cmd:'chrome'}, 'browser scratch'],
  [{path:'/home/u/.config/Code/db.sqlite', cmd:'code'}, 'live database'],
]) assert.notStrictEqual(S(o), 'safe', tag + ' must never be auto-reaped: ' + S(o));

// --- folder tree built from du output (feeds the rings chart) ---
const { buildTree } = require('../src/main/tree');
const MB = 1024 * 1024;
const duOut = [
  [40*MB, '/r/a/deep/deeper'],
  [90*MB, '/r/a/deep'],
  [300*MB,'/r/a'],
  [200*MB,'/r/b'],
  [1*MB,  '/r/sliver'],          // 0.1% of 1000MB = 1MB floor -> kept at exactly the floor
  [100*1024, '/r/dust'],         // well under the floor -> pruned
  [1000*MB,'/r'],
].map(([s,p])=>`${s}\t${p}`).join('\n');

const root = buildTree(duOut, "/r");
assert.strictEqual(root.size, 1000*MB);
assert.deepStrictEqual(root.kids.map(k=>k.name), ['a','b','sliver'], 'sorted desc, dust pruned');
assert.strictEqual(root.kids[0].kids[0].name, 'deep', 'nesting rebuilt from flat du output');
assert.strictEqual(root.kids[0].kids[0].kids[0].name, 'deeper');
// a folder's own files = its size minus its children — this is the gap the rings show
assert.strictEqual(root.kids[0].own, (300-90)*MB, 'own bytes = size - children');
assert.strictEqual(root.own, (1000-300-200-1)*MB, 'pruned dust counts as the root\'s own');
// depth cap stops the payload exploding
assert.strictEqual(buildTree(duOut,'/r',1).kids[0].kids.length, 0, 'maxDepth truncates');
assert.strictEqual(buildTree(duOut,'/nope'), null, 'unknown root is reported, not crashed');
// children never claim more than the parent, or the arcs would overflow the ring
(function check(n){const sum=n.kids.reduce((a,k)=>a+k.size,0);
  assert.ok(sum<=n.size, n.path+' children exceed parent'); n.kids.forEach(check)})(root);

// --- deletion guard: the tool must refuse to nuke the system ---
const { guard } = require('../src/main/safety');
for (const bad of ['/', '/home', '/usr', '/etc', '/var', '/boot', os.homedir(), '/usr/lib', '/var/lib', '/etc/'])
  assert.ok(guard(bad), 'must refuse to delete ' + bad);
for (const ok of [path.join(os.homedir(), '.cache'), '/home/someone/project/node_modules',
                  '/var/log/mysql/slow.log', '/tmp/scratch'])
  assert.strictEqual(guard(ok), null, 'must allow ' + ok);
// a whole mounted drive, and NTFS stream aliases of a folder (Documents::$INDEX_ALLOCATION is Documents)
for (const bad of ['/mnt/backup', '/media/u/disk', '/run/media/u/disk', '/Volumes/Backup', 'C:\\Users\\x\\Documents::$INDEX_ALLOCATION', 'C:\\Users\\x\\Documents:'])
  assert.ok(guard(bad, { home: 'C:\\Users\\x' }), 'must refuse ' + bad);
assert.strictEqual(guard('/mnt/backup/old/cache'), null, 'inside a drive is fine');
// one level under /var is the OS, emptied or not (journald logs go through journalctl)
assert.ok(guard('/var/log'));
assert.ok(guard('/var/log', { contentsOnly: true }));
assert.strictEqual(guard('/var/log/mysql', { contentsOnly: true }), null);
assert.ok(guard('/', { contentsOnly: true }), 'root is never emptiable either');
// other accounts' personal folders, and macOS's /private spellings of /etc and /var
for (const bad of ['/home/other/Documents', '/home/other/.ssh/id_rsa', '/private/etc/ssh', '/private/var/db'])
  assert.ok(guard(bad), 'must refuse ' + bad);
assert.ok(guard('C:\\Users\\alice\\Documents', { home: 'C:\\Users\\bob' }));

console.log('ok — layout, du parsing, truncate reclaim, /proc reclaim, safety gate, folder tree, delete guard');

// --- size cache: a delete is patched in place, no second disk walk ---
{
  const { parseDu, patch } = require('../src/main/tree');
  const sizes = parseDu(duOut);
  // delete /r/a/deep (90MB): it and its children vanish, every ancestor shrinks
  patch(sizes, '/r/a/deep', 90*MB, new Map());
  assert.ok(!sizes.has('/r/a/deep') && !sizes.has('/r/a/deep/deeper'), 'deleted subtree dropped');
  assert.strictEqual(sizes.get('/r/a'), 210*MB);
  assert.strictEqual(sizes.get('/r'), 910*MB);
  assert.strictEqual(sizes.get('/r/b'), 200*MB, 'siblings untouched');
  // empty /r/b, keeping the folder (4KB left)
  patch(sizes, '/r/b', 200*MB, new Map([['/r/b', 4096]]));
  assert.strictEqual(sizes.get('/r/b'), 4096);
  assert.strictEqual(sizes.get('/r'), 710*MB + 4096);
  // a loose file never becomes a folder in the tree
  patch(sizes, '/r/a/big.iso', 10*MB, new Map());
  assert.strictEqual(sizes.get('/r/a'), 200*MB);
  assert.ok(!sizes.has('/r/a/big.iso'));
  assert.strictEqual(buildTree(sizes, '/r').size, 700*MB + 4096, 'tree rebuilds from the patched cache');
  assert.strictEqual(buildTree(sizes, '/r/a').size, 200*MB, 'any cached subfolder can be the root');
}
console.log('ok — size cache patch');
// --- cross-platform guard + shared walkers ---
{
  const { guard } = require('../src/main/safety');
  for (const bad of ['C:\\', 'C:\\Users', 'C:\\Users\\me', 'C:\\Program Files', 'C:\\Windows\\System32', '/System', '/Users'])
    assert.ok(guard(bad), 'must refuse ' + bad);
  assert.strictEqual(guard('C:\\Users\\me\\AppData\\Local\\Temp', { contentsOnly: true }), null);
  assert.strictEqual(guard('/Users/me/Library/Caches', { contentsOnly: true }), null);
  const junk = require('../src/main/junk');
  const fsS = require('fs'), osS = require('os'), pathS = require('path');
  const r = fsS.mkdtempSync(pathS.join(osS.tmpdir(), 'junk-'));
  for (const d of ['a/node_modules/x', 'c/target']) fsS.mkdirSync(pathS.join(r, d), { recursive: true });
  fsS.writeFileSync(pathS.join(r, 'a/node_modules/x/f'), Buffer.alloc(10000));
  (async () => {
    assert.ok(await junk.dirSize(pathS.join(r, 'a')) >= 10000);
    const m = await junk.duMap(r);
    assert.ok(m.get(r) >= m.get(pathS.join(r, 'a')) + m.get(pathS.join(r, 'c')), 'parent includes children');
    assert.strictEqual((await junk.largestFiles(r))[0].path, pathS.join(r, 'a/node_modules/x/f'));
    fsS.rmSync(r, { recursive: true });
    console.log('ok — cross-platform guard, shared walkers');
  })();
}
