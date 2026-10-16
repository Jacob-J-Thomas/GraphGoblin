import { describe, expect, it, vi } from 'vitest';
import { RunEventSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestEngine } from '../testing/scenario.js';

describe('terminal exits', () => {
  it.each([
    ['success', 'succeeded'],
    ['failure', 'failed'],
    ['exhausted', 'exhausted'],
  ] as const)('maps %s to %s and preserves its authored return', async (outcome, status) => {
    const e = await createTestEngine();
    const def = minimalLoop();
    def.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { outcome, returns: 'trigger.payload', destinations: [{ kind: 'log' }] },
    };
    const run = await e.runToIdle(e.publish(def).loopId, { value: 42 });
    expect(run).toMatchObject({ status, outcome, result: { value: 42 } });
    expect(run.failure).toBeUndefined();
    const events = e.events(run.id);
    for (const event of events) expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(events.find((event) => event.type === 'exit.evaluated')).toMatchObject({ outcome });
    expect(events.filter((event) => event.type === 'decision.made')).toEqual([]);
    expect(e.ports.codexDecider.routes).toEqual([]);
    expect(e.ports.classifiers.requests).toEqual([]);
    expect(e.ports.delivery.logged).toHaveLength(1);
    e.manager.stop();
  });

  it('a return mapping error fails before terminal exit completion', async () => {
    const e = await createTestEngine();
    const def = minimalLoop();
    def.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { returns: '$error("bad mapping")' },
    };
    const run = await e.runToIdle(e.publish(def).loopId);
    expect(run.status).toBe('failed');
    expect(e.eventTypes(run.id)).not.toContain('exit.evaluated');
    expect(e.eventTypes(run.id)).not.toContain('run.finished');
    e.manager.stop();
  });

  it('records exit evidence, completion and run outcome in one append', async () => {
    const e = await createTestEngine();
    const append = vi.spyOn(e.ports.events, 'append');
    const run = await e.runToIdle(e.publish(minimalLoop()).loopId);
    const batch = append.mock.calls.find(([, drafts]) =>
      drafts.some((draft) => draft.type === 'run.finished'),
    )?.[1];
    expect(batch?.map((event) => event.type)).toEqual([
      'exit.evaluated',
      'node.finished',
      'run.finished',
    ]);
    expect(run.status).toBe('succeeded');
    e.manager.stop();
  });
});
