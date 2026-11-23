import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const closure = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-closure-01';
const interim = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-01';
const head = '58227ea02a00fcfe67775ddc8d337b3bab61406d';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receiptBytes = readFileSync(join(closure, 'candidate03-receipt.json'));
const receipt = JSON.parse(receiptBytes.toString('utf8'));
if (digest(receiptBytes) !== '0578b53c83139b661d57082156683c9b6f0d69e295c59be74ad7c09b2fbc1567') throw new Error('Receipt identity mismatch');
const prior = JSON.parse(readFileSync(join(interim, 'source-commit-and-qa-overlay-provenance.json'), 'utf8'));
const members = receipt.members.map((member) => {
  const diskSha256 = digest(readFileSync(member.path));
  const commitBlobSha256 = digest(execFileSync('git', ['cat-file', 'blob', `${head}:${member.path}`], { maxBuffer: 4 * 1024 * 1024 }));
  if (diskSha256 !== member.sha256 || commitBlobSha256 !== member.sha256) throw new Error(`Candidate member mismatch: ${member.path}`);
  const priorMember = prior.members.find((item) => item.path === member.path);
  return { path: member.path, sha256: diskSha256, matchesImmutableCommit: true, unchangedFromCandidate02: priorMember?.overlaySha256 === diskSha256 };
});
if (members.filter((member) => !member.unchangedFromCandidate02).map((member) => member.path).join() !== 'apps/web/e2e/inspector-truthfulness.spec.ts') throw new Error('Unexpected candidate delta');
const qaOverlay = prior.qaFiles.map((member) => {
  const actual = digest(readFileSync(member.path));
  if (actual !== member.sha256) throw new Error(`QA-only overlay changed: ${member.path}`);
  return { path: member.path, sha256: actual, unchangedFromSealedInterim: true };
});
const originalClaudeSpecSha256 = digest(readFileSync('apps/web/e2e/claude-harness.spec.ts'));
if (originalClaudeSpecSha256 !== 'e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0') throw new Error('Original Claude regression spec changed');
const interimSealSha256 = digest(readFileSync(join(interim, 'SEAL.json')));
const interimReportSha256 = digest(readFileSync(join(interim, 'README.md')));
if (interimSealSha256 !== '422b7e8a6c1d808bfca58516871d681fe4d8deffd173d566ac54c6f1ae6fb3de' || interimReportSha256 !== '060984deb4ef63e05d76ceb678917d5d818ba9543062bc9753ba5d057fc02dfb') throw new Error('Sealed interim changed');
const record = {
  atUtc: new Date().toISOString(), head,
  tree: execFileSync('git', ['rev-parse', `${head}^{tree}`], { encoding: 'utf8' }).trim(),
  parent: execFileSync('git', ['rev-parse', `${head}^`], { encoding: 'utf8' }).trim(),
  candidateManifestSha256: digest(receiptBytes), members, qaOverlay, originalClaudeSpecSha256,
  interimSealSha256, interimReportSha256,
  runtimeSourceUnchangedFromPassedBuildAndBehavioralEvidence: true,
};
writeFileSync(join(closure, 'verified-source-and-parity.json'), JSON.stringify(record, null, 2) + '\n');
console.log('All 11 disk/commit blobs match candidate03; only browser fixture changed; original Claude and sealed QA overlay/report unchanged.');
