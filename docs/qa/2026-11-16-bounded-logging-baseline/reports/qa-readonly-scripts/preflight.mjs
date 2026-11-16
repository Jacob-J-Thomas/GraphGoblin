// Read-only preflight for #438 baseline attempt 3. Writes nothing; prints JSON.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const correctionPath = join(root, 'launcher-438-baseline-invocation-correction-03.json');
const correction = JSON.parse(readFileSync(correctionPath, 'utf8'));
const adm = JSON.parse(readFileSync(correction.admission.path, 'utf8'));
const b = JSON.parse(readFileSync(adm.binding.path, 'utf8'));
const check = (label, ref) => { const s = lstatSync(ref.path); const actual = sha(ref.path);
  return { label, path: ref.path, realpathEqualsResolve: realpathSync(ref.path) === resolve(ref.path), isFile: s.isFile(), nlink: s.nlink, bytes: s.size, sha256: actual, sha256Matches: actual === ref.sha256 }; };
const suite = join(root, 'launcher-438-native-preparation-v3');
const refs = [
  ['admission-03', correction.admission], ['binding-02', adm.binding], ['git', b.git], ['node', b.node], ['launcher', b.launcher],
  ['buildReceipt', b.buildReceipt], ['buildLog', b.buildLog], ['buildExit', b.buildExit],
  ['launcherBuildReceipt', b.launcherBuildReceipt], ['launcherBuildExit', b.launcherBuildExit],
  ['common.mjs', { path: join(root, 'runtime-410-build-preparation', 'common.mjs'), sha256: adm.artifactCommonSha256 }],
  ['artifacts.mjs', { path: join(root, 'runtime-410-build-preparation', 'artifacts.mjs'), sha256: adm.artifactModuleSha256 }],
  ['native.mjs (v3)', { path: join(suite, 'native.mjs'), sha256: adm.nativeModuleSha256 }],
  ['pwsh', correction.powerShell],
].map(([l, r]) => check(l, r));
const expected = {
  'launcher-438-baseline-invocation-correction-03.json': 'daa69b9cc8d16477c58e13810c58bb650addf2432e3ed4f31efecacdb8cb44a1',
  'launcher-438-baseline-admission-03.json': '65e8885e05586766e822220de21d9a510f85b292a1f65157b94e88c8e3919ea2',
  'launcher-438-baseline-binding-02.json': '85a77468ebe1bacfed414081261287809febf793785e9d28e2223939ff9820de',
  'launcher-438-baseline-invoke-03.mjs': '67eb71db94a29f0dacbc9e507919734dbe1d3dd6ae48e78cf6cf8676bcdca71c',
  'launcher-438-native-preparation-v3/native.mjs': 'd365f69e8eb35ec256669b413d54920ef8c3c0d82270d786f9c86a8454f5b74d',
  'launcher-438-native-preparation-v3/SHA256SUMS.txt': '514e46c93bc47e21a1b528a0f50cd79f17b0ab7c30fa86e7fed51c2f5921c92f',
  'launcher-438-native-v3-helper-controls-01/result.json': 'f0c6350163a896142d13e5cf2e650b0e102a53a819e50532199250115412012a',
  'launcher-438-native-v3-private-fixture-root.json': 'd0f4f456a8efbcc68fbb400cf694a17c9f347b7850ad435631c9110df2c0df52',
  'launcher-438-native-preparation-v3/launch.ps1': '6c0ae2056abb21405ac24f6681f903fc769f015399750700307000051bd64864',
};
const promptHashes = Object.entries(expected).map(([rel, want]) => { const got = sha(join(root, rel)); return { rel, want, got, match: got === want }; });
const manifestLines = readFileSync(join(suite, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const manifest = manifestLines.map(l => { const [want, name] = l.split(/\s+/, 2); const got = sha(join(suite, name)); return { name, want, got, match: got === want }; });
const out = {
  schema: 'gg438-baseline-opus-execution-03-preflight/v1', at: new Date().toISOString(),
  node: { execPath: process.execPath, version: process.version,
    nodeOptionsPresent: Object.keys(process.env).some(k => k.toUpperCase() === 'NODE_OPTIONS'),
    gitOptionalLocks: process.env.GIT_OPTIONAL_LOCKS ?? null },
  attempt: correction.attempt, admissionAttempt: adm.attempt, bindingHead: b.head, bindingTree: b.tree,
  bindingIndex: b.indexSha256, bindingCheckout: b.checkout,
  bindingSourceFiles: Object.keys(b.sourceFiles).length, bindingArtifactCounts: b.artifacts?.counts ?? null,
  bindingArtifactInventorySha256: b.artifacts?.inventorySha256 ?? null,
  promptHashes, allPromptHashesMatch: promptHashes.every(x => x.match),
  manifestPayloads: manifest.length, manifestAllMatch: manifest.every(x => x.match), manifest,
  refs,
  allBoundRefsReadBoundCompatible: refs.filter(r => r.label !== 'pwsh').every(r => r.realpathEqualsResolve && r.isFile && r.nlink === 1 && r.sha256Matches),
  attemptDirsAbsent: { receipts: !existsSync(join(suite, 'receipts', correction.attempt)),
    attempts: !existsSync(join(suite, 'attempts', correction.attempt)), attemptsRoot: !existsSync(join(suite, 'attempts')), receiptsRoot: !existsSync(join(suite, 'receipts')) },
  invocationOutDirAbsent: !existsSync(join(root, 'launcher-438-baseline-invocation-03')),
  cleanupContinuationAbsent: !existsSync(join(root, 'launcher-438-baseline-03-root-cleanup.json')),
};
console.log(JSON.stringify(out, null, 2));
