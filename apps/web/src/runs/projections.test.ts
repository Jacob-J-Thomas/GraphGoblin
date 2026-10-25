import {
  LoopDefinitionSchema,
  type JsonValue,
  type ReturnChannel,
  type RunEvent,
} from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import { event, queuedFields } from '../__fixtures__/fake-api.js';
import { MAX_HISTORY_BYTES, quotaSafeSessionStorage, useRunEventStore } from './event-store.js';
import { describeEvent, exitReturnSummary, lastGateSummary, nodeActivity } from './projections.js';

const R = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const actor = { kind: 'user' as const, id: 'local' };
const channel = { kind: 'log' as const };
const usage = { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningOutputTokens: 0 };
const expressionEvidence = (optionId: string) => ({
  portId: optionId,
  provenance: {
    kind: 'expression' as const,
    provider: null,
    classifierId: null,
    model: null,
    effort: null,
  },
  diagnostics: [],
  observation: { kind: 'route' as const, routeId: optionId, confidence: null, reasoning: null },
});

const ALL: RunEvent[] = [
  event(R, 1, 'run.queued', queuedFields()),
  event(R, 2, 'run.started', { attempt: 1 }),
  event(R, 3, 'run.paused', { actor }),
  event(R, 4, 'run.resumed', { actor }),
  event(R, 5, 'run.cancel_requested', { actor }),
  event(R, 6, 'run.waiting', {
    nodeId: 'w',
    wait: { waitId: 'fixture-wait', startedSeq: 1, nodeId: 'w', kind: 'input' },
  }),
  event(R, 7, 'run.woken', { nodeId: 'w', reason: 'input' }),
  event(R, 8, 'iteration.incremented', { from: 1, to: 2, targetNodeId: 'a' }),
  event(R, 9, 'node.started', { nodeId: 'a', kind: 'mutate', attempt: 1, configHash: 'h' }),
  event(R, 10, 'node.finished', {
    nodeId: 'a',
    patch: [{ op: 'replace', path: '/vars/topic', value: 'x' }],
    durationMs: 3,
    route: 'good',
  }),
  event(R, 11, 'node.progress', {
    nodeId: 'i',
    progress: { exitCode: 0, stderr: '', stdoutBytes: 0 },
  }),
  event(R, 12, 'harness.session', { nodeId: 'i', harness: 'codex', sessionId: 's', mode: 'fresh' }),
  event(R, 13, 'harness.usage', { nodeId: 'i', usage }),
  event(R, 14, 'decision.made', { nodeId: 'd', ...expressionEvidence('good') }),
  event(R, 15, 'signal.received', { name: 'go' }),
  event(R, 16, 'input.received', { nodeId: 'w', payload: 1 }),
  event(R, 17, 'heartbeat.beat', { nodeId: 'h', beat: 1 }),
  event(R, 18, 'child_run.started', { nodeId: 's', childRunId: R }),
  event(R, 19, 'child_run.finished', { nodeId: 's', childRunId: R, status: 'succeeded' }),
  event(R, 20, 'return.delivered', { channel }),
  event(R, 21, 'return.failed', { channel, error: 'e' }),
  event(R, 22, 'run.failed', {
    failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: true },
  }),
  event(R, 23, 'run.cancelled', {}),
  event(R, 24, 'run.finished', { status: 'succeeded', outcome: 'success' }),
  event(R, 25, 'node.finished', {
    nodeId: 'b',
    patch: [{ op: 'remove', path: '/vars/count' }],
    durationMs: 1,
  }),
];

