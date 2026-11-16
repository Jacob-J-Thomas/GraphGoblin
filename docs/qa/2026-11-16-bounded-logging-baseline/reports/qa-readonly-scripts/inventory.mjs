// Read-only evidence inventory for #438 baseline-attempt-3. Prints JSON to stdout; writes nothing.
// lstat-only traversal: reparse points are recorded with their link text and are never followed.
// Run only after root's junction continuation has finished, so no handle overlaps its exclusive probes.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-13-aidlc-batch';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const omitHash = new Set(['master.key']);
function entry(p) {
  if (!existsSync(p) && !(() => { try { lstatSync(p); return true; } catch { return false; } })()) return { path: p, absent: true };
  const s = lstatSync(p);
  const rel = p.startsWith(root) ? relative(root, p).replaceAll('\\', '/') : p;
  if (s.isSymbolicLink()) return { path: rel, kind: 'reparse-link', target: readlinkSync(p) };
  if (s.isDirectory()) return null;
  const name = p.split('\\').pop();
  if (omitHash.has(name)) return { path: rel, bytes: s.size, nlink: s.nlink, sha256: 'omitted (disposable key material)' };
  return { path: rel, bytes: s.size, nlink: s.nlink, sha256: sha(p) };
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return [{ path: dir, absent: true }];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const s = lstatSync(p);
    if (s.isDirectory() && !s.isSymbolicLink()) { out.push({ path: relative(root, p).replaceAll('\\', '/') + '/', kind: 'directory' }); walk(p, out); }
    else { const e = entry(p); if (e) out.push(e); }
  }
  return out;
}
const files = (list) => list.map((r) => entry(join(root, r))).filter(Boolean);
const suite = join(root, 'launcher-438-native-preparation-v3');
const adm = JSON.parse(readFileSync(join(root, 'launcher-438-baseline-admission-03.json'), 'utf8'));
const b = JSON.parse(readFileSync(adm.binding.path, 'utf8'));
const boundRef = (label, ref) => ({ label, expected: ref.sha256, ...entry(ref.path) });
const result = {
  schema: 'gg438-baseline-opus-execution-03-evidence-inventory/v1',
  at: new Date().toISOString(),
  root,
  correctedInputs: files([
    'launcher-438-baseline-invocation-correction-03.json', 'launcher-438-baseline-admission-03.json',
    'launcher-438-baseline-binding-02.json', 'launcher-438-baseline-invoke-03.mjs',
    'launcher-438-baseline-admit-v3.mjs', 'launcher-438-native-v3-helper-controls.mjs',
    'launcher-438-native-v3-helper-controls-01/result.json', 'launcher-438-native-v3-private-fixture-root.json',
    'launcher-438-native-v3-preparation-report.md', 'launcher-438-baseline-git-diagnostic.json',
    'launcher-438-baseline-opus-execution-03-brief.md', 'launcher-438-baseline-opus-execution-03-spec.json',
  ]),
  boundModulesAndExecutables: [
    boundRef('git', b.git), boundRef('node', b.node), boundRef('launcher', b.launcher),
    boundRef('buildReceipt', b.buildReceipt), boundRef('buildLog', b.buildLog), boundRef('buildExit', b.buildExit),
    boundRef('launcherBuildReceipt', b.launcherBuildReceipt), boundRef('launcherBuildExit', b.launcherBuildExit),
    boundRef('common.mjs', { path: join(root, 'runtime-410-build-preparation', 'common.mjs'), sha256: adm.artifactCommonSha256 }),
    boundRef('artifacts.mjs', { path: join(root, 'runtime-410-build-preparation', 'artifacts.mjs'), sha256: adm.artifactModuleSha256 }),
    boundRef('native.mjs (v3)', { path: join(suite, 'native.mjs'), sha256: adm.nativeModuleSha256 }),
    entry('C:\\Program Files\\WindowsApps\\OpenAI.CodexPrimaryRuntime.v26-1110-778-0_26.1110.778.0_x64__3k8sg7r9htsxt\\dependencies\\native\\powershell\\pwsh.exe'),
  ],
  sealedSuite: walk(suite).filter((e) => !e.path.includes('/receipts/') && !e.path.includes('/attempts/') && e.kind !== 'directory'),
  invokerReceipts: walk(join(root, 'launcher-438-baseline-invocation-03')),
  wrapperReceipts: walk(join(suite, 'receipts', 'baseline-attempt-3')),
  runtimeEvidence: walk(join(suite, 'attempts', 'baseline-attempt-3', 'evidence')),
  retainedDisposable: walk(join(suite, 'attempts', 'baseline-attempt-3', 'disposable')),
  rootContinuation: [...walk(join(root, 'launcher-438-profile-cleanup-preparation')),
    entry(join(root, 'launcher-438-baseline-03-root-cleanup.json'))],
  priorAttemptsUnchanged: [
    ...files(['launcher-438-native-preparation-v2/attempts/baseline-attempt-2/evidence/first-failure.json',
      'launcher-438-native-preparation-v2/attempts/baseline-attempt-2/evidence/cleanup.json',
      'launcher-438-native-preparation-v2/attempts/baseline-attempt-2/evidence/result.json',
      'launcher-438-baseline-02-owned-drain/result.json', 'launcher-438-native-preparation-v2/SHA256SUMS.txt']),
  ],
};
console.log(JSON.stringify(result, null, 2));
