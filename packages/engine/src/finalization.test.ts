/**
 * Regressions from the third review round of WP-G (reviewer probes, adapted): terminal events
 * survive a crash before the status write for every failure source; finalization (returns,
 * children, parent) survives a crash after it; domain projections match resume-to-waiting.
 */
import { it, expect, vi } from 'vitest';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { RunManager } from './run-manager.js';
import { transitionRun, summarizeRun } from '@graphgoblin/domain';
import { defaultHandlers } from './handlers/index.js';
import type { LoopDefinitionInput, RunEvent } from '@graphgoblin/contracts';

const hang = () => new Promise<never>(() => {});
const terminal = (e: RunEvent) => ['run.finished', 'run.failed', 'run.cancelled'].includes(e.type);
const input = (name = 'input') =>
  singleNodeLoop(name, {
    id: 'wait',
    kind: 'wait',
    label: 'W',
    config: { mode: 'input', prompt: '?' },
  });
async function recover(e: TestEngine) {
  const m = new RunManager(e.ports, e.settings);
  await m.start();
  await m.waitForIdle();
  m.stop();
  return m;
}

for (const source of [
  'exit-success',
  'exit-failure',
  'exit-exhausted',
  'harness',
  'harness-uninstalled',
  'inference-timeout',
  'repair',
  'decider',
  'decision',
  'heartbeat-cap',
  'timeout',
  'script',
  'script-timeout',
  'missing-edge',
  'missing-version',
  'missing-node',
  'invalid-patch',
  'executor-error',
  'subloop-missing',
  'mutate-error',
] as const) {
  it(`terminal append survives crash before status: ${source}`, async () => {
    const e = await createTestEngine();
    let def: LoopDefinitionInput = minimalLoop();
    let code: string | undefined;
    if (source.startsWith('exit'))
      def.nodes[1] = {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          criteria:
            source === 'exit-failure'
              ? [
                  {
                    when: 'predicate',
                    answer: { type: 'noul' },
                    evaluation: { kind: 'expression', jsonata: 'true' },
                    match: { type: 'noul', value: true },
                    outcome: 'failure',
                  },
                ]
              : source === 'exit-exhausted'
                ? [{ when: 'max-iterations', value: 1 }]
                : [],
          return: { mapping: 'counters.nodeVisits.done', channels: [{ kind: 'caller' }] },
        },
      };
    if (source === 'harness' || source === 'repair') {
      e.ports.harness.script(
        source === 'harness'
          ? [{ error: { code: 'HARNESS_BOOM', message: 'harness failed' } }]
          : [{ structured: { ok: 'no' } }, { structured: { ok: 'no' } }],
      );
      def = singleNodeLoop(source, {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: {
          prompt: { template: 'go' },
          ...(source === 'repair'
            ? {
                output: {
                  schema: {
                    jsonSchema: {
                      type: 'object',
                      required: ['ok'],
                      properties: { ok: { type: 'boolean' } },
                    },
                    repair: { maxAttempts: 1 },
                  },
                },
              }
            : {}),
        },
      });
      if (source === 'repair') code = 'OUTPUT_SCHEMA_MISMATCH';
    }
    if (source === 'decider') {
      e.ports.deciders = [];
      def.nodes[1] = {
        id: 'done',
        kind: 'exit',
        label: 'D',
        config: {
          criteria: [
            {
              when: 'predicate',
              answer: {
                type: 'noul',
                true: { label: 'Ready', criteria: 'Task is done' },
                false: { label: 'Continue', criteria: 'Task is not done' },
              },
              evaluation: {
                kind: 'llm',
                harness: 'codex',
                model: { mode: 'inherit' },
                effort: { mode: 'inherit' },
                question: 'done?',
              },
              match: { type: 'noul', value: true },
              outcome: 'success',
            },
          ],
        },
      };
      code = 'EVALUATION_UNAVAILABLE';
    }
    if (source === 'decision') {
      e.ports.deciders = [];
      e.ports.classifiers.models.clear();
      def = singleNodeLoop(source, {
        id: 'decide',
        kind: 'decision',
        label: 'D',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'yes', criteria: 'Y' },
              { id: 'no', label: 'no', criteria: 'N' },
            ],
          },
          evaluation: { kind: 'classifier', model: 'jev', question: '?', context: {} },
        },
      });
      code = 'EVALUATION_UNAVAILABLE';
    }
    if (source === 'heartbeat-cap') {
      def = singleNodeLoop(source, {
        id: 'beat',
        kind: 'heartbeat',
        label: 'B',
        config: { intervalSeconds: 1, maxBeats: 1, onExhausted: 'fail-run' },
      });
      code = 'HEARTBEAT_EXHAUSTED';
    }
    if (source === 'harness-uninstalled' || source === 'inference-timeout') {
      if (source === 'harness-uninstalled') delete e.ports.harnesses.codex;
      else e.ports.harness.script([{ delayMs: 100000 }]);
      def = singleNodeLoop(source, {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: { prompt: { template: 'go' }, timeoutSeconds: 1 },
      });
      code = source === 'harness-uninstalled' ? 'HARNESS_NOT_INSTALLED' : 'INFERENCE_TIMEOUT';
    }
    if (source === 'invalid-patch') {
      vi.spyOn(defaultHandlers().trigger, 'execute').mockResolvedValue({
        kind: 'done',
        route: 'out',
        patch: [{ op: 'replace', path: '/schemaVersion', value: 999 }],
      });
      code = 'INTERNAL_ERROR';
    }
    if (source === 'executor-error') {
      e.settings.ownerDefaults = vi
        .fn()
        .mockRejectedValueOnce(new Error('owner store failed'))
        .mockResolvedValue({ byHarness: {} });
      code = 'INTERNAL_ERROR';
    }
    if (source === 'subloop-missing') {
      def = singleNodeLoop(source, {
        id: 'sub',
        kind: 'subloop',
        label: 'S',
        config: { loopRef: { loopId: e.loopId('not-published') } },
      });
      code = 'SUBLOOP_NOT_FOUND';
    }
    if (source === 'mutate-error') {
      def = singleNodeLoop(source, {
        id: 'mutate',
        kind: 'mutate',
        label: 'M',
        config: {
          operations: [
            { op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("bad")' } },
          ],
        },
      });
      code = 'INTERNAL_ERROR';
    }
    if (source === 'timeout') {
      def = singleNodeLoop(source, {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'duration', seconds: 10, timeoutSeconds: 1, onTimeout: 'fail-run' },
      });
      code = 'WAIT_TIMEOUT';
    }
    if (source === 'script' || source === 'script-timeout') {
      vi.spyOn(e.ports.scripts, 'run').mockResolvedValue({
        exitCode: source === 'script' ? 5 : 0,
        stdout: '',
        stderr: '',
        timedOut: source === 'script-timeout',
      });
      def = singleNodeLoop(source, {
        id: 'script',
        kind: 'script',
        label: 'S',
        config: { command: 'echo' },
      });
      code = source === 'script' ? 'SCRIPT_EXIT_CODE' : 'SCRIPT_TIMEOUT';
    }
    if (source === 'missing-edge') {
      def.edges = [];
      code = 'INTERNAL_ERROR';
    }
    const v = e.publish(def);
    let blocked = false;
    let target = '';
    const append = e.ports.events.append.bind(e.ports.events);
    const spy = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation(async (id, drafts, options) => {
        const stored = await append(id, drafts, options);
        if (stored.some(terminal)) {
          target = id;
          expect(['queued', 'running', 'waiting', 'paused']).toContain(
            (await e.ports.runs.get(id))!.status,
          );
          if (drafts.some((d) => d.type === 'run.finished'))
            expect(drafts[0]!.type).toBe('node.finished');
          blocked = true;
          return hang();
        }
        return stored;
      });
    if (source === 'missing-version' || source === 'missing-node') e.manager.stop();
    const r = await e.start(v.loopId);
    let other: RunManager | undefined;
    if (source === 'missing-version') {
      e.ports.loops.versions.delete(v.id);
      code = 'INTERNAL_ERROR';
    }
    if (source === 'missing-node') {
      await e.ports.runs.update(r.id, { currentNodeId: 'gone' });
      code = 'INTERNAL_ERROR';
    }
    if (source === 'missing-version' || source === 'missing-node') {
      other = new RunManager(e.ports, e.settings);
      await other.start();
    }
    if (source === 'timeout') {
      await e.manager.waitForIdle();
      e.ports.clock.advance(2000);
      await e.ports.timers.fireDue(e.ports.clock.now());
    }
    await vi.waitFor(() => expect(blocked).toBe(true), { timeout: 4000 });
    e.manager.stop();
    other?.stop();
    spy.mockRestore();
    const before = e.events(target).filter(terminal);
    expect(before).toHaveLength(1);
    await recover(e);
    await recover(e);
    const final = (await e.ports.runs.get(r.id))!;
    const expected =
      source === 'exit-success'
        ? 'succeeded'
        : source === 'exit-exhausted'
          ? 'exhausted'
          : 'failed';
    expect(final.status).toBe(expected);
    if (code) expect(final.failure?.code).toBe(code);
    if (source.startsWith('exit')) expect(final.result).toBe(1);
    expect(e.events(r.id).filter(terminal)).toHaveLength(1);
  });
}

