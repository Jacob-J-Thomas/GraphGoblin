/**
 * One durable child per subloop visit (#320), with the in-memory ports. The child and the
 * parent's `child_run.started` are one admission; a child's finish is recorded once per outcome
 * even when the process dies between recording it and the parent's next event. The real-storage
 * and real-process versions are `infrastructure/src/sqlite/child-admission-recovery.test.ts` and
 * `apps/api/src/child-creation-restart.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import type { EventDraft, EventStorePort, ScriptRunResult } from './ports.js';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';

const result = (exitCode: number): ScriptRunResult => ({
  exitCode,
  stdout: '',
  stderr: exitCode === 0 ? '' : 'boom',
  stdoutBytes: 0,
  stderrBytes: exitCode === 0 ? 0 : 4,
  stdoutOverflow: false,
  stderrOverflow: false,
  state: 'completed' as const,
  timedOut: false,
});

/** start -> sub -> done, returning the child's result. */
const parentLoop = (name: string, childLoopId: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: childLoopId } } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.sub.value' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
    { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
  ],
});

const scriptChild = (name: string) =>
  singleNodeLoop(
    name,
    { id: 'work', kind: 'script', label: 'Work', config: { command: 'work', args: [] } },
    { returns: '"child done"' },
  );

/** The event store of a process that dies (never returns) before writing a matching append. */
class DyingEvents implements EventStorePort {
  died = false;
  constructor(
    private readonly durable: EventStorePort,
    private readonly dies: (runId: string, drafts: readonly EventDraft[]) => boolean,
  ) {}
  append(runId: string, drafts: readonly EventDraft[], options?: { expectedLastSeq?: number }) {
    if (!this.dies(runId, drafts)) return this.durable.append(runId, drafts, options);
    this.died = true;
    return new Promise<never>(() => undefined);
  }
  read(runId: string, afterSeq?: number, limit?: number) {
    return this.durable.read(runId, afterSeq, limit);
  }
  subscribe(runId: string, listener: (event: RunEvent) => void) {
    return this.durable.subscribe(runId, listener);
  }
}

/**
 * A run manager over the engine's durable stores whose event store dies at `dies`, then a second
 * manager over the same stores (the restart), recovered until idle. Returns the parent's id.
 */
async function dieThenRecover(
  e: TestEngine,
  loopId: string,
  dies: (parentId: string, runId: string, drafts: readonly EventDraft[]) => boolean,
): Promise<string> {
  e.manager.stop();
  const watched = { parentId: '' };
  const events = new DyingEvents(e.ports.events, (runId, drafts) =>
    dies(watched.parentId, runId, drafts),
  );
  const dying = new RunManager({ ...e.ports, events }, e.settings);
  await dying.start();
  const parent = await dying.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
  watched.parentId = parent.id;
  await expect.poll(() => events.died).toBe(true);
  dying.stop();
  const recovered = new RunManager(e.ports, e.settings);
  await recovered.start();
  await recovered.waitForIdle();
  recovered.stop();
  return parent.id;
}

const ofType = (e: TestEngine, runId: string, type: RunEvent['type']) =>
  e.events(runId).filter((event) => event.type === type);

