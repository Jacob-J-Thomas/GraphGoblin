// Check lost-original annotations and HEAD membership; never run product behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const out = new URL('.', import.meta.url);
const root = new URL('../', out);
const repo = new URL('../../../../', out);
const prefix = 'docs/qa/2026-10-22-wp-d1-321-qa/';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const read = async (name) =>
  JSON.parse((await fs.readFile(new URL(name, root), 'utf8')).replace(/^\uFEFF/, ''));
const manifest = await read('round-4/citation-dispositions.json');
assert.equal(git('rev-parse', 'HEAD'), manifest.head);
const kept = new Set(
  git('ls-tree', '-r', '--name-only', 'HEAD', prefix)
    .split(/\r?\n/)
    .map((p) => p.slice(prefix.length)),
);
assert.equal(manifest.losses.length, 28);
const losses = new Map(manifest.losses.map((d) => [d.originalPath, d]));
assert.equal(losses.size, 28);
const filenameOutput = await fs.readFile(new URL('orchestrator-check.log.txt', out), 'utf8');
const filenameMissing = [...filenameOutput.matchAll(/([\w.-]+) \((?:bare|quoted|link)\)/g)].map(
  (m) => m[1],
);
for (const name of filenameMissing)
  assert(losses.has(name), `Undispositioned checker finding: ${name}`);
let replacements = 0;
for (const d of losses.values()) {
  assert.equal(d.disposition, 'original not kept');
  assert.equal(d.originalRecovered, false);
  assert(!kept.has(d.originalPath));
  if (d.replacement) {
    assert(kept.has(d.replacement.path), `Not in HEAD: ${d.replacement.path}`);
    assert.match(d.replacement.round, /^round [23]$/);
    replacements++;
  } else assert.match(d.limitation, /No equivalent retained/);
}
// All original JSON leaf values, including failures, IDs, times, counts, coverage
// and statuses, must survive. New evidence-retention metadata is additive.
let preservedLeaves = 0;
function preserve(before, after) {
  if (before !== null && typeof before === 'object') {
    for (const [key, value] of Object.entries(before)) {
      assert(Object.hasOwn(after, key));
      preserve(value, after[key]);
    }
  } else {
    assert.deepEqual(after, before);
    preservedLeaves++;
  }
}
let originalJsonReferences = 0;
for (const name of ['gate-checks.json', 'checks.json']) {
  const before = JSON.parse(git('show', `HEAD:${prefix}${name}`));
  const after = await read(name);
  preserve(before, after);
  for (const row of after) {
    if (!losses.has(row.evidence)) continue;
    assert.deepEqual(row.evidenceRetention, losses.get(row.evidence));
    originalJsonReferences++;
  }
}
let originalMarkdownReferences = 0;
for (const name of ['report.md', 'README.md']) {
  const before = git('show', `HEAD:${prefix}${name}`);
  const after = await fs.readFile(new URL(name, root), 'utf8');
  for (const hit of after.matchAll(/`([^`\n]+)`/g)) {
    if (!losses.has(hit[1])) continue;
    const tail = after.slice(hit.index + hit[0].length);
    assert(tail.startsWith(' (original not kept'), `Unlabelled occurrence in ${name}: ${hit[1]}`);
  }
  for (const hit of before.matchAll(/`([^`\n]+)`/g)) {
    if (!losses.has(hit[1])) continue;
    const expected = '`' + hit[1] + '` (original not kept';
    assert(after.includes(expected), `No inline loss annotation in ${name}: ${hit[1]}`);
    originalMarkdownReferences++;
  }
}
for (const input of manifest.historicalQaInputs) {
  assert.equal(input.disposition, 'original not kept');
  assert(kept.has(input.replacement));
}
const changed = git('diff', '--name-only').split(/\r?\n/).filter(Boolean);
assert(
  changed.every((p) => p.startsWith(prefix)),
  'Changed a non-QA tracked file.',
);
assert.equal(git('diff', '--cached', '--name-only'), '', 'Git index changed.');
const links = [];
const documents = [];
const roundReadme = await fs.readFile(new URL('README.md', out), 'utf8');
const directRoundLinks = new Set(
  [...roundReadme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]),
);
const newArtifacts = await fs.readdir(out);
for (const name of newArtifacts)
  if (name !== 'README.md')
    assert(directRoundLinks.has(name), `Round-4 artifact not directly linked: ${name}`);
async function walk(url) {
  for (const e of await fs.readdir(url, { withFileTypes: true })) {
    if (e.isDirectory()) await walk(new URL(e.name + '/', url));
    else if (/\.(md|json|jsonl|mjs|ps1|txt)$/.test(e.name)) documents.push(new URL(e.name, url));
  }
}
await walk(root);
for (const url of documents) {
  // Limit new content's privacy scan; pre-existing unrelated artifacts stay untouched.
  const relative = fileURLToPath(url).slice(fileURLToPath(root).length).replaceAll('\\', '/');
  const text = await fs.readFile(url, 'utf8');
  if (relative.startsWith('round-4/') || changed.includes(prefix + relative)) {
    assert(!/[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i.test(text), `Local user directory in ${relative}`);
  }
  if (!relative.endsWith('.md')) continue;
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    const target = new URL(m[1], url);
    const targetRel = fileURLToPath(target).slice(fileURLToPath(root).length).replaceAll('\\', '/');
    await fs.access(target);
    assert(
      kept.has(targetRel) || targetRel.startsWith('round-4/'),
      `Link not in HEAD or new round-4 evidence: ${targetRel}`,
    );
    links.push({ source: relative, target: targetRel, inHead: kept.has(targetRel) });
  }
}
const result = {
  status: 'PASS',
  head: manifest.head,
  auditedPaths: losses.size,
  originalsRecovered: 0,
  originalJsonReferences,
  originalMarkdownReferences,
  originalReferences: originalJsonReferences + originalMarkdownReferences,
  filenameCheckerFindingsExplicitlyLost: filenameMissing.length,
  preservedOriginalJsonLeaves: preservedLeaves,
  laterReplacementEntriesInHead: replacements,
  distinctReplacementPathsInHead: new Set(
    manifest.losses.flatMap((d) => (d.replacement ? [d.replacement.path] : [])),
  ).size,
  noEquivalentReplacement: losses.size - replacements,
  historicalCommandInputsExplicitlyLost: manifest.historicalQaInputs.length,
  markdownLinksChecked: links.length,
  newArtifactCount: newArtifacts.length,
  allNewArtifactsDirectlyLinked: true,
  newRound4LinksPendingOrchestratorCommit: links.filter((l) => !l.inHead).length,
  noProductOrIndexChanges: true,
  localUserDirectoriesInNewContent: false,
  behaviorChecksRepeated: false,
};
await fs.writeFile(new URL('validation.json', out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