it.each(['queued', 'running', 'waiting', 'paused'] as const)(
  'recovery completes terminal log from %s status',
  async (status) => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(input()).loopId);
    e.manager.stop();
    await e.ports.events.append(r.id, [
      {
        type: 'run.failed',
        failure: { code: 'INTERNAL_ERROR', message: 'durable failure', resumable: false },
      },
    ]);
    await e.ports.runs.update(r.id, { status });
    await recover(e);
    await recover(e);
    expect((await e.ports.runs.get(r.id))!.status).toBe('failed');
    expect(e.events(r.id).filter(terminal)).toHaveLength(1);
  },
);

it.each([
  'input',
  'signal',
  'duration',
  'until',
  'heartbeat',
  'child',
  'inference',
  'paused',
  'queued',
] as const)('cancel event before status: %s', async (kind) => {
  const e = await createTestEngine({ maxConcurrentRuns: 2 });
  let def = input(kind);
  if (['signal', 'duration', 'until'].includes(kind))
    def = singleNodeLoop(kind, {
      id: 'wait',
      kind: 'wait',
      label: 'W',
      config:
        kind === 'signal'
          ? { mode: 'signal', name: 'go' }
          : kind === 'duration'
            ? { mode: 'duration', seconds: 20 }
            : { mode: 'until', timestamp: '2026-10-03T00:00:00Z' },
    });
  if (kind === 'heartbeat')
    def = singleNodeLoop(kind, {
      id: 'beat',
      kind: 'heartbeat',
      label: 'B',
      config: { intervalSeconds: 1, maxBeats: 10 },
    });
  if (kind === 'child') {
    const kid = e.publish(input('kid'));
    def = singleNodeLoop(kind, {
      id: 'sub',
      kind: 'subloop',
      label: 'S',
      config: { loopRef: { loopId: kid.loopId } },
    });
  }
  if (kind === 'inference') {
    e.ports.harness.script([{ delayMs: 100000 }]);
    def = singleNodeLoop(kind, {
      id: 'infer',
      kind: 'inference',
      label: 'I',
      config: { prompt: { template: 'hi' } },
    });
  }
  if (kind === 'queued') e.manager.stop();
  const r = await e.start(e.publish(def).loopId);
  if (kind === 'inference') await vi.waitFor(() => expect(e.ports.harness.started).toHaveLength(1));
  else if (kind !== 'queued') await e.manager.waitForIdle();
  if (kind === 'paused') await e.manager.pause(r.id);
  const append = e.ports.events.append.bind(e.ports.events);
  let blocked = false;
  const spy = vi.spyOn(e.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
    const out = await append(id, drafts, options);
    if (id === r.id && drafts.some((d) => d.type === 'run.cancelled')) {
      expect(['queued', 'running', 'waiting', 'paused']).toContain(
        (await e.ports.runs.get(id))!.status,
      );
      blocked = true;
      return hang();
    }
    return out;
  });
  void e.manager.cancel(r.id);
  await vi.waitFor(() => expect(blocked).toBe(true));
  e.manager.stop();
  spy.mockRestore();
  await recover(e);
  await recover(e);
  expect((await e.ports.runs.get(r.id))!.status).toBe('cancelled');
  expect(e.events(r.id).filter((x) => x.type === 'run.cancelled')).toHaveLength(1);
  expect(e.ports.timers.scheduled.filter((t) => t.runId === r.id)).toHaveLength(0);
  if (kind === 'child')
    expect((await e.ports.runs.listChildren(r.id))[0]!.status).toBe('cancelled');
});

