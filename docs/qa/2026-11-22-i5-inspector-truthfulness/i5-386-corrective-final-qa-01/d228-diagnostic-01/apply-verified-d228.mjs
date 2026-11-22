import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const common = 'G:/ggq/gg-delivery-next-independent/GraphGoblin';
const candidate = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d228-partial-candidate-01';
const shaBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (path) => shaBytes(readFileSync(path));
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const gitBytes = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }, maxBuffer: 4 * 1024 * 1024,
});
const git = (cwd, ...args) => gitBytes(cwd, ...args).toString('utf8').trim();
const manifestPath = resolve(candidate, 'CANDIDATE.json');
const manifest = json(manifestPath);
const expectedManifest = 'd8b5b678c8ea427bb0cda377a298bc0f449d31ecbc355e28e5cb2df68072807a';
const prior = json(resolve(evidence, '../stable-candidate-01/CANDIDATE.json'));
const staticReceipt = json(resolve(evidence, '../review2-qa-static-prep-01/static-result-and-preservation.json'));
const qaFiles = [...staticReceipt.original31.map((file) => ({ path: file.path, sha256: file.sha256 })),
  { path: staticReceipt.qaFile, sha256: staticReceipt.qaFileSha256 },
  { path: 'apps/web/e2e/inspector-final-independent-qa.spec.ts', sha256: '58cd117d2d723c41486b4ae7d8b2d9dc5895703b83875263ed0e7675731bc112' },
  { path: 'apps/web/e2e/inspector-independent-qa.spec.ts', sha256: '655afa38677e058cdc6738299f5faa63ccaf8fadf4547474b5181afcdbf8f266' },
  { path: 'apps/web/e2e/claude-harness.spec.ts', sha256: 'e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0' },
  { path: 'apps/web/src/runs/projections.ts', sha256: 'c4446d3018e256fc32d5460afe09c0f7b24b1429598cf94b80fcd1acad555f01' }];
const boundaries = () => ({ qaHead: git(qa, 'rev-parse', 'HEAD'), qaIndexSha256: sha(resolve(qa, '.git/index')),
  commonHead: git(common, 'rev-parse', 'HEAD'), commonIndexAbsent: !existsSync(resolve(common, '.git/index')),
  qaFiles: qaFiles.map((file) => ({ ...file, matches: sha(resolve(qa, file.path)) === file.sha256 })) });
const before = boundaries();
if (sha(manifestPath) !== expectedManifest || statSync(manifestPath).size !== 5679 || manifest.files.length !== 23) throw new Error('Candidate identity/count mismatch');
if (manifest.parent !== prior.head || git(qa, 'rev-parse', `${manifest.head}^{tree}`) !== manifest.tree) throw new Error('Candidate Git identity mismatch');
if (before.qaHead !== staticReceipt.qaHead || before.qaIndexSha256 !== staticReceipt.qaIndexSha256
  || before.commonHead !== staticReceipt.commonHead || !before.commonIndexAbsent || !before.qaFiles.every((file) => file.matches)) throw new Error('Preservation boundary changed');
if (!prior.files.every((file) => sha(resolve(qa, file.path)) === file.sha256)) throw new Error('Prior22 source changed');
if (sha(resolve(qa, 'apps/web/src/api/ApiKeyPanel.tsx')) !== shaBytes(gitBytes(qa, 'cat-file', 'blob', `${prior.head}:apps/web/src/api/ApiKeyPanel.tsx`))) throw new Error('Previous panel source changed');
const sources = manifest.files.map((file) => ({ ...file, candidateSha256: sha(resolve(candidate, 'source', file.path)),
  candidateBytes: statSync(resolve(candidate, 'source', file.path)).size,
  gitBlobSha256: shaBytes(gitBytes(qa, 'cat-file', 'blob', `${manifest.head}:${file.path}`)), beforeSha256: sha(resolve(qa, file.path)) }));
if (!sources.every((file) => file.sha256 === file.candidateSha256 && file.sha256 === file.gitBlobSha256 && file.bytes === file.candidateBytes)) throw new Error('Candidate source/Git mismatch');
const changes = sources.filter((file) => file.beforeSha256 !== file.sha256).map((file) => file.path).sort();
if (JSON.stringify(changes) !== JSON.stringify([...manifest.partialDeltaPaths].sort())) throw new Error('Candidate delta outside stated five files');
if (sha(manifest.partialDelta.source) !== manifest.partialDelta.sha256) throw new Error('Partial delta artifact mismatch');
copyFileSync(manifestPath, resolve(evidence, 'CANDIDATE.json'));
copyFileSync(manifest.partialDelta.source, resolve(evidence, 'partial-exact-delta.patch'));
for (const file of sources) {
  for (const [label, from] of [['before-source', resolve(qa, file.path)], ['candidate-source', resolve(candidate, 'source', file.path)]]) {
    const to = resolve(evidence, label, file.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to);
  }
}
for (const file of qaFiles) {
  const to = resolve(evidence, 'executed-qa-and-protected-source', file.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(resolve(qa, file.path), to);
}
for (const file of sources) copyFileSync(resolve(evidence, 'candidate-source', file.path), resolve(qa, file.path));
const after = boundaries();
const applied = sources.map((file) => ({ path: file.path, sha256: sha(resolve(qa, file.path)), matches: sha(resolve(qa, file.path)) === file.sha256 }));
const receipt = { atUtc: new Date().toISOString(), disposition: 'D228 PARTIAL PRODUCTION DIAGNOSTIC ONLY; UNACCEPTED',
  candidateManifestSha256: expectedManifest, head: manifest.head, tree: manifest.tree, parent: manifest.parent,
  sources, changedFiles: changes, before, after, applied, expectedCases: 36, retries: 0,
  productEditsByQa: false, gitWrites: false, install: false };
receipt.allChecksPass = applied.every((file) => file.matches) && JSON.stringify(before) === JSON.stringify(after);
writeFileSync(resolve(evidence, 'apply-source-parity.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ allChecksPass: receipt.allChecksPass, head: manifest.head, sourceMembers: sources.length,
  changedFiles: changes, qaIndexSha256: after.qaIndexSha256 }, null, 2));
if (!receipt.allChecksPass) process.exitCode = 1;
