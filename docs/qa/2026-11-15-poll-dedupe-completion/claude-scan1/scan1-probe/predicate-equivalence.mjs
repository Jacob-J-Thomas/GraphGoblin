// Scan-1 reviewer: compare the committed isPollKeyWellFormed regex with String#isWellFormed.
// Usage: node predicate-equivalence.mjs <repo-root>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(process.argv[2], 'packages/domain/src/poll-items.ts'), 'utf8');
const match = source.match(/return !(\/\[\\uD800-\\uDFFF\]\/u)\.test\(key\);/);
if (!match) throw new Error('predicate shape changed; refusing to guess');
const pattern = /[\uD800-\uDFFF]/u;
const committed = (key) => !pattern.test(key);
let checked = 0;
let mismatches = [];
const check = (s) => {
  checked += 1;
  if (committed(s) !== s.isWellFormed()) mismatches.push([...s].map((c) => c.codePointAt(0).toString(16)));
};
for (let u = 0; u <= 0xffff; u += 1) check(String.fromCharCode(u));
const edges = [0x0, 0x41, 0xd7ff, 0xd800, 0xd83d, 0xdbff, 0xdc00, 0xde00, 0xdfff, 0xe000, 0xfffd, 0xffff];
for (const a of edges) for (const b of edges) {
  check(String.fromCharCode(a, b));
  for (const c of edges) check(String.fromCharCode(a, b, c));
}
let seed = 361;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
for (let i = 0; i < 200_000; i += 1) {
  const len = 1 + Math.floor(rand() * 12);
  const units = Array.from({ length: len }, () =>
    rand() < 0.5 ? 0xd800 + Math.floor(rand() * 0x800) : Math.floor(rand() * 0x10000),
  );
  check(String.fromCharCode(...units));
}
// 512-unit slice through a pair, as single-result mode derives it.
check(('x'.repeat(511) + '😀').slice(0, 512));
check(('x'.repeat(510) + '😀').slice(0, 512));
console.log(JSON.stringify({ node: process.version, committedPattern: match[1], checked, mismatches: mismatches.length, sample: mismatches.slice(0, 5) }));
process.exitCode = mismatches.length === 0 ? 0 : 1;
