import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-385-independent-qa-01';
const manifestFile = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-candidate-02/CANDIDATE.json';
const head = '0776ad604e69d17f42a03b52ea27fd5e30b1318e';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const members = manifest.members.map((member) => {
  const overlaySha256 = digest(readFileSync(member.path));
  const commitBlobSha256 = digest(execFileSync('git', ['cat-file', 'blob', `${head}:${member.path}`], { maxBuffer: 4 * 1024 * 1024 }));
  if (overlaySha256 !== member.sha256 || commitBlobSha256 !== member.sha256) throw new Error(`Source identity mismatch: ${member.path}`);
  return { path: member.path, overlaySha256, commitBlobSha256, matchesManifest: true };
});
const qaFiles = [
  'apps/web/e2e/inspector-independent-qa.spec.ts',
  'apps/web/src/runs/RunInspectorPage.independent-qa.test.tsx',
].map((path) => ({ path, sha256: digest(readFileSync(path)) }));
const record = {
  atUtc: new Date().toISOString(), head,
  tree: execFileSync('git', ['rev-parse', `${head}^{tree}`], { encoding: 'utf8' }).trim(),
  candidateManifestSha256: digest(manifestBytes), members, qaFiles,
  originalClaudeSpecSha256: digest(readFileSync('apps/web/e2e/claude-harness.spec.ts')),
};
writeFileSync(join(evidence, 'source-commit-and-qa-overlay-provenance.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`Verified ${members.length} frozen files against overlay and immutable commit blobs; ${qaFiles.length} QA-only files recorded.`);
