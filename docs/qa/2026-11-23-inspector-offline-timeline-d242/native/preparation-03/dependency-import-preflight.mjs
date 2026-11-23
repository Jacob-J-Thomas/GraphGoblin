import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const binding = JSON.parse(fs.readFileSync(path.join(here, 'OLD-ROOT-BINDING.template.json'), 'utf8'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const verify = ref => { const raw = fs.readFileSync(ref.source); assert(raw.length === ref.bytes && hash(raw) === ref.sha256); };
assert(process.version === 'v22.23.4'); verify(binding.runtime.node); verify(binding.runtime.contractsEntry); verify(binding.fixture);
assert(path.resolve(process.execPath).toLowerCase() === path.resolve(binding.runtime.node.source).toLowerCase());
const schemas = await import(pathToFileURL(binding.runtime.contractsEntry.source).href);
const names = ['RunRecordSchema', 'RunSnapshotSchema', 'DeletionSelectionSchema', 'DeletionConfirmationSchema'];
for (const name of names) assert(typeof schemas[name]?.parse === 'function', 'Missing public schema export ' + name);
const fixture = JSON.parse(fs.readFileSync(binding.fixture.source, 'utf8'));
const runPath = fixture.runPath, runA = structuredClone(fixture.responses[runPath]), idA = runA.id;
assert(runPath === '/runs/' + idA && runA.status === 'failed' && runA.finalizedAt && runA.recovery.observedSeq === 6);
schemas.RunSnapshotSchema.parse(runA);
const idB = idA.slice(0, -1) + (idA.endsWith('Z') ? 'Y' : 'Z');
const rebind = value => {
  if (typeof value === 'string') return value === idA ? idB : value;
  if (Array.isArray(value)) return value.map(rebind);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebind(item)]));
  return value;
};
const runB = rebind(runA); schemas.RunSnapshotSchema.parse(runB);
const running = structuredClone(runA);
running.status = 'running'; running.lastEventSeq = 7;
delete running.failure; delete running.finishedAt; delete running.finalizedAt;
running.recovery = { observedSeq: 7, resume: { allowed: false, code: 'RUN_ACTIVE', message: 'Controlled running response' },
  replayDefault: { allowed: false, code: 'RUN_ACTIVE', message: 'Controlled running response' }, replay: [] };
schemas.RunSnapshotSchema.parse(running);
const asRecord = snapshot => { const value = structuredClone(snapshot); delete value.recovery; return schemas.RunRecordSchema.parse(value); };
asRecord(runA); asRecord(runB); asRecord(running);
schemas.DeletionSelectionSchema.parse({ runIds: [idA] });
schemas.DeletionConfirmationSchema.parse({ runIds: [idA], action: 'mark', confirmed: true, token: 'a'.repeat(64) });
console.log(JSON.stringify({ scope: 'Dependency import and pure schema prerequisite only', node: process.version,
  importedPinnedPublicEntry: binding.runtime.contractsEntry, exportsPresent: names,
  exactFixtureRunSnapshotValid: true, reboundRunSnapshotValid: true, generatedRunningSnapshotValid: true,
  generatedRunningRecordValid: true, originalAndReboundRunRecordsValid: true, plannedDeletionBodiesValid: true,
  browserOrProductCasesStarted: 0, serverOrProviderLaunched: false, semanticProjectionChanged: false }));
