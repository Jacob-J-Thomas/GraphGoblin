/**
 * Awaited parent-child execution (#242): a parent parked on a subloop child continues only once
 * that child has finished, every child wake is bound to the park it was observed for, and the
 * child's configured output (or its absence) is what the parent receives.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';

const inputLoop = (name: string): LoopDefinitionInput =>
  singleNodeLoop(
    name,
    { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: '?' } },
    { returns: 'lastOutput.value' },
  );

const subNode = (loopId: string, config: Record<string, unknown> = {}) => ({
  id: 'sub',
  kind: 'subloop' as const,
  label: 'Sub',
  config: { loopRef: { loopId }, ...config },
});

/** start -> sub -> ask (input wait) -> done. */
function subThenInput(name: string, childLoopId: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      subNode(childLoopId),
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'next?' } },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '{ "child": outputs.sub.value, "answer": outputs.ask.value }' },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'ask' } },
      { id: 'e3', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/** start -> sub -> gate; the gate repeats the subloop once, then exits. */
function subTwice(name: string, childLoopId: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      subNode(childLoopId),
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'gates.gate.passes = 1 ? "repeat" : "done"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: 2,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.sub.value' } },
      { id: 'limit', kind: 'exit', label: 'Limit', config: { outcome: 'exhausted' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'gate' } },
      { id: 'e3', from: { node: 'gate', port: 'repeat' }, to: { node: 'sub' } },
      { id: 'e4', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'e5', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'limit' } },
    ],
  };
}

const waitIdOf = async (e: TestEngine, runId: string): Promise<string> =>
  (await e.manager.getRun(runId))?.waiting?.waitId ?? 'unknown';

const childEvents = (e: TestEngine, runId: string) =>
  e
    .events(runId)
    .filter(
      (event): event is Extract<RunEvent, { type: 'child_run.finished' }> =>
        event.type === 'child_run.finished',
    );

/**
 * The constructed crossing from the WP-C3 review: the parent's first child finishes after the
 * parent's park committed and before its post-park check, so the child's own notification and the
 * parent's check both observe the parent waiting on that child. The child's notification is held
 * on its one re-read of the parent (a single delayed storage read, through the fake run port)
 * while the check wakes the parent, which runs on to its next park; then the held read returns.
 */
async function crossStaleChildWake(
  e: TestEngine,
  parentLoopId: string,
  nextPark: (parent: RunRecord | undefined, firstChildId: string | undefined) => boolean,
): Promise<{ parentId: string; firstChildId: string }> {
  const get = e.ports.runs.get.bind(e.ports.runs);
  const transition = e.ports.runs.transition.bind(e.ports.runs);
  let watched: string | undefined;
  let reads = 0;
  let holding = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(e.ports.runs, 'get').mockImplementation(async (id) => {
    if (id === watched && ++reads === 2) {
      // The child's notification: its first read checked the parent's park; this is the wake's
      // re-read of the parent, delayed until the parent has moved on.
      holding = true;
      await held;
    }
    return get(id);
  });
  let firstChildId: string | undefined;
  vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes, ...rest) => {
    const parked = await transition(id, from, changes, ...rest);
    if (!firstChildId && changes.status === 'waiting' && changes.waiting?.kind === 'child') {
      const childId = changes.waiting.childRunId!;
      firstChildId = childId;
      await vi.waitFor(async () => expect((await get(childId))?.status).toBe('waiting'));
      watched = id;
      await e.manager.provideInput(childId, await waitIdOf(e, childId), 'first');
      await vi.waitFor(() => expect(holding).toBe(true));
      watched = undefined;
    }
    return parked;
  });
  const parent = await e.start(parentLoopId);
  await vi.waitFor(async () => expect(nextPark(await get(parent.id), firstChildId)).toBe(true));
  release();
  await e.manager.waitForIdle();
  vi.restoreAllMocks();
  return { parentId: parent.id, firstChildId: firstChildId! };
}

