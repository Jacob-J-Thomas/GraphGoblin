/**
 * Stored definitions that predate ADR-0044 (#242): an exit that still publishes an Event is
 * refused before anything executes, at admission, on replay and at every executor start, with
 * the non-resumable `LOOP_UPGRADE_REQUIRED` naming the loop, the version and the destination.
 */
import { describe, expect, it } from 'vitest';
import type { LoopDefinition, LoopVersionRecord } from '@graphgoblin/contracts';
import { LoopUpgradeRequiredError } from './errors.js';
import { assertCurrentDefinition, definitionUpgradeRequired } from './stored-definition.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';

/** The record as a store saved before ADR-0044 would hold it: its exit also publishes an Event. */
function stored(e: TestEngine, record: LoopVersionRecord): LoopVersionRecord {
  const definition = structuredClone(record.definition) as unknown as {
    nodes: { kind: string; config: { destinations?: unknown[] } }[];
  };
  for (const node of definition.nodes)
    if (node.kind === 'exit')
      node.config.destinations = [{ kind: 'event', eventType: 'loop-done' }];
  const old = { ...record, definition: definition as unknown as LoopDefinition };
  e.ports.loops.add(old);
  return old;
}

const waitLoop = singleNodeLoop('emitting wait', {
  id: 'ask',
  kind: 'wait',
  label: 'Ask',
  config: { mode: 'input', prompt: '?' },
});

describe('stored definitions with an Event destination (#242)', () => {
  it('names the loop, the version and every destination, and says how to repair', async () => {
    const e = await createTestEngine();
    const version = stored(e, e.publish(waitLoop));
    expect(definitionUpgradeRequired(e.publish(waitLoop, { loopId: e.loopId('ok') }))).toBe(
      undefined,
    );
    const refused = definitionUpgradeRequired(version)!;
    expect(refused).toBeInstanceOf(LoopUpgradeRequiredError);
    expect(refused.toFailure()).toEqual({
      code: 'LOOP_UPGRADE_REQUIRED',
      message: expect.stringContaining('/nodes/2/config/destinations/0'),
      resumable: false,
      details: {
        loopId: version.loopId,
        versionId: version.id,
        version: 1,
        paths: ['/nodes/2/config/destinations/0'],
      },
    });
    expect(refused.message).toMatch(/published version 1/);
    expect(definitionUpgradeRequired({ ...version, status: 'snapshot' })?.message).toMatch(
      /draft-run snapshot .* of version 1/,
    );
    expect(() => assertCurrentDefinition(version)).toThrow(LoopUpgradeRequiredError);
  });

  it('refuses admission and replay, creating no run', async () => {
    const e = await createTestEngine();
    const ok = await e.runToIdle(e.publish(waitLoop).loopId);
    expect(ok.status).toBe('waiting');
    const version = stored(e, (await e.ports.loops.getVersion(ok.versionId))!);
    await expect(e.start(version.loopId)).rejects.toBeInstanceOf(LoopUpgradeRequiredError);
    await expect(e.manager.replay({ runId: ok.id, nodeId: 'ask' })).rejects.toMatchObject({
      code: 'LOOP_UPGRADE_REQUIRED',
    });
    expect([...e.ports.runs.runs.values()]).toHaveLength(1);
  });

  it('fails a run already pinned to such a definition before it executes again, and its parent with it', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(waitLoop);
    const parentLoop = e.publish(
      singleNodeLoop('awaiting parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: child.loopId } },
      }),
    );
    const parent = await e.runToIdle(parentLoop.loopId);
    const [kid] = await e.ports.runs.listChildren(parent.id);
    expect(kid?.status).toBe('waiting');
    // The child was admitted before the upgrade; its pinned definition holds the destination.
    stored(e, child);
    await e.manager.provideInput(kid!.id, kid!.waiting!.waitId, 'go');
    const failedKid = await e.settle(kid!.id);
    expect(failedKid.failure).toMatchObject({
      code: 'LOOP_UPGRADE_REQUIRED',
      resumable: false,
      details: { loopId: child.loopId, versionId: child.id },
    });
    // Nothing after the wait ran.
    expect(e.events(kid!.id).filter((event) => event.type === 'node.finished')).toHaveLength(1);
    // The awaiting parent fails with it (#251), not resumable.
    expect(await e.settle(parent.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'LOOP_UPGRADE_REQUIRED', resumable: false, nodeId: 'sub' },
    });
  });

  it('fails a parent at its subloop node when the child loop it would start holds one', async () => {
    const e = await createTestEngine();
    const child = stored(e, e.publish(waitLoop));
    const parent = await e.runToIdle(
      e.publish(
        singleNodeLoop('calls an old loop', {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: { loopRef: { loopId: child.loopId } },
        }),
      ).loopId,
    );
    expect(parent.failure).toMatchObject({
      code: 'LOOP_UPGRADE_REQUIRED',
      resumable: false,
      nodeId: 'sub',
      details: { loopId: child.loopId, versionId: child.id },
    });
    expect(await e.ports.runs.listChildren(parent.id)).toEqual([]);
  });
});
