import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DecisionConfigSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop, sampleThread, FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import {
  upgradeDefaultsV1,
  upgradeExportV1,
  upgradeLoopV1,
  validateUpgradeResolutions,
} from './upgrade.js';
import { upgradeDecisionFactV1, upgradeRunHistoryV1, upgradedFailure } from './upgrade-history.js';

function oldLoop(strategy: string[] = ['codex'], jsonata = '"yes"') {
  const base = minimalLoop();
  return {
    ...base,
    schemaVersion: 1,
    settings: {
      workingDirectory: { kind: 'temp' },
      defaults: { model: 'gpt-6-luna', effort: 'low' },
    },
    nodes: [
      base.nodes[0],
      {
        id: 'decide',
        kind: 'decision',
        label: 'Choose',
        config: {
          routes: [
            { label: 'yes', description: 'Approved' },
            { label: 'no', description: 'Rejected' },
          ],
          question: 'Choose',
          strategy,
          expression: { jsonata },
          codex: { model: 'gpt-6-luna', effort: 'high' },
          jev: { model: 'kev', minConfidence: 0.7 },
        },
      },
      base.nodes[1],
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'e2', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
      { id: 'e3', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
    ],
  };
}
const chosen = DecisionConfigSchema.parse({
  answer: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'Approved' },
      { id: 'no', label: 'No', criteria: 'Rejected' },
    ],
  },
  evaluation: { kind: 'expression', jsonata: '"yes"' },
});
const file = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
describe('offline v1 authoring conversion', () => {
  it.each(['codex', 'jev', 'expression'])(
    'converts a singleton %s without changing edge ids/waypoints',
    (kind) => {
      const original = oldLoop([kind]);
      const before = JSON.stringify(original);
      const result = upgradeLoopV1(original);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.value.schemaVersion).toBe(2);
      expect(result.value.edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e3']);
      expect(result.value.settings.defaults).toEqual({
        byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } },
      });
      const node = result.value.nodes.find((node) => node.kind === 'decision');
      expect(node?.config.answer.options.map((option) => option.id)).toEqual(['yes', 'no']);
      expect(JSON.stringify(original)).toBe(before);
    },
  );
  it.each(['topic', '1', 'null', '$string(topic)'])(
    'refuses unproven coercion %s until explicit replacement',
    (expression) => {
      expect(upgradeLoopV1(oldLoop(['expression'], expression))).toMatchObject({
        ok: false,
        issues: [{ code: 'UPGRADE_EXPRESSION_CHOICE_REQUIRED' }],
      });
      expect(
        upgradeLoopV1(oldLoop(['expression'], expression), { decisions: { decide: chosen } }).ok,
      ).toBe(true);
    },
  );
  it('proves string-valued branches, refuses mixed chains, requires declared result and authored criteria', () => {
    expect(upgradeLoopV1(oldLoop(['expression'], 'trigger.payload.ok ? "yes" : "no"')).ok).toBe(
      true,
    );
    expect(upgradeLoopV1(oldLoop(['expression'], '("yes")')).ok).toBe(true);
    expect(upgradeLoopV1(oldLoop(['expression'], '"other"')).ok).toBe(false);
    expect(upgradeLoopV1(oldLoop(['jev', 'codex']))).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_DECISION_CHOICE_REQUIRED' }],
    });
    expect(upgradeLoopV1(oldLoop(['jev', 'codex']), { decisions: { decide: chosen } }).ok).toBe(
      true,
    );
    const empty = oldLoop();
    empty.nodes[1]!.config = {
      ...empty.nodes[1]!.config,
      routes: [
        { label: 'yes', description: '' },
        { label: 'no', description: 'Rejected' },
      ],
    };
    expect(upgradeLoopV1(empty).ok).toBe(false);
  });
  it('parses templates/JSONata and refuses uncertain output access, dynamic lookup and invalid resolution keys', () => {
    for (const source of [
      '{{ lastOutput.value.route }}',
      '{{ outputs.decide.value }}',
      '{{ outputs }}',
      '{{ outputs[trigger.payload.id] }}',
    ]) {
      const old = oldLoop();
      old.nodes[1]!.config = { ...old.nodes[1]!.config, question: source };
      expect(upgradeLoopV1(old).ok).toBe(false);
      expect(upgradeLoopV1(old, { sources: { '/nodes/1/config/question': 'Choose' } }).ok).toBe(
        true,
      );
    }
    const invalid = oldLoop();
    invalid.nodes[1]!.config = { ...invalid.nodes[1]!.config, question: '{{' };
    expect(upgradeLoopV1(invalid).ok).toBe(false);
    expect(upgradeLoopV1(oldLoop(['expression'], '$lookup(vars,"x")')).ok).toBe(false);
    expect(
      upgradeLoopV1(oldLoop(), { sources: { '/unknown': 'x' }, decisions: { unknown: chosen } }).ok,
    ).toBe(false);
    const unchanged = oldLoop();
    unchanged.nodes[1]!.config = {
      ...unchanged.nodes[1]!.config,
      question: '{{ outputs.worker.value.finalText }} {{ lastOutput.nodeId }}',
    };
    expect(upgradeLoopV1(unchanged).ok).toBe(true);
  });
  it('refuses opaque script stdin until the exact version manifest approves its reviewed consumer', () => {
    const old = oldLoop();
    const withScript = {
      ...old,
      nodes: [
        ...old.nodes,
        {
          id: 'script',
          label: 'Script',
          kind: 'script',
          config: { command: 'echo ok', stdin: 'thread' },
        },
      ],
    };
    expect(upgradeLoopV1(withScript)).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_OPAQUE_CONSUMER_REVIEW_REQUIRED' }],
    });
    expect(
      upgradeLoopV1(withScript, {
        opaqueConsumers: {
          script: { reason: 'Reviewed command handles canonical Choice payload' },
        },
      }).ok,
    ).toBe(true);
    expect(
      upgradeLoopV1(old, { opaqueConsumers: { script: { reason: 'wrong version' } } }).ok,
    ).toBe(false);
  });
  it('uses real frozen AIDLC exports as refusal inputs, never selected-first fallbacks', () => {
    for (const name of ['codex-first', 'planning', 'implementation']) {
      const original = file('./upgrade-fixtures/' + name + '.v1.json');
      const result = upgradeExportV1(original);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(
          result.issues.some(
            (issue) =>
              issue.code.includes('CHOICE_REQUIRED') ||
              issue.code.includes('REFERENCE') ||
              issue.code.includes('OPAQUE'),
          ),
        ).toBe(true);
    }
    expect(upgradeExportV1(file('./upgrade-v1-fixture.json')).ok).toBe(false);
  });
  it('validates complete export envelopes and defaults, with no tolerant runtime path', () => {
    expect(
      upgradeExportV1({
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: FIXTURE_TS,
        loop: oldLoop(),
      }).ok,
    ).toBe(true);
    for (const input of [
      null,
      {},
      { ...oldLoop(), schemaVersion: 2 },
      { ...oldLoop(), unexpected: true },
    ])
      expect(upgradeLoopV1(input).ok).toBe(false);
    expect(
      upgradeExportV1({
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: 'bad',
        loop: oldLoop(),
      }).ok,
    ).toBe(false);
    expect(upgradeExportV1({}).ok).toBe(false);
    expect(upgradeDefaultsV1({}).ok).toBe(true);
    expect(upgradeDefaultsV1({ harness: 'codex' }).ok).toBe(false);
    expect(upgradeDefaultsV1({ effort: 'unknown' }).ok).toBe(false);
  });
});

