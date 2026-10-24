/** Controlled persisted ~10k-event HTTP measurement; no execution or provider work. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextThreadSchema,
  RunRecordSchema,
  CURRENT_DEFINITION_FORMAT,
} from '@graphgoblin/contracts';
import { reconcileThread, replayStateAt } from '@graphgoblin/domain';
import { RunManager, type EventDraft, type EventStorePort } from '@graphgoblin/engine';
import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { loadConfig } from '../src/config.js';

const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-g1-116-measure-'));
const container = await createContainer(
  loadConfig({
    GG_DATA_DIR: dataDir,
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_SWAGGER_UI: 'false',
  }),
  { startTimers: false },
);
await container.start();
container.manager.stop();
const reads: { afterSeq: number; rows: number }[] = [];
const events: EventStorePort = {
  append: (...args) => container.ports.events.append(...args),
  subscribe: (...args) => container.ports.events.subscribe(...args),
  async read(runId, afterSeq = 0, limit) {
    const result = await container.ports.events.read(runId, afterSeq, limit);
    reads.push({ afterSeq, rows: result.length });
    return result;
  },
};
const manager = new RunManager({ ...container.ports, events }, container.settings);
const app = await buildApp({ ...container, manager }, { logger: false });
try {
  const created = await app.inject({
    method: 'POST',
    url: '/loops',
    payload: {
      definition: {
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'Thread read measurement',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [{ id: 'edge', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      },
    },
  });
  if (created.statusCode !== 201) throw new Error(created.body);
  const loopId = created.json<{ loop: { id: string } }>().loop.id;
  const published = await app.inject({ method: 'POST', url: '/loops/' + loopId + '/publish' });
  if (published.statusCode !== 200) throw new Error(published.body);
  const started = await app.inject({
    method: 'POST',
    url: '/loops/' + loopId + '/runs',
    payload: {},
  });
  const run = RunRecordSchema.parse(started.json<{ run: unknown }>().run);
  const initial = await container.repos.runs.getInitialThread(run.id);
  if (!initial) throw new Error('Missing admitted seed');
  const drafts: EventDraft[] = [];
  for (let i = 0; i < 5000; i++)
    drafts.push(
      {
        type: 'node.started',
        nodeId: 'measure',
        kind: 'mutate',
        attempt: i + 1,
        configHash: '0'.repeat(64),
      },
      {
        type: 'node.finished',
        nodeId: 'measure',
        durationMs: 1,
        patch: [{ op: 'add', path: '/vars/measured', value: i }],
      },
    );
  for (let offset = 0; offset < drafts.length; offset += 200)
    await events.append(run.id, drafts.slice(offset, offset + 200));
  const history = await events.read(run.id);
  const finalSeq = history.at(-1)?.seq;
  if (!finalSeq) throw new Error('Empty history');
  const expected = reconcileThread(initial, history);
  const url = await app.listen({ host: '127.0.0.1', port: 5933 });
  const samples = [];
  for (const [name, seq] of [
    ['current', finalSeq],
    ['lagging-200-events', finalSeq - 200],
  ] as const) {
    await container.repos.runs.saveThread(
      run.id,
      reconcileThread(initial, history, undefined, seq),
      seq,
      replayStateAt(history, seq),
    );
    const ms: number[] = [];
    const counts: typeof reads = [];
    for (let i = 0; i < 6; i++) {
      reads.length = 0;
      const begin = performance.now();
      const response = await fetch(url + '/runs/' + run.id + '/thread');
      if (!response.ok) throw new Error('Thread HTTP ' + response.status);
      const thread = ContextThreadSchema.parse(await response.json());
      const elapsed = performance.now() - begin;
      if (JSON.stringify(thread) !== JSON.stringify(expected))
        throw new Error('Thread disagreement');
      if (i > 0) {
        ms.push(elapsed);
        counts.push(...reads);
      }
    }
    const sorted = [...ms].sort((a, b) => a - b);
    samples.push({
      name,
      checkpointSeq: seq,
      ms,
      medianMs: sorted[2],
      minMs: sorted[0],
      maxMs: sorted[4],
      reads: counts,
    });
  }
  const output =
    JSON.stringify(
      {
        label: process.env['GG_THREAD_MEASURE_LABEL'],
        runtime: process.version,
        events: history.length,
        finalSeq,
        warmupPerCase: 1,
        samplesPerCase: 5,
        transport: 'loopback HTTP, physical SQLite, controlled appended node pairs',
        samples,
      },
      null,
      2,
    ) + '\n';
  const target = process.env['GG_THREAD_MEASURE_OUTPUT'];
  if (!target) throw new Error('GG_THREAD_MEASURE_OUTPUT is required');
  await writeFile(target, output);
  process.stdout.write('Measurement saved\n');
} finally {
  manager.stop();
  await manager.waitForIdle();
  await app.close();
  await container.stop();
}