describe('identity-bound child wakes (#242)', () => {
  it('a stale child wake never answers a later input park of its parent', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(inputLoop('stale-input-child'));
    const parent = e.publish(subThenInput('stale-input-parent', child.loopId));
    const { parentId } = await crossStaleChildWake(
      e,
      parent.loopId,
      (run) => run?.status === 'waiting' && run.waiting?.kind === 'input',
    );
    const stalled = await e.ports.runs.get(parentId);
    expect(stalled?.status).toBe('waiting');
    expect(stalled?.waiting).toMatchObject({ kind: 'input', nodeId: 'ask' });
    const woken = e.events(parentId).filter((event) => event.type === 'run.woken');
    expect(woken).toEqual([expect.objectContaining({ nodeId: 'sub', reason: 'child' })]);

    await e.manager.provideInput(parentId, await waitIdOf(e, parentId), 'answer');
    const done = await e.settle(parentId);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({ answer: 'answer', child: { result: 'first' } });
  });

  it('a stale child wake never reaches the next visit of the same subloop node', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const child = e.publish(inputLoop('stale-visit-child'));
    const parent = e.publish(subTwice('stale-visit-parent', child.loopId));
    const { parentId, firstChildId } = await crossStaleChildWake(
      e,
      parent.loopId,
      (run, first) =>
        run?.status === 'waiting' &&
        run.waiting?.kind === 'child' &&
        run.waiting.childRunId !== first,
    );
    const children = await e.ports.runs.listChildren(parentId);
    expect(children).toHaveLength(2);
    const second = children.find((run) => run.id !== firstChildId)!;
    // The second child is live and its parent still awaits it.
    expect(second.status).toBe('waiting');
    expect(await e.ports.runs.get(parentId)).toMatchObject({
      status: 'waiting',
      waiting: { kind: 'child', childRunId: second.id },
    });
    expect(childEvents(e, parentId).map((event) => event.status)).toEqual(['succeeded']);

    await e.manager.provideInput(second.id, await waitIdOf(e, second.id), 'second');
    const done = await e.settle(parentId);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({ result: 'second', childRunId: second.id });
    expect(childEvents(e, parentId).map((event) => [event.childRunId, event.status])).toEqual([
      [firstChildId, 'succeeded'],
      [second.id, 'succeeded'],
    ]);
  });
});

