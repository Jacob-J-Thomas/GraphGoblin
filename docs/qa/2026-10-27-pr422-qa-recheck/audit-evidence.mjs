import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as L from './lib.mjs';
const ids = new Set();
const prior = JSON.parse(fs.readFileSync(path.join(L.RECORD, 'owned-pid-check.json'), 'utf8'));
for (const p of prior.results) ids.add(p.pid);
for (const name of fs.readdirSync(L.RECORD)) {
  const match = name.match(/-(\d+)\.log\.txt$/);
  if (match) ids.add(Number(match[1]));
}
const pids = [...ids]
  .sort((a, b) => a - b)
  .map((pid) => {
    try {
      process.kill(pid, 0);
      return { pid, state: 'alive' };
    } catch (error) {
      return { pid, state: error.code === 'ESRCH' ? 'absent' : 'unverified', error: error.code };
    }
  });
L.save('owned-pid-check.json', { ...prior, results: pids });
const leaks = [],
  bom = [],
  oversized = [],
  invalidJson = [];
const names = fs
  .readdirSync(L.RECORD)
  .filter((n) => fs.statSync(path.join(L.RECORD, n)).isFile() && n !== 'evidence-manifest.json');
const manifest = [];
for (const name of names) {
  const p = path.join(L.RECORD, name),
    bytes = fs.readFileSync(p);
  if (bytes.length > 1000000) oversized.push({ name, bytes: bytes.length });
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) bom.push(name);
  if (/\.(?:json|md|mjs|ps1|txt)$/.test(name)) {
    const text = bytes.toString('utf8');
    if (/C:[\\/]+Users[\\/]+[^\\/\s"']+|S-1-\d+(?:-\d+)+/i.test(text)) leaks.push(name);
    if (name.endsWith('.json'))
      try {
        JSON.parse(text);
      } catch {
        invalidJson.push(name);
      }
  }
  manifest.push({
    name,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
}
L.save('evidence-manifest.json', {
  generatedAt: new Date().toISOString(),
  excludes: 'This manifest itself',
  files: manifest,
});
console.log(
  JSON.stringify({
    files: manifest.length,
    oversized,
    bom,
    profileOrSidLeaks: leaks,
    invalidJson,
    knownPidCount: pids.length,
    knownPidsRemaining: pids.filter((p) => p.state !== 'absent'),
  }),
);
if (
  oversized.length ||
  bom.length ||
  leaks.length ||
  invalidJson.length ||
  pids.some((p) => p.state !== 'absent')
)
  process.exitCode = 1;