describe('child creation and finish across a process death (#320)', () => {
  it('the visit records its child once, linked in the same commit as the child', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(scriptChild('linked child'));
    const parent = await e.runToIdle(e.publish(parentLoop('linked parent', child.loopId)).loopId);
    const [kid] = await e.ports.runs.listChildren(parent.id);
    const types = e.eventTypes(parent.id);
    // The link precedes the park: it is part of the child's admission, not a later append.
    expect(types.indexOf('child_run.started')).toBeLessThan(types.indexOf('run.waiting'));
    expect(ofType(e, parent.id, 'child_run.started')).toEqual([
      expect.objectContaining({ nodeId: 'sub', childRunId: kid!.id }),
    ]);
    expect(parent).toMatchObject({ status: 'succeeded', result: { result: 'child done' } });
  });

  it('a death before the atomic child finish and node completion records it once', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(scriptChild('finish-once child'));
    const loop = e.publish(parentLoop('finish-once parent', child.loopId));
    const parentId = await dieThenRecover(
      e,
      loop.loopId,
      (parent, runId, drafts) =>
        runId === parent && drafts.some((d) => d.type === 'node.finished' && d.nodeId === 'sub'),
    );
    expect(await e.ports.runs.get(parentId)).toMatchObject({ status: 'succeeded' });
    expect(ofType(e, parentId, 'child_run.finished')).toHaveLength(1);
    expect(await e.ports.runs.listChildren(parentId)).toHaveLength(1);
  });

  it('a death before the atomic child finish and parent failure records it once', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    e.ports.scripts.respondWith(() => result(3));
    const child = e.publish(scriptChild('fail-once child'));
    const loop = e.publish(parentLoop('fail-once parent', child.loopId));
    const parentId = await dieThenRecover(
      e,
      loop.loopId,
      (parent, runId, drafts) => runId === parent && drafts.some((d) => d.type === 'run.failed'),
    );
    expect(await e.ports.runs.get(parentId)).toMatchObject({
      status: 'failed',
      failure: { code: 'SCRIPT_EXIT_CODE', nodeId: 'sub' },
    });
    expect(ofType(e, parentId, 'child_run.finished')).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
    expect(ofType(e, parentId, 'run.failed')).toHaveLength(1);
  });

  it('a new outcome of the same child after a resume is recorded again', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    let calls = 0;
    e.ports.scripts.respondWith(() => result(++calls === 1 ? 3 : 0));
    const child = e.publish(scriptChild('new-outcome child'));
    const failed = await e.runToIdle(
      e.publish(parentLoop('new-outcome parent', child.loopId)).loopId,
    );
    expect(failed.status).toBe('failed');
    const [kid] = await e.ports.runs.listChildren(failed.id);
    // The child is resumed on its own and succeeds while its parent stays failed; the parent's
    // later resume maps that new outcome without running the child again.
    await e.manager.resume(kid!.id);
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(kid!.id))?.status).toBe('succeeded');
    await e.manager.resume(failed.id);
    const done = await e.settle(failed.id);
    expect(done.status).toBe('succeeded');
    expect(ofType(e, failed.id, 'child_run.finished').map((event) => event.type)).toHaveLength(2);
    expect(
      e
        .events(failed.id)
        .flatMap((event) => (event.type === 'child_run.finished' ? [event.status] : [])),
    ).toEqual(['failed', 'succeeded']);
    expect(calls).toBe(2);
  });

  it('retrying the parent output mapping does not record an unchanged child outcome again', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(scriptChild('mapping child'));
    const definition = parentLoop('mapping parent', child.loopId);
    const sub = definition.nodes.find((node) => node.kind === 'subloop')!;
    if (sub.kind !== 'subloop') throw new Error('missing subloop');
    sub.config.output = { mode: 'custom', custom: { patch: '"bad patch"' } };
    const failed = await e.runToIdle(e.publish(definition).loopId);
    expect(failed.status).toBe('failed');
    await e.manager.resume(failed.id);
    expect((await e.settle(failed.id)).status).toBe('failed');
    expect(ofType(e, failed.id, 'child_run.finished')).toHaveLength(1);
    expect(await e.ports.runs.listChildren(failed.id)).toHaveLength(1);
  });

  it('an explicit retry records a second failed outcome of the same child', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    e.ports.scripts.respondWith(() => result(3));
    const child = e.publish(scriptChild('failed-again child'));
    const failed = await e.runToIdle(
      e.publish(parentLoop('failed-again parent', child.loopId)).loopId,
    );
    await e.manager.resume(failed.id);
    expect((await e.settle(failed.id)).status).toBe('failed');
    expect(ofType(e, failed.id, 'child_run.finished')).toEqual([
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({ status: 'failed' }),
    ]);
    expect(await e.ports.runs.listChildren(failed.id)).toHaveLength(1);
  });

  it('records a child independently retried while its parent was interrupted', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    e.manager.stop();
    e.ports.scripts.respondWith(() => result(3));
    const child = e.publish(scriptChild('independent retry child'));
    const loop = e.publish(parentLoop('independent retry parent', child.loopId));
    let parentId = '';
    const events = new DyingEvents(
      e.ports.events,
      (runId, drafts) => runId === parentId && drafts.some((draft) => draft.type === 'run.failed'),
    );
    const interrupted = new RunManager({ ...e.ports, events }, e.settings);
    await interrupted.start();
    parentId = (
      await interrupted.startRun({ ownerId: 'local', loopId: loop.loopId, source: 'manual.api' })
    ).id;
    await expect.poll(() => events.died).toBe(true);
    const [kid] = await e.ports.runs.listChildren(parentId);
    await interrupted.resume(kid!.id);
    await expect.poll(() => ofType(e, kid!.id, 'run.failed').length).toBe(2);
    interrupted.stop();
    const recovered = new RunManager(e.ports, e.settings);
    try {
      await recovered.start();
      await recovered.waitForIdle();
      expect((await recovered.getRun(parentId))?.status).toBe('failed');
      // The lost atomic append stored no first finish. Only the new outcome is consumed.
      expect(ofType(e, parentId, 'child_run.finished')).toHaveLength(1);
      const childFailure = e.events(kid!.id).findLast((event) => event.type === 'run.failed')!;
      const wake = e.events(parentId).findLast((event) => event.type === 'run.woken');
      expect(wake).toMatchObject({ payload: { childFinishedSeq: childFailure.seq } });
      expect(await e.ports.runs.listChildren(parentId)).toHaveLength(1);
    } finally {
      recovered.stop();
    }
  });
});
