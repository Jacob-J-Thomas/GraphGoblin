import { describe, expect, it } from 'vitest';
import jsonata from 'jsonata';
import { LoopDefinitionSchema, RunEventSchema, type NoulSpec } from '@graphgoblin/contracts';
import { minimalLoop, sampleThread, FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  upgradeLoopCurrent,
  upgradeExportCurrent,
  validateUpgradeCurrentResolutions,
  provenBooleanExpression,
} from './upgrade-current.js';
import { upgradeRunHistoryCurrent } from './upgrade-history-current.js';
import { upgradeLoopV1 } from './upgrade.js';

const sides: NoulSpec = {
  type: 'noul',
  true: { label: 'Done', criteria: 'All required work is complete' },
  false: { label: 'Pending', criteria: 'Required work remains' },
};
const path = '/nodes/1/config/criteria/0';
const old = (criteria: unknown[] = []) => ({
  ...minimalLoop(),
  schemaVersion: 2,
  nodes: [
    minimalLoop().nodes[0],
    {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: {
        criteria,
        default: 'loop-back',
        loopBack: { targetNodeId: 'start' },
        return: { mapping: 'vars.result', channels: [{ kind: 'caller' }] },
      },
    },
  ],
  edges: [
    {
      id: 'e1',
      from: { node: 'start', port: 'out' },
      to: { node: 'done', port: 'in' },
      ui: { route: [12, -20, 30] },
    },
  ],
});
const predicate = (strategy: string, extra: Record<string, unknown> = {}) => ({
  when: 'predicate',
  strategy,
  outcome: 'success',
  ...(strategy === 'expression' ? { jsonata: 'true' } : { question: 'Is {{ vars.task }} done?' }),
  ...extra,
});

