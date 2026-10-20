import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestEngine } from './testing/scenario.js';
import { RunManager } from './run-manager.js';
function repeated(kind: 'wait' | 'heartbeat' = 'wait'): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'Repeated wait',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      kind === 'wait'
        ? { id: 'work', kind, label: 'Work', config: { mode: 'input', prompt: 'Answer' } }
        : {
            id: 'work',
            kind,
            label: 'Work',
            config: {
              intervalSeconds: 1,
              probe: { kind: 'signal-count', name: 'tick' },
              until: 'probe.count >= 1',
              maxBeats: 10,
            },
          },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'gates.gate.passes < 2 ? "repeat" : "done"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 3,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.work.value' } },
      { id: 'limit', kind: 'exit', label: 'Limit', config: { outcome: 'exhausted' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'repeat' }, to: { node: 'work' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'e', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'limit' } },
    ],
  };
}

describe('logical wait regressions', () => {
  it('rejects a duplicate answer from the previous visit at the same node', async () => {
    const e = await createTestEngine();
    const v = e.publish(repeated());
    const a = await e.runToIdle(v.loopId);
    await e.manager.provideInput(a.id, a.waiting!.waitId, 'A');
    const b = await e.settle(a.id);
    expect(b.status).toBe('waiting');
    expect(b.waiting?.startedSeq).not.toBe(a.waiting?.startedSeq);
    await expect(e.manager.provideInput(a.id, a.waiting!.waitId, 'stale A')).rejects.toMatchObject({
      code: 'WAIT_MISMATCH',
    });
  });
  it('resets heartbeat signal counts when a gate repeats the node', async () => {
    const e = await createTestEngine();
    const v = e.publish(repeated('heartbeat'));
    const a = await e.runToIdle(v.loopId);
    await e.manager.signal(a.id, 'tick', a.waiting!.waitId);
    await e.ports.timers.fire(a.id, 'heartbeat');
    const b = await e.settle(a.id);
    expect(b.status).toBe('waiting');
    expect(b.waiting?.beat).toBe(1);
  });
  it('does not discard a due timer delivered while the handler is still parking', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const manager = new RunManager(
      {
        ...e.ports,
        timers: {
          schedule: async (id, key, at) => {
            await e.ports.timers.schedule(id, key, at);
            await e.ports.timers.fireDue(e.ports.clock.now());
          },
          cancel: (id, key) => e.ports.timers.cancel(id, key),
          onFire: (l) => e.ports.timers.onFire(l),
        },
      },
      e.settings,
    );
    await manager.start();
    try {
      const def = repeated();
      def.nodes[1] = {
        id: 'work',
        kind: 'wait',
        label: 'Zero',
        config: { mode: 'until', timestamp: '2026-10-02T12:00:00.000Z' },
      };
      const v = e.publish(def);
      const r = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      expect((await manager.getRun(r.id))?.status).toBe('succeeded');
    } finally {
      manager.stop();
    }
  });
});

it('the fake repository honors the same observed-wait transition guard as SQLite', async () => {
  const e = await createTestEngine();
  const v = e.publish(repeated());
  const a = await e.runToIdle(v.loopId);
  e.manager.stop();
  const repo = e.ports.runs;
  await repo.update(a.id, { waiting: { ...a.waiting!, waitId: 'replacement' } });
  expect(
    await repo.transition(a.id, ['waiting'], { status: 'running' }, { waitId: a.waiting!.waitId }),
  ).toBeUndefined();
  expect((await repo.get(a.id))?.waiting?.waitId).toBe('replacement');
  expect(
    await repo.transition(a.id, ['waiting'], { status: 'running' }, { waitId: 'replacement' }),
  ).toMatchObject({ status: 'running' });
});