const oldFact = { route: 'yes', strategy: 'codex', confidence: 0.8 };
const event = (seq: number, type: string, rest: Record<string, unknown>) => ({
  seq,
  type,
  runId: FIXTURE_IDS.run,
  ts: FIXTURE_TS,
  ...rest,
});
const output = { nodeId: 'decide', at: FIXTURE_TS, value: oldFact };
const oldEvents = [
  event(1, 'run.queued', { initialThread: sampleThread() }),
  event(2, 'node.started', { nodeId: 'decide', kind: 'decision', attempt: 1, configHash: 'x' }),
  event(3, 'decision.made', {
    nodeId: 'decide',
    ...oldFact,
    alternatives: [{ route: 'no', confidence: 0.2 }],
    skipped: [{ strategy: 'jev', code: 'PROVIDER_UNAVAILABLE', message: 'Not configured' }],
  }),
  event(4, 'node.finished', {
    nodeId: 'decide',
    route: 'yes',
    durationMs: 1,
    patch: [
      { op: 'add', path: '/outputs/decide', value: output },
      { op: 'add', path: '/lastOutput', value: output },
    ],
  }),
];
describe('offline historical conversion', () => {
  it('preserves diagnostic code/message/order and honest unknown provenance, never fabricates probabilities', () => {
    const result = upgradeRunHistoryV1({
      initialThread: sampleThread(),
      events: oldEvents,
      decisionNodeIds: ['decide'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const made = result.value.events.find((event) => event.type === 'decision.made');
    expect(made).toMatchObject({
      answer: { type: 'choice', optionId: 'yes', confidence: 0.8, probabilities: null },
      portId: 'yes',
      provenance: { kind: 'llm', provider: 'codex', model: null, effort: null },
      diagnostics: [
        {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Not configured',
          provenance: { kind: 'classifier', model: null },
        },
      ],
    });
    expect(result.value.finalThread.outputs.decide?.value).toEqual(upgradeDecisionFactV1(oldFact));
    const checkpoint = upgradeRunHistoryV1({
      initialThread: sampleThread(),
      events: oldEvents,
      decisionNodeIds: ['decide'],
      snapshot: result.value.finalThread,
      snapshotSeq: 4,
    });
    expect(checkpoint.ok).toBe(true); // Already canonical JSON values are preserved without reinterpretation.
    const oldSnapshot = {
      ...result.value.finalThread,
      outputs: { decide: output },
      lastOutput: output,
    };
    expect(
      upgradeRunHistoryV1({
        initialThread: sampleThread(),
        events: oldEvents,
        decisionNodeIds: ['decide'],
        snapshot: oldSnapshot,
        snapshotSeq: 4,
      }).ok,
    ).toBe(true);
  });
  it('refuses malformed events, invalid checkpoint/origin/order and partial legacy writes', () => {
    for (const events of [
      [{}],
      [...oldEvents, oldEvents[3]],
      [
        event(1, 'decision.made', {
          nodeId: 'decide',
          route: 'other',
          strategy: 'bad',
          skipped: [],
        }),
      ],
    ])
      expect(
        upgradeRunHistoryV1({ initialThread: sampleThread(), events, decisionNodeIds: ['decide'] })
          .ok,
      ).toBe(false);
    expect(
      upgradeRunHistoryV1({ initialThread: sampleThread(), events: oldEvents, decisionNodeIds: [] })
        .ok,
    ).toBe(false);
    expect(
      upgradeRunHistoryV1({
        initialThread: sampleThread(),
        events: oldEvents,
        decisionNodeIds: ['decide'],
        snapshot: sampleThread(),
        snapshotSeq: 4,
      }).ok,
    ).toBe(false);
    const partial = [
      ...oldEvents,
      event(5, 'node.started', { nodeId: 'decide', kind: 'decision', attempt: 2, configHash: 'x' }),
      event(6, 'node.finished', {
        nodeId: 'decide',
        durationMs: 0,
        patch: [{ op: 'replace', path: '/lastOutput/value/route', value: 'no' }],
      }),
    ];
    expect(
      upgradeRunHistoryV1({
        initialThread: sampleThread(),
        events: partial,
        decisionNodeIds: ['decide'],
      }).ok,
    ).toBe(false);
  });
  it('preserves existing failure details with an explicit approved replay disposition', () => {
    expect(
      upgradedFailure(
        { code: 'OLD', message: 'error', resumable: true, details: { known: 1 } },
        { approvedAt: FIXTURE_TS, reason: 'Decision semantics changed' },
      ),
    ).toMatchObject({
      code: 'OLD',
      message: 'error',
      resumable: false,
      details: {
        original: { known: 1 },
        upgrade: { version: 2, disposition: 'nonresumable-replay', approvedAt: FIXTURE_TS },
      },
    });
    expect(() => upgradedFailure(null, { approvedAt: FIXTURE_TS, reason: 'x' })).toThrow();
  });
});

describe('adversarial offline source and history boundaries', () => {
  it.each([
    '$',
    '$$',
    '$spread($)',
    '$lookup($,"outputs")',
    '($alias := $; $alias.outputs)',
    'outputs[vars.id].value',
    'outputs.*',
    '**',
    'function($v){$v}($)',
  ])('refuses indirect whole-thread JSONata %s', (source) => {
    const old = oldLoop();
    const last = old.nodes.at(-1)!;
    last.config = { return: { mapping: source } };
    const result = upgradeLoopV1(old);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.issues.some((issue) => issue.code === 'UPGRADE_REFERENCE_CHOICE_REQUIRED'),
      ).toBe(true);
  });
  it.each([
    '"outputs.decide.value.route"',
    '/* outputs.decide.value.route */ "literal"',
    'lastOutput.nodeId',
    'outputs.worker.value.text',
    '$uppercase(trigger.payload.name)',
  ])('does not mistake literal/comment/safe access for old output %s', (source) => {
    const old = oldLoop();
    old.nodes.at(-1)!.config = { return: { mapping: source } };
    expect(upgradeLoopV1(old).ok).toBe(true);
  });
  it.each([
    '{{ this }}',
    '{{ thread }}',
    '{% assign alias = outputs %}{{ alias }}',
    '{{ outputs[vars.id].value }}',
    '{% if outputs %}x{% endif %}',
  ])('refuses whole-value Liquid %s', (question) => {
    const old = oldLoop();
    old.nodes[1]!.config = { ...old.nodes[1]!.config, question };
    expect(upgradeLoopV1(old).ok).toBe(false);
  });
  it('refuses a decision replacement that would disconnect preserved edge ports', () => {
    const replacement = {
      ...chosen,
      answer: {
        type: 'choice' as const,
        options: [
          { id: 'ready', label: 'Ready', criteria: 'Ready' },
          { id: 'revise', label: 'Revise', criteria: 'Revise' },
        ],
      },
      evaluation: { kind: 'expression' as const, jsonata: '"ready"' },
    };
    expect(
      upgradeLoopV1(oldLoop(['codex', 'expression']), { decisions: { decide: replacement } }),
    ).toMatchObject({ ok: false, issues: [{ code: 'UPGRADE_RESOLUTION_INVALID' }] });
  });
  it('validates unknown/untyped resolution JSON defensively', () => {
    for (const raw of [
      null,
      [],
      { extra: 1 },
      { sources: [] },
      { sources: { '/nodes/1/config/question': 1 } },
      { decisions: { decide: { bad: true } } },
      { opaqueConsumers: { script: { reason: '' } } },
      { opaqueConsumers: { script: { reason: 'review', extra: true } } },
    ])
      expect(validateUpgradeResolutions(raw)).toEqual([
        expect.objectContaining({ code: 'UPGRADE_RESOLUTION_INVALID' }),
      ]);
    expect(
      validateUpgradeResolutions({ opaqueConsumers: { script: { reason: 'Reviewed' } } }),
    ).toEqual([]);
  });
  it('does not reinterpret arbitrary user JSON resembling an output or reject unrelated confidence writes', () => {
    const initial = sampleThread();
    const note = {
      nodeId: 'decide',
      value: { route: 'yes', strategy: 'expression', confidence: null },
    };
    initial.vars.note = note;
    initial.invocation.trigger.payload = { note };
    initial.messages = [
      {
        id: 'message',
        role: 'user',
        content: JSON.stringify(note),
        nodeId: 'start',
        ts: FIXTURE_TS,
      },
    ];
    initial.lastOutput = { nodeId: 'worker', value: { confidence: 0.1 }, at: FIXTURE_TS };
    const events = [
      event(1, 'node.started', {
        nodeId: 'worker',
        kind: 'inference',
        attempt: 1,
        configHash: 'x',
      }),
      event(2, 'node.finished', {
        nodeId: 'worker',
        durationMs: 0,
        patch: [
          { op: 'replace', path: '/lastOutput/value/confidence', value: 0.2 },
          { op: 'add', path: '/vars/second', value: note },
        ],
      }),
    ];
    const result = upgradeRunHistoryV1({
      initialThread: initial,
      events,
      decisionNodeIds: ['decide'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.initialThread.vars.note).toEqual(note);
    expect(result.value.initialThread.invocation.trigger.payload).toEqual({ note });
    expect(result.value.finalThread.vars.second).toEqual(note);
    expect(result.value.finalThread.lastOutput?.value).toEqual({ confidence: 0.2 });
  });
  it('preserves factual DECISION_NO_ROUTE and refuses missing checkpoint proof', () => {
    const failure = {
      code: 'DECISION_NO_ROUTE',
      message: 'No strategy produced a route',
      resumable: true,
    };
    const result = upgradeRunHistoryV1({
      initialThread: sampleThread(),
      events: [event(1, 'run.failed', { failure })],
      decisionNodeIds: ['decide'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.events[0]).toMatchObject({ failure });
    expect(
      upgradedFailure(failure, { approvedAt: FIXTURE_TS, reason: 'Owner approves replay' }),
    ).toMatchObject({ ...failure, resumable: false });
    for (const snapshotSeq of [undefined, -1, 5]) {
      expect(
        upgradeRunHistoryV1({
          initialThread: sampleThread(),
          events: oldEvents,
          decisionNodeIds: ['decide'],
          snapshot: { ...sampleThread(), vars: { unknown: 'cache' } },
          ...(snapshotSeq !== undefined ? { snapshotSeq } : {}),
        }).ok,
      ).toBe(false);
    }
  });
});
describe('opaque subloop result references at offline cutover', () => {
  const parent = (source: string) => {
    const old = oldLoop();
    return {
      ...old,
      nodes: [
        old.nodes[0],
        {
          id: 'child',
          kind: 'subloop',
          label: 'Child',
          config: {
            loopRef: { loopId: FIXTURE_IDS.loop },
            output: { resultTo: { lastOutput: true, var: 'childResult' } },
          },
        },
        { ...old.nodes[2], config: { return: { mapping: source } } },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'child' } },
        { id: 'b', from: { node: 'child', port: 'out' }, to: { node: 'done' } },
      ],
    };
  };
  it.each([
    'outputs.child.value.result.route',
    'outputs.child.value',
    'vars.childResult.route',
    'lastOutput.value.result',
    'child.outputs.decide.value.route',
    'result.route',
  ])('requires explicit source approval for possible changed child result %s', (source) => {
    const original = parent(source);
    expect(upgradeLoopV1(original)).toMatchObject({
      ok: false,
      issues: [{ code: 'UPGRADE_REFERENCE_CHOICE_REQUIRED' }],
    });
    expect(
      upgradeLoopV1(original, {
        sources: { '/nodes/2/config/return/mapping': '"Owner reviewed result"' },
      }).ok,
    ).toBe(true);
  });
  it.each([
    'outputs.child.value.status',
    'outputs.child.value.outcome',
    'outputs.child.value.childRunId',
    'lastOutput.value.status',
    'parent.vars.task',
  ])('proves unchanged subloop metadata %s', (source) => {
    expect(upgradeLoopV1(parent(source)).ok).toBe(true);
  });
});
