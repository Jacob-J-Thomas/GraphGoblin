import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { RunRecordSchema, RunSnapshotSchema } from 'file:///G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/packages/contracts/src/index.ts';
import { FakeApi } from 'file:///G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/apps/web/src/__fixtures__/fake-api.ts';

// Isolated fixture/schema diagnosis only: no App, QueryClient, Vitest, real fetch or HTTP listener.
const api = new FakeApi();
const wait = { waitId: 'review2-wait', startedSeq: 3, nodeId: 'real-wait', kind: 'input' as const };
const run = api.addRun({ status: 'waiting', lastEventSeq: 3, currentNodeId: 'real-wait', waiting: wait });
const response = await api.fetch(new Request(`http://fixture-only.test/runs/${run.id}`));
const body: unknown = await response.json();
const record = RunRecordSchema.safeParse(body);
const snapshot = RunSnapshotSchema.safeParse(body);
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = {
  atUtc: new Date().toISOString(), candidateHead: '3168250645fe37bced7ace6a664c82fd137b1196',
  tier: 'isolated legitimate FakeApi GET detail + contract schema evaluation; not a component rerun',
  networkRequests: 0, listeners: 0, vitestCases: 0, responseStatus: response.status,
  actualKeys: typeof body === 'object' && body !== null ? Object.keys(body) : [],
  wrongRecordSchemaAccepted: record.success,
  wrongRecordSchemaIssues: record.success ? [] : record.error.issues,
  correctSnapshotSchemaAccepted: snapshot.success,
  correctSnapshotSchemaIssues: snapshot.success ? [] : snapshot.error.issues,
  foreignFlagReachedByOriginalFixture: record.success,
  desiredAssertionsExercised: false,
  source: [
    'packages/contracts/src/run.ts', 'apps/web/src/__fixtures__/fake-api.ts',
    'apps/web/src/runs/RunInspectorPage.review2-independent-qa.test.tsx',
  ].map((path) => ({ path, sha256: sha('G:/ggq/gg-i5-truthfulness-qa/GraphGoblin/' + path) })),
};
writeFileSync('G:/ggq/delivery-evidence/2026-11-17-five-intents/i5-386-corrective-final-qa-01/d228-diagnostic-01/r2-2-schema-cause.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
if (record.success || !snapshot.success) process.exitCode = 1;
