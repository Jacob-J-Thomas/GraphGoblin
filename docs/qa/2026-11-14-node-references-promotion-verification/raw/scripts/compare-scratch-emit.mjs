// Read-only: compare a from-scratch tsc emit (scratch directory) with the real dist tree, file by file.
// Usage: node compare-scratch-emit.mjs <scratch-dir> <dist-dir> <result.json>
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [scratch, dist, resultFile] = process.argv.slice(2);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const list = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? list(join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
const scratchFiles = list(scratch).sort();
const distFiles = list(dist).sort();
const kind = (name) => (name.endsWith('.d.ts.map') ? 'd.ts.map' : name.endsWith('.js.map') ? 'js.map' : name.endsWith('.d.ts') ? 'd.ts' : name.endsWith('.js') ? 'js' : name === '.tsbuildinfo' ? 'tsbuildinfo' : 'other');
const rows = {};
const differing = [];
for (const name of scratchFiles) {
  const k = kind(name);
  rows[k] ??= { files: 0, byteIdentical: 0, differing: 0, missingInDist: 0 };
  rows[k].files++;
  if (!distFiles.includes(name)) { rows[k].missingInDist++; differing.push({ name, reason: 'missing in dist' }); continue; }
  if (digest(readFileSync(join(scratch, name))) === digest(readFileSync(join(dist, name)))) rows[k].byteIdentical++;
  else { rows[k].differing++; differing.push({ name, reason: 'bytes differ', kind: k }); }
}
const onlyInDist = distFiles.filter((name) => !scratchFiles.includes(name));
const authoritative = ['js', 'd.ts'].every((k) => rows[k] && rows[k].files === rows[k].byteIdentical);
const result = { scratchFiles: scratchFiles.length, distFiles: distFiles.length, onlyInDist, byKind: rows, authoritativeJsAndDtsAllByteIdentical: authoritative, differing };
writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ scratchFiles: scratchFiles.length, distFiles: distFiles.length, onlyInDist, byKind: rows, authoritativeJsAndDtsAllByteIdentical: authoritative, differingSample: differing.slice(0, 6) }, null, 2));