it('return delivery survives a crash just after terminal status commits', async () => {
  const e = await createTestEngine();
  const def = minimalLoop();
  def.nodes[1] = {
    id: 'done',
    kind: 'exit',
    label: 'D',
    config: { return: { mapping: '7', channels: [{ kind: 'log' }] } },
  };
  const transition = e.ports.runs.transition.bind(e.ports.runs);
  let blocked = false;
  const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
    const out = await transition(id, from, changes);
    if (changes.status === 'succeeded') {
      blocked = true;
      return hang();
    }
    return out;
  });
  const r = await e.start(e.publish(def).loopId);
  await vi.waitFor(() => expect(blocked).toBe(true));
  e.manager.stop();
  spy.mockRestore();
  await recover(e);
  expect((await e.ports.runs.get(r.id))!.status).toBe('succeeded');
  expect(e.ports.delivery.logged).toHaveLength(1);
});

it('cancellation propagates to children after parent status commits and process dies', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 2 });
  const kid = e.publish(input('kid'));
  const p = e.publish(
    singleNodeLoop('parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'S',
      config: { loopRef: { loopId: kid.loopId } },
    }),
  );
  const r = await e.runToIdle(p.loopId);
  const transition = e.ports.runs.transition.bind(e.ports.runs);
  let blocked = false;
  const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
    const out = await transition(id, from, changes);
    if (id === r.id && changes.status === 'cancelled') {
      blocked = true;
      return hang();
    }
    return out;
  });
  void e.manager.cancel(r.id);
  await vi.waitFor(() => expect(blocked).toBe(true));
  e.manager.stop();
  spy.mockRestore();
  await recover(e);
  expect((await e.ports.runs.listChildren(r.id))[0]!.status).toBe('cancelled');
});

