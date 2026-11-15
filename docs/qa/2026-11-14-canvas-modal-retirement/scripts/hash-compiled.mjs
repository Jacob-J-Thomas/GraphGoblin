// Read-only. Hashes the 13 retained compiled trees of the admitted checkout and compares each file with the
// phase-1 candidate-build manifests. No build, no emit, no process launch. Writes only the JSON path in argv[2].
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const checkout = 'C:/Users/98jak/.codex/worktrees/gg-20261114-canvas/GraphGoblin';
const manifests = `${batch}/ui-207-phase1/manifests/candidate-build`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const out = { label: process.argv[3] ?? '', checkedAt: new Date().toISOString(), trees: [], files: 0, ok: true };
const combined = createHash('sha256');
for (const name of readdirSync(manifests).filter((n) => n.endsWith('.sha256')).sort()) {
  const tree = name.replace(/\.sha256$/, '').replaceAll('_', '/');
  const rows = readFileSync(`${manifests}/${name}`, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((r) => /^([a-f0-9]{64}) \*\.\/(.+)$/.exec(r));
  const expected = new Map(rows.map((m) => [m[2], m[1]]));
  const present = walk(`${checkout}/${tree}`)
    .map((f) => relative(`${checkout}/${tree}`, f).split(String.fromCharCode(92)).join('/'))
    .sort();
  const actual = present.map((p) => [p, sha(readFileSync(`${checkout}/${tree}/${p}`))]);
  const listing = actual.map(([p, h]) => `${h} *./${p}`).join('\n') + '\n';
  combined.update(`${tree}\n${listing}`);
  const missing = [...expected.keys()].filter((k) => !present.includes(k));
  const extra = present.filter((k) => !expected.has(k));
  const changed = actual.filter(([p, h]) => expected.has(p) && expected.get(p) !== h).map(([p]) => p);
  const ok = !missing.length && !extra.length && !changed.length;
  out.trees.push({ tree, files: present.length, listingSha256: sha(listing), missing, extra, changed, ok });
  out.files += present.length;
  if (!ok) out.ok = false;
}
out.combinedSha256 = combined.digest('hex');
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ label: out.label, ok: out.ok, trees: out.trees.length, files: out.files, combinedSha256: out.combinedSha256 }));
