// Disposable external-effect probe for #321. Never point this at an owner store.
import fs from 'node:fs';
import process from 'node:process';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
const [marker, release, maxWait = '600000'] = process.argv.slice(2);
if (!marker || !release) throw new Error('Usage: marker.mjs <marker> <release> [maxWaitMs]');
const active = `${marker}.active-${process.pid}`;
fs.writeFileSync(active, String(process.pid));
process.once('exit', () => fs.rmSync(active, { force: true }));
fs.appendFileSync(marker, 'effect\n');
process.stdout.write('effect produced; waiting for release\n');
const timer = setInterval(() => {
  if (fs.existsSync(release)) {
    clearInterval(timer);
    process.exit(0);
  }
}, 25);
setTimeout(() => process.exit(1), Number(maxWait)).unref();
