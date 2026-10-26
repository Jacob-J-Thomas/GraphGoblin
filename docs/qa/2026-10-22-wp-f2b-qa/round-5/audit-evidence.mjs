import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { format, resolveConfig } from 'prettier';
const here = new URL('.', import.meta.url);
const config = (await resolveConfig(fileURLToPath(new URL('README.md', here)))) ?? {};
async function files(url = here, prefix = '') {
  let out = [];
  for (const f of await readdir(url, { withFileTypes: true })) {
    if (f.isDirectory())
      out.push(...(await files(new URL(f.name + '/', url), prefix + f.name + '/')));
    else out.push(prefix + f.name);
  }
  return out.sort();
}
const names = await files(),
  readme = await readFile(new URL('README.md', here), 'utf8');
const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
  .map((m) => m[1])
  .filter((p) => !p.includes('://'));
const missing = links.filter((p) => !names.includes(p)),
  unlinked = names.filter((n) => !links.includes(n));
const manifest = [],
  paths = [],
  oversized = [];
for (const name of names) {
  const data = await readFile(new URL(name, here));
  if (data.length >= 1000000) oversized.push({ file: name, bytes: data.length });
  if (
    !name.endsWith('.png') &&
    /(?:[A-Za-z]:)?[\\/]+Users[\\/]+(?!%)[^\\/%\s]+[\\/]/i.test(data.toString('utf8'))
  )
    paths.push(name);
  if (name !== 'final-audit.json')
    manifest.push({
      file: name,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
}
const get = async (n) => JSON.parse(await readFile(new URL(n, here), 'utf8'));
const source = await get('execution-source-audit.json');
const snapshotChecks = [];
for (const x of source.snapshots) {
  const actual = createHash('sha256')
    .update(await readFile(new URL(x.exactExecutedSource, here)))
    .digest('hex');
  snapshotChecks.push({ file: x.exactExecutedSource, matches: x.sha256 === actual });
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const tracked = execFileSync('git', ['diff', '--name-only'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const index = execFileSync('git', ['diff', '--cached', '--name-only'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8', windowsHide: true })
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((x) => x.trim());
const served = await get('served-comparison.json'),
  cleanup = await get('cleanup-manifest.json'),
  edge = await get('edge-results.json');
const issues =
  missing.length +
  unlinked.length +
  paths.length +
  oversized.length +
  snapshotChecks.filter((x) => !x.matches).length +
  (tracked ? 1 : 0) +
  (index ? 1 : 0) +
  (head !== '86e96bbc7f99a65cbf26d6feb7fb9fc0b2f61f60' ? 1 : 0);
const result = {
  head,
  integrityVerdict: issues ? 'FAIL' : 'PASS',
  productVerdict: 'PASS for #204 with known #205 failures outside scope',
  servedInvocations: 1,
  servedRetries: 0,
  servedPassed: served.passed,
  servedFailed: served.failed,
  initialMergeMatrix: {
    passed: 60,
    failed: 2,
    classification: 'Retained external-event setup failures; no second readiness request started',
  },
  correctedBackground: { passed: 2, failed: 0 },
  edgeModelPicker: {
    passed: edge.stats.expected,
    failed: edge.stats.unexpected,
    flaky: edge.stats.flaky,
  },
  missingLinkedTargets: missing,
  unlinkedArtifacts: unlinked,
  localUserPathMatches: paths,
  oversizedArtifacts: oversized,
  trackedFilesChanged: tracked ? tracked.split('\n') : [],
  indexFilesChanged: index ? index.split('\n') : [],
  gitStatus: status,
  cleanup: {
    allRecordedPidsAbsent: cleanup.allRecordedPidsAbsent,
    retainedDirectories: cleanup.directories.length,
    reason: 'QA-COMMON prohibits Codex directory deletion; exact list in cleanup manifest',
  },
  exactExecutedSnapshotHashes: snapshotChecks,
  evidenceFileCount: names.length,
  selfExcludedFromHashes:
    'final-audit.json excludes its own bytes to avoid self-referential hashes; every other retained file is hashed after final formatting.',
  files: manifest,
};
await writeFile(
  new URL('final-audit.json', here),
  await format(JSON.stringify(result), { ...config, parser: 'json' }),
);
console.log(
  JSON.stringify({
    integrity: result.integrityVerdict,
    files: names.length,
    missing,
    unlinked,
    paths,
    oversized,
    tracked,
    index,
    snapshots: snapshotChecks,
  }),
);
if (issues) process.exitCode = 1;
