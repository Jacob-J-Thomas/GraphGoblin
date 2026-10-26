import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { reconcileThread, replayThread } from '@graphgoblin/domain';
import { createTestEngine } from '@graphgoblin/engine/testing';
import { describe, expect, it } from 'vitest';
import { patchDiff } from '../src/runs/projections.js';
import { replaySeedLoop } from './replay-seed-fixture.js';

describe('replay fork projections against the engine', () => {
  it.each(['recorded', 'repository'] as const)(
    'equals the engine at every sequence using the %s seed, including a fork of a fork',
    async (seedFrom) => {
      const engine = await createTestEngine();
      try {
        const definition = LoopDefinitionSchema.parse(replaySeedLoop());
        const version = engine.publish(definition);
        const source = await engine.runToIdle(version.loopId);
        let parentId = source.id;
        for (const nodeId of ['prepare', 'gate', 'append']) {
          const fork = await engine.manager.replay({ runId: parentId, nodeId });
          await engine.settle(fork.id);
          const current = (await engine.manager.getThread(fork.id))!;
          const seed = (await engine.ports.runs.getInitialThread(fork.id))!;
          const events = engine.events(fork.id);
          const first = events[0];
          if (first?.type !== 'run.queued' || !first.initialThread)
            throw new Error('Missing admitted seed');
          const recorded = first.initialThread;
          if (seedFrom === 'recorded') expect(recorded).toEqual(seed);
          const initial = seedFrom === 'recorded' ? recorded : seed;
          for (const event of events) {
            // Domain replay is the executor's authoritative reconstruction; reconcile the actual
            // executor's saved checkpoint too, rather than trusting only two projections.
            expect(
              reconcileThread(initial, events, undefined, event.seq),
              `${nodeId} at ${event.seq}`,
            ).toEqual(replayThread(seed, events, event.seq));
          }
          expect(reconcileThread(initial, events, undefined, events.at(-1)!.seq)).toEqual(current);
          const checkpoint = (await engine.ports.runs.getThreadCheckpoint(fork.id))!;
          expect(reconcileThread(initial, events, undefined, checkpoint.seq)).toEqual(
            checkpoint.thread,
          );
          if (nodeId === 'prepare') {
            const finish = events.find(
              (event) => event.type === 'node.finished' && event.nodeId === 'prepare',
            );
            if (finish?.type !== 'node.finished') throw new Error('Prepare never finished');
            const lines = patchDiff(
              reconcileThread(initial, events, undefined, finish.seq - 1),
              reconcileThread(initial, events, undefined, finish.seq),
              finish.patch,
            );
            expect(lines.find((line) => line.path === '/vars/history')).toMatchObject({
              op: 'add',
              before: undefined,
              after: ['seed'],
            });
            expect(lines.find((line) => line.path === '/vars/total')).toMatchObject({
              op: 'add',
              before: undefined,
              after: 0,
            });
          }
          if (nodeId === 'append') {
            expect(seed.gates).toEqual({ gate: { passes: 2 } });
            expect(seed.run.iteration).toBe(1);
            const finish = events.find(
              (event) => event.type === 'node.finished' && event.nodeId === 'append',
            );
            if (finish?.type !== 'node.finished') throw new Error('Append never finished');
            const before = reconcileThread(initial, events, undefined, finish.seq - 1);
            const after = reconcileThread(initial, events, undefined, finish.seq);
            const diff = patchDiff(before, after, finish.patch);
            expect(diff.find((line) => line.path === '/vars/total')).toMatchObject({
              op: 'replace',
              before: 1,
              after: 2,
            });
            expect(diff.find((line) => line.path === '/vars/added')).toMatchObject({
              op: 'replace',
              before: 'present',
              after: 'present',
            });
            expect(after.vars.history).toEqual(['seed', 'step', 'step']);
            expect(after.messages).toHaveLength(3);
          }
          parentId = fork.id;
        }
      } finally {
        engine.manager.stop();
      }
    },
  );
});
