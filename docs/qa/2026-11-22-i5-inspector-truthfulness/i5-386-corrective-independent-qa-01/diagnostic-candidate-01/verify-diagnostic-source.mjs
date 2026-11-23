import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const evidenceRoot = 'G:/ggq/delivery-evidence/2026-11-17-five-intents';
const out = join(evidenceRoot, 'i5-386-corrective-independent-qa-01/diagnostic-candidate-01');
const head = '56e3a48bbe4b652c1d74b55cc61985ff91884075';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync(join(out, 'diagnostic-candidate-receipt.json'));
if (digest(bytes) !== '4c0c18f0345323e1e7b20a5b5029f8116efb7312fb97bb1ba7ddbae01d2793ce') throw new Error('Diagnostic receipt changed');
const receipt = JSON.parse(bytes.toString('utf8'));
const members = receipt.files.map((member) => {
  const disk = digest(readFileSync(member.path));
  const blob = digest(execFileSync('git', ['cat-file', 'blob', `${head}:${member.path}`], { maxBuffer: 4 * 1024 * 1024 }));
  if (disk !== member.sha256 || blob !== member.sha256) throw new Error(`Diagnostic source mismatch: ${member.path}`);
  return { path: member.path, sha256: disk, matchesImmutableCheckpoint: true };
});
const protectedFiles = ['apps/web/e2e/claude-harness.spec.ts', 'apps/web/e2e/inspector-truthfulness.spec.ts', 'apps/web/src/runs/projections.ts'].map((path) => ({ path, sha256: digest(readFileSync(path)) }));
const qaFiles = ['apps/web/src/runs/RunInspectorPage.corrective-independent-qa.test.tsx', 'apps/web/src/runs/RunInspectorPage.corrective-boundaries-qa.test.tsx'].map((path) => ({ path, sha256: digest(readFileSync(path)) }));
const seals = [
  ['i5-386-corrective-independent-qa-01/PREPARATION-SEAL.json', '44fc1d08053fceaafc6b4eeeebb8ded025e97e8dab56b4e6fd6ce46d9aa7af65'],
  ['i5-386-385-independent-qa-01/SEAL.json', '422b7e8a6c1d808bfca58516871d681fe4d8deffd173d566ac54c6f1ae6fb3de'],
  ['i5-386-385-independent-qa-closure-01/SEAL.json', '1081e0463bd117b45610120a4f408146d4cfc5673249116bf30657bc00e51c8e'],
].map(([path, expected]) => { const sha256 = digest(readFileSync(join(evidenceRoot, path))); if (sha256 !== expected) throw new Error(`Old seal changed: ${path}`); return { path, sha256 }; });
const record = { atUtc: new Date().toISOString(), status: 'DIAGNOSTIC UNACCEPTED', head, tree: execFileSync('git', ['rev-parse', `${head}^{tree}`], { encoding: 'utf8' }).trim(), receiptSha256: digest(bytes), members, protectedFiles, qaFiles, retainedSeals: seals, qaIndexSha256: digest(readFileSync('.git/index')), browserRun: false, providerRun: false, productEditsByQa: false };
writeFileSync(join(out, 'final-source-and-probe-provenance.json'), JSON.stringify(record, null, 2) + '\n');
console.log('20 source copies and checkpoint Git blobs match; diagnostic QA source/protected files/prior seals recorded.');
