import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const qa = resolve(here, '..'),
  round3 = resolve(qa, 'round-3');
const head = '492b283b49747e91470d94dca7028caa4eeb6c3d';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== head) throw Error('Pinned HEAD differs');
const rel = relative(repo, round3).replaceAll('\\', '/');
const names = git('ls-files', rel)
  .split('\n')
  .filter(Boolean)
  .map((p) => p.slice(rel.length + 1))
  .sort();
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const phase = process.argv[2] ?? 'verify';
if (phase === 'prepare') {
  const initialPath = join(here, 'evidence-repair-before.json');
  if (!(await exists(initialPath))) {
    const old = await load(join(round3, 'artifact-manifest.json'));
    const failures = [];
    for (const item of old.artifacts) {
      const path = join(round3, item.name);
      if (!(await exists(path))) failures.push({ name: item.name, problem: 'missing on disk' });
      else if (hash(await readFile(path)) !== item.sha256)
        failures.push({ name: item.name, problem: 'hash differs' });
      if (!names.includes(item.name))
        failures.push({ name: item.name, problem: 'not committed at snapshot HEAD' });
    }
    await save(initialPath, {
      snapshotHead: head,
      scope: 'Committed round-3 file inventory; actual disk bytes',
      committedFiles: names.length,
      oldManifestHead: old.head,
      oldEntries: old.artifacts.length,
      failures,
      committedFilesAbsentFromOldManifest: names.filter(
        (n) => !old.artifacts.some((a) => a.name === n),
      ),
      historicalObservationsRegenerated: false,
    });
  }
  let text = await readFile(join(qa, 'report.md'), 'utf8');
  text = text.replace(
    'That adapter-induced result is retained in api-helper-copy-coverage.json.',
    'That adapter-induced result is described here as a historical observation; its raw artifact was not retained in the curated tree.',
  );
  text = text.replace(
    'A corrected evidence-only Vite adapter (api-coverage.config.ts)',
    'A corrected evidence-only Vite adapter (its original setup file was not retained)',
  );
  text = text.replace(
    'PASS; see format-gate.json',
    'PASS as historically reported; raw format evidence was not retained',
  );
  await writeFile(join(qa, 'report.md'), text);
  const r2 = join(qa, 'round-2', 'README.md');
  text = await readFile(r2, 'utf8');
  const lostDescriptions = {
    'served-initial-results.json': 'initial served observations',
    'collector-observation-results.json': 'observation-only collector output',
    'served-initial-lifecycle.json': 'initial served lifecycle record',
    'collector-observation-lifecycle.json': 'observation-only collector lifecycle record',
  };
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, target) => {
    const absolute = resolve(dirname(r2), target);
    // Only this curated directory has the README; no missing artifact is relabelled as a later run.
    if (target === 'README.md' || target === '../round-3/README.md') return full;
    const words =
      lostDescriptions[target] ?? (label.includes('.') ? 'result or replay artifact' : label);
    return 'the original round-2 ' + words + ' (not retained)';
  });
  const warning =
    '**Evidence availability correction at ' +
    head +
    ':** this is a historical report for 18890113. Its raw round-2 artifacts were not carried into the curated tree. Missing file references below are withdrawn; the earlier observations have not been regenerated. Fresh, separately dated evidence is in the [round-3 report](../round-3/README.md).\n\n';
  if (!text.includes('**Evidence availability correction at '))
    text = text.replace(/\n\n/, '\n\n' + warning);
  text = text.replace(
    'the original round-2 initial served observations (not retained) preserves the first run.',
    'The initial served observations from that run were not retained.',
  );
  text = text.replace(
    'preserved in the original round-2 observation-only collector output (not retained)',
    'described historically here, with its raw output not retained',
  );
  await writeFile(r2, text);
  let readme = await readFile(join(round3, 'README.md'), 'utf8');
  const marker = '## Evidence record maintenance (round 4)';
  if (!readme.includes(marker)) {
    const note =
      marker +
      '\n\nThe manifest and integrity audit were regenerated at **' +
      head +
      '** from the committed file inventory and the bytes now on disk. The earlier manifest became stale when curation renamed six ignored logs to tracked .log.txt copies, formatted files and stripped paths; round-4 source changes also postdate the original run. The six retained logs are the committed .log.txt files. The historical observations above still belong to 541fddd4; this repair does not re-execute them or certify the revised replay script as the original executed bytes.\n\nEvery round-3 file is linked and hash-covered. The manifest hashes every other file, including final-audit.json. Its own SHA-256 is stored in the external [round-4 integrity anchor](../round-4/round-3-integrity.json), avoiding a circular self-hash. The anchor also hashes all round-3 files. Run the [repair verifier](../round-4/repair-evidence.mjs) after any later formatting or path stripping; regenerate the seal if bytes change.\n\n';
    readme = readme.replace('## Replay', note + '## Replay');
  }
  await writeFile(join(round3, 'README.md'), readme);
  console.log('Prepared evidence provenance and withdrawn missing historical references');
}
async function linkAudit() {
  const readme = await readFile(join(round3, 'README.md'), 'utf8');
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  const missing = [];
  for (const target of links) if (!(await exists(resolve(round3, target)))) missing.push(target);
  return { unlinkedFiles: names.filter((n) => !links.includes(n)), missingLinkedTargets: missing };
}
if (phase === 'seal') {
  const onDisk = (await readdir(round3, { withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort();

  const missingCommitted = names.filter((n) => !onDisk.includes(n));
  if (missingCommitted.length) throw Error('Committed round-3 files missing');
  const ignored = [];
  for (const name of onDisk.filter((n) => !names.includes(n))) {
    const canonical = name + '.txt';
    if (!name.endsWith('.log') || !names.includes(canonical))
      throw Error('Unexpected uncommitted round-3 file');
    const data = await readFile(join(round3, name));
    if (hash(data) !== hash(await readFile(join(round3, canonical))))
      throw Error('Ignored log differs from committed copy');
    ignored.push({
      name,
      canonicalArtifact: canonical,
      bytes: data.length,
      sha256: hash(data),
      committed: false,
      removal: 'Automatic approval review rejected removal: blocked by policy',
    });
  }

  const knownAnchor = '../round-4/round-3-integrity.json';
  const links = await linkAudit();
  const missing = links.missingLinkedTargets.filter((t) => t !== knownAnchor);
  if (links.unlinkedFiles.length || missing.length) throw Error('Unlinked or missing artifact');
  const observedChanged = git('diff', '--name-only', 'HEAD', '--', rel)
    .split('\n')
    .filter(Boolean)
    .filter(
      (p) =>
        !['README.md', 'artifact-manifest.json', 'final-audit.json'].some(
          (n) => p === rel + '/' + n,
        ),
    );
  if (observedChanged.length)
    throw Error('Historical observation/script bytes changed during repair');
  const timestamp = new Date().toISOString();
  await save(join(round3, 'final-audit.json'), {
    kind: 'evidence-integrity-repair',
    snapshotHead: head,
    regeneratedAtUtc: timestamp,
    historicalObservationHead: '541fddd4e7d0ff87408b0427b86721345f604f4d',
    historicalObservationsRegenerated: false,
    scope:
      'Committed inventory at snapshot HEAD; on-disk README/integrity repairs explicitly included',
    files: names.length,
    allCommittedFilesPresent: true,
    unlinkedCommittedFiles: [],
    missingLinkedTargets: [],
    ignoredWorkingCopyDuplicates: ignored,
    hashCoverage:
      'All 41 committed files via manifest plus external anchor; 6 ignored working-copy aliases hashed separately; no circular manifest self-hash',
    manifestSelfHashLocation: knownAnchor,
    productAcceptance:
      'Not rerun or reassessed by this integrity audit; see the round-4 report for fresh tests',
  });
  const artifacts = [];
  for (const name of names)
    if (name !== 'artifact-manifest.json') {
      const data = await readFile(join(round3, name));
      artifacts.push({ name, bytes: data.length, sha256: hash(data) });
    }
  await save(join(round3, 'artifact-manifest.json'), {
    snapshotHead: head,
    historicalObservationHead: '541fddd4e7d0ff87408b0427b86721345f604f4d',
    regeneratedAtUtc: timestamp,
    scope: 'Committed inventory plus explicit README/final-audit repairs; actual on-disk bytes',
    self: { name: 'artifact-manifest.json', sha256RecordedIn: knownAnchor },
    artifacts,
  });
  const all = [];
  for (const name of names) {
    const data = await readFile(join(round3, name));
    all.push({ name, bytes: data.length, sha256: hash(data), committed: true });
  }
  all.push(...ignored);
  await save(join(here, 'round-3-integrity.json'), {
    snapshotHead: head,
    generatedAtUtc: timestamp,
    historicalObservationsRegenerated: false,
    manifestSha256: all.find((f) => f.name === 'artifact-manifest.json').sha256,
    allRound3Files: all,
  });
  console.log('Sealed ' + all.length + ' round-3 files; external self-hash anchor written');
}
if (phase === 'verify' || phase === 'seal') {
  const anchor = await load(join(here, 'round-3-integrity.json'));
  const manifest = await load(join(round3, 'artifact-manifest.json'));
  const mismatches = [];
  for (const item of anchor.allRound3Files) {
    const path = join(round3, item.name);
    if (!(await exists(path)) && item.committed !== false)
      mismatches.push({ name: item.name, problem: 'missing committed artifact' });
    else if (!(await exists(path))) continue;
    else if (hash(await readFile(path)) !== item.sha256)
      mismatches.push({ name: item.name, problem: 'hash differs' });
  }
  for (const item of manifest.artifacts)
    if (hash(await readFile(join(round3, item.name))) !== item.sha256)
      mismatches.push({ name: item.name, problem: 'manifest hash differs' });
  const links = await linkAudit();
  const pass =
    !mismatches.length &&
    !links.unlinkedFiles.length &&
    !links.missingLinkedTargets.length &&
    anchor.allRound3Files.filter((f) => f.committed !== false).length === names.length;
  await save(join(here, 'integrity-verification.json'), {
    snapshotHead: head,
    phase,
    committedFiles: names.length,
    filesHashVerified: anchor.allRound3Files.length,
    ignoredCopies: anchor.allRound3Files.filter((f) => f.committed === false).length,
    manifestEntries: manifest.artifacts.length,
    externalManifestSelfHashVerified:
      hash(await readFile(join(round3, 'artifact-manifest.json'))) === anchor.manifestSha256,
    mismatches,
    ...links,
    verdict: pass ? 'PASS' : 'FAIL',
    historicalObservationsRegenerated: false,
  });
  console.log('Integrity ' + (pass ? 'PASS' : 'FAIL'));
  if (!pass) process.exitCode = 1;
}
