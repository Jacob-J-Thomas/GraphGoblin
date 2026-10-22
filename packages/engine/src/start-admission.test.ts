import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';

let t: TestEngine;
afterEach(() => {
  t?.manager.stop();
});
const mutation = () =>
  singleNodeLoop('Effect', {
    id: 'effect',
    kind: 'mutate',
    label: 'Effect',
    config: { operations: [{ op: 'append-message', content: 'effect' }] },
  });

describe('optional run-start admission policy', () => {
  it('rejects before persisting a run, draft snapshot or effect', async () => {
    t = await createTestEngine();
    const root = t.publish(mutation(), { status: 'draft' });
    let snapshotId = '';
    await expect(
      t.manager.startRun(
        {
          ownerId: 'local',
          loopId: root.loopId,
          versionId: root.id,
          source: 'manual.api',
          allowDraft: true,
        },
        (plan) => {
          snapshotId = plan.root.id;
          expect(plan.root.status).toBe('snapshot');
          expect(plan.versions.get(snapshotId)).toEqual(plan.root);
          return Promise.reject(new Error('Admission refused'));
        },
      ),
    ).rejects.toThrow('Admission refused');
    expect(snapshotId).not.toBe(root.id);
    expect(await t.ports.loops.getVersion(snapshotId)).toBeUndefined();
    expect(await t.ports.runs.listRecoveryCandidates()).toEqual([]);
  });

  it('commits the checked pins without holding the pin lock during policy IO', async () => {
    t = await createTestEngine();
    const child = t.publish(mutation());
    const root = t.publish(
      singleNodeLoop('Parent draft', {
        id: 'child',
        kind: 'subloop',
        label: 'Child',
        config: { loopRef: { loopId: child.loopId } },
      }),
      { status: 'draft' },
    );
    const unrelated = t.publish(
      singleNodeLoop('Unrelated', {
        id: 'nothing',
        kind: 'mutate',
        label: 'Nothing',
        config: { operations: [{ op: 'append-message', content: 'unrelated effect' }] },
      }),
    );
    const admitted = await t.manager.startRun(
      {
        ownerId: 'local',
        loopId: root.loopId,
        versionId: root.id,
        source: 'manual.api',
        allowDraft: true,
      },
      async (plan) => {
        expect(plan.subloopVersions[child.loopId]).toBe(child.id);
        expect(plan.versions.get(child.id)).toEqual(child);
        // Publishing a newer child cannot replace the checked child in the queued intent.
        t.publish(mutation(), { loopId: child.loopId, version: 2 });
        await t.manager.startRun({ ownerId: 'local', loopId: unrelated.loopId, source: 'cron' });
      },
    );
    await t.manager.waitForIdle();
    expect(t.events(admitted.id)[0]).toMatchObject({
      subloopVersions: { [child.loopId]: child.id },
    });
    expect((await t.ports.runs.listChildren(admitted.id))[0]!.versionId).toBe(child.id);
    expect(admitted.pinned.source).toBe('draft');
  });

  it.each(['root', 'child'] as const)(
    'revalidates a %s deleted during policy IO',
    async (target) => {
      t = await createTestEngine();
      const child = t.publish(mutation());
      const root = t.publish(
        singleNodeLoop('Parent', {
          id: 'child',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: child.loopId } },
        }),
      );
      await expect(
        t.manager.startRun({ ownerId: 'local', loopId: root.loopId, source: 'manual.api' }, () => {
          // Supported in-memory repository fault injection at the storage boundary.
          t.ports.loops.versions.delete(target === 'root' ? root.id : child.id);
          return Promise.resolve();
        }),
      ).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
      expect(await t.ports.runs.listRecoveryCandidates()).toEqual([]);
    },
  );
});
