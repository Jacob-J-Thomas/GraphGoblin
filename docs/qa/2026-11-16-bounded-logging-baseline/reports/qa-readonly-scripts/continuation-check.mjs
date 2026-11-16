// Read-only validation of root's junction continuation receipt for baseline-attempt-3. Prints JSON.
import { readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const P = join(root, 'launcher-438-profile-cleanup-preparation');
const disposable = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-13-aidlc-batch\\launcher-438-native-preparation-v3\\attempts\\baseline-attempt-3\\disposable';
const junction = disposable + '\\profile\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.IE5';
const target = disposable + '\\profile\\AppData\\Local\\Microsoft\\Windows\\INetCache\\IE';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const lines = readFileSync(join(P, 'continuation-receipt.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const stage = (s) => lines.find((l) => l.stage === s);
const adm = JSON.parse(readFileSync(join(P, 'root-admission.json'), 'utf8'));
const before = stage('before')?.data.inventory ?? [];
const after = stage('attested-retained')?.data.inventory ?? [];
const key = (r) => JSON.stringify(r);
const isTarget = (r) => r.path.toLowerCase() === target.toLowerCase() || r.path.toLowerCase().startsWith(target.toLowerCase() + '\\');
const beforeNoLink = before.filter((r) => r.path.toLowerCase() !== junction.toLowerCase());
const reparseBefore = before.filter((r) => r.reparse);
const reparseAfter = after.filter((r) => r.reparse);
// Bound input hashes recomputed now (read-only).
const E = join(root, 'launcher-438-native-preparation-v3/attempts/baseline-attempt-3/evidence');
const R = join(root, 'launcher-438-native-preparation-v3/receipts/baseline-attempt-3');
const I = join(disposable, 'install');
const pathFor = (name) => name.startsWith('wrapper-') ? join(R, name.slice(8) + '.json')
  : name.startsWith('config-') ? join(I, name.slice(7) + '.qa438-private-config-42d8050e.json') : join(E, name + '.json');
const bound = Object.entries(adm.sha256).map(([name, want]) => ({ name, match: sha(pathFor(name)) === want }));
let junctionNow;
try { const s = lstatSync(junction); junctionNow = { present: true, symlink: s.isSymbolicLink(), link: s.isSymbolicLink() ? readlinkSync(junction) : null }; }
catch (e) { junctionNow = { present: false, code: e.code }; }
let targetNow;
try { const s = lstatSync(target); targetNow = { present: true, directory: s.isDirectory(), symlink: s.isSymbolicLink() }; } catch (e) { targetNow = { present: false, code: e.code }; }
const out = {
  schema: 'gg438-baseline-opus-execution-03-continuation-check/v1', at: new Date().toISOString(),
  receiptSha256: sha(join(P, 'continuation-receipt.jsonl')),
  admissionSha256: sha(join(P, 'root-admission.json')),
  admissionMatchesReceipt: stage('admitted')?.data.admissionSha256 === sha(join(P, 'root-admission.json')),
  admission: { schema: adm.schema, state: adm.state, attempt: adm.attempt, action: adm.action, behaviorReviewed: adm.behaviorReviewed,
    scriptPinMatches: adm.scriptSha256 === sha(join(P, 'continue.ps1')), metadataPinMatches: adm.metadataSha256 === sha(join(P, 'Metadata.cs')) },
  stages: lines.map((l) => ({ stage: l.stage, utc: l.utc })),
  firstFailurePresent: !!stage('first-failure'),
  owned: stage('owned')?.data ?? null,
  absenceBefore: stage('before')?.data.absence ?? null,
  absencePreUnlink: stage('pre-unlink')?.data.absence ?? null,
  absenceAfter: stage('attested-retained')?.data.absence ?? null,
  exclusivePreUnlink: stage('pre-unlink')?.data.exclusive ?? null,
  exclusiveAfter: stage('attested-retained')?.data.exclusive ?? null,
  linkId: stage('pre-unlink')?.data.linkId ?? null,
  unlinkRequest: stage('unlink-requested')?.data ?? null,
  attestedFlags: (({ targetUnchanged, junctionAbsent, disposableRetained, rawEvidenceUnchanged }) =>
    ({ targetUnchanged, junctionAbsent, disposableRetained, rawEvidenceUnchanged }))(stage('attested-retained')?.data ?? {}),
  inventory: {
    beforeEntries: before.length, afterEntries: after.length,
    reparseBefore: reparseBefore.map((r) => ({ path: r.path, id: r.id, attributes: r.attributes })),
    reparseAfter: reparseAfter.length,
    afterEqualsBeforeMinusLink: key(beforeNoLink.map((r) => r.path)) === key(after.map((r) => r.path)),
    nonTargetRowsIdentical: key(beforeNoLink.filter((r) => !isTarget(r))) === key(after.filter((r) => !isTarget(r))),
    targetRowsIdentical: key(before.filter(isTarget)) === key(after.filter(isTarget)),
    targetEntries: after.filter(isTarget).length,
    targetFilesHashed: after.filter((r) => isTarget(r) && !r.directory).every((r) => /^[a-f0-9]{64}$/.test(r.sha256 ?? '')),
    multiLinkFiles: after.filter((r) => !r.directory && r.links !== 1).length,
    sqliteRows: after.filter((r) => /graphgoblin\.db(-wal|-shm)?$/.test(r.path)).map((r) => ({ path: r.path.slice(disposable.length + 1), bytes: r.bytes, id: r.id })),
    lockOrReclaimRows: after.filter((r) => /graphgoblin(\.db)?\.graphgoblin\.lock|\.reclaim$|graphgoblin\.lock$/.test(r.path)).length,
  },
  boundInputsNow: { count: bound.length, allMatch: bound.every((b) => b.match), mismatched: bound.filter((b) => !b.match).map((b) => b.name) },
  junctionNow, targetNow,
};
console.log(JSON.stringify(out, null, 2));
