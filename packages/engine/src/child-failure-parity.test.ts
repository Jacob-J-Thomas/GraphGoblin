/**
 * Ordinary failure and recovery semantics for subloop children (#251). Each scenario runs the same
 * failing node inline in a run and inside a child, and compares what the parent records with what
 * the inline run records: the failure code, its resumability, a visible failure on the parent
 * (never a silent success), and what an explicit resume does. An authored Failure exit stays data.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import type { ScriptRunResult } from './ports.js';
import { RunManager } from './run-manager.js';
import { createTestEngine, type TestEngine, type TestNode } from './testing/scenario.js';

const scriptResult = (exitCode: number, extra: Partial<ScriptRunResult> = {}): ScriptRunResult => ({
  exitCode,
  stdout: '"ok"',
  stderr: exitCode === 0 ? '' : 'boom',
  stdoutBytes: 4,
  stderrBytes: exitCode === 0 ? 0 : 4,
  stdoutOverflow: false,
  stderrOverflow: false,
  state: 'completed' as const,
  timedOut: false,
  ...extra,
});

/** start -> work -> done (exit returning the work output), for decisions through route `ok`. */
function single(name: string, work: TestNode): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      work as unknown as LoopDefinitionInput['nodes'][number],
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"finished"' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      ...(work.kind === 'decision'
        ? ['ok', 'other'].map((port) => ({
            id: `e-${port}`,
            from: { node: 'work', port },
            to: { node: 'done' },
          }))
        : [{ id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done' } }]),
    ],
  };
}

