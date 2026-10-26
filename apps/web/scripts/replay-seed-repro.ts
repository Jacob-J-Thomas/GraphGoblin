import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp, createContainer, loadConfig } from '@graphgoblin/api';
import { FakeHarness } from '@graphgoblin/engine/testing';
import {
  ContextThreadSchema,
  RunEventSchema,
  RunRecordSchema,
  RunSnapshotSchema,
} from '@graphgoblin/contracts';
import { replayThread } from '@graphgoblin/domain';
import { replaySeedLoop } from './replay-seed-fixture.js';

// Retain this disposable store for inspection. Never remove directories in the worker sandbox.
const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186r2-'));
const container = await createContainer(
  loadConfig({
    GG_DATA_DIR: dataDir,
    GG_PORT: '5828',
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
  }),
  { harnesses: { codex: new FakeHarness() }, startTimers: false },
);
await container.start();
const app = await buildApp(container, { logger: false });
await app.listen({ port: 5828, host: '127.0.0.1' });
async function api(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(
    `http://127.0.0.1:5828${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result: unknown = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
function wrapped(value: unknown, key: string): unknown {
  assert.ok(value && typeof value === 'object' && key in value);
  return Reflect.get(value, key);
}
try {
  const loopId = RunRecordSchema.shape.loopId.parse(
    wrapped(
      wrapped(
        await api('/loops', {
          definition: replaySeedLoop('WP-G1 reproduction'),
        }),
        'loop',
      ),
      'id',
    ),
  );
  await api(`/loops/${loopId}/publish`, {});
  const source = RunRecordSchema.parse(wrapped(await api(`/loops/${loopId}/runs`, {}), 'run'));
  await container.manager.waitForIdle();
  const frozenSource = async () => {
    const {
      recovery: _recovery,
      lastEventSeq: _seq,
      ...record
    } = RunSnapshotSchema.parse(await api(`/runs/${source.id}`));
    const events = RunEventSchema.array().parse(
      wrapped(await api(`/runs/${source.id}/events`), 'items'),
    );
    // The source records fork requests; execution state and all other history stay unchanged.
    return JSON.stringify({
      record,
      events: events.filter((event) => event.type !== 'run.replay_requested'),
      snapshot: await container.repos.runs.getThreadCheckpoint(source.id),
      initial: await container.repos.runs.getInitialThread(source.id),
    });
  };
  const beforeSource = await frozenSource();
  const comparisons = [];
  // Second node, then a deeper fork with inherited values, then a fork of that fork with passes 2.
  let parentId = source.id;
  for (const nodeId of ['prepare', 'gate', 'append']) {
    container.manager.stop();
    const fork = RunRecordSchema.parse(
      wrapped(
        await api(`/runs/${parentId}/replay`, {
          nodeId,
          observedSeq: (await container.manager.getRecovery(parentId)).observedSeq,
        }),
        'run',
      ),
    );
    const queuedThread = ContextThreadSchema.parse(await api(`/runs/${fork.id}/thread`));
    const actualSeed = await container.repos.runs.getInitialThread(fork.id);
    assert.deepEqual(queuedThread, actualSeed);
    await container.manager.start();
    await container.manager.waitForIdle();
    const current = ContextThreadSchema.parse(await api(`/runs/${fork.id}/thread`));
    const events = RunEventSchema.array().parse(
      wrapped(await api(`/runs/${fork.id}/events`), 'items'),
    );
    assert.ok(actualSeed);
    // Same public domain projection used by the executor's loadThread and replay input. Also
    // reconcile it against the actual saved checkpoint and the terminal public thread below.
    const checkpoint = await container.repos.runs.getThreadCheckpoint(fork.id);
    assert.ok(checkpoint);
    assert.deepEqual(replayThread(actualSeed, events, checkpoint.seq), checkpoint.thread);
    assert.deepEqual(replayThread(actualSeed, events), current);
    const sequences = [];
    for (const event of events) {
      const expected = replayThread(actualSeed, events, event.seq);
      const actual = ContextThreadSchema.parse(
        await api(`/runs/${fork.id}/thread?at=${event.seq}`),
      );
      const discrepancies = Object.keys(expected).filter(
        (key) =>
          JSON.stringify(Reflect.get(expected, key)) !== JSON.stringify(Reflect.get(actual, key)),
      );
      sequences.push({ seq: event.seq, type: event.type, discrepancies, expected, actual });
    }
    comparisons.push({
      forkId: fork.id,
      parentId,
      nodeId,
      queuedThread,
      recordedSeed: events[0]?.type === 'run.queued' ? events[0].initialThread : null,
      sequences,
    });
    parentId = fork.id;
  }
  assert.equal(await frozenSource(), beforeSource);
  const output = resolve(
    process.argv[2] ?? '../../docs/qa/2026-10-24-wp-e1-186-r2/replay-seed-check.json',
  );
  await writeFile(
    output,
    JSON.stringify({ dataDir, sourceId: source.id, sourceUnchanged: true, comparisons }, null, 2),
  );
  process.stdout.write(
    JSON.stringify({
      output,
      dataDir,
      forks: comparisons.map((fork) => ({
        nodeId: fork.nodeId,
        events: fork.sequences.length,
        disagreements: fork.sequences.filter((seq) => seq.discrepancies.length).length,
        first: fork.sequences[0]?.discrepancies,
      })),
    }) + '\n',
  );
} finally {
  await app.close();
  await container.stop();
}
