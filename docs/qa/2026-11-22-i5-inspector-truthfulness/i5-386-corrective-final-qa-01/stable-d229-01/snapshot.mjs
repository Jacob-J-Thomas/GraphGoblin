import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const stage = process.argv[2];
if (!stage || !/^[a-z0-9-]+$/.test(stage)) throw new Error('Supply an owned snapshot stage');
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const common = 'G:/ggq/gg-delivery-next-independent/GraphGoblin';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const binding = json(resolve(evidence, 'component-runtime-input-binding.json'));
const git = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
}).trim();
const inputs = binding.inheritedInputs.map((file) => ({ path: file.path,
  sha256: sha(resolve(qa, file.path)), matchesFinalGitBoundBytes: sha(resolve(qa, file.path)) === file.afterDiskSha256 }));
const qaSources = binding.qaSources.map((file) => {
  const expected = file.path === binding.browserOutputOnlyChange.path ? binding.browserOutputOnlyChange.afterSha256 : file.expected;
  return { path: file.path, sha256: sha(resolve(qa, file.path)), matches: sha(resolve(qa, file.path)) === expected };
});
const result = { atUtc: new Date().toISOString(), stage, finalHead: binding.finalHead, finalTree: binding.finalTree,
  candidateManifestSha256: sha(resolve(evidence, 'CANDIDATE.json')), inputs, qaSources,
  qaHead: git(qa, 'rev-parse', 'HEAD'), qaIndexSha256: sha(resolve(qa, '.git/index')),
  commonHead: git(common, 'rev-parse', 'HEAD'), commonIndexAbsent: !existsSync(resolve(common, '.git/index')),
  retainedD228SealSha256: sha(resolve(evidence, '../d228-diagnostic-01/DIAGNOSTIC-SEAL.json')) };
result.allChecksPass = inputs.every((file) => file.matchesFinalGitBoundBytes) && qaSources.every((file) => file.matches)
  && result.qaHead === binding.boundaries.qaHead && result.qaIndexSha256 === binding.boundaries.qaIndexSha256
  && result.commonHead === binding.boundaries.commonHead && result.commonIndexAbsent
  && result.retainedD228SealSha256 === binding.componentEvidence.diagnosticSealSha256;
writeFileSync(resolve(evidence, `source-parity-${stage}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ stage, inputs: inputs.length, qaAndProtected: qaSources.length,
  allChecksPass: result.allChecksPass, qaIndexSha256: result.qaIndexSha256 }, null, 2));
if (!result.allChecksPass) process.exitCode = 1;
