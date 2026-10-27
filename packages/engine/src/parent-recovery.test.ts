import { expect, it, vi } from 'vitest';
import { RunManager } from './run-manager.js';
import type { EventStorePort, ScriptRunResult } from './ports.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

const completed: ScriptRunResult = {
  state: 'completed',
  exitCode: 0,
  stdout: 'null',
  stderr: '',
  stdoutBytes: 4,
  stderrBytes: 0,
  stdoutOverflow: false,
  stderrOverflow: false,
  timedOut: false,
};

it('surfaces a newer child failure when already accepted work advances before parent admission', async () => {
  const e = await createTestEngine();
  e.manager.stop();
  let dispatches = 0;
  e.ports.scripts.respondWith(() =>
    ++dispatches === 1 || dispatches === 3
      ? { ...completed, state: 'outcome-uncertain', exitCode: null }
      : completed,
  );
  const childDefinition = singleNodeLoop('pre-admission child', {
    id: 'a',
    kind: 'script',
    label: 'A',
    config: { command: 'a' },
  });
  childDefinition.nodes.splice(2, 0, {
    id: 'b',
    kind: 'script',
    label: 'B',
    config: { command: 'b' },
  });
  childDefinition.edges = [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
    { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
    { id: 'c', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
  ];
  const childVersion = e.publish(childDefinition);
  const version = e.publish(
    singleNodeLoop('pre-admission parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: childVersion.loopId } },
    }),
  );
  let parentId = '';
  let childId = '';
  let parentBlocked = false;
  let childBlocked = false;
  let releaseParent!: () => void;
  let releaseChild!: () => void;
  const parentGate = new Promise<void>((resolve) => {
    releaseParent = resolve;
  });
  const childGate = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  const events: EventStorePort = {
    recoveryFacts: (...args) => e.ports.events.recoveryFacts(...args),
    read: (...args) => e.ports.events.read(...args),
    subscribe: (...args) => e.ports.events.subscribe(...args),
    append: async (id, drafts, options) => {
      if (
        !parentBlocked &&
        id === parentId &&
        drafts.some((draft) => draft.type === 'run.failed')
      ) {
        parentBlocked = true;
        await parentGate;
      }
      if (!childBlocked && id === childId && drafts.some((draft) => draft.type === 'run.resumed')) {
        childBlocked = true;
        await childGate;
      }
      return e.ports.events.append(id, drafts, options);
    },
  };
  const manager = new RunManager({ ...e.ports, events }, e.settings);
  try {
    await manager.start();
    const parent = await manager.startRun({
      ownerId: 'local',
      loopId: version.loopId,
      source: 'manual.api',
    });
    parentId = parent.id;
    await vi.waitFor(() => expect(parentBlocked).toBe(true));
    const [child] = await e.ports.runs.listChildren(parent.id);
    childId = child!.id;
    const a = await manager.getRecovery(childId);
    expect(a.resume).toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
    // This client passes ownership validation before the parent records its own failure.
    const alreadyAccepted = manager.resume(
      childId,
      { kind: 'user', id: 'early-child-client' },
      {
        observedSeq: a.observedSeq,
        retryUncertainScript: true,
      },
    );
    await vi.waitFor(() => expect(childBlocked).toBe(true));
    releaseParent();
    await vi.waitFor(async () =>
      expect((await manager.getRun(parent.id))?.finalizedAt).toBeDefined(),
    );
    const reviewed = await manager.getRecovery(parent.id);
    const aFailure = e.events(childId).findLast((event) => event.type === 'run.failed')!.seq;
    releaseChild();
    await alreadyAccepted;
    await vi.waitFor(async () =>
      expect((await manager.getRun(childId))?.failure?.nodeId).toBe('b'),
    );
    expect(dispatches).toBe(3);
    await manager.resume(
      parent.id,
      { kind: 'user', id: 'parent-client' },
      {
        observedSeq: reviewed.observedSeq,
        retryUncertainScript: true,
      },
    );
    await manager.waitForIdle();
    expect(dispatches).toBe(3);
    expect((await manager.getRun(parent.id))?.failure?.script?.visitId).toBe(
      (await manager.getRun(childId))?.failure?.script?.visitId,
    );
    const intent = e.events(parent.id).findLast((event) => event.type === 'run.resumed');
    expect(intent).toMatchObject({
      childRecovery: { runId: childId, failureSeq: aFailure, observedSeq: aFailure },
    });
    expect(
      e.ports.logger.lines.some(
        (line) => line.obj['code'] === 'RECOVERY_STALE' && line.obj['childRunId'] === childId,
      ),
    ).toBe(true);
    const fresh = await manager.getRecovery(parent.id);
    await expect(
      manager.resume(
        parent.id,
        { kind: 'user', id: 'parent-client' },
        {
          observedSeq: fresh.observedSeq,
        },
      ),
    ).rejects.toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
    await manager.resume(
      parent.id,
      { kind: 'user', id: 'parent-client' },
      {
        observedSeq: fresh.observedSeq,
        retryUncertainScript: true,
      },
    );
    await manager.waitForIdle();
    expect(dispatches).toBe(4);
    expect((await manager.getRun(parent.id))?.status).toBe('succeeded');
    expect((await e.ports.runs.listChildren(parent.id)).map((run) => run.id)).toEqual([childId]);
  } finally {
    releaseParent();
    releaseChild();
    manager.stop();
  }
});

it.each(['external-client', 'already-admitted-parent'] as const)(
  'binds parent consent to A while %s tries to advance the child to B',
  async (client) => {
    const e = await createTestEngine();
    e.manager.stop();
    let dispatches = 0;
    e.ports.scripts.respondWith(() =>
      ++dispatches === 1 || dispatches === 3
        ? { ...completed, state: 'outcome-uncertain', exitCode: null }
        : completed,
    );
    const child = singleNodeLoop('two uncertain visits', {
      id: 'a',
      label: 'A',
      kind: 'script',
      config: { command: 'a' },
    });
    child.nodes.splice(2, 0, { id: 'b', label: 'B', kind: 'script', config: { command: 'b' } });
    child.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
      { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
      { id: 'c', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
    ];
    const childVersion = e.publish(child);
    const parentVersion = e.publish(
      singleNodeLoop('reviewed parent', {
        id: 'sub',
        label: 'Child',
        kind: 'subloop',
        config: { loopRef: { loopId: childVersion.loopId } },
      }),
    );
    let parentId = '';
    let armed = false;
    let blocked = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: EventStorePort = {
      append: (...args) => e.ports.events.append(...args),
      subscribe: (...args) => e.ports.events.subscribe(...args),
      recoveryFacts: (...args) => e.ports.events.recoveryFacts(...args),
      read: async (...args) => {
        const history = await e.ports.events.read(...args);
        if (
          armed &&
          !blocked &&
          args[0] === parentId &&
          history.some((event) => event.type === 'run.resumed')
        ) {
          blocked = true;
          await gate;
        }
        return history;
      },
    };
    const manager = new RunManager({ ...e.ports, events }, e.settings);
    try {
      await manager.start();
      const parent = await manager.startRun({
        ownerId: 'local',
        loopId: parentVersion.loopId,
        source: 'manual.api',
      });
      parentId = parent.id;
      await manager.waitForIdle();
      const [childRun] = await e.ports.runs.listChildren(parent.id);
      expect(childRun?.failure?.nodeId).toBe('a');
      const childId = childRun!.id;
      const a = await manager.getRecovery(childId);
      const reviewed = await manager.getRecovery(parent.id);
      expect(reviewed.resume).toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
      armed = true;
      await manager.resume(
        parent.id,
        { kind: 'user', id: 'parent-tab' },
        {
          observedSeq: reviewed.observedSeq,
          retryUncertainScript: true,
        },
      );
      await vi.waitFor(() => expect(blocked).toBe(true));
      expect((await manager.getRecovery(childId)).resume).toMatchObject({
        code: 'PARENT_RECOVERY_REQUIRED',
      });
      const consent = e.events(parent.id).findLast((event) => event.type === 'run.resumed');
      expect(consent).toMatchObject({
        childRecovery: {
          runId: childId,
          failureSeq: e.events(childId).findLast((event) => event.type === 'run.failed')!.seq,
        },
      });
      if (client === 'external-client') {
        await expect(
          manager.resume(
            childId,
            { kind: 'user', id: 'child-tab' },
            {
              observedSeq: a.observedSeq,
              retryUncertainScript: true,
            },
          ),
        ).rejects.toMatchObject({ code: 'PARENT_RECOVERY_REQUIRED' });
        expect(dispatches).toBe(1);
      } else {
        // Work already authorized by this parent may finish before its executor resumes.
        // It must not let the pending executor apply A's consent to B's new failure.
        await manager.resume(
          childId,
          { kind: 'run', id: parent.id },
          {
            observedSeq: a.observedSeq,
            retryUncertainScript: true,
          },
        );
        await vi.waitFor(async () =>
          expect((await manager.getRun(childId))?.failure?.nodeId).toBe('b'),
        );
        expect(dispatches).toBe(3);
      }
      release();
      await manager.waitForIdle();
      expect(dispatches).toBe(3);
      expect((await manager.getRun(childId))?.failure?.nodeId).toBe('b');
      expect((await manager.getRun(parent.id))?.failure?.script?.visitId).toBe(
        (await manager.getRun(childId))?.failure?.script?.visitId,
      );
      const fresh = await manager.getRecovery(parent.id);
      expect(fresh.resume).toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
      await expect(
        manager.resume(
          parent.id,
          { kind: 'user', id: 'parent-tab' },
          {
            observedSeq: reviewed.observedSeq,
            retryUncertainScript: true,
          },
        ),
      ).rejects.toMatchObject({ code: 'RECOVERY_STALE' });
      await manager.resume(
        parent.id,
        { kind: 'user', id: 'parent-tab' },
        {
          observedSeq: fresh.observedSeq,
          retryUncertainScript: true,
        },
      );
      await manager.waitForIdle();
      expect(dispatches).toBe(4);
      expect((await manager.getRun(parent.id))?.status).toBe('succeeded');
      expect((await manager.getRun(childId))?.status).toBe('succeeded');
      expect((await e.ports.runs.listChildren(parent.id)).map((run) => run.id)).toEqual([childId]);
    } finally {
      release();
      manager.stop();
    }
  },
);

it('recovers the durable child consent after losing the parent Resume acknowledgement', async () => {
  const e = await createTestEngine();
  let dispatches = 0;
  e.ports.scripts.respondWith(() =>
    ++dispatches === 1 ? { ...completed, state: 'outcome-uncertain', exitCode: null } : completed,
  );
  const child = e.publish(
    singleNodeLoop('durable child', {
      id: 'effect',
      kind: 'script',
      label: 'Effect',
      config: { command: 'effect' },
    }),
  );
  const version = e.publish(
    singleNodeLoop('durable parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: child.loopId } },
    }),
  );
  const parent = await e.runToIdle(version.loopId);
  e.manager.stop();
  const [childRun] = await e.ports.runs.listChildren(parent.id);
  const observation = await e.manager.getRecovery(parent.id);
  let committed!: () => void;
  const commit = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const events: EventStorePort = {
    recoveryFacts: (...args) => e.ports.events.recoveryFacts(...args),
    read: (...args) => e.ports.events.read(...args),
    subscribe: (...args) => e.ports.events.subscribe(...args),
    append: async (...args) => {
      const stored = await e.ports.events.append(...args);
      if (args[0] === parent.id && args[1].some((draft) => draft.type === 'run.resumed')) {
        committed();
        return new Promise<never>(() => undefined); // this process never acknowledges the commit
      }
      return stored;
    },
  };
  const dying = new RunManager({ ...e.ports, events }, e.settings);
  void dying.resume(
    parent.id,
    { kind: 'user', id: 'reviewer' },
    {
      observedSeq: observation.observedSeq,
      retryUncertainScript: true,
    },
  );
  await commit;
  dying.stop();
  expect((await e.ports.events.recoveryFacts(parent.id, [])).resumed?.childRecovery).toMatchObject({
    runId: childRun!.id,
    retryUncertainScript: true,
  });
  const restarted = new RunManager(e.ports, e.settings);
  try {
    await restarted.start();
    await restarted.waitForIdle();
    expect(dispatches).toBe(2);
    expect((await restarted.getRun(parent.id))?.status).toBe('succeeded');
    expect((await restarted.getRun(childRun!.id))?.status).toBe('succeeded');
  } finally {
    restarted.stop();
  }
});

it.each(['success', 'failure', 'exhausted'] as const)(
  'releases %s child recovery ownership while the parent waits downstream',
  async (outcome) => {
    const e = await createTestEngine();
    let dispatches = 0;
    e.ports.scripts.respondWith(() =>
      ++dispatches === 1 ? { ...completed, state: 'outcome-uncertain', exitCode: null } : completed,
    );
    const childDefinition = singleNodeLoop('finished child', {
      id: 'effect',
      kind: 'script',
      label: 'Effect',
      config: { command: 'effect' },
    });
    const exit = childDefinition.nodes.find((node) => node.kind === 'exit');
    if (exit?.kind !== 'exit') throw new Error('Child fixture has no exit');
    exit.config = { ...exit.config, outcome };
    const child = e.publish(childDefinition);
    const definition = singleNodeLoop('parent downstream wait', {
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: child.loopId } },
    });
    definition.nodes.splice(2, 0, {
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'signal', name: 'go' },
    });
    definition.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'wait' } },
      { id: 'c', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
    ];
    try {
      const parent = await e.runToIdle(e.publish(definition).loopId);
      const [childRun] = await e.ports.runs.listChildren(parent.id);
      const recovery = await e.manager.getRecovery(parent.id);
      await e.manager.resume(
        parent.id,
        { kind: 'user', id: 'owner' },
        {
          observedSeq: recovery.observedSeq,
          retryUncertainScript: true,
        },
      );
      await e.manager.waitForIdle();
      expect((await e.manager.getRun(parent.id))?.status).toBe('waiting');
      expect((await e.manager.getRun(childRun!.id))?.status).toBe(
        { success: 'succeeded', failure: 'failed', exhausted: 'exhausted' }[outcome],
      );
      const completedChild = await e.manager.getRecovery(childRun!.id);
      expect(completedChild.resume).toMatchObject({
        code: outcome === 'failure' ? 'FAILURE_NOT_RESUMABLE' : 'RUN_FINISHED',
      });
      expect(completedChild.replay.find((node) => node.nodeId === 'effect')?.action.allowed).toBe(
        true,
      );
    } finally {
      e.manager.stop();
    }
  },
);