describe('one current offline definition cutover', () => {
  it('preserves v2 structure/defaults and converts provably boolean expressions without invented criteria', () => {
    const source = old([
      predicate('expression'),
      { when: 'max-iterations', value: 5 },
      { when: 'last-output-matches', jsonSchema: { type: 'object' } },
    ]);
    const frozen = upgradeLoopV1(source);
    expect(frozen.ok).toBe(true);
    const result = upgradeLoopCurrent(source);
    expect(result.ok).toBe(true);
    if (!result.ok || !frozen.ok) throw new Error('conversion failed');
    expect(result.value.schemaVersion).toBe(3);
    expect(result.value.settings).toEqual(frozen.value.settings);
    expect(result.value.edges).toEqual(frozen.value.edges);
    const exit = result.value.nodes[1];
    if (exit?.kind !== 'exit') throw new Error('exit missing');
    expect(exit.config.criteria[0]).toEqual({
      when: 'predicate',
      answer: { type: 'noul' },
      evaluation: { kind: 'expression', jsonata: 'true' },
      match: { type: 'noul', value: true },
      outcome: 'success',
    });
    expect(exit.config.return).toEqual({ mapping: 'vars.result', channels: [{ kind: 'caller' }] });
    expect(exit.config.loopBack).toEqual({ targetNodeId: 'start' });
    expect(source.schemaVersion).toBe(2);
    expect(source.nodes[1]?.config).toHaveProperty('criteria.0.strategy', 'expression');
  });
  it.each(['jev', 'codex'])(
    'requires authored sides for every old %s predicate and preserves its confidence policy',
    (strategy) => {
      const source = old([predicate(strategy, { minConfidence: 0.8 })]);
      const refused = upgradeLoopCurrent(source);
      expect(refused).toMatchObject({
        ok: false,
        issues: [{ code: 'UPGRADE_EXIT_CRITERIA_REQUIRED', path }],
      });
      const result = upgradeLoopCurrent(source, { predicates: { [path]: { answer: sides } } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('conversion failed');
      const exit = result.value.nodes[1];
      if (exit?.kind !== 'exit') throw new Error('exit missing');
      const converted = exit.config.criteria[0];
      expect(converted).toMatchObject({
        answer: sides,
        outcome: 'success',
        match: { type: 'noul', value: true },
      });
      expect(converted).toHaveProperty('evaluation.question', 'Is {{ vars.task }} done?');
      if (strategy === 'jev') expect(converted).toHaveProperty('evaluation.minConfidence', 0.8);
      else expect(converted).toHaveProperty('match.minReportedConfidence', 0.8);
      expect(JSON.stringify(result.value)).not.toContain('context');
    },
  );
  it('converts provider criteria without a gate and refuses irrelevant or incomplete resolutions atomically', () => {
    const source = old([predicate('jev'), predicate('codex')]);
    const p2 = '/nodes/1/config/criteria/1';
    expect(upgradeLoopCurrent(source, { predicates: { [path]: { answer: sides } } }).ok).toBe(
      false,
    );
    const result = upgradeLoopCurrent(source, {
      predicates: { [path]: { answer: sides }, [p2]: { answer: sides } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('conversion failed');
    expect(JSON.stringify(result.value)).not.toContain('minConfidence');
    expect(JSON.stringify(result.value)).not.toContain('minReportedConfidence');
    expect(
      upgradeLoopCurrent(source, {
        predicates: { [path]: { answer: sides, jsonata: 'true' }, [p2]: { answer: sides } },
      }).ok,
    ).toBe(false);
    expect(upgradeLoopCurrent(old(), { predicates: { [path]: { answer: sides } } })).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_RESOLUTION_INVALID' }],
    });
    expect(
      upgradeLoopCurrent(old([predicate('expression')]), {
        predicates: { [path]: { answer: sides } },
      }).ok,
    ).toBe(false);
  });
  it('requires a reviewed provably boolean rewrite for coercing expressions', () => {
    const source = old([predicate('expression', { jsonata: 'vars.done' })]);
    expect(upgradeLoopCurrent(source)).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_EXIT_BOOLEAN_REQUIRED' }],
    });
    expect(
      upgradeLoopCurrent(source, { predicates: { [path]: { jsonata: 'vars.done = true' } } }).ok,
    ).toBe(true);
    expect(upgradeLoopCurrent(source, { predicates: { [path]: { jsonata: '1' } } }).ok).toBe(false);
    for (const good of [
      'true',
      'false',
      '(vars.count > 0) = true',
      'true and false',
      'vars.a ? true : false',
      '($x := 1; $x = 1)',
    ])
      expect(provenBooleanExpression(good), good).toBe(true);
    for (const bad of [
      'vars.a',
      'vars.count > 0',
      '1',
      '"yes"',
      '[true]',
      'vars.a ? true : 1',
      '($x := 1; $x)',
      '(',
      '',
    ])
      expect(provenBooleanExpression(bad), bad).toBe(false);
  });
  it.each([
    { source: 'true[false]', expected: undefined },
    { source: '(vars.count > 0)[false]', expected: undefined },
    { source: 'true{"x": true}', expected: { x: true } },
    { source: 'vars.a ? true[false] : false', expected: undefined },
    { source: '($x := 1; true{"x": true})', expected: { x: true } },
  ])(
    'requires an explicit rewrite for output-modified boolean AST: $source',
    async ({ source, expected }) => {
      expect(await jsonata(source).evaluate({ vars: { count: 1, a: true } })).toEqual(expected);
      expect(provenBooleanExpression(source)).toBe(false);
      const input = old([predicate('expression', { jsonata: source })]);
      const original = structuredClone(input);
      const envelope = {
        format: 'graphgoblin-loop',
        formatVersion: 2,
        exportedAt: FIXTURE_TS,
        loop: input,
      };
      expect(upgradeLoopCurrent(input)).toMatchObject({
        ok: false,
        issues: [{ code: 'UPGRADE_EXIT_BOOLEAN_REQUIRED' }],
      });
      expect(upgradeExportCurrent(envelope)).toMatchObject({
        ok: false,
        issues: [{ code: 'UPGRADE_EXIT_BOOLEAN_REQUIRED' }],
      });
      expect(input).toEqual(original);
      const result = upgradeExportCurrent(envelope, {
        predicates: { [path]: { jsonata: 'vars.a = true' } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('explicit rewrite failed');
      expect(result.value.loop.nodes[1]).toHaveProperty(
        'config.criteria.0.evaluation.jsonata',
        'vars.a = true',
      );
      expect(result.value.loop.edges).toEqual(input.edges);
      expect(input).toEqual(original);
    },
  );
  it.each([
    'missing > 2',
    '1 > missing',
    'missing <= 1',
    'missing < 1',
    'missing >= 1',
    'vars.count > 0',
  ])(
    'requires a strict boolean rewrite when a relational operand is missing: %s',
    async (source) => {
      expect(await jsonata(source).evaluate({})).toBeUndefined();
      expect(provenBooleanExpression(source)).toBe(false);
      const input = old([predicate('expression', { jsonata: source })]);
      expect(upgradeLoopCurrent(input)).toMatchObject({
        ok: false,
        issues: [{ code: 'UPGRADE_EXIT_BOOLEAN_REQUIRED' }],
      });
      expect(
        upgradeLoopCurrent(input, { predicates: { [path]: { jsonata: source } } }),
      ).toMatchObject({ ok: false, issues: [{ code: 'UPGRADE_EXIT_BOOLEAN_REQUIRED' }] });
      const rewrite = `(${source}) = true`;
      expect(await jsonata(rewrite).evaluate({})).toBe(false);
      const result = upgradeLoopCurrent(input, { predicates: { [path]: { jsonata: rewrite } } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('strict boolean rewrite failed');
      expect(result.value.nodes[1]).toHaveProperty('config.criteria.0.evaluation.jsonata', rewrite);
    },
  );
  it('conservatively refuses array modifiers even when this scalar evaluates to a boolean', async () => {
    expect(await jsonata('true[]').evaluate({})).toBe(true);
    expect(provenBooleanExpression('true[]')).toBe(false);
  });
  it('composes actual v1 conversion, preserves additive decisions, and validates current input', () => {
    const source = { ...minimalLoop(), schemaVersion: 1 };
    expect(upgradeLoopV1(source).ok).toBe(true);
    const upgraded = upgradeLoopCurrent(source);
    expect(upgraded.ok).toBe(true);
    const decisions = [
      {
        answer: {
          ...sides,
          true: { ...sides.true, id: 'yes' },
          false: { ...sides.false, id: 'no' },
        },
        evaluation: { kind: 'classifier', model: 'jev', question: 'Q' },
      },
      {
        answer: {
          type: 'score',
          anchors: ['None', 'Complete'],
          bands: [{ id: 'all', label: 'All', min: 0, max: 1 }],
        },
        evaluation: { kind: 'classifier', model: 'jev', question: 'Q' },
      },
    ];
    for (const config of decisions) {
      const value = {
        ...old(),
        nodes: [...old().nodes, { id: 'decision', kind: 'decision', label: 'Decision', config }],
      };
      const frozen = upgradeLoopV1(value),
        current = upgradeLoopCurrent(value);
      expect(current.ok && frozen.ok && current.value.nodes[2]).toEqual(
        frozen.ok && frozen.value.nodes[2],
      );
    }
    const current = LoopDefinitionSchema.parse(minimalLoop());
    expect(upgradeLoopCurrent(current)).toEqual({ ok: true, value: current, notices: [] });
    expect(upgradeLoopCurrent(current, { predicates: { [path]: { answer: sides } } }).ok).toBe(
      false,
    );
    expect(upgradeLoopCurrent({ ...current, unknown: true })).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_V3_INVALID' }],
    });
    const invalid = structuredClone(current);
    invalid.nodes.push({
      id: 'predicate',
      kind: 'exit',
      label: 'Predicate',
      ui: { x: 0, y: 0 },
      config: {
        criteria: [
          {
            when: 'predicate',
            answer: { type: 'noul' },
            evaluation: { kind: 'expression', jsonata: '(' },
            match: { type: 'noul', value: true },
            outcome: 'success',
          },
        ],
        default: 'success',
        return: { mapping: 'none', channels: [{ kind: 'caller' }] },
      },
    });
    expect(upgradeLoopCurrent(invalid)).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_SOURCE_INVALID' }],
    });
    expect(upgradeLoopCurrent(null).ok).toBe(false);
  });
  it('validates exact resolution maps and export envelopes', () => {
    for (const invalid of [
      null,
      [],
      { unknown: {} },
      { predicates: [] },
      { predicates: { bad: { answer: sides } } },
      { predicates: { [path]: {} } },
      { predicates: { [path]: { extra: true } } },
      { predicates: { [path]: { answer: { type: 'noul' } } } },
      { predicates: { [path]: { jsonata: '' } } },
      { predicates: { [path]: { jsonata: 1 } } },
    ])
      expect(validateUpgradeCurrentResolutions(invalid).length).toBeGreaterThan(0);
    expect(validateUpgradeCurrentResolutions({})).toEqual([]);
    expect(
      validateUpgradeCurrentResolutions({ predicates: { [path]: { answer: sides } } }),
    ).toEqual([]);
    const envelope = {
      format: 'graphgoblin-loop',
      formatVersion: 2,
      exportedAt: FIXTURE_TS,
      loop: old([predicate('expression')]),
    };
    expect(upgradeExportCurrent(envelope)).toMatchObject({
      ok: true,
      value: { formatVersion: 3, loop: { schemaVersion: 3 } },
    });
    for (const invalid of [
      null,
      { ...envelope, extra: 1 },
      { ...envelope, format: 'other' },
      { ...envelope, formatVersion: 4 },
      { ...envelope, loop: null },
      { ...envelope, formatVersion: 1 },
      { ...envelope, exportedAt: 'invalid' },
      { ...envelope, loop: old([predicate('jev')]) },
    ])
      expect(upgradeExportCurrent(invalid).ok).toBe(false);
  });
});

describe('canonical factual exit history', () => {
  const initialThread = sampleThread();
  const event = {
    runId: FIXTURE_IDS.run,
    seq: 1,
    ts: FIXTURE_TS,
    type: 'exit.evaluated',
    nodeId: 'done',
    iteration: 1,
    maxIterations: 10,
    result: {
      kind: 'completed',
      outcome: 'success',
      reason: 'criterion-matched',
      criterionIndex: 1,
    },
    criteria: [
      {
        index: 0,
        strategy: 'jev',
        status: 'not-matched',
        holds: false,
        confidence: 0.6,
        minConfidence: 0.8,
        classifierModel: 'jev',
      },
      {
        index: 1,
        strategy: 'codex',
        status: 'matched',
        holds: true,
        confidence: 0.9,
        model: 'actual-model',
        reasoning: 'Recorded excerpt',
        minConfidence: 0.8,
      },
      { index: 2, strategy: 'expression', status: 'not-matched' },
      { index: 3, strategy: 'max-duration', status: 'not-matched' },
      {
        index: 4,
        strategy: 'jev',
        status: 'skipped',
        reason: { code: 'EARLIER_CRITERION_MATCHED', message: 'Earlier match' },
      },
      {
        index: 5,
        strategy: 'codex',
        status: 'error',
        diagnostic: { code: 'DECIDER_UNAVAILABLE', message: 'Unavailable' },
      },
    ],
  };
  it('retains known facts, unknown facts and checkpoint parity without fabricating probabilities or acceptance', () => {
    const result = upgradeRunHistoryCurrent({
      initialThread,
      events: [event],
      decisionNodeIds: [],
      snapshot: initialThread,
      snapshotSeq: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('history failed');
    const converted = result.value.events[0];
    if (converted?.type !== 'exit.evaluated') throw new Error('event missing');
    expect(converted.criteria[0]).toMatchObject({
      strategy: 'classifier',
      answer: {
        type: 'noul',
        kind: 'classifier',
        holds: false,
        confidence: 0.6,
        trueProbability: null,
      },
      acceptance: null,
      configuredMinConfidence: 0.8,
    });
    expect(converted.criteria[1]).toMatchObject({
      strategy: 'llm',
      answer: { holds: true, confidence: 0.9, reasoning: 'Recorded excerpt' },
      provenance: { model: 'actual-model', effort: null },
      acceptance: null,
      match: { minReportedConfidence: 0.8 },
    });
    expect(converted.criteria[2]).toHaveProperty('answer.holds', null);
    expect(converted.criteria[3]).toHaveProperty('holds', null);
    expect(converted.criteria[4]).toMatchObject({ strategy: 'classifier', status: 'skipped' });
    expect(converted.criteria[5]).toMatchObject({ strategy: 'llm', status: 'error' });
    expect(result.value.finalThread).toEqual(initialThread);
    expect(result.value.snapshot).toEqual(initialThread);
    expect(RunEventSchema.safeParse(converted).success).toBe(true);
    expect(event.criteria[0]).not.toHaveProperty('answer');
  });
  it.each([
    {
      strategy: 'jev',
      classifierModel: 'jev',
      model: 'recorded-classifier-model',
      expected: {
        kind: 'classifier',
        provider: null,
        classifierId: 'jev',
        model: 'recorded-classifier-model',
        effort: null,
      },
    },
    {
      strategy: 'codex',
      model: 'actual-model',
      expected: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'actual-model',
        effort: null,
      },
    },
    {
      strategy: 'jev',
      expected: {
        kind: 'classifier',
        provider: null,
        classifierId: null,
        model: null,
        effort: null,
      },
    },
    {
      strategy: 'codex',
      expected: { kind: 'llm', provider: 'codex', classifierId: null, model: null, effort: null },
    },
  ])(
    'retains known and unknown $strategy identity on historical errors',
    ({ expected, ...facts }) => {
      const diagnostic = { code: 'DECIDER_UNAVAILABLE', message: 'Recorded error' };
      const oldError = { index: 0, status: 'error', diagnostic, ...facts };
      const input = { ...event, criteria: [oldError] };
      const result = upgradeRunHistoryCurrent({
        initialThread,
        events: [input],
        decisionNodeIds: [],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('historical error conversion failed');
      expect(result.value.events[0]).toHaveProperty('criteria.0', {
        index: 0,
        strategy: expected.kind,
        status: 'error',
        diagnostic,
        provenance: expected,
      });
      expect(RunEventSchema.safeParse(result.value.events[0]).success).toBe(true);
      expect(oldError).not.toHaveProperty('provenance');
    },
  );
  it('adds only predicate provenance to expression errors and leaves ordinary limit errors factual', () => {
    const diagnostic = { code: 'CRITERION_ERROR', message: 'Recorded error' };
    const input = {
      ...event,
      criteria: [
        { index: 0, strategy: 'expression', status: 'error', diagnostic },
        { index: 1, strategy: 'max-duration', status: 'error', diagnostic },
      ],
    };
    const result = upgradeRunHistoryCurrent({
      initialThread,
      events: [input],
      decisionNodeIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('historical error conversion failed');
    expect(result.value.events[0]).toHaveProperty('criteria.0.provenance', {
      kind: 'expression',
      provider: null,
      classifierId: null,
      model: null,
      effort: null,
    });
    expect(result.value.events[0]).not.toHaveProperty('criteria.1.provenance');
  });
  it('converts missing LLM facts to null and preserves unchanged events without a snapshot', () => {
    const sparse = { ...event, criteria: [{ index: 0, strategy: 'codex', status: 'not-matched' }] };
    const result = upgradeRunHistoryCurrent({
      initialThread,
      events: [sparse, { runId: FIXTURE_IDS.run, seq: 2, ts: FIXTURE_TS, type: 'run.cancelled' }],
      decisionNodeIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('history failed');
    expect(result.value.events[0]).toHaveProperty('criteria.0.answer', {
      type: 'noul',
      kind: 'llm',
      holds: null,
      confidence: null,
      reasoning: null,
    });
    expect(result.value.events[1]?.type).toBe('run.cancelled');
    expect(result.value).not.toHaveProperty('snapshot');
    expect(
      upgradeRunHistoryCurrent({
        initialThread,
        events: [{ ...event, criteria: [{ index: 0, strategy: 'unknown', status: 'matched' }] }],
        decisionNodeIds: [],
      }).ok,
    ).toBe(false);
  });
  it('validates already-current history explicitly, including canonical unknowns, ordered events and exact snapshots', () => {
    const first = upgradeRunHistoryCurrent({ initialThread, events: [event], decisionNodeIds: [] });
    if (!first.ok) throw new Error('fixture conversion failed');
    const input = {
      sourceVersion: 3 as const,
      initialThread,
      events: first.value.events,
      decisionNodeIds: [],
    };
    expect(upgradeRunHistoryCurrent(input)).toEqual(first);
    expect(
      upgradeRunHistoryCurrent({ ...input, snapshot: initialThread, snapshotSeq: 0 }),
    ).toMatchObject({ ok: true });
    expect(upgradeRunHistoryCurrent({ ...input, snapshot: initialThread })).toMatchObject({
      ok: true,
    });
    const changed = { ...initialThread, vars: { other: 'changed' } };
    for (const invalid of [
      { ...input, events: [...input.events, ...input.events] },
      { ...input, events: [event] },
      { ...input, initialThread: null },
      { ...input, snapshot: changed },
      { ...input, snapshot: initialThread, snapshotSeq: -1 },
      { ...input, snapshot: initialThread, snapshotSeq: 4 },
      { ...input, snapshot: changed, snapshotSeq: 1 },
    ])
      expect(upgradeRunHistoryCurrent(invalid).ok).toBe(false);
  });
});