it('domain status prediction and replay summary match resume of a parked run', async () => {
  const e = await createTestEngine();
  const r = await e.runToIdle(e.publish(input()).loopId);
  await e.manager.pause(r.id);
  const resumed = await e.manager.resume(r.id);
  e.manager.stop();
  expect(resumed.status).toBe('waiting');
  expect(summarizeRun(e.events(r.id)).status).toBe(resumed.status);
  expect(transitionRun('paused', { type: 'resume', parked: true })).toBe(resumed.status);
});

// Fourth round: finalization per terminal generation, failed child cleanup, durable resume intent.

it('a resumed failed run is finalized again after a crash on its next terminal status', async () => {
  const e = await createTestEngine();
  e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
  const def = singleNodeLoop(
    'resumed-finalization',
    { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
    { return: { mapping: '7', channels: [{ kind: 'log' }] } },
  );
  const r = await e.runToIdle(e.publish(def).loopId);
  expect(r.failure?.resumable).toBe(true);
  expect(await e.ports.runs.listUnfinalized()).toHaveLength(0);
  const transition = e.ports.runs.transition.bind(e.ports.runs);
  let blocked = false;
  const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
    const out = await transition(id, from, changes);
    if (changes.status === 'succeeded') {
      blocked = true;
      return hang();
    }
    return out;
  });
  await e.manager.resume(r.id);
  await vi.waitFor(() => expect(blocked).toBe(true));
  e.manager.stop();
  spy.mockRestore();
  expect((await e.ports.runs.listUnfinalized()).map((x) => x.id)).toEqual([r.id]);
  await recover(e);
  expect((await e.ports.runs.get(r.id))?.status).toBe('succeeded');
  expect(e.ports.delivery.logged).toHaveLength(1);
  expect(await e.ports.runs.listUnfinalized()).toHaveLength(0);
});