describe('child results (#242)', () => {
  function returning(name: string, returns: string): LoopDefinitionInput {
    return singleNodeLoop(
      name,
      {
        id: 'work',
        kind: 'mutate',
        label: 'Work',
        config: {
          operations: [{ op: 'set', path: '/vars/x', value: { kind: 'literal', value: 1 } }],
        },
      },
      { returns },
    );
  }

  function parentOf(name: string, childLoopId: string): LoopDefinitionInput {
    return singleNodeLoop(
      name,
      subNode(childLoopId, {
        output: { mode: 'result-only', resultTo: { lastOutput: true, var: 'got' } },
      }),
      { returns: '{ "summary": outputs.sub.value, "hasVar": $exists(vars.got), "got": vars.got }' },
    );
  }

  it('a child that returns no output leaves the result absent in its parent', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(returning('returns-none', 'none'));
    const parent = await e.runToIdle(e.publish(parentOf('absent-parent', child.loopId)).loopId);
    expect(parent.status).toBe('succeeded');
    const [kid] = await e.ports.runs.listChildren(parent.id);
    expect(kid).not.toHaveProperty('result');
    const value = parent.result as { summary: Record<string, unknown>; hasVar: boolean };
    expect(value.summary).toEqual({ status: 'succeeded', outcome: 'success', childRunId: kid!.id });
    expect(value.hasVar).toBe(false);
    const thread = await e.manager.getThread(parent.id);
    expect(thread?.outputs['sub']?.value).not.toHaveProperty('result');
    expect(thread?.vars).not.toHaveProperty('got');
  });

  it('a child that returns JSON null passes null, distinct from no output', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(returning('returns-null', 'null'));
    const parent = await e.runToIdle(e.publish(parentOf('null-parent', child.loopId)).loopId);
    const value = parent.result as { summary: Record<string, unknown>; hasVar: boolean };
    expect(value.summary).toHaveProperty('result', null);
    expect(value.hasVar).toBe(true);
    expect((await e.manager.getThread(parent.id))?.vars).toHaveProperty('got', null);
  });

  describe.each(['parent-wins', 'child-wins'] as const)(
    'with a %s variable merge, the result variable holds only what the child returned',
    (strategy) => {
      /** start -> prep (`vars.answer` = "old result", inherited by the child) -> sub -> done. */
      function merging(name: string, childLoopId: string): LoopDefinitionInput {
        return {
          schemaVersion: CURRENT_DEFINITION_FORMAT,
          name,
          nodes: [
            { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
            {
              id: 'prep',
              kind: 'mutate',
              label: 'Prep',
              config: {
                operations: [
                  {
                    op: 'set',
                    path: '/vars/answer',
                    value: { kind: 'literal', value: 'old result' },
                  },
                ],
              },
            },
            subNode(childLoopId, {
              output: { mode: 'merge', resultTo: { var: 'answer' }, vars: { strategy } },
            }),
            {
              id: 'done',
              kind: 'exit',
              label: 'Done',
              config: {
                returns: '{ "has": $exists(vars.answer), "answer": vars.answer, "x": vars.x }',
              },
            },
          ],
          edges: [
            { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
            { id: 'e2', from: { node: 'prep', port: 'out' }, to: { node: 'sub' } },
            { id: 'e3', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
          ],
        };
      }
      const run = async (returns: string) => {
        const e = await createTestEngine({ maxConcurrentRuns: 2 });
        const child = e.publish(returning(`merge-${strategy}-${returns}`, returns));
        const parent = e.publish(merging(`merge-parent-${strategy}-${returns}`, child.loopId));
        return (await e.runToIdle(parent.loopId)).result as Record<string, unknown>;
      };

      it('no output: the inherited stale value is not restored by the merge', async () => {
        // The child's own variables still merge (`x` comes from the child either way).
        expect(await run('none')).toEqual({ has: false, x: 1 });
      });

      it('JSON null: the variable holds null', async () => {
        expect(await run('null')).toEqual({ has: true, answer: null, x: 1 });
      });

      it('data: the variable holds the returned data, not the merged stale value', async () => {
        expect(await run('{ "n": 1 }')).toEqual({ has: true, answer: { n: 1 }, x: 1 });
      });
    },
  );

  it('a later visit without output removes the result an earlier visit stored, and a custom mapping sees no result', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    // The child returns data on its first call and nothing on its second.
    const child = e.publish({
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'sometimes-silent',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            kind: 'expression',
            jsonata: 'trigger.payload = "data" ? "data" : "silent"',
            routes: [
              { id: 'data', label: 'Data' },
              { id: 'silent', label: 'Silent' },
            ],
          },
        },
        { id: 'data', kind: 'exit', label: 'Data', config: { returns: '{ "n": 1 }' } },
        { id: 'silent', kind: 'exit', label: 'Silent', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
        { id: 'e2', from: { node: 'pick', port: 'data' }, to: { node: 'data' } },
        { id: 'e3', from: { node: 'pick', port: 'silent' }, to: { node: 'silent' } },
      ],
    });
    const def = subTwice('visits-parent', child.loopId);
    def.nodes[1] = subNode(child.loopId, {
      input: { mode: 'fresh', trigger: { payload: 'gates.gate.passes = 1 ? "data" : "silent"' } },
      output: { mode: 'result-only', resultTo: { lastOutput: true, var: 'got' } },
    });
    def.nodes[3] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { returns: '{ "hasVar": $exists(vars.got), "last": outputs.sub.value }' },
    };
    const run = await e.runToIdle(e.publish(def).loopId);
    expect(run.status).toBe('succeeded');
    expect(run.result).toEqual({
      hasVar: false,
      last: { status: 'succeeded', outcome: 'success', childRunId: expect.any(String) },
    });

    const custom = e.publish(
      singleNodeLoop(
        'custom-absent',
        subNode(e.publish(returning('custom-none', 'none')).loopId, {
          output: {
            mode: 'custom',
            custom: {
              patch: '[{ "op": "add", "path": "/vars/seen", "value": $exists(result) }]',
            },
          },
        }),
        { returns: 'vars.seen' },
      ),
    );
    expect((await e.runToIdle(custom.loopId)).result).toBe(false);
  });

  it('a child exit returns its data and never terminates its parent, which continues to its own exit', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    // The child gives up with an authored Exhausted exit: an outcome, not the parent's.
    const child = e.publish(
      singleNodeLoop(
        'exhausting-child',
        {
          id: 'work',
          kind: 'mutate',
          label: 'Work',
          config: {
            operations: [{ op: 'set', path: '/vars/n', value: { kind: 'literal', value: 3 } }],
          },
        },
        { outcome: 'exhausted', returns: '{ "tries": vars.n }' },
      ),
    );
    const appended = recordAppends(e);
    const run = await e.runToIdle(e.publish(withAfter('continuing-parent', child.loopId)).loopId);
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'success' });
    expect(run.result).toEqual({
      child: {
        status: 'exhausted',
        outcome: 'exhausted',
        result: { tries: 3 },
        childRunId: expect.any(String),
      },
      after: true,
    });
    const [kid] = await e.ports.runs.listChildren(run.id);
    // Across both logs: the child finished, then the parent woke, then its own work ran.
    const position = (entry: string) => appended.indexOf(entry);
    expect(position(`${kid!.id}:run.finished`)).toBeGreaterThan(-1);
    expect(position(`${kid!.id}:run.finished`)).toBeLessThan(position(`${run.id}:run.woken`));
    expect(position(`${run.id}:run.woken`)).toBeLessThan(position(`${run.id}:node.started:after`));
  });
});

