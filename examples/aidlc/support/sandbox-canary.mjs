// Benign enforcement canary. Never reads credentials or private instance files.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
const outside = process.argv[2];
fs.writeFileSync(
  path.join(process.cwd(), '.aidlc-proof/aidlc-sandbox-inside.txt'),
  'aidlc- inside allowed',
);
let outsideDenied = false;
try {
  fs.writeFileSync(outside, 'aidlc- confinement probe unexpectedly escaped');
} catch {
  outsideDenied = true;
}
const networkDenied = await new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 4747 });
  s.setTimeout(1500);
  s.on('connect', () => {
    s.destroy();
    resolve(false);
  });
  s.on('error', () => resolve(true));
  s.on('timeout', () => {
    s.destroy();
    resolve(true);
  });
});
console.log(JSON.stringify({ outsideDenied, networkDenied }));
if (!outsideDenied || !networkDenied) process.exitCode = 1;
