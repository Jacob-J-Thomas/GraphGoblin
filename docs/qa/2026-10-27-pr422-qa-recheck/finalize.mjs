import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import * as L from './lib.mjs';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profile = new RegExp(process.env.USERPROFILE.split(/[\\/]/).map(esc).join('[\\\\/]+'), 'gi');
const clean = (s) => L.redact(s).replace(profile, '%USERPROFILE%');
const digest = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = (n) => JSON.parse(fs.readFileSync(path.join(L.RECORD, n), 'utf8'));
const b = read('behaviour-results.json');
const repair = b.evidence.scenarios.scriptRepair;
const dispatches = repair.after.filter((e) => e.type === 'script.dispatched');
L.save('assertion-corrections.json', {
  name: 'Resume logical visit identity',
  originalAssertion: 'node.started count must stay one',
  whyWrong: 'A retry records node.started attempt 2 while retaining the original logical visitId.',
  evaluatedOriginalCapture: true,
  passed:
    repair.failed.versionId === repair.repaired.versionId &&
    new Set(dispatches.map((e) => e.visitId)).size === 1 &&
    JSON.stringify(repair.before[0]) === JSON.stringify(repair.after[0]),
  versionBefore: repair.failed.versionId,
  versionAfter: repair.repaired.versionId,
  visitIds: dispatches.map((e) => e.visitId),
  dispatchIds: dispatches.map((e) => e.dispatchId),
  started: repair.after.filter((e) => e.type === 'node.started' && e.nodeId === 'script'),
});
L.save('fake-cli-requests.log.txt', fs.readFileSync(path.join(L.CLI, 'requests.jsonl'), 'utf8'));
const omissions = [];
const add = (p) => {
  if (fs.existsSync(p) && fs.statSync(p).isFile())
    omissions.push({ path: clean(p), bytes: fs.statSync(p).size, sha256: digest(p) });
};
add(path.join(L.ROOT, 'baseline-main.tar'));
for (const entry of fs.readdirSync(L.ROOT, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== 'baseline-main')
    for (const name of ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm'])
      add(path.join(L.ROOT, entry.name, name));
}
for (const name of ['claude.exe', 'codex.exe', 'requests.jsonl']) add(path.join(L.CLI, name));
L.save(
  'NOT-KEPT.md',
  '# Omitted raw artifacts\n\nThese artifacts remain in disposable system temp and are not included in this QA record. The archive and extracted baseline source/build tree are build inputs, not retained acceptance evidence. The database files are raw disposable stores; public observations and read-only migration results are in the retained JSON captures. No trace archive was captured. Nothing was deleted.\n\n| Artifact | Bytes | SHA-256 |\n| --- | ---: | --- |\n' +
    omissions.map((x) => `| \`${x.path}\` | ${x.bytes} | \`${x.sha256}\` |`).join('\n') +
    '\n',
);
for (const name of fs.readdirSync(L.RECORD)) {
  if (/\.(?:md|json|mjs|ps1|txt)$/.test(name)) {
    const p = path.join(L.RECORD, name);
    let data = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    fs.writeFileSync(p, clean(data), 'utf8');
  }
}
console.log(
  'Sanitized text, corrected assertion on original evidence, and inventoried omitted raw artifacts.',
);
