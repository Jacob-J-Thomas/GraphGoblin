// Scan-1 reviewer: read-only summary of committed ports, race and offline-reanalysis receipts.
// Usage: node inspect-receipts.mjs <corrected-preparation-v3 dir>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const read = (p) => JSON.parse(readFileSync(path.join(dir, p), 'utf8'));
const brief = (v, n = 600) => {
  const s = JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const ports = read('ports-attempt-1/result.json');
console.log('ports keys', Object.keys(ports));
const cases = ports.cases ?? ports.results ?? ports.checks ?? [];
console.log('ports cases', Array.isArray(cases) ? cases.length : typeof cases);
if (Array.isArray(cases))
  for (const c of cases) console.log(' -', c.name ?? c.label ?? c.id, c.pass ?? c.ok ?? c.status ?? '', brief(c.observed ?? c.calls ?? '', 160));
const race = read('race-attempt-1/result.json');
console.log('race', brief(race, 1600));
const offline = read('diagnostic-reanalysis/receipt.json');
console.log('offline keys', Object.keys(offline));
for (const k of Object.keys(offline)) {
  if (['windows', 'assignments', 'warnings'].includes(k) && Array.isArray(offline[k])) {
    console.log(k, offline[k].length);
    const neg = offline[k].filter((w) => JSON.stringify(w).includes('-1'));
    console.log(' sample', brief(offline[k][0], 400));
  } else console.log(k, brief(offline[k], 400));
}
