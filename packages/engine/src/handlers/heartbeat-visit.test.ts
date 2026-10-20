import { describe, expect, it } from 'vitest';
import { applyPatch } from '@graphgoblin/domain';
import type { NodeContext } from '../handler.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';
import { heartbeatHandler } from './heartbeat.js';

describe('heartbeat public handler visit evidence', () => {
  it('continues persisted beats and observations after a retry, then resets after completion', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('handler-visit', {
        id: 'hb',
        kind: 'heartbeat',
        label: 'Heartbeat',
        config: {
          intervalSeconds: 1,
          probe: { kind: 'signal-count', name: 'tick' },
          until: 'probe.count >= 3',
          maxBeats: 3,
          record: 'full',
        },
      }),
    );
    const run = await e.runToIdle(v.loopId);
    const waitId = run.waiting!.waitId;
    await e.manager.signal(run.id, 'tick', waitId);
    await e.manager.signal(run.id, 'tick', waitId);
    e.manager.stop();
    // A completed observation was persisted before an interrupted park/retry.
    await e.ports.events.append(run.id, [
      { type: 'run.woken', nodeId: 'hb', reason: 'timer' },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 2, configHash: 'fixture' },
      { type: 'heartbeat.beat', nodeId: 'hb', beat: 2, result: { name: 'tick', count: 2 } },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 3, configHash: 'fixture' },
    ]);
    const node = v.definition.nodes.find((n) => n.kind === 'heartbeat');
    if (node?.kind !== 'heartbeat') throw Error('fixture');
    const thread = await e.manager.getThread(run.id);
    if (!thread) throw Error('thread');
    const unused = () => Promise.reject(new Error('unused service'));
    const ctx: NodeContext<'heartbeat'> = {
      node,
      config: node.config,
      definition: v.definition,
      thread,
      run: { ...run, status: 'running' },
      attempt: 3,
      previousWait: run.waiting!,
      signal: new AbortController().signal,
      ports: e.ports,
      settings: e.settings,
      services: {
        render: unused,
        record: async (draft) => {
          await e.ports.events.append(run.id, [draft]);
        },
        resolveModel: unused,
        startChild: unused,
        childOutcome: unused,
        events: () => e.ports.events.read(run.id),
        depth: () => Promise.resolve(0),
        workingDirectory: () => Promise.resolve('.'),
        newId: () => e.ports.ids.next(),
        now: () => e.ports.clock.now().toISOString(),
      },
    };
    const continued = await heartbeatHandler.execute(ctx);
    expect(continued.kind).toBe('done');
    expect(
      e
        .events(run.id)
        .filter((ev) => ev.type === 'heartbeat.beat')
        .at(-1),
    ).toMatchObject({ beat: 3 });
    expect(applyPatch(ctx.thread, continued.patch).outputs['hb']?.value).toEqual({
      beat: 3,
      probe: { name: 'tick', count: 2 },
      exhausted: true,
    });
    await e.ports.events.append(run.id, [
      { type: 'node.finished', nodeId: 'hb', patch: continued.patch, route: 'out', durationMs: 0 },
      { type: 'signal.received', name: 'tick' },
      { type: 'signal.received', name: 'tick' },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 1, configHash: 'fixture' },
    ]);
    const { previousWait: _previous, ...fresh } = ctx;
    const next = await heartbeatHandler.execute({ ...fresh, attempt: 1 });
    expect(next.kind).toBe('park');
    if (next.kind === 'park') expect(next.wait.beat).toBe(1);
    expect(
      e
        .events(run.id)
        .filter((ev) => ev.type === 'heartbeat.beat')
        .at(-1),
    ).toMatchObject({ beat: 1, result: { name: 'tick', count: 0 } });
  });
});
