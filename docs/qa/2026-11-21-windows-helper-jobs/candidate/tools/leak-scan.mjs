// GraphGoblin #459 independent QA: leak scan of the public folder.
// Usage: node leak-scan.mjs <public dir> <output json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, relative } from 'node:path';

const [dir, output] = process.argv.slice(2);
const user = os.userInfo().username;
const checks = [
  ['<USER>', new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
  ['user-profile-path', /C:[\\/]+Users/i],
  ['scratch-or-checkout-root', /G:[\\/]+ggq/i],
  ['sentinel-value', /QA459-SENTINEL-[0-9a-f]{12}/],
  ['drive-path', /\b[A-Za-z]:\\{1,2}[A-Za-z][^'"\s)`]*/g],
];
const hits = [];
let files = 0;
const walk = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files++;
      const text = readFileSync(full, 'latin1');
      for (const [name, pattern] of checks) {
        if (pattern.global) for (const match of text.matchAll(pattern)) hits.push({ file: relative(dir, full), check: name, value: match[0] });
        else if (pattern.test(text)) hits.push({ file: relative(dir, full), check: name });
      }
    }
  }
};
walk(dir);
const reviewed = hits.every((hit) => hit.check === 'drive-path' && /^C:\\{1,2}Windows$/.test(hit.value));
writeFileSync(output, JSON.stringify({ scannedAt: new Date().toISOString(), files, hits, onlyGenericWindowsLiterals: reviewed }, null, 2) + '\n');
console.log(JSON.stringify({ files, hits, onlyGenericWindowsLiterals: reviewed }));