/** The order of every append across all logs, as `<runId>:<type>[:<nodeId>]`. */
function recordAppends(e: TestEngine): string[] {
  const appended: string[] = [];
  const append = e.ports.events.append.bind(e.ports.events);
  vi.spyOn(e.ports.events, 'append').mockImplementation(async (runId, drafts, options) => {
    const stored = await append(runId, drafts, options);
    for (const event of stored)
      appended.push(
        [
          runId,
          event.type,
          ...('nodeId' in event && event.type === 'node.started' ? [event.nodeId] : []),
        ].join(':'),
      );
    return stored;
  });
  return appended;
}

/** start -> sub -> after (mutate) -> done, returning the child summary and the parent's own work. */
function withAfter(name: string, childLoopId: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      subNode(childLoopId),
      {
        id: 'after',
        kind: 'mutate',
        label: 'After',
        config: {
          operations: [{ op: 'set', path: '/vars/after', value: { kind: 'literal', value: true } }],
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '{ "child": outputs.sub.value, "after": vars.after }' },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'after' } },
      { id: 'e3', from: { node: 'after', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

const count = (e: TestEngine, runId: string, match: (event: RunEvent) => boolean): number =>
  e.events(runId).filter(match).length;
const started = (nodeId: string) => (event: RunEvent) =>
  event.type === 'node.started' && event.nodeId === nodeId;
const hang = () => new Promise<never>(() => undefined);

/** One continuation: one wake, one child completion, the subsequent work and the exit once. */
function expectOneContinuation(e: TestEngine, runId: string): void {
  expect(count(e, runId, (event) => event.type === 'run.woken')).toBe(1);
  expect(count(e, runId, (event) => event.type === 'child_run.finished')).toBe(1);
  expect(count(e, runId, started('after'))).toBe(1);
  expect(count(e, runId, (event) => event.type === 'run.finished')).toBe(1);
}

async function recover(e: TestEngine): Promise<RunManager> {
  e.manager.stop();
  const manager = new RunManager(e.ports, e.settings);
  await manager.start();
  await manager.waitForIdle();
  manager.stop();
  return manager;
}

describe('awaiting a child across failures and restarts (#242)', () => {
  it('an unfinished child is never mapped: a parent woken before its child was resumed awaits it again', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const child = e.publish(
      singleNodeLoop(
        'flaky-child',
        {
          id: 'job',
          kind: 'script',
          label: 'Job',
          config: { command: 'job', stdout: 'last-output' },
        },
        { returns: 'lastOutput.value' },
      ),
    );
    let release: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = (exitCode: number, stdout: string) => ({
      exitCode,
      stdout,
      stderr: '',
      stdoutBytes: stdout.length,
      stderrBytes: 0,
      stdoutOverflow: false,
      stderrOverflow: false,
      timedOut: false,
    });
    let calls = 0;
    vi.spyOn(e.ports.scripts, 'run').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return result(1, '');
      await second;
      return result(0, '"done"');
    });
    const parent = e.publish(withAfter('resumed-child-parent', child.loopId));
    // The parent is paused right after its child's failure woke it, before it could run.
    const watched: { parentId?: string } = {};
    let paused = false;
    const append = e.ports.events.append.bind(e.ports.events);
    vi.spyOn(e.ports.events, 'append').mockImplementation(async (runId, drafts, options) => {
      const stored = await append(runId, drafts, options);
      if (
        !paused &&
        runId === watched.parentId &&
        drafts.some((draft) => draft.type === 'run.woken')
      ) {
        paused = true;
        await e.manager.pause(runId);
      }
      return stored;
    });
    const parentId = (await e.start(parent.loopId)).id;
    watched.parentId = parentId;
    await e.manager.waitForIdle();
    const [kid] = await e.ports.runs.listChildren(parentId);
    expect(kid?.status).toBe('failed');
    expect((await e.ports.runs.get(parentId))?.status).toBe('paused');

    // The operator resumes the failed child; it runs again (and is still running) when the
    // parent resumes and consumes the wake its failure left.
    await e.manager.resume(kid!.id);
    await vi.waitFor(() => expect(calls).toBe(2));
    await e.manager.resume(parentId);
    await vi.waitFor(async () =>
      expect(await e.ports.runs.get(parentId)).toMatchObject({
        status: 'waiting',
        waiting: { kind: 'child', childRunId: kid!.id },
      }),
    );
    expect(count(e, parentId, (event) => event.type === 'child_run.finished')).toBe(0);
    expect(count(e, parentId, started('after'))).toBe(0);

    release();
    const done = await e.settle(parentId);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({
      child: { status: 'succeeded', result: 'done' },
      after: true,
    });
    expect(
      e
        .events(parentId)
        .flatMap((event) => (event.type === 'child_run.finished' ? [event.status] : [])),
    ).toEqual(['succeeded']);
  });

  it('nested children each finish before their parent continues to its own work and exit', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const leaf = e.publish(inputLoop('nested-leaf'));
    const middle = e.publish(withAfter('nested-middle', leaf.loopId));
    const top = await e.runToIdle(e.publish(withAfter('nested-top', middle.loopId)).loopId);
    expect(top.status).toBe('waiting');
    const [mid] = await e.ports.runs.listChildren(top.id);
    const [bottom] = await e.ports.runs.listChildren(mid!.id);
    expect(mid?.status).toBe('waiting');
    expect(bottom?.status).toBe('waiting');
    await e.manager.provideInput(bottom!.id, await waitIdOf(e, bottom!.id), 'leaf data');
    const done = await e.settle(top.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({
      child: {
        status: 'succeeded',
        childRunId: mid!.id,
        result: { child: { result: 'leaf data', childRunId: bottom!.id }, after: true },
      },
      after: true,
    });
    for (const runId of [top.id, mid!.id]) expectOneContinuation(e, runId);
  });

  it('a child that finished while the process was down wakes its parent exactly once', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const leaf = e.publish(inputLoop('down-leaf'));
    const middle = e.publish(withAfter('down-middle', leaf.loopId));
    const top = await e.runToIdle(e.publish(withAfter('down-top', middle.loopId)).loopId);
    const [mid] = await e.ports.runs.listChildren(top.id);
    const [bottom] = await e.ports.runs.listChildren(mid!.id);
    // The leaf reaches its terminal status, and the process dies before it is finalized: the
    // middle run is never told.
    const cancel = e.ports.timers.cancel.bind(e.ports.timers);
    let stranded = false;
    vi.spyOn(e.ports.timers, 'cancel').mockImplementation(async (runId, key) => {
      if (runId === bottom!.id && (await e.ports.runs.get(runId))?.status === 'succeeded') {
        stranded = true;
        return hang();
      }
      return cancel(runId, key);
    });
    await e.manager.provideInput(bottom!.id, await waitIdOf(e, bottom!.id), 'while down');
    await vi.waitFor(() => expect(stranded).toBe(true));
    expect((await e.ports.runs.get(mid!.id))?.status).toBe('waiting');
    vi.restoreAllMocks();

    const recovered = await recover(e);
    expect((await recovered.getRun(top.id))?.status).toBe('succeeded');
    for (const runId of [top.id, mid!.id]) expectOneContinuation(e, runId);
    expect((await recovered.getRun(top.id))?.result).toMatchObject({
      child: { result: { child: { result: 'while down' } } },
    });
  });

  it('a parent interrupted mid-wake continues exactly once after recovery', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const leaf = e.publish(inputLoop('mid-wake-leaf'));
    const parent = await e.runToIdle(e.publish(withAfter('mid-wake-parent', leaf.loopId)).loopId);
    const [kid] = await e.ports.runs.listChildren(parent.id);
    // The child's wake of its parent is durable; the process dies before the status write.
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let interrupted = false;
    vi.spyOn(e.ports.runs, 'transition').mockImplementation((id, from, changes, ...rest) => {
      if (id === parent.id && changes.status === 'running' && from.includes('waiting')) {
        interrupted = true;
        return hang();
      }
      return transition(id, from, changes, ...rest);
    });
    await e.manager.provideInput(kid!.id, await waitIdOf(e, kid!.id), 'mid-wake');
    await vi.waitFor(() => expect(interrupted).toBe(true));
    expect((await e.ports.runs.get(parent.id))?.status).toBe('waiting');
    expect(count(e, parent.id, (event) => event.type === 'run.woken')).toBe(1);
    vi.restoreAllMocks();

    const recovered = await recover(e);
    expect((await recovered.getRun(parent.id))?.status).toBe('succeeded');
    expectOneContinuation(e, parent.id);
    // A second recovery finds nothing left to do.
    await recover(e);
    expectOneContinuation(e, parent.id);
  });

  it('a parent that dies after recording its child completion records it once after recovery (#398)', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 3 });
    const leaf = e.publish(inputLoop('completion-leaf'));
    const parent = await e.runToIdle(e.publish(withAfter('completion-parent', leaf.loopId)).loopId);
    const [kid] = await e.ports.runs.listChildren(parent.id);
    // The child's completion is durable on the parent; the process dies writing the subloop
    // node's own `node.finished`, a separate append.
    const append = e.ports.events.append.bind(e.ports.events);
    let died = false;
    vi.spyOn(e.ports.events, 'append').mockImplementation(async (runId, drafts, options) => {
      if (
        runId === parent.id &&
        drafts.some((draft) => draft.type === 'node.finished' && draft.nodeId === 'sub')
      ) {
        died = true;
        return hang();
      }
      return append(runId, drafts, options);
    });
    await e.manager.provideInput(kid!.id, await waitIdOf(e, kid!.id), 'completed');
    await vi.waitFor(() => expect(died).toBe(true));
    expect(count(e, parent.id, (event) => event.type === 'child_run.finished')).toBe(1);
    vi.restoreAllMocks();

    const recovered = await recover(e);
    expect((await recovered.getRun(parent.id))?.status).toBe('succeeded');
    expectOneContinuation(e, parent.id);
    expect((await recovered.getRun(parent.id))?.result).toMatchObject({
      child: { result: 'completed' },
      after: true,
    });
  });
});
