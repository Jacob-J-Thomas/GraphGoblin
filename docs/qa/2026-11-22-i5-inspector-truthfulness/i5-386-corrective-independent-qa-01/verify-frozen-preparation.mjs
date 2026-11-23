import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = 'G:/ggq/delivery-evidence/2026-11-17-five-intents';
const out = join(root, 'i5-386-corrective-independent-qa-01');
const head = '58227ea02a00fcfe67775ddc8d337b3bab61406d';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const memberReceipt = JSON.parse(readFileSync(join(root, 'i5-386-candidate-03/CANDIDATE.json'), 'utf8'));
const members = memberReceipt.members.map((member) => {
  const disk = digest(readFileSync(member.path));
  const blob = digest(execFileSync('git', ['cat-file', 'blob', `${head}:${member.path}`], { maxBuffer: 4 * 1024 * 1024 }));
  if (disk !== member.sha256 || blob !== member.sha256) throw new Error(`Frozen product mismatch: ${member.path}`);
  return { path: member.path, sha256: disk, matchesFrozenCommit: true };
});
const protectedPaths = [
  'apps/web/e2e/claude-harness.spec.ts',
  'apps/web/e2e/inspector-truthfulness.spec.ts',
  'apps/web/src/runs/projections.ts',
  'apps/web/src/runs/projections.exact-values.test.ts',
];
const protectedFiles = protectedPaths.map((path) => {
  const disk = digest(readFileSync(path));
  const blob = digest(execFileSync('git', ['cat-file', 'blob', `${head}:${path}`], { maxBuffer: 4 * 1024 * 1024 }));
  if (disk !== blob) throw new Error(`Protected frozen file changed: ${path}`);
  return { path, sha256: disk };
});
const inspectorTests = readFileSync('apps/web/src/runs/RunInspectorPage.test.tsx', 'utf8');
const appendStart = inspectorTests.indexOf("describe('appended values in a selected patch (#385)'");
const appendEnd = inspectorTests.indexOf("describe('RunInspectorPage',", appendStart);
if (appendStart < 0 || appendEnd < 0) throw new Error('Protected #385 regression block missing');
const inputFiles = [
  'i5-386-gpt-review-01/README.md',
  'i5-386-gpt-review-01/review-witness.test.tsx',
  'i5-386-gpt-review-01/review-navigation.test.tsx',
  'i5-386-correction-architecture-01/README.md',
  'i5-386-corrective-root-inputs-01/decision-224.md',
].map((path) => ({ path, sha256: digest(readFileSync(join(root, path))) }));
const retainedSeals = [
  ['i5-386-385-independent-qa-01/SEAL.json', '422b7e8a6c1d808bfca58516871d681fe4d8deffd173d566ac54c6f1ae6fb3de'],
  ['i5-386-385-independent-qa-closure-01/SEAL.json', '1081e0463bd117b45610120a4f408146d4cfc5673249116bf30657bc00e51c8e'],
].map(([path, expected]) => {
  const sha256 = digest(readFileSync(join(root, path)));
  if (sha256 !== expected) throw new Error(`Historical evidence changed: ${path}`);
  return { path, sha256 };
});
const qaPath = 'apps/web/src/runs/RunInspectorPage.corrective-independent-qa.test.tsx';
const record = {
  atUtc: new Date().toISOString(), phase: 'PREPARATION; no corrected candidate', head,
  tree: execFileSync('git', ['rev-parse', `${head}^{tree}`], { encoding: 'utf8' }).trim(),
  actualCheckoutHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  existingQaIndexSha256: digest(readFileSync('.git/index')),
  members, protectedFiles,
  protected385BlockSha256: digest(inspectorTests.slice(appendStart, appendEnd)),
  inputFiles, retainedSeals,
  qaOnlySource: { path: qaPath, sha256: digest(readFileSync(qaPath)) },
  productionEdits: false, newDependencyInstallation: false, browserStartup: false,
  newNetworkService: false, correctedCandidateAccepted: false,
};
writeFileSync(join(out, 'preparation-source-and-inputs.json'), JSON.stringify(record, null, 2) + '\n');
console.log('Frozen 58227 product, protected files/#385 block and historical seals verified; only new corrective QA source added.');