it('a child cancellation error leaves the parent finalization pending for the next recovery', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 2 });
  const kid = e.publish(input('kid'));
  const r = await e.runToIdle(
    e.publish(
      singleNodeLoop('parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'S',
        config: { loopRef: { loopId: kid.loopId } },
      }),
    ).loopId,
  );
  const child = (await e.ports.runs.listChildren(r.id))[0]!;
  const claim = e.ports.runs.claimCancel.bind(e.ports.runs);
  const spy = vi
    .spyOn(e.ports.runs, 'claimCancel')
    .mockImplementation((id, from, at) =>
      id === child.id
        ? Promise.reject(new Error('transient child database failure'))
        : claim(id, from, at),
    );
  await e.manager.cancel(r.id);
  e.manager.stop();
  spy.mockRestore();
  expect((await e.ports.runs.get(child.id))?.status).toBe('waiting');
  expect((await e.ports.runs.listUnfinalized()).map((x) => x.id)).toEqual([r.id]);
  await recover(e);
  expect((await e.ports.runs.get(child.id))?.status).toBe('cancelled');
  expect(await e.ports.runs.listUnfinalized()).toHaveLength(0);
});

it.each(['durable', 'not durable'] as const)(
  'a resume of a failed run whose run.resumed is %s when the process dies',
  async (durable) => {
    const e = await createTestEngine();
    e.ports.harness.script([{ error: { code: 'temporary', message: 'retry' } }]);
    const v = e.publish(
      singleNodeLoop('resume-audit', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: { prompt: { template: 'go' } },
      }),
    );
    const r = await e.runToIdle(v.loopId);
    expect(r.status).toBe('failed');
    const append = e.ports.events.append.bind(e.ports.events);
    let blocked = false;
    const spy = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation(async (id, drafts, options) => {
        if (drafts.some((x) => x.type === 'run.resumed')) {
          if (durable === 'durable') await append(id, drafts, options);
          blocked = true;
          return hang();
        }
        return append(id, drafts, options);
      });
    void e.manager.resume(r.id);
    await vi.waitFor(() => expect(blocked).toBe(true));
    // The intent is written before the status: the status has not moved yet.
    expect((await e.ports.runs.get(r.id))?.status).toBe('failed');
    e.manager.stop();
    spy.mockRestore();
    await recover(e);
    // A durable resume is completed; one that never reached the log never happened.
    expect((await e.ports.runs.get(r.id))?.status).toBe(
      durable === 'durable' ? 'succeeded' : 'failed',
    );
    expect(await e.ports.runs.listUnfinalized()).toHaveLength(0);
  },
);

