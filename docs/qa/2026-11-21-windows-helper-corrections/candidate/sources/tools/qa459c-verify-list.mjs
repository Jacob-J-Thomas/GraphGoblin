// QA459C list-manifest verifier. Not product code. Read-only.
// node qa459c-verify-list.mjs <rootDir> <manifestFile>
// Verifies every "<sha256>  <bytes>  <relative/path>" line of <manifestFile> against <rootDir>.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, manifest] = process.argv.slice(2);
const bytes = readFileSync(manifest);
const lines = bytes.toString('utf8').split('\n').filter(Boolean);
const mismatches = [];
for (const line of lines) {
  const [sha256, size, ...rest] = line.split('  ');
  const path = join(root, rest.join('  '));
  if (!existsSync(path)) {
    mismatches.push({ path: rest.join('  '), reason: 'missing' });
    continue;
  }
  const data = readFileSync(path);
  if (data.length !== Number(size) || createHash('sha256').update(data).digest('hex') !== sha256) mismatches.push({ path: rest.join('  '), reason: 'changed' });
}
console.log(JSON.stringify({ manifestSha256: createHash('sha256').update(bytes).digest('hex'), entries: lines.length, mismatches }));
process.exit(mismatches.length === 0 ? 0 : 1);