/** start -> prep -> sub (awaits `childLoopId`) -> after -> done. */
function parentOf(name: string, childLoopId: string): LoopDefinitionInput {
  const set = (id: string, variable: string): LoopDefinitionInput['nodes'][number] => ({
    id,
    kind: 'mutate',
    label: id,
    config: {
      operations: [
        { op: 'set', path: `/vars/${variable}`, value: { kind: 'literal', value: true } },
      ],
    },
  });
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      set('prep', 'before'),
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: childLoopId } } },
      set('after', 'after'),
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          returns:
            '{ "child": outputs.sub.value.result, "before": vars.before, "after": vars.after }',
        },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
      { id: 'e2', from: { node: 'prep', port: 'out' }, to: { node: 'sub' } },
      { id: 'e3', from: { node: 'sub', port: 'out' }, to: { node: 'after' } },
      { id: 'e4', from: { node: 'after', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

const routes = [
  { id: 'ok', label: 'OK' },
  { id: 'other', label: 'Other' },
];
const classifierChoice = {
  kind: 'classifier',
  model: 'jev',
  question: 'Ready?',
  context: {},
  answer: {
    type: 'choice',
    options: [
      { id: 'ok', label: 'OK', criteria: 'Ready' },
      { id: 'other', label: 'Other', criteria: 'Not ready' },
    ],
  },
};

interface Scenario {
  name: string;
  /** The failure class this scenario stands for in the parity matrix. */
  kind: 'transient' | 'deterministic' | 'provider' | 'bug';
  work: TestNode;
  /** Make the node fail on its first execution; returns how to repair it before a resume. */
  arrange(e: TestEngine): () => void;
  code: string;
  resumable: boolean;
  /** Status after one explicit resume of a resumable failure. */
  afterResume?: 'succeeded' | 'failed';
}

const scenarios: Scenario[] = [
  {
    name: 'script exits non-zero',
    kind: 'transient',
    work: { id: 'work', kind: 'script', label: 'Work', config: { command: 'job' } },
    arrange(e) {
      e.ports.scripts.respondWith(() => scriptResult(3));
      return () => e.ports.scripts.respondWith(() => scriptResult(0));
    },
    code: 'SCRIPT_EXIT_CODE',
    resumable: true,
    afterResume: 'succeeded',
  },
  {
    name: 'script times out',
    kind: 'transient',
    work: {
      id: 'work',
      kind: 'script',
      label: 'Work',
      config: { command: 'job', timeoutSeconds: 5 },
    },
    arrange(e) {
      e.ports.scripts.respondWith(() => scriptResult(-1, { timedOut: true }));
      return () => e.ports.scripts.respondWith(() => scriptResult(0));
    },
    code: 'SCRIPT_TIMEOUT',
    resumable: true,
    afterResume: 'succeeded',
  },
  {
    name: 'decision expression fails',
    kind: 'deterministic',
    work: {
      id: 'work',
      kind: 'decision',
      label: 'Work',
      config: { kind: 'expression', jsonata: '$error("no route")', routes },
    },
    arrange: () => () => undefined,
    code: 'EVALUATION_EXPRESSION_FAILED',
    resumable: false,
  },
  {
    name: 'harness quota is exhausted',
    kind: 'provider',
    work: { id: 'work', kind: 'inference', label: 'Work', config: { prompt: { template: 'go' } } },
    arrange(e) {
      // One failing turn for the inline run and one for the child.
      const exhausted = {
        error: { code: 'usage_limit_reached', message: 'quota exhausted', retriable: true },
      };
      e.ports.harness.script([exhausted, exhausted]);
      return () => e.ports.harness.script([{ finalText: 'continued' }, { finalText: 'continued' }]);
    },
    code: 'HARNESS_QUOTA_EXHAUSTED',
    resumable: true,
    afterResume: 'succeeded',
  },
  {
    name: 'classifier answers outside the declared options',
    kind: 'provider',
    work: { id: 'work', kind: 'decision', label: 'Work', config: classifierChoice },
    arrange(e) {
      vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({
        type: 'choice',
        optionId: 'undeclared',
        confidence: 1,
        probabilities: { ok: 1, other: 0 },
      });
      return () => undefined;
    },
    code: 'EVALUATION_INVALID_RESPONSE',
    resumable: false,
  },
  {
    name: 'a mutation expression throws (bug class)',
    kind: 'bug',
    work: {
      id: 'work',
      kind: 'mutate',
      label: 'Work',
      config: {
        operations: [
          { op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("boom")' } },
        ],
      },
    },
    arrange: () => () => undefined,
    code: 'INTERNAL_ERROR',
    resumable: true,
    afterResume: 'failed',
  },
];

const ofType = (e: TestEngine, runId: string, type: RunEvent['type']) =>
  e.events(runId).filter((event) => event.type === type);
const startsOf = (e: TestEngine, runId: string, nodeId: string) =>
  e
    .events(runId)
    .flatMap((event) =>
      event.type === 'node.started' && event.nodeId === nodeId ? [event.attempt] : [],
    );

describe('child failures follow the inline rules (#251)', () => {
  it.each(scenarios)(
    '$kind: $name fails the parent like the inline node, and resumes alike',
    async (scenario) => {
      const e = await createTestEngine({ maxConcurrentRuns: 2 });
      const repair = scenario.arrange(e);
      const inlineLoop = e.publish(single(`inline ${scenario.name}`, scenario.work));
      const childLoop = e.publish(single(`child ${scenario.name}`, scenario.work));
      const parentLoop = e.publish(parentOf(`parent ${scenario.name}`, childLoop.loopId));

      const inline = await e.runToIdle(inlineLoop.loopId);
      const parent = await e.runToIdle(parentLoop.loopId);
      const [child] = await e.ports.runs.listChildren(parent.id);
      expect(inline.failure).toMatchObject({
        code: scenario.code,
        resumable: scenario.resumable,
        nodeId: 'work',
      });
      // The child records exactly what the inline run records.
      const { code, message, resumable, nodeId } = inline.failure!;
      expect(child).toMatchObject({
        status: 'failed',
        failure: { code, message, resumable, nodeId },
      });
      // The parent fails visibly with the same code and resumability, at its subloop node.
      expect(parent.status).toBe('failed');
      expect(parent).not.toHaveProperty('outcome');
      expect(parent.failure).toMatchObject({
        code: scenario.code,
        resumable: scenario.resumable,
        nodeId: 'sub',
        details: { childRunId: child!.id, childNodeId: 'work' },
      });
      expect(parent.failure?.message).toContain(inline.failure!.message);
      expect(parent.failure?.message).toContain(child!.id);
      expect(startsOf(e, parent.id, 'after')).toEqual([]);
      expect(ofType(e, parent.id, 'child_run.finished')).toMatchObject([
        { childRunId: child!.id, status: 'failed' },
      ]);

      if (!scenario.resumable) {
        // Not advertised as resumable, so neither run can be resumed.
        await expect(e.manager.resume(inline.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
        await expect(e.manager.resume(parent.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
        expect((await e.ports.runs.get(child!.id))?.status).toBe('failed');
        return;
      }
      repair();
      await e.manager.resume(inline.id);
      const inlineAfter = await e.settle(inline.id);
      await e.manager.resume(parent.id);
      const parentAfter = await e.settle(parent.id);
      const childAfter = (await e.ports.runs.get(child!.id))!;
      expect(inlineAfter.status).toBe(scenario.afterResume);
      expect(parentAfter.status).toBe(scenario.afterResume);
      // The same child resumed in place: its failed node ran again as the inline node did, with
      // its own thread and pins intact; no second child was started.
      expect(await e.ports.runs.listChildren(parent.id)).toHaveLength(1);
      expect(ofType(e, parent.id, 'child_run.started')).toHaveLength(1);
      expect(startsOf(e, child!.id, 'work')).toEqual(startsOf(e, inline.id, 'work'));
      expect(childAfter).toMatchObject({ versionId: child!.versionId, pinned: child!.pinned });
      expect(ofType(e, child!.id, 'run.resumed')).toEqual([
        expect.objectContaining({ actor: { kind: 'run', id: parent.id } }),
      ]);
      if (scenario.afterResume === 'succeeded') {
        expect(parentAfter.result).toEqual({ child: 'finished', before: true, after: true });
        expect(childAfter.status).toBe('succeeded');
      } else {
        // The same bug fails again in both places, with the same code; nothing is consumed.
        expect(parentAfter.failure).toMatchObject({
          code: inlineAfter.failure?.code,
          nodeId: 'sub',
        });
        expect(ofType(e, parent.id, 'run.failed')).toHaveLength(2);
        expect(startsOf(e, parent.id, 'after')).toEqual([]);
      }
    },
  );

  it('depth exceeded deep in a tree fails every ancestor non-resumably (G12)', async () => {
    const e = await createTestEngine();
    const selfId = e.loopId('self');
    const self = parentOf('self', selfId);
    (self.nodes[2] as { config: Record<string, unknown> }).config['depthLimitOverride'] = 2;
    e.publish(self, { loopId: selfId });
    const top = await e.runToIdle(selfId);
    const all = [...e.ports.runs.runs.values()];
    expect(all).toHaveLength(3);
    for (const run of all) {
      expect(run.status).toBe('failed');
      expect(run.failure).toMatchObject({ code: 'SUBLOOP_DEPTH_EXCEEDED', resumable: false });
    }
    expect(top.failure?.nodeId).toBe('sub');
    await expect(e.manager.resume(top.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('cancellation: a cancelled child cancels its parent, as cancelling the inline work cancels its run', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const work: TestNode = {
      id: 'work',
      kind: 'wait',
      label: 'Work',
      config: { mode: 'input', prompt: '?' },
    };
    const inline = await e.runToIdle(e.publish(single('inline wait', work)).loopId);
    const childLoop = e.publish(single('child wait', work));
    const parent = await e.runToIdle(e.publish(parentOf('parent wait', childLoop.loopId)).loopId);
    const [child] = await e.ports.runs.listChildren(parent.id);
    expect(parent.status).toBe('waiting');

    await e.manager.cancel(inline.id);
    await e.manager.cancel(child!.id);
    const inlineAfter = await e.settle(inline.id);
    const parentAfter = await e.settle(parent.id);
    expect(inlineAfter.status).toBe('cancelled');
    expect(parentAfter.status).toBe('cancelled');
    expect(parentAfter).not.toHaveProperty('failure');
    expect(startsOf(e, parent.id, 'after')).toEqual([]);
    // The parent's log says why: its child was cancelled, and the request came from that child.
    expect(ofType(e, parent.id, 'child_run.finished')).toMatchObject([
      { childRunId: child!.id, status: 'cancelled' },
    ]);
    expect(ofType(e, parent.id, 'run.cancel_requested')).toEqual([
      expect.objectContaining({ actor: { kind: 'run', id: child!.id } }),
    ]);
    expect(ofType(e, parent.id, 'run.cancelled')).toHaveLength(1);
    await expect(e.manager.resume(inline.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(e.manager.resume(parent.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('an authored Failure exit is ordinary data for the parent, distinct from an execution error', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const work: TestNode = {
      id: 'work',
      kind: 'mutate',
      label: 'Work',
      config: {
        operations: [{ op: 'set', path: '/vars/why', value: { kind: 'literal', value: 'no' } }],
      },
    };
    const rejecting = (name: string) => {
      const def = single(name, work);
      def.nodes[2] = {
        id: 'done',
        kind: 'exit',
        label: 'Rejected',
        config: { outcome: 'failure', returns: '{ "reason": vars.why }' },
      };
      return def;
    };
    const inline = await e.runToIdle(e.publish(rejecting('inline rejects')).loopId);
    const childLoop = e.publish(rejecting('child rejects'));
    const parent = await e.runToIdle(
      e.publish(parentOf('parent of a rejection', childLoop.loopId)).loopId,
    );
    const [child] = await e.ports.runs.listChildren(parent.id);
    // The inline run and the child finish the same way: an authored outcome, not a failure.
    for (const run of [inline, child!]) {
      expect(run).toMatchObject({ status: 'failed', outcome: 'failure', result: { reason: 'no' } });
      expect(run).not.toHaveProperty('failure');
    }
    // The parent receives it as data and continues to its own exit.
    expect(parent).toMatchObject({
      status: 'succeeded',
      result: { child: { reason: 'no' }, before: true, after: true },
    });
    expect((await e.manager.getThread(parent.id))?.outputs['sub']?.value).toMatchObject({
      status: 'failed',
      outcome: 'failure',
    });
  });
});

describe('repeat and recovery attempts (#251)', () => {
  const failingScript = (e: TestEngine, failures: number) => {
    let calls = 0;
    e.ports.scripts.respondWith(() => (++calls <= failures ? scriptResult(1) : scriptResult(0)));
    return () => calls;
  };
  const scriptNode: TestNode = {
    id: 'work',
    kind: 'script',
    label: 'Work',
    config: { command: 'job' },
  };

  it('each resume of the parent resumes the same child until it succeeds', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const calls = failingScript(e, 2);
    const childLoop = e.publish(single('twice failing child', scriptNode));
    const parent = await e.runToIdle(
      e.publish(parentOf('patient parent', childLoop.loopId)).loopId,
    );
    expect(parent.failure).toMatchObject({ code: 'SCRIPT_EXIT_CODE', resumable: true });
    await e.manager.resume(parent.id);
    expect(await e.settle(parent.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'SCRIPT_EXIT_CODE', resumable: true, nodeId: 'sub' },
    });
    await e.manager.resume(parent.id);
    const done = await e.settle(parent.id);
    expect(done).toMatchObject({ status: 'succeeded', result: { child: 'finished', after: true } });
    expect(calls()).toBe(3);
    const [child] = await e.ports.runs.listChildren(parent.id);
    expect(await e.ports.runs.listChildren(parent.id)).toHaveLength(1);
    expect(startsOf(e, child!.id, 'work')).toEqual([1, 2, 3]);
    expect(ofType(e, parent.id, 'run.failed')).toHaveLength(2);
    expect(
      e
        .events(parent.id)
        .flatMap((event) => (event.type === 'child_run.finished' ? [event.status] : [])),
    ).toEqual(['failed', 'failed', 'succeeded']);
  });

  it('a child resumed directly lets the parent continue on its own resume', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    failingScript(e, 1);
    const childLoop = e.publish(single('directly resumed child', scriptNode));
    const parent = await e.runToIdle(
      e.publish(parentOf('waiting on resume', childLoop.loopId)).loopId,
    );
    const [child] = await e.ports.runs.listChildren(parent.id);
    await e.manager.resume(child!.id);
    expect((await e.settle(child!.id)).status).toBe('succeeded');
    // The parent failed when its child did; it is not revived by the child alone.
    expect((await e.ports.runs.get(parent.id))?.status).toBe('failed');
    await e.manager.resume(parent.id);
    expect(await e.settle(parent.id)).toMatchObject({
      status: 'succeeded',
      result: { child: 'finished', after: true },
    });
    expect(ofType(e, child!.id, 'run.resumed')).toHaveLength(1);
  });

  it('nested: the root fails with the leaf failure, and resuming the root resumes the tree', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    failingScript(e, 1);
    const leaf = e.publish(single('nested leaf', scriptNode));
    const middle = e.publish(parentOf('nested middle', leaf.loopId));
    const root = await e.runToIdle(e.publish(parentOf('nested root', middle.loopId)).loopId);
    const [mid] = await e.ports.runs.listChildren(root.id);
    const [bottom] = await e.ports.runs.listChildren(mid!.id);
    for (const run of [root, mid!, bottom!])
      expect(run.failure).toMatchObject({ code: 'SCRIPT_EXIT_CODE', resumable: true });
    expect(root.failure?.details).toMatchObject({ childRunId: mid!.id, childNodeId: 'sub' });
    expect(mid!.failure?.details).toMatchObject({ childRunId: bottom!.id, childNodeId: 'work' });
    await e.manager.resume(root.id);
    expect(await e.settle(root.id)).toMatchObject({
      status: 'succeeded',
      result: { child: { child: 'finished', before: true, after: true }, after: true },
    });
    for (const run of [mid!, bottom!])
      expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
    expect(await e.ports.runs.listChildren(root.id)).toHaveLength(1);
    expect(await e.ports.runs.listChildren(mid!.id)).toHaveLength(1);
  });

  it('a crash after the child failure woke the parent fails the parent once at recovery', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    failingScript(e, 1);
    const childLoop = e.publish(single('crash child', scriptNode));
    const parentLoop = e.publish(parentOf('crash parent', childLoop.loopId));
    // The parent's process dies right after its child's failure woke it.
    const append = e.ports.events.append.bind(e.ports.events);
    let stopped = false;
    const watched: { parentId?: string } = {};
    vi.spyOn(e.ports.events, 'append').mockImplementation(async (runId, drafts, options) => {
      if (
        runId === watched.parentId &&
        drafts.some((draft) => draft.type === 'child_run.finished')
      ) {
        stopped = true;
        return new Promise<never>(() => undefined);
      }
      return append(runId, drafts, options);
    });
    const parent = await e.start(parentLoop.loopId);
    watched.parentId = parent.id;
    await vi.waitFor(() => expect(stopped).toBe(true));
    e.manager.stop();
    vi.restoreAllMocks();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    recovered.stop();
    const failed = (await e.ports.runs.get(parent.id)) as RunRecord;
    expect(failed.failure).toMatchObject({
      code: 'SCRIPT_EXIT_CODE',
      resumable: true,
      nodeId: 'sub',
    });
    expect(ofType(e, parent.id, 'run.failed')).toHaveLength(1);
    expect(ofType(e, parent.id, 'child_run.finished')).toHaveLength(1);
    // Recovery did not resume the child on its own: only an explicit resume does.
    expect(startsOf(e, (await e.ports.runs.listChildren(parent.id))[0]!.id, 'work')).toEqual([1]);
  });
});
