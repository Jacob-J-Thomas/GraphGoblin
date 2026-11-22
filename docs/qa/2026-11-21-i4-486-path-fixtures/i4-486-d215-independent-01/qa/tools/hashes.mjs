// Seal: sha256 and byte length of REPORT.md, qa/RESULTS.json and every file under qa/tools and
// qa/raw. Writes qa/SHA256SUMS.json exclusively (never overwrites).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EVID = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d215-independent-01';
const files = ['REPORT.md', 'qa\\RESULTS.json'];
for (const dir of ['qa\\tools', 'qa\\raw'])
  for (const name of fs.readdirSync(path.join(EVID, dir)).sort()) files.push(`${dir}\\${name}`);
const entries = files.map((rel) => {
  const bytes = fs.readFileSync(path.join(EVID, rel));
  return {
    path: rel.replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
});
const seal = { sealedAt: new Date().toISOString(), root: EVID, count: entries.length, files: entries };
fs.writeFileSync(path.join(EVID, 'qa', 'SHA256SUMS.json'), JSON.stringify(seal, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify({ count: entries.length, report: entries[0], results: entries[1] }));