describe('run projections', () => {
  it.each(['success', 'failure', 'exhausted'] as const)(
    'describes a terminal %s exit',
    (outcome) => {
      expect(describeEvent(event(R, 1, 'exit.evaluated', { nodeId: 'done', outcome }))).toBe(
        `Exited: ${outcome}`,
      );
    },
  );
  it('omits missing optional Score confidence but retains missing required LLM and Choice confidence', () => {
    const provenance = {
      kind: 'classifier' as const,
      provider: 'typesafe',
      classifierId: 'jev',
      model: 'jev-latest',
      effort: null,
    };
    const score = describeEvent(
      event(R, 30, 'decision.made', {
        nodeId: 'score',
        portId: 'middle',
        provenance,
        diagnostics: [],
        observation: {
          kind: 'classifier',
          answer: {
            type: 'score',
            score: 1.25,
            confidence: null,
            legend: { '0': 'Low', '1': 'Middle', '2': 'High' },
            probabilities: null,
          },
        },
      }),
    );
    expect(score).toBe('Scored 1.25 to band middle with classifier via typesafe (jev-latest)');
    expect(
      describeEvent(
        event(R, 31, 'decision.made', {
          nodeId: 'choice',
          portId: 'yes',
          provenance,
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'choice',
              optionId: 'yes',
              confidence: null,
              probabilities: null,
            },
          },
        }),
      ),
    ).toContain('with confidence not recorded');
    expect(
      describeEvent(
        event(R, 32, 'decision.made', {
          nodeId: 'route',
          portId: 'yes',
          diagnostics: [],
          provenance: {
            kind: 'llm',
            provider: 'codex',
            model: 'alpha',
            effort: 'low',
            classifierId: null,
          },
          observation: { kind: 'route', routeId: 'yes', confidence: null, reasoning: null },
        }),
      ),
    ).toContain('with self-reported confidence (informational) not recorded');
  });
  it('describes Noul truth probability and fractional Score output separately', () => {
    const classifier = {
      kind: 'classifier' as const,
      provider: 'typesafe',
      classifierId: 'jev',
      model: 'jev-latest',
      effort: null,
    };
    expect(
      describeEvent(
        event(R, 30, 'decision.made', {
          nodeId: 'noul',
          portId: 'true',
          provenance: classifier,
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'noul',
              holds: true,
              trueProbability: 0.72,
              confidence: 0.83,
            },
          },
        }),
      ),
    ).toBe(
      'Answered true (true probability 72%) with classifier via typesafe (jev-latest) with confidence 83%',
    );
    expect(
      describeEvent(
        event(R, 32, 'decision.made', {
          nodeId: 'archived-noul',
          portId: 'true',
          provenance: classifier,
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'noul',
              holds: null,
              trueProbability: null,
              confidence: null,
            },
          },
        }),
      ),
    ).toBe(
      'Answered unknown (not recorded) (true probability not recorded) with classifier via typesafe (jev-latest) with confidence not recorded',
    );
    expect(
      describeEvent(
        event(R, 31, 'decision.made', {
          nodeId: 'score',
          portId: 'middle',
          provenance: classifier,
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'score',
              score: 1.25,
              confidence: 0.91,
              legend: { '0': 'Low', '1': 'Middle', '2': 'High' },
              probabilities: { '1': 0.91 },
            },
          },
        }),
      ),
    ).toBe(
      'Scored 1.25 to band middle with classifier via typesafe (jev-latest) with confidence 91%',
    );
  });

  it('invalidates old event caches and cursors and retains only current-format replay', async () => {
    useRunEventStore.setState({ runs: {} });
    useRunEventStore.persist.clearStorage();
    sessionStorage.setItem(
      'graphgoblin-run-events-v3',
      JSON.stringify({
        state: {
          runs: {
            [R]: {
              events: [
                {
                  runId: R,
                  seq: 1,
                  type: 'decision.made',
                  nodeId: 'd',
                  strategy: 'jev',
                  route: 'good',
                },
              ],
              lastSeq: 1,
            },
          },
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const { useRunEventStore: freshStore, quotaSafeSessionStorage: freshStorage } =
      await import('./event-store.js');
    await freshStore.persist.rehydrate();
    expect(freshStore.getState().runs[R]).toBeUndefined();
    expect(sessionStorage.getItem('graphgoblin-run-events-v3')).toBeNull();
    const refreshed = event(R, 1, 'decision.made', { nodeId: 'd', ...expressionEvidence('good') });
    freshStore.getState().append(R, refreshed);
    expect(freshStore.getState().runs[R]?.events).toEqual([refreshed]);
    expect(sessionStorage.getItem('graphgoblin-run-events-v4')).toContain('"portId":"good"');
    sessionStorage.setItem(
      'graphgoblin-run-events-v3',
      'written by an older tab after initialisation',
    );
    const removing = vi.spyOn(Storage.prototype, 'removeItem');
    try {
      freshStorage.getItem('graphgoblin-run-events-v4');
      await freshStore.persist.rehydrate();
      expect(removing).not.toHaveBeenCalled();
    } finally {
      removing.mockRestore();
    }
    freshStore.setState({ runs: {} });
  });
  it('describes every event type', () => {
    const lines = ALL.map((entry) => describeEvent(entry));
    expect(lines).toContain('attempt 1');
    expect(lines).toContain('by user local');
    expect(lines).toContain('w waits for input');
    expect(lines).toContain('w woken by input');
    expect(lines).toContain('iteration 1 → 2 at a');
    expect(lines).toContain('a (mutate) attempt 1');
    expect(lines).toContain('a → good, 1 change, 3 ms');
    expect(lines).toContain('go');
    expect(lines).toContain('log');
    expect(lines).toContain('INTERNAL_ERROR: boom');
    expect(lines).toContain('succeeded (success)');
    expect(lines).toContain('b, 1 change, 1 ms');
    expect(lines[0]).toBe('');
  });

  it('groups node activity for the progress drawer', () => {
    const activity = nodeActivity(ALL);
    expect([...activity.keys()]).toEqual(['i', 'd', 'h']);
    expect(activity.get('i')).toHaveLength(3);
  });

  it('keeps per-run logs, ignores replays, and evicts old runs', () => {
    const { append, clear } = useRunEventStore.getState();
    append('r1', ALL[0]!);
    append('r1', ALL[0]!);
    expect(useRunEventStore.getState().runs['r1']?.events).toHaveLength(1);
    for (let i = 0; i < 21; i += 1) append(`bulk${i}`, ALL[0]!);
    expect(Object.keys(useRunEventStore.getState().runs)).toHaveLength(20);
    expect(useRunEventStore.getState().runs['r1']).toBeUndefined();
    clear('bulk20');
    expect(useRunEventStore.getState().runs['bulk20']).toBeUndefined();
    expect(sessionStorage.getItem('graphgoblin-run-events-v4')).toContain('bulk19');
  });
});

/** Gate and return evidence at the top of the run (#129). */
describe('exit evidence summaries', () => {
  const gate = (
    portId: string,
    previousPasses: number,
    limit: 'max-passes' | 'max-run-time' | null,
    maxPasses: number | null = 3,
  ) =>
    event(R, previousPasses, 'decision.made', {
      ...expressionEvidence(limit ? 'again' : portId),
      portId: limit ? 'limit-reached' : portId,
      nodeId: 'gate',
      gate: {
        previousPasses,
        passes: previousPasses + (portId === 'again' && !limit ? 1 : 0),
        repeatRouteId: 'again',
        maxPasses,
        maxRunTimeSeconds: 60,
        elapsedSeconds: limit === 'max-run-time' ? 61 : 1,
        limit,
      },
    });

  it('summarizes the latest gate decision, its pass and any stopping limit', () => {
    expect(
      lastGateSummary([
        event(R, 1, 'decision.made', { nodeId: 'pick', ...expressionEvidence('a') }),
      ]),
    ).toBeUndefined();
    expect(lastGateSummary([gate('again', 1, null)])).toBe(
      'Last gate decision: gate chose again on pass 1 of 3.',
    );
    expect(lastGateSummary([gate('again', 1, null), gate('done', 2, null)])).toBe(
      'Last gate decision: gate chose done on pass 2 of 3.',
    );
    expect(lastGateSummary([gate('again', 1, null), gate('again', 3, 'max-passes')])).toBe(
      'Last gate decision: gate chose again on pass 3 of 3; maximum passes stopped the repeat, so it took Limit reached.',
    );
    expect(lastGateSummary([gate('again', 2, 'max-run-time')])).toBe(
      'Last gate decision: gate chose again on pass 2 of 3; maximum run time stopped the repeat, so it took Limit reached.',
    );
    // An Unlimited gate records no pass bound (#243).
    expect(lastGateSummary([gate('done', 12, null, null)])).toBe(
      'Last gate decision: gate chose done on pass 12 (unlimited passes).',
    );
    expect(lastGateSummary([gate('again', 4, 'max-run-time', null)])).toBe(
      'Last gate decision: gate chose again on pass 4 (unlimited passes); maximum run time stopped the repeat, so it took Limit reached.',
    );
  });

  const exitDefinition = (destinations: ReturnChannel[], returns = 'none') =>
    LoopDefinitionSchema.parse({
      ...minimalLoop(),
      nodes: minimalLoop().nodes.map((node) =>
        node.kind === 'exit' ? { ...node, config: { returns, destinations } } : node,
      ),
    });
  const finishedRun = (result?: JsonValue) => [
    event(R, 1, 'exit.evaluated', { nodeId: 'done', outcome: 'success' }),
    event(R, 2, 'run.finished', {
      status: 'succeeded',
      outcome: 'success',
      ...(result === undefined ? {} : { result }),
    }),
  ];

  it('stays silent until an exit finished the run, and when it returned a value, null included', () => {
    expect(exitReturnSummary([], undefined)).toBeUndefined();
    expect(exitReturnSummary(finishedRun().slice(0, 1), undefined)).toBeUndefined();
    expect(exitReturnSummary(finishedRun('done'), exitDefinition([]))).toBeUndefined();
    expect(exitReturnSummary(finishedRun(null), exitDefinition([]))).toBeUndefined();
  });

  it('asserts Returns None only when the pinned exit configuration establishes it (#129)', () => {
    // A run recorded by an older build omitted a null result (CHANGELOG, format 4): with an
    // expression exit, or without the definition, the history cannot show a no-value configuration.
    expect(exitReturnSummary(finishedRun(), undefined)).toBe(
      'No value was recorded for this run. The pinned definition is not available, so the exit’s Returns setting cannot be shown.',
    );
    expect(exitReturnSummary(finishedRun(), exitDefinition([{ kind: 'caller' }], 'null'))).toBe(
      'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.',
    );
    expect(exitReturnSummary(finishedRun(), exitDefinition([], '$count(outputs)'))).toBe(
      'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.',
    );
    const renamed = LoopDefinitionSchema.parse({
      ...exitDefinition([]),
      nodes: exitDefinition([]).nodes.map((node) =>
        node.kind === 'exit' ? { ...node, id: 'finish' } : node,
      ),
      edges: exitDefinition([]).edges.map((edge) =>
        edge.to.node === 'done' ? { ...edge, to: { ...edge.to, node: 'finish' } } : edge,
      ),
    });
    expect(exitReturnSummary(finishedRun(), renamed)).toBe(
      'No value was recorded for this run. The pinned definition has no exit node done, so the exit’s Returns setting cannot be shown.',
    );
  });

  it('explains a None return by configuration, naming the destinations that received nothing', () => {
    const configuration = 'This is the exit’s configuration, not a failure.';
    expect(exitReturnSummary(finishedRun(), exitDefinition([]))).toBe(
      `Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. ${configuration}`,
    );
    expect(
      exitReturnSummary(finishedRun(), exitDefinition([{ kind: 'caller' }, { kind: 'log' }])),
    ).toBe(
      `No value was returned: Returns is None, so no destination received anything (caller, log from the exit). ${configuration}`,
    );
    // The start request's extra destinations are skipped too; a duplicate is named once.
    expect(
      exitReturnSummary(finishedRun(), exitDefinition([{ kind: 'caller' }]), [
        { kind: 'caller' },
        { kind: 'webhook', url: 'https://example.test/hook' },
      ]),
    ).toBe(
      `No value was returned: Returns is None, so no destination received anything (caller from the exit; webhook from the start request). ${configuration}`,
    );
    expect(exitReturnSummary(finishedRun(), exitDefinition([]), [{ kind: 'log' }])).toBe(
      `No value was returned: Returns is None, so no destination received anything (log from the start request). ${configuration}`,
    );
  });
});

describe('initial thread and replay failures', () => {
  it('drops a stored log of the earlier version, which carries no recorded size (#259)', async () => {
    useRunEventStore.setState({ runs: {} });
    useRunEventStore.persist.clearStorage();
    const sized = event(R, 1, 'decision.made', { nodeId: 'd', ...expressionEvidence('good') });
    sessionStorage.setItem(
      'graphgoblin-run-events-v4',
      JSON.stringify({ state: { runs: { [R]: { events: [sized], lastSeq: 1 } } }, version: 0 }),
    );
    vi.resetModules();
    const { useRunEventStore: freshStore } = await import('./event-store.js');
    await freshStore.persist.rehydrate();
    expect(freshStore.getState().runs[R]).toBeUndefined();
    freshStore.getState().append(R, sized);
    expect(freshStore.getState().runs[R]?.bytes).toBe(JSON.stringify(sized).length * 2);
    expect(sessionStorage.getItem('graphgoblin-run-events-v4')).toContain('"version":2');
  });

  it('appends batches in order and drops a full session storage copy instead of throwing', () => {
    const { append } = useRunEventStore.getState();
    append('batch', ALL[0]!, ALL[1]!, ALL[1]!, ALL[2]!);
    expect(useRunEventStore.getState().runs['batch']?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    append('batch', ALL[0]!);
    expect(useRunEventStore.getState().runs['batch']?.lastSeq).toBe(3);
    // The recorded size counts each kept event once, as its JSON (#259).
    expect(useRunEventStore.getState().runs['batch']?.bytes).toBe(
      ALL.slice(0, 3).reduce((sum, e) => sum + JSON.stringify(e).length * 2, 0),
    );
    // A large history is kept in memory but left out of the stored copy, which other runs keep.
    const wide = event('wide', 1, 'node.finished', {
      nodeId: 'a',
      patch: [{ op: 'add', path: '/vars/wide', value: 'w'.repeat(MAX_HISTORY_BYTES) }],
      durationMs: 1,
    });
    append('wide', wide);
    expect(useRunEventStore.getState().runs['wide']?.bytes).toBeLessThan(MAX_HISTORY_BYTES);
    expect(useRunEventStore.getState().runs['wide']?.uncached).toEqual([
      {
        seq: 1,
        type: 'node.finished',
        uncached: true,
        description: 'a, 1 change, 1 ms',
        // The outline keeps the patch's shape for the row's description, never its values.
        outline: { ...wide, patch: [{ op: 'add', path: '/vars/wide' }] },
      },
    ]);
    const stored = JSON.parse(sessionStorage.getItem('graphgoblin-run-events-v4') ?? '{}') as {
      state: { runs: Record<string, unknown> };
    };
    expect(Object.keys(stored.state.runs)).toContain('batch');
    expect(Object.keys(stored.state.runs)).toContain('wide');

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    expect(() => quotaSafeSessionStorage.setItem('k', 'v')).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith('k');
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
