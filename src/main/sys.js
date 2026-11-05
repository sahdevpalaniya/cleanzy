const { execFile } = require('child_process');

const run = (cmd, args, opts) => new Promise(res => {
  execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
    res({ out: stdout || '', err: stderr || '', code: err ? err.code ?? 1 : 0 }));   // killed by timeout: code null -> 1
});

// Run a privileged command with a password this app collected. The password is
// written to sudo's stdin and never reaches argv, a log line or disk.
function sudo(password, args) {
  return new Promise(res => {
    const child = execFile('sudo', ['-S', '-k', '-p', '', ...args],
      { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
        res({ out: stdout || '', err: stderr || '', code: err ? (err.code || 1) : 0 }));
    child.stdin.on('error', () => {});
    child.stdin.end(password + '\n');
  });
}

module.exports = { run, sudo };
