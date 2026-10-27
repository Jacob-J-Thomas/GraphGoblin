// Disposable external program only; never edits GraphGoblin or its database.
import fs from 'node:fs';
const [mode, marker, release] = process.argv.slice(2);
fs.appendFileSync(marker, JSON.stringify({ pid: process.pid, mode, at: Date.now() }) + '\n');
if (mode === 'exit') process.exit(fs.existsSync(release) ? 0 : 7);
if (mode === 'hold') {
  const t = setInterval(() => {
    if (fs.existsSync(release)) {
      clearInterval(t);
      process.exit(0);
    }
  }, 40);
  setTimeout(() => process.exit(9), 120000).unref();
}