// Fifth round: the finalizer of an earlier outcome cannot overwrite the marker a resume cleared.
it.each(['next success', 'durable resume'] as const)(
  'an older finalizer in flight cannot hide the %s',
  async (crashPoint) => {
    const e = await createTestEngine();
    e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
    const def = singleNodeLoop(
      'stale-finalizer',
      { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
      { return: { mapping: '7', channels: [{ kind: 'log' }] } },
    );
    // Hold the failure's finalizer just before it writes its marker.
    let entered!: () => void;
    const enteredP = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const releaseP = new Promise<void>((resolve) => (release = resolve));
    const mark = e.ports.runs.markFinalized.bind(e.ports.runs);
    let first = true;
    const markSpy = vi.spyOn(e.ports.runs, 'markFinalized').mockImplementation(async (id) => {
      if (first) {
        first = false;
        entered();
        await releaseP;
      }
      return mark(id);
    });
    const r = await e.start(e.publish(def).loopId);
    await enteredP;
    expect((await e.ports.runs.get(r.id))?.status).toBe('failed');
    let blocked = false;
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const append = e.ports.events.append.bind(e.ports.events);
    const statusSpy = vi
      .spyOn(e.ports.runs, 'transition')
      .mockImplementation(async (id, from, changes) => {
        const out = await transition(id, from, changes);
        if (crashPoint === 'next success' && changes.status === 'succeeded') {
          blocked = true;
          return hang();
        }
        return out;
      });
    const appendSpy = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation(async (id, drafts, options) => {
        const out = await append(id, drafts, options);
        if (crashPoint === 'durable resume' && drafts.some((d) => d.type === 'run.resumed')) {
          blocked = true;
          return hang();
        }
        return out;
      });
    // The resume is requested while the old finalizer is in flight; it waits for it.
    const resumed = e.manager.resume(r.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(e.eventTypes(r.id)).not.toContain('run.resumed');
    release();
    if (crashPoint === 'next success') await resumed;
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    markSpy.mockRestore();
    statusSpy.mockRestore();
    appendSpy.mockRestore();
    await recover(e);
    expect((await e.ports.runs.get(r.id))?.status).toBe('succeeded');
    expect(e.ports.delivery.logged).toHaveLength(1);
    expect(await e.ports.runs.listUnfinalized()).toHaveLength(0);
  },
);

// Sixth round: resume eligibility is re-checked inside the per-run lock.
it.each(['same failure', 'newer non-resumable failure'] as const)(
  'of two concurrent resumes of one failure, only one acts (%s)',
  async (scenario) => {
    const e = await createTestEngine();
    e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
    const exitFailure = scenario === 'newer non-resumable failure';
    const def = singleNodeLoop(
      'concurrent-resume',
      { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
      {
        ...(exitFailure
          ? {
              criteria: [
                {
                  when: 'predicate',
                  answer: { type: 'noul' },
                  evaluation: { kind: 'expression', jsonata: 'true' },
                  match: { type: 'noul', value: true },
                  outcome: 'failure',
                },
              ],
            }
          : {}),
        return: { mapping: '7', channels: [{ kind: 'log' }] },
      },
    );
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.failure?.resumable).toBe(true);
    // Hold the first resume inside the lock until the second has read the same failed record.
    let entered!: () => void;
    const enteredP = new Promise<void>((resolve) => (entered = resolve));
    let gate!: () => void;
    const gateP = new Promise<void>((resolve) => (gate = resolve));
    const clear = e.ports.runs.clearFinalized.bind(e.ports.runs);
    let first = true;
    vi.spyOn(e.ports.runs, 'clearFinalized').mockImplementation(async (id) => {
      if (first) {
        first = false;
        entered();
        await gateP;
      }
      return clear(id);
    });
    const a = e.manager.resume(r.id);
    await enteredP;
    const b = e.manager.resume(r.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    gate();
    const outcomes = await Promise.allSettled([a, b]);
    await e.manager.waitForIdle();
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { code: 'INVALID_STATE' },
    });
    // The rejected resume wrote nothing; the run ran its retry once.
    expect(e.eventTypes(r.id).filter((t) => t === 'run.resumed')).toHaveLength(1);
    expect(e.eventTypes(r.id).filter((t) => t === 'run.finished')).toHaveLength(1);
    expect((await e.ports.runs.get(r.id))?.status).toBe(exitFailure ? 'failed' : 'succeeded');
  },
);
