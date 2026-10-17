import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { V2DecisionConfigSchema, V2LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { minimalLoopV3 as minimalLoop } from './__fixtures__/upgrade-v3.js';
import {
  upgradeDefaultsV1,
  upgradeExportV1,
  upgradeLoopV1,
  validateUpgradeResolutions,
} from './upgrade.js';

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
const chosen = V2DecisionConfigSchema.parse({
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
      expect(
        node?.config.answer.type === 'choice' &&
          node.config.answer.options.map((option) => option.id),
      ).toEqual(['yes', 'no']);
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
  it.each(['/nodes/1/config/question', '/nodes/1/config/expression/jsonata'])(
    'rejects an owner source replacement superseded by a complete decision replacement: %s',
    (path) => {
      const original = oldLoop(['codex', 'expression']);
      const before = JSON.stringify(original);
      expect(
        upgradeLoopV1(original, {
          decisions: { decide: chosen },
          sources: { [path]: '"owner replacement"' },
        }),
      ).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'UPGRADE_RESOLUTION_INVALID',
            path,
            message: 'source replacement overlaps a complete decision replacement',
          },
        ],
      });
      expect(upgradeLoopV1(original, { decisions: { decide: chosen } }).ok).toBe(true);
      expect(JSON.stringify(original)).toBe(before);
    },
  );
  it('refuses opaque script stdin until an exact source resolution approves its reviewed consumer', () => {
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

describe('adversarial offline definition source boundaries', () => {
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
  it.each([
    {
      type: 'noul',
      true: { id: 'yes', label: 'Yes', criteria: 'Ready' },
      false: { id: 'no', label: 'No', criteria: 'Needs work' },
    },
    {
      type: 'score',
      anchors: ['Low', 'High'],
      bands: [{ id: 'yes', label: 'All', min: 0, max: 1 }],
    },
  ])('refuses reinterpretation of a v1 Choice as another primitive %j', (answer) => {
    const replacement = V2DecisionConfigSchema.parse({
      answer,
      evaluation: { kind: 'classifier', model: 'jev', question: 'Q' },
    });
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

describe('current v2 structural-upgrade passthrough', () => {
  it('preserves canonical authoring without applying old evaluator resolutions', () => {
    const current = V2LoopDefinitionSchema.parse({ ...minimalLoop(), schemaVersion: 2 });
    expect(upgradeLoopV1(current)).toEqual({ ok: true, value: current, notices: [] });
    expect(upgradeLoopV1(current, { sources: { '/nodes/0/config/filter': 'true' } })).toMatchObject(
      { ok: false, issues: [{ code: 'UPGRADE_RESOLUTION_INVALID' }] },
    );
    expect(upgradeLoopV1({ ...current, unknown: true })).toMatchObject({ ok: false });
  });
});
