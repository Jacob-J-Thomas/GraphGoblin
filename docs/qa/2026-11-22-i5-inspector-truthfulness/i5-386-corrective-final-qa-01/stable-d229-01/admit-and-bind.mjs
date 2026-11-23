import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const common = 'G:/ggq/gg-delivery-next-independent/GraphGoblin';
const candidate = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-d229-stable-candidate-01';
const priorEvidence = resolve(evidence, '../d228-diagnostic-01');
const shaBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (path) => shaBytes(readFileSync(path));
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const gitBytes = (...args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd: qa, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }, maxBuffer: 16 * 1024 * 1024,
});
const git = (...args) => gitBytes(...args).toString('utf8').trim();
const blobId = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function tree(head) {
  return new Map(gitBytes('ls-tree', '-r', '-z', head).toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t'); const [mode, type, blob] = entry.slice(0, tab).split(' ');
    return [entry.slice(tab + 1), { mode, type, blob }];
  }));
}
const manifestPath = resolve(candidate, 'CANDIDATE.json');
const manifest = json(manifestPath);
const prior = json(resolve(priorEvidence, 'CANDIDATE.json'));
const priorProvenance = json(resolve(priorEvidence, 'post-run-source-provenance.json'));
const expectedManifest = '2a0f2c81528b8110922f3c719a4668cf38681df8eff3efb2403745269af9fed5';
if (sha(manifestPath) !== expectedManifest || statSync(manifestPath).size !== 6930 || manifest.files.length !== 25) throw new Error('Stable receipt identity/count mismatch');
if (manifest.parent !== prior.head || git('rev-parse', `${manifest.head}^{tree}`) !== manifest.tree) throw new Error('Stable Git identity mismatch');
if (sha(resolve(priorEvidence, 'DIAGNOSTIC-SEAL.json')) !== '40bb302bc3fc0129ae2f88d440676b0d40f84e44b893d7a9e7c3172c9aa8c023') throw new Error('D228 diagnostic seal changed');
const priorSeal = json(resolve(priorEvidence, 'DIAGNOSTIC-SEAL.json'));
if (!priorSeal.files.every((file) => statSync(resolve(priorEvidence, file.path)).size === file.bytes && sha(resolve(priorEvidence, file.path)) === file.sha256)) throw new Error('D228 sealed member changed');
const commonHead = execFileSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], { cwd: common, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const boundaries = { qaHead: git('rev-parse', 'HEAD'), qaIndexSha256: sha(resolve(qa, '.git/index')),
  commonHead, commonIndexAbsent: !existsSync(resolve(common, '.git/index')) };
if (boundaries.qaHead !== priorProvenance.qaHead || boundaries.qaIndexSha256 !== priorProvenance.qaIndexSha256
  || boundaries.commonHead !== priorProvenance.commonHead || !boundaries.commonIndexAbsent) throw new Error('Index/common boundary changed');
const protectedAndQa = priorProvenance.qaSources.map((file) => ({ path: file.path, sha256: sha(resolve(qa, file.path)), expected: file.expectedSha256 }));
if (!protectedAndQa.every((file) => file.sha256 === file.expected)) throw new Error('QA/protected source changed');
const baseTree = tree(manifest.baseHead); const diagnosticTree = tree(prior.head); const finalTree = tree(manifest.head);
const changedPaths = gitBytes('diff', '--name-only', '-z', prior.head, manifest.head).toString('utf8').split('\0').filter(Boolean).sort();
if (JSON.stringify(changedPaths) !== JSON.stringify([...manifest.supportingDeltaPaths].sort())) throw new Error('Stable delta outside seven supporting paths');
const rootInputs = new Set(['AGENTS.md', '.gitattributes', '.npmrc', '.nvmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'eslint.config.js', 'tsconfig.base.json']);
const inputScope = (path) => rootInputs.has(path) || /^(apps\/(web|api)\/|packages\/|tooling\/|scripts\/|patches\/)/.test(path);
const protectedE2e = new Set(['apps/web/e2e/inspector-truthfulness.spec.ts', 'apps/web/e2e/claude-harness.spec.ts']);
const runtimeInput = (path) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || protectedE2e.has(path);
const inheritedInputs = [...finalTree].filter(([path, entry]) => inputScope(path) && entry.type === 'blob').map(([path, entry]) => {
  const previous = diagnosticTree.get(path)?.blob ?? null;
  const exists = existsSync(resolve(qa, path));
  if (!exists && previous !== null) throw new Error('Scoped imported/runtime input missing: ' + path);
  const bytes = exists ? readFileSync(resolve(qa, path)) : null;
  return { path, mode: entry.mode, signedBaseBlob: baseTree.get(path)?.blob ?? null,
    diagnosticBlob: previous, finalBlob: entry.blob,
    beforeDiskBlob: bytes === null ? null : blobId(bytes), beforeDiskSha256: bytes === null ? null : shaBytes(bytes),
    runtimeInput: runtimeInput(path), signedBaseUnchanged: baseTree.get(path)?.blob === entry.blob };
});
if (!inheritedInputs.every((file) => file.beforeDiskBlob === file.diagnosticBlob)) throw new Error('Pre-admission whole input bytes differ from executed D228 Git state');
const runtime = inheritedInputs.filter((file) => file.runtimeInput);
if (!runtime.every((file) => file.diagnosticBlob === file.finalBlob)) throw new Error('Stable candidate changed a runtime/config/fixture input');
const sources = manifest.files.map((file) => ({ ...file, sourceSha256: sha(resolve(candidate, 'source', file.path)),
  sourceBytes: statSync(resolve(candidate, 'source', file.path)).size,
  gitBlobSha256: shaBytes(gitBytes('cat-file', 'blob', `${manifest.head}:${file.path}`)),
  beforeSha256: existsSync(resolve(qa, file.path)) ? sha(resolve(qa, file.path)) : null }));
if (!sources.every((file) => file.sourceSha256 === file.sha256 && file.gitBlobSha256 === file.sha256 && file.sourceBytes === file.bytes)) throw new Error('Stable25 source/Git mismatch');
for (const file of sources) {
  for (const [label, from] of [['before-source', resolve(qa, file.path)], ['candidate-source', resolve(candidate, 'source', file.path)]]) {
    if (label === 'before-source' && !existsSync(from)) continue;
    const to = resolve(evidence, label, file.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to);
  }
}
copyFileSync(manifestPath, resolve(evidence, 'CANDIDATE.json'));
if (sha(manifest.supportingDelta.source) !== manifest.supportingDelta.sha256) throw new Error('Supporting delta artifact mismatch');
copyFileSync(manifest.supportingDelta.source, resolve(evidence, 'supporting-exact-delta.patch'));
for (const file of protectedAndQa) {
  const to = resolve(evidence, 'before-qa-and-protected-source', file.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(resolve(qa, file.path), to);
}
for (const file of sources) copyFileSync(resolve(evidence, 'candidate-source', file.path), resolve(qa, file.path));
for (const file of inheritedInputs) {
  const bytes = readFileSync(resolve(qa, file.path));
  file.afterDiskBlob = blobId(bytes); file.afterDiskSha256 = shaBytes(bytes); file.matchesFinal = file.afterDiskBlob === file.finalBlob;
}
if (!inheritedInputs.every((file) => file.matchesFinal)) throw new Error('Whole input bytes differ from final Git state after overlay');
const browserPath = 'apps/web/e2e/inspector-final-independent-qa.spec.ts';
const oldBrowser = readFileSync(resolve(qa, browserPath), 'utf8');
const oldDestination = 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/stable-candidate-01/independent-browser-closure-01/output/playwright/independent';
const newDestination = evidence.replaceAll('\\', '/') + '/output/playwright/independent';
if (oldBrowser.split(oldDestination).length !== 2) throw new Error('Browser artifact destination precondition changed');
const newBrowser = oldBrowser.replace(oldDestination, newDestination);
mkdirSync(newDestination, { recursive: true }); writeFileSync(resolve(qa, browserPath), newBrowser);
const browserCopy = resolve(evidence, 'executed-qa-and-protected-source', browserPath); mkdirSync(dirname(browserCopy), { recursive: true }); copyFileSync(resolve(qa, browserPath), browserCopy);
for (const file of protectedAndQa.filter((file) => file.path !== browserPath)) {
  const to = resolve(evidence, 'executed-qa-and-protected-source', file.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(resolve(qa, file.path), to);
}
const binding = { atUtc: new Date().toISOString(), status: 'D228 COMPONENT EVIDENCE BOUND TO FINAL SUPPORT-ONLY SOURCE; NO COMPONENT RERUN',
  priorHead: prior.head, priorTree: prior.tree, finalHead: manifest.head, finalTree: manifest.tree,
  candidateManifestSha256: expectedManifest, changedPaths, inputScope: 'apps/web + apps/api + packages + tooling + scripts + patches + named root configs; all tracked blob inputs',
  trackedInputs: inheritedInputs.length, runtimeInputs: runtime.length,
  signedBaseUnchangedRuntimeInputs: runtime.filter((file) => file.signedBaseUnchanged).length,
  runtimeConfigFixtureBytesIdentical: true, actualDiskMatchedDiagnosticBeforeApply: true, actualDiskMatchesFinalAfterApply: true,
  dependencyInstallUnchanged: true, dependencyLockSha256: sha(resolve(qa, 'pnpm-lock.yaml')),
  nodeVersion: process.version, inheritedInputs,
  componentEvidence: { diagnosticSealSha256: '40bb302bc3fc0129ae2f88d440676b0d40f84e44b893d7a9e7c3172c9aa8c023',
    distinctPassed: 36, initial: '35 passed / 1 fixture precondition failed', scopedClosure: 'corrected R2-2 alone passed; four others unselected',
    originalFailurePreserved: true, single36Green: false, rerun: false },
  qaSources: protectedAndQa, browserOutputOnlyChange: { path: browserPath, beforeSha256: shaBytes(Buffer.from(oldBrowser)),
    afterSha256: shaBytes(Buffer.from(newBrowser)), oldDestination, newDestination,
    exactDestinationReplacementOnly: newBrowser.replace(newDestination, oldDestination) === oldBrowser },
  boundaries, sources, sourceAccepted: false, qaAccepted: false };
writeFileSync(resolve(evidence, 'component-runtime-input-binding.json'), JSON.stringify(binding, null, 2) + '\n');
console.log(JSON.stringify({ finalHead: manifest.head, sourceMembers: sources.length, trackedInputs: inheritedInputs.length,
  runtimeInputs: runtime.length, signedBaseUnchangedRuntimeInputs: binding.signedBaseUnchangedRuntimeInputs,
  allRuntimeInputsUnchanged: true, diagnostic81MembersVerified: true, browserOutputOnlyChange: binding.browserOutputOnlyChange,
  qaIndexSha256: boundaries.qaIndexSha256 }, null, 2));
