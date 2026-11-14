// Static scan of apps/web/e2e for loop names passed as literals (not through uniqueLoopName), and
// for any pair that ADR-0073 would treat as the same name (trim, collapse whitespace, lowercase).
// Usage: node scan-literal-loop-names.mjs <repo-root>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const dir = join(root, 'apps', 'web', 'e2e');
const key = (name) => name.trim().replace(/\s+/gu, ' ').toLowerCase();
const patterns = [
  // approvalLoop('literal') or approvalLoop(`literal ${x}`) with no uniqueLoopName around it
  /approvalLoop\(\s*(['"`])((?:(?!\1).)+)\1\s*\)/gu,
  // a loop definition whose name is a plain literal on the same line as a loop-ish helper
  /(?:minimalLoop\(\)|definition|loop),\s*name:\s*(['"`])((?:(?!\1).)+)\1/gu,
];
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.includes('uniqueLoopName')) return;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        rows.push({ file, line: index + 1, name: match[2], templated: match[2].includes('${') });
      }
    }
  });
}
const byKey = new Map();
for (const row of rows) {
  const k = key(row.name);
  byKey.set(k, [...(byKey.get(k) ?? []), row]);
}
console.log(`literal loop-name sites (not wrapped in uniqueLoopName): ${rows.length}`);
for (const row of rows) {
  console.log(`  ${row.file}:${row.line}  ${JSON.stringify(row.name)}${row.templated ? '  [templated]' : ''}`);
}
const dupes = [...byKey.entries()].filter(([, list]) => list.length > 1);
console.log(`equivalent-name groups with more than one site: ${dupes.length}`);
for (const [k, list] of dupes) {
  console.log(`  ${JSON.stringify(k)} -> ${list.map((r) => `${r.file}:${r.line}`).join(', ')}`);
}
