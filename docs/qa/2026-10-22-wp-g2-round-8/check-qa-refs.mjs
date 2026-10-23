// Report artefacts a QA folder's Markdown files cite that are missing from the folder. Citations
// are Markdown links, backtick-quoted names, and bare file names in prose or tables (the G2, F1
// and F4 records cite "outage.txt and outage-recovered.txt" or "gate-*.txt files" without links).
// Usage: node check-qa-refs.mjs <dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const dir = process.argv[2];
const walk = (d) =>
  readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(dir);
// A QA round often has a sibling report `<folder>.md` beside the folder; its citations count too.
try {
  if (statSync(`${dir}.md`).isFile()) files.push(`${dir}.md`);
} catch {
  // no sibling report
}
const present = new Set(files.map((f) => basename(f)));
const presentRel = new Set(files.map((f) => relative(dir, f).replace(/\\/g, '/')));
// Files a NOT-KEPT.md records (first table column) count as resolved: recorded as not kept.
let notKept = 0;
for (const file of files.filter((f) => basename(f) === 'NOT-KEPT.md')) {
  for (const match of readFileSync(file, 'utf8').matchAll(/^\| `([^`]+)` \|/gm)) {
    present.add(basename(match[1]));
    presentRel.add(match[1]);
    notKept += 1;
  }
}
// Names that are repository files or tooling, not evidence, when they appear in prose.
const ignore = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'turbo.json',
  'main.js',
  'index.html',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
]);
// Longest alternatives first: `x.log.txt` must match whole, not as `x.log` followed by `.txt`.
const EXT =
  'aria\\.txt|log\\.txt|mjs\\.txt|ps1\\.txt|json\\.txt|diff\\.txt|jsonl|json|log|mjs|cjs|js|txt|ps1|sh|png|csv|html|md';
const missing = new Map(); // name -> how it was cited
let cited = 0;
const note = (name, how) => {
  cited += 1;
  if (!presentRel.has(name) && !present.has(basename(name))) missing.set(name, how);
};
for (const file of files) {
  if (!file.endsWith('.md')) continue;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)\s#]+)\)/g)) {
    const target = match[1].replace(/^\.\//, '');
    if (/^[a-z]+:/i.test(target)) continue;
    note(target, 'link');
  }
  for (const match of text.matchAll(new RegExp(`\`([A-Za-z0-9_./\\\\-]+\\.(?:${EXT}))\``, 'g'))) {
    note(basename(match[1].replace(/\\/g, '/')), 'quoted');
  }
  for (const match of text.matchAll(new RegExp(`(?<![\\w./\\\\-])([A-Za-z0-9_][A-Za-z0-9_-]*\\.(?:${EXT}))(?![\\w-])`, 'g'))) {
    const name = match[1];
    if (ignore.has(name) || name.includes('*') || name === basename(file)) continue;
    // Source files mentioned with their folder are repository paths, not evidence.
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (/(src|packages|apps|docs|tooling)[/\\][\w./-]*$/.test(before)) continue;
    note(name, 'bare');
  }
}
const list = [...missing].sort(([a], [b]) => a.localeCompare(b)).map(([n, how]) => `${n} (${how})`);
console.log(
  `${dir}: ${files.length} files, ${cited} citations, ${notKept} recorded as not kept, ${missing.size} missing${missing.size ? ': ' + list.join(', ') : ''}`,
);
process.exitCode = missing.size ? 1 : 0;
