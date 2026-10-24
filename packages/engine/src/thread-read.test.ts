import { expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { reconcileThread } from '@graphgoblin/domain';
import { RunManager } from './run-manager.js';
import type { EventStorePort } from './ports.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

async function setup(waiting = false) {
  const engine = await createTestEngine();
  const version = engine.publish(
    waiting
      ? singleNodeLoop('parked checkpoint', {
          id: 'wait',
          kind: 'wait',
          label: 'Wait',
          config: { mode: 'input', prompt: 'Approve?' },
        })
      : minimalLoop(),
  );
  const run = await engine.runToIdle(version.loopId);
  engine.manager.stop();
  const reads: { after: number; seqs: number[] }[] = [];
  const events: EventStorePort = {
    append: (...args) => engine.ports.events.append(...args),
    subscribe: (...args) => engine.ports.events.subscribe(...args),
    async read(runId, after = 0, limit) {
      const result = await engine.ports.events.read(runId, after, limit);
      reads.push({ after, seqs: result.map((e) => e.seq) });
      return result;
    },
  };
  const reader = new RunManager({ ...engine.ports, events }, engine.settings);
  const initial = await engine.ports.runs.getInitialThread(run.id);
  if (!initial) throw new Error('No seed');
  const history = engine.events(run.id);
  return { engine, run, reader, reads, initial, history };
}

it('reads only the checkpoint event for a current terminal snapshot', async () => {
  const t = await setup();
  const checkpoint = await t.engine.ports.runs.getThreadCheckpoint(t.run.id);
  if (!checkpoint) throw new Error('No checkpoint');
  expect(await t.reader.getThread(t.run.id)).toEqual(reconcileThread(t.initial, t.history));
  expect(t.reads).toEqual([{ after: checkpoint.seq - 1, seqs: [checkpoint.seq] }]);
  expect(await t.engine.ports.runs.getThreadCheckpoint(t.run.id)).toEqual(checkpoint);
});
it('catches up a completed checkpoint without replaying a duplicate completion patch', async () => {
  const t = await setup();
  const finished = t.history.findLast((e) => e.type === 'node.finished');
  if (!finished) throw new Error('No finish');
  await t.engine.ports.runs.saveThread(
    t.run.id,
    reconcileThread(t.initial, t.history, undefined, finished.seq),
    finished.seq,
  );
  await t.engine.ports.events.append(t.run.id, [
    {
      type: 'node.finished',
      nodeId: finished.nodeId,
      durationMs: 0,
      patch: [{ op: 'add', path: '/vars/duplicate', value: true }],
    },
  ]);
  expect(await t.reader.getThread(t.run.id)).toEqual(
    reconcileThread(t.initial, t.engine.events(t.run.id)),
  );
  expect(t.reads).toEqual([
    {
      after: finished.seq - 1,
      seqs: t.engine
        .events(t.run.id)
        .filter((e) => e.seq >= finished.seq)
        .map((e) => e.seq),
    },
  ]);
});
it('derives the open visit at a parked checkpoint without reading its prefix', async () => {
  const t = await setup(true);
  const checkpoint = await t.engine.ports.runs.getThreadCheckpoint(t.run.id);
  if (!checkpoint) throw new Error('No park');
  await t.engine.ports.events.append(t.run.id, [
    {
      type: 'node.finished',
      nodeId: 'wait',
      durationMs: 0,
      patch: [{ op: 'add', path: '/vars/answered', value: true }],
    },
  ]);
  expect(await t.reader.getThread(t.run.id)).toEqual(
    reconcileThread(t.initial, t.engine.events(t.run.id)),
  );
  expect(t.reads[0]?.after).toBe(checkpoint.seq - 1);
  expect(t.reads).toHaveLength(1);
});
it('falls back to the full seed/history when the checkpoint event is missing or its state is ambiguous', async () => {
  for (const missing of [true, false]) {
    const t = await setup();
    const seq = missing ? 999 : t.history.find((e) => e.type === 'exit.evaluated')?.seq;
    if (!seq) throw new Error('No boundary');
    await t.engine.ports.runs.saveThread(
      t.run.id,
      reconcileThread(t.initial, t.history, undefined, seq),
      seq,
    );
    expect(await t.reader.getThread(t.run.id)).toEqual(reconcileThread(t.initial, t.history));
    expect(t.reads.map((r) => r.after)).toEqual([seq - 1, 0]);
  }
});
it('replays the full history when no sequenced checkpoint exists', async () => {
  const t = await setup();
  await t.engine.ports.runs.saveThread(t.run.id, t.initial);
  expect(await t.reader.getThread(t.run.id)).toEqual(reconcileThread(t.initial, t.history));
  expect(t.reads.map((r) => r.after)).toEqual([0]);
});

it('derives an unfinished started checkpoint without applying a patch early', async () => {
  const t = await setup();
  const start = t.history.findLast((e) => e.type === 'node.started');
  if (!start) throw new Error('No start');
  await t.engine.ports.runs.saveThread(
    t.run.id,
    reconcileThread(t.initial, t.history, undefined, start.seq),
    start.seq,
  );
  expect(await t.reader.getThread(t.run.id)).toEqual(reconcileThread(t.initial, t.history));
  expect(t.reads.map((r) => r.after)).toEqual([start.seq - 1]);
});
