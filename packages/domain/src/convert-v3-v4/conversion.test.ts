import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  V3LoopDefinitionSchema,
  V3NodeConfigSchemas,
  type V3LoopDefinition,
  type V3LoopDefinitionInput,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import { validateLoop } from '../graph.js';
import { evaluateExpression } from '../expression.js';
import { renderTemplate } from '../template.js';
import {
  convertDefinitionV3ToV4,
  booleanRouteExpression,
  definitionReviewHash,
  type DefinitionConversionResult,
  type DefinitionResolutions,
} from './index.js';
import { consumerNeedsReview, rewriteLastOutput, proposeAnswerConsumer } from './consumers.js';

const choice = {
  type: 'choice',
  options: [
    { id: 'yes', label: 'Yes', criteria: 'Ready' },
    { id: 'no', label: 'No', criteria: 'Needs work' },
  ],
};
const noul = {
  type: 'noul',
  true: { id: 'yes', label: 'Yes', criteria: 'Ready' },
  false: { id: 'no', label: 'No', criteria: 'Needs work' },
};
const score = {
  type: 'score',
  anchors: ['Bad', 'Good'],
  bands: [{ id: 'yes', label: 'Yes', min: 0, max: 1 }],
};
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Is {{ trigger.payload }} ready?',
};
const classifier = { kind: 'classifier', model: 'jev', question: 'Ready?', minConfidence: 0.7 };
function loop(exit: unknown = {}, decision?: unknown): V3LoopDefinition {
  const raw: V3LoopDefinitionInput = {
    schemaVersion: 3,
    name: 'Conversion fixture',
    settings: { maxIterations: 5 },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      { id: 'work', kind: 'wait', label: 'Work', config: { mode: 'duration', seconds: 1 } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'work-done', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const data = structuredClone(raw) as unknown as Record<string, unknown>;
  const nodes = data.nodes as Record<string, unknown>[];
  nodes[2]!.config = exit;
  if (decision) {
    nodes[1] = { id: 'work', kind: 'decision', label: 'Work', config: decision };
    data.edges = [
      { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      ...((decision as { answer: { type: string } }).answer.type === 'score'
        ? ['yes']
        : ['yes', 'no']
      ).map((port) => ({ id: 'work-' + port, from: { node: 'work', port }, to: { node: 'done' } })),
    ];
  }
  return V3LoopDefinitionSchema.parse(data);
}
function candidate(result: DefinitionConversionResult) {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(LoopDefinitionSchema.safeParse(result.value).success).toBe(true);
  expect(validateLoop(result.value)).toEqual([]);
  return result;
}
function approvals(result: DefinitionConversionResult): DefinitionResolutions {
  return Object.fromEntries(
    result.reviewItems
      .filter((item) => item.status === 'pending')
      .map((item) => [
        item.id,
        {
          hash: item.hash,
          action: 'approve',
          reason: 'Owner reviewed this exact candidate and producer evidence.',
        },
      ]),
  );
}
const back = {
  default: 'loop-back',
  loopBack: { targetNodeId: 'work' },
  return: { mapping: 'lastOutput.value' },
};
function predicate(
  evaluation: unknown,
  answer: unknown = { type: 'noul' },
  match: unknown = { type: 'noul', value: true },
) {
  return { when: 'predicate', evaluation, answer, match, outcome: 'success' };
}

describe('definition conversion golden rules', () => {
  it.each([
    {
      name: 'manual',
      config: {
        subtype: 'manual',
        inputSchema: { type: 'object', required: ['topic'] },
        exposeTo: ['api', 'mcp'],
      },
    },
    {
      name: 'cron',
      config: {
        subtype: 'cron',
        expression: '15 4 * * 1',
        timezone: 'America/Chicago',
        missedFirePolicy: 'run-each',
        enabled: false,
      },
    },
    {
      name: 'event',
      config: {
        subtype: 'event',
        eventType: 'build-done',
        dedupeKey: 'id',
      },
    },
    {
      name: 'poll',
      config: {
        subtype: 'poll',
        intervalSeconds: 30,
        probe: {
          kind: 'http',
          method: 'POST',
          url: 'https://example.test/status',
          headers: { accept: 'application/json' },
          body: '{"since":"{{ vars.since }}"}',
          timeoutSeconds: 12,
        },
        fireWhen: 'probe.status = 200',
        dedupeKey: 'probe.body.id',
        enabled: false,
      },
    },
    {
      name: 'items poll',
      config: {
        subtype: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'script', command: 'probe', args: ['--json'], timeoutSeconds: 30 },
        fireWhen: 'true',
        items: { select: 'probe.json', dedupeKey: 'item.id', maxRunsPerPoll: 3 },
        enabled: true,
      },
    },
    {
      name: 'timestamp webhook',
      config: {
        subtype: 'webhook',
        signature: {
          scheme: 'hmac-sha256',
          header: 'x-timestamp-signature',
          secretRef: 'timestamp-key',
        },
        replayWindowSeconds: 120,
        dedupeKey: '$headers."x-delivery"',
      },
    },
    {
      name: 'body webhook',
      config: {
        subtype: 'webhook',
        signature: {
          scheme: 'hmac-sha256-body',
          header: 'x-body-signature',
          secretRef: 'body-key',
        },
        dedupeKey: '$headers."x-delivery"',
      },
    },
  ])(
    'converts $name with current configuration and explicit decoding review',
    async ({ config }) => {
      const source = loop();
      const start = source.nodes[0]!;
      if (start.kind !== 'trigger') throw new Error('missing trigger');
      start.config = V3NodeConfigSchemas.trigger.parse(config);
      const before = structuredClone(source);
      const { subtype, ...fields } = start.config;
      const result = candidate(await convertDefinitionV3ToV4(source));
      if (start.config.subtype === 'webhook') {
        const signature = start.config.signature;
        expect(result.value.nodes[0]?.config).toEqual({
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: signature.scheme === 'hmac-sha256' ? 'timestamp-body' : 'body',
            header: signature.header.toLowerCase(),
            secretRef: signature.secretRef,
            ...('replayWindowSeconds' in start.config
              ? { windowSeconds: start.config.replayWindowSeconds }
              : {}),
          },
          body: { type: 'json' },
          eventType: { source: 'constant', value: 'webhook' },
          dedupeKey: start.config.dedupeKey,
        });
        expect(result.ready).toBe(false);
        expect(result.reviewItems.filter((item) => item.nodeId === start.id)).toEqual([
          expect.objectContaining({
            id: '/nodes/0/config:webhook-json-decoding',
            kind: 'webhook-json-decoding',
            status: 'pending',
          }),
        ]);
        const approved = candidate(await convertDefinitionV3ToV4(source, approvals(result)));
        expect(approved.ready).toBe(true);
        expect(approved.value).toEqual(result.value);
      } else {
        expect(result.ready).toBe(true);
        expect(result.value.nodes[0]).toEqual({ ...start, config: { type: subtype, ...fields } });
        expect(result.reviewItems.filter((item) => item.nodeId === start.id)).toEqual([]);
      }
      expect(JSON.stringify(result.value)).not.toMatch(/"subtype"\s*:/);
      expect(source).toEqual(before);
    },
  );

  it('analyses trigger expressions against V3 before emitting the current config', async () => {
    const source = loop({ ...back, criteria: [{ when: 'max-iterations', value: 3 }] });
    const start = source.nodes[0]!;
    if (start.kind !== 'trigger') throw new Error('missing trigger');
    start.config = V3NodeConfigSchemas.trigger.parse({
      subtype: 'poll',
      intervalSeconds: 30,
      probe: { kind: 'none' },
      fireWhen: 'run.iteration > 2',
    });
    const result = candidate(await convertDefinitionV3ToV4(source));
    const converted = result.value.nodes[0];
    if (converted?.kind !== 'trigger' || converted.config.type !== 'poll')
      throw new Error('missing converted poll');
    const gate = result.value.nodes.find(
      (node) => node.kind === 'decision' && node.config.maxPasses,
    );
    if (!gate) throw new Error('missing repeat gate');
    expect(
      await evaluateExpression(converted.config.fireWhen, { gates: { [gate.id]: { passes: 3 } } }),
    ).toBe(true);
    expect(
      await evaluateExpression(converted.config.fireWhen, { gates: { [gate.id]: { passes: 2 } } }),
    ).toBe(false);
    expect(
      result.reviewItems.find((item) => item.path === '/nodes/0/config/fireWhen'),
    ).toMatchObject({
      kind: 'iteration-consumer',
      status: 'automatic',
    });
    expect(JSON.stringify(result.value)).not.toMatch(/"subtype"\s*:/);
  });

  it.each([
    ['Choice expression', choice, { kind: 'expression', jsonata: '"yes"' }],
    ['Noul expression', noul, { kind: 'expression', jsonata: 'true' }],
    ['Choice LLM', choice, llm],
    ['Noul LLM', noul, llm],
    ['Choice classifier', choice, classifier],
    ['Noul classifier', noul, { ...classifier, truthThreshold: 0.6 }],
    ['Score classifier', score, classifier],
  ])('matches the complete %s decision golden', async (name, answer, evaluation) => {
    const source = loop({}, { answer, evaluation, recordAlternatives: false });
    const before = structuredClone(source);
    const result = candidate(await convertDefinitionV3ToV4(source));
    expect(source).toEqual(before);
    expect(result.ready).toBe(!String(name).includes('LLM'));
    expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
    const resolved = candidate(await convertDefinitionV3ToV4(source, approvals(result)));
    expect(resolved.ready).toBe(true);
    expect(resolved.value).toEqual(result.value);
  });

  it('evaluates strict boolean wrappers once and preserves non-boolean failures', async () => {
    for (const value of [true, false])
      expect(
        await evaluateExpression(booleanRouteExpression('flag', 'yes', 'no'), { flag: value }),
      ).toBe(value ? 'yes' : 'no');
    for (const flag of [undefined, null, 0, 1, 'true', [], {}])
      await expect(
        evaluateExpression(booleanRouteExpression('flag', 'yes', 'no'), { flag }),
      ).rejects.toThrow('Expected a boolean');
    let calls = 0;
    expect(
      await evaluateExpression(
        booleanRouteExpression('$counter()', 'yes', 'no'),
        {},
        {
          bindings: {
            counter: () => {
              calls++;
              return true;
            },
          },
        },
      ),
    ).toBe('yes');
    expect(calls).toBe(1);
  });

  it.each([
    ['ceiling', [{ when: 'max-iterations', value: 3 }]],
    ['duration', [{ when: 'max-duration', seconds: 45 }]],
    [
      'expression true',
      [predicate({ kind: 'expression', jsonata: 'lastOutput.value.ready = true' })],
    ],
    [
      'expression false',
      [
        predicate(
          { kind: 'expression', jsonata: 'lastOutput.value.ready = true' },
          { type: 'noul' },
          { type: 'noul', value: false },
        ),
      ],
    ],
    [
      'LLM true',
      [
        predicate(llm, {
          type: 'noul',
          true: { label: 'Yes', criteria: 'Ready' },
          false: { label: 'No', criteria: 'Needs work' },
        }),
      ],
    ],
    [
      'LLM false confidence zero',
      [
        predicate(
          llm,
          {
            type: 'noul',
            true: { label: 'Yes', criteria: 'Ready' },
            false: { label: 'No', criteria: 'Needs work' },
          },
          { type: 'noul', value: false, minReportedConfidence: 0 },
        ),
      ],
    ],
    [
      'LLM Choice confidence',
      [predicate(llm, choice, { type: 'choice', optionIds: ['no'], minReportedConfidence: 0.8 })],
    ],
    [
      'classifier Noul false',
      [
        predicate(
          { ...classifier, truthThreshold: 0.8 },
          {
            type: 'noul',
            true: { label: 'Yes', criteria: 'Ready' },
            false: { label: 'No', criteria: 'Needs work' },
          },
          { type: 'noul', value: false },
        ),
      ],
    ],
    ['classifier Choice', [predicate(classifier, choice, { type: 'choice', optionIds: ['yes'] })]],
    [
      'classifier Score',
      [
        predicate(
          classifier,
          { type: 'score', anchors: score.anchors },
          { type: 'score', operator: 'gte', value: 0.6 },
        ),
      ],
    ],
    [
      'ordered mixed predicates',
      [
        { when: 'max-duration', seconds: 30 },
        predicate({ kind: 'expression', jsonata: 'false' }),
        predicate(classifier, choice, { type: 'choice', optionIds: ['yes'] }),
        { when: 'max-iterations', value: 2 },
      ],
    ],
  ])('matches the %s loop-back golden and resolves all reviews', async (_name, criteria) => {
    const source = loop({ ...back, criteria });
    const result = candidate(await convertDefinitionV3ToV4(source));
    expect(result.ready).toBe(false);
    expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
    const gates = result.value.nodes.filter(
      (node) => node.kind === 'decision' && node.config.maxPasses,
    );
    expect(gates).toHaveLength(1);
    for (const gate of gates)
      if (gate.kind === 'decision')
        expect(result.value.settings.maxNodeVisits).toBeGreaterThanOrEqual(gate.config.maxPasses!);
    const resolved = candidate(await convertDefinitionV3ToV4(source, approvals(result)));
    expect(resolved.ready).toBe(true);
    expect(resolved.value).toEqual(result.value);
  });

  it.each([true, false])('routes a false-match expression correctly for %s', async (ready) => {
    const result = candidate(
      await convertDefinitionV3ToV4(
        loop({
          ...back,
          criteria: [
            predicate(
              { kind: 'expression', jsonata: 'lastOutput.value.ready = true' },
              { type: 'noul' },
              { type: 'noul', value: false },
            ),
          ],
        }),
      ),
    );
    const gate = result.value.nodes.find((node) => node.id === 'done');
    if (gate?.kind !== 'decision' || gate.config.kind !== 'expression')
      throw new Error('missing expression gate');
    expect(
      await evaluateExpression(gate.config.jsonata, {
        outputs: { work: { value: { ready } } },
        lastOutput: { value: { ready: !ready } },
      }),
    ).toBe(ready ? 'unmatched' : 'matched');
  });

  it.each(['starter', 'implementation', 'review', 'qa'])(
    'converts the frozen shipped %s draft triggers and exits to current behavior',
    async (name) => {
      const old = JSON.parse(
        readFileSync(new URL(`./fixtures/${name}.v3.json`, import.meta.url), 'utf8').replace(
          /^\uFEFF/,
          '',
        ),
      ) as { loop: unknown };
      const source = V3LoopDefinitionSchema.parse(old.loop);
      const result = candidate(await convertDefinitionV3ToV4(source));
      const current = JSON.parse(
        readFileSync(
          new URL(`../../../../apps/api/templates/${name}/draft.json`, import.meta.url),
          'utf8',
        ),
      ) as { loop: unknown };
      const expected = LoopDefinitionSchema.parse(current.loop);
      for (const node of expected.nodes) {
        const original = source.nodes.find((entry) => entry.id === node.id);
        if (node.kind === 'trigger' || node.kind === 'exit' || original?.kind === 'exit')
          expect(result.value.nodes.find((entry) => entry.id === node.id)?.config).toEqual(
            node.config,
          );
      }
      for (const edge of source.edges)
        expect(result.value.edges.some((entry) => entry.id === edge.id)).toBe(true);
      expect(result.value.settings.maxNodeVisits).toBe(expected.settings.maxNodeVisits);
      expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
    },
  );
});

describe('E2 review regressions', () => {
  function twoLoopBacks() {
    const source = loop(
      { ...back, return: { mapping: 'none' } },
      {
        answer: choice,
        evaluation: { kind: 'expression', jsonata: 'run.iteration >= 3 ? "yes" : "no"' },
      },
    );
    const oldExit = source.nodes[2]!;
    source.nodes.push({ ...structuredClone(oldExit), id: 'again' });
    source.edges.find((edge) => edge.from.port === 'no')!.to.node = 'again';
    return source;
  }

  it('F1 automatically maps a sole gate expression, template and return to one-based passes', async () => {
    const source = loop({
      ...back,
      criteria: [predicate({ kind: 'expression', jsonata: 'run.iteration >= 3' })],
      return: { mapping: 'run.iteration' },
    });
    source.nodes[1] = {
      ...source.nodes[1]!,
      kind: 'wait',
      config: {
        mode: 'input',
        prompt: 'Pass {{ run.iteration }}',
        exposeTo: ['api'],
        onTimeout: 'continue',
      },
    };
    const result = candidate(await convertDefinitionV3ToV4(source));
    const changes = result.reviewItems.filter((item) => item.kind === 'iteration-consumer');
    expect(changes).toHaveLength(3);
    expect(changes.every((item) => item.status === 'automatic')).toBe(true);
    expect(changes.map((item) => item.oldValue)).toEqual(
      expect.arrayContaining(['run.iteration >= 3', 'Pass {{ run.iteration }}', 'run.iteration']),
    );
    const gate = result.value.nodes.find((node) => node.id === 'done');
    if (gate?.kind !== 'decision' || gate.config.kind !== 'expression')
      throw new Error('missing expression gate');
    expect(gate.config.maxPasses).toBe(5);
    const work = result.value.nodes.find((node) => node.id === 'work');
    if (work?.kind !== 'wait' || work.config.mode !== 'input') throw new Error('missing input');
    for (const passes of [1, 3]) {
      const view = { run: { iteration: 1 }, gates: { done: { passes } } };
      expect(await evaluateExpression(gate.config.jsonata, view)).toBe(
        passes >= 3 ? 'matched' : 'unmatched',
      );
      expect(await renderTemplate(work.config.prompt, view)).toBe('Pass ' + passes);
      for (const node of result.value.nodes)
        if (node.kind === 'exit')
          expect(await evaluateExpression(node.config.returns, view)).toBe(passes);
    }
    expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
  });

  it.each(['zero', 'two'] as const)(
    'F1 requires an owner source resolution with %s loop-back exits',
    async (count) => {
      const source =
        count === 'two'
          ? twoLoopBacks()
          : loop(
              {},
              {
                answer: choice,
                evaluation: { kind: 'expression', jsonata: 'run.iteration >= 3 ? "yes" : "no"' },
              },
            );
      const result = candidate(await convertDefinitionV3ToV4(source));
      const item = result.reviewItems.find(
        (entry) => entry.kind === 'output-consumer' && entry.path.endsWith('/evaluation/jsonata'),
      )!;
      expect(item.status).toBe('pending');
      expect(item.proposedValue).toBe(item.oldValue);
      expect(result.reviewItems.some((entry) => entry.kind === 'iteration-consumer')).toBe(false);
      const resolved = candidate(
        await convertDefinitionV3ToV4(source, {
          [item.id]: {
            hash: item.hash,
            action: 'replace',
            value: '"yes"',
            reason: 'Owner selected an explicit route policy.',
          },
        }),
      );
      expect(resolved.value.nodes.find((node) => node.id === 'work')?.config).toMatchObject({
        jsonata: '"yes"',
      });
      expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
    },
  );

  it('F1 reviews counters even with one gate and does not partially rewrite a mixed read', async () => {
    const source = loop({
      ...back,
      return: { mapping: 'run.iteration + counters.nodeVisits.work' },
    });
    const result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'output-consumer')!;
    expect(item.status).toBe('pending');
    expect(item.oldValue).toBe(item.proposedValue);
    expect(result.reviewItems.filter((entry) => entry.id === item.id)).toHaveLength(1);
    expect(consumerNeedsReview('counters', 'expression')).toBe(true);
    expect(consumerNeedsReview('{{ counters.usage }}', 'template')).toBe(true);
    expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
  });

  it('F1 keeps other run fields and literal iteration text safe', async () => {
    for (const field of ['id', 'loopId', 'versionId', 'parentRunId']) {
      expect(consumerNeedsReview('run.' + field, 'expression')).toBe(false);
      expect(consumerNeedsReview('{{ run.' + field + ' }}', 'template')).toBe(false);
    }
    const result = candidate(
      await convertDefinitionV3ToV4(
        loop({ return: { mapping: '{"id":run.id,"text":"run.iteration counters"}' } }),
      ),
    );
    expect(result.ready).toBe(true);
  });

  it('F1 refuses an authored graph that would remove the seeded gate referenced by an automatic rewrite', async () => {
    const source = loop({ ...back, return: { mapping: 'run.iteration' } });
    const result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'exit-policy')!;
    const graph = {
      nodes: [{ id: 'done', kind: 'exit', label: 'Removed gate', config: { outcome: 'success' } }],
      edges: [],
    };
    const refused = await convertDefinitionV3ToV4(source, {
      [item.id]: {
        hash: item.hash,
        action: 'replace',
        value: graph,
        reason: 'This would leave no seeded gate.',
      },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.issues.map((entry) => entry.code)).toContain('V4_ITERATION_GATE_UNPROVEN');
  });

  it.each([false, true])(
    're-review F1 resolves every invalidated source with two authored gates (explicit return: %s)',
    async (explicitReturn) => {
      const source = loop({ ...back, return: { mapping: 'run.iteration' } });
      source.nodes[1] = {
        ...source.nodes[1]!,
        kind: 'wait',
        config: {
          mode: 'input',
          prompt: 'Pass {{ run.iteration }}',
          exposeTo: ['api'],
          onTimeout: 'continue',
        },
      };
      const preview = candidate(await convertDefinitionV3ToV4(source));
      const policy = preview.reviewItems.find((item) => item.kind === 'exit-policy')!;
      const graph = structuredClone(policy.proposedValue) as {
        nodes: LoopDefinition['nodes'];
        edges: LoopDefinition['edges'];
      };
      graph.nodes.push({
        id: 'extra',
        label: 'Second gate',
        kind: 'decision',
        ui: { x: 0, y: 0 },
        config: {
          kind: 'expression',
          jsonata: '"stop"',
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'stop', label: 'Stop' },
          ],
          maxPasses: 2,
        },
      });
      graph.edges.find(
        (edge) => edge.from.node === 'done' && edge.from.port === 'finish',
      )!.to.node = 'extra';
      graph.edges.push(
        {
          id: 'extra-repeat',
          from: { node: 'extra', port: 'repeat' },
          to: { node: 'extra', port: 'in' },
        },
        {
          id: 'extra-stop',
          from: { node: 'extra', port: 'stop' },
          to: { node: 'done-complete', port: 'in' },
        },
        {
          id: 'extra-limit',
          from: { node: 'extra', port: 'limit-reached' },
          to: { node: 'done-exhausted', port: 'in' },
        },
      );
      if (explicitReturn)
        for (const node of graph.nodes)
          if (node.kind === 'exit') node.config.returns = '"explicit owner value"';
      const graphResolution: DefinitionResolutions = {
        [policy.id]: {
          hash: policy.hash,
          action: 'replace',
          value: graph,
          reason: 'Owner authored a second gate.',
        },
      };
      const refused = await convertDefinitionV3ToV4(source, graphResolution);
      expect(refused.ok).toBe(false);
      const items = refused.reviewItems.filter((item) => item.kind === 'iteration-consumer');
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.status).toBe('pending');
        if (!refused.ok)
          expect(
            refused.issues.find((issue) => issue.code === 'V4_ITERATION_GATE_UNPROVEN')?.message,
          ).toContain(item.id);
      }
      const answers: DefinitionResolutions = { ...graphResolution };
      for (const item of items)
        answers[item.id] = {
          hash: item.hash,
          action: 'replace',
          value: item.path.endsWith('/prompt')
            ? 'Pass {{ gates.extra.passes }}'
            : 'gates.extra.passes',
          reason: 'Owner chose the second gate counter for this source.',
        };
      const converted = candidate(await convertDefinitionV3ToV4(source, answers));
      expect(converted.ready).toBe(true);
      expect(
        converted.reviewItems
          .filter((item) => item.kind === 'iteration-consumer')
          .every((item) => item.status === 'resolved'),
      ).toBe(true);
      const input = converted.value.nodes.find((node) => node.id === 'work');
      expect(input?.config).toMatchObject({ prompt: 'Pass {{ gates.extra.passes }}' });
      for (const node of converted.value.nodes)
        if (node.kind === 'exit')
          expect(node.config.returns).toBe(
            explicitReturn ? '"explicit owner value"' : 'gates.extra.passes',
          );
      const first = items[0]!;
      for (const bad of [
        { ...answers[first.id]!, hash: '0'.repeat(64) },
        {
          hash: first.hash,
          action: 'approve' as const,
          reason: 'Approval cannot choose a counter.',
        },
        { ...answers[first.id]!, value: 123 },
      ])
        expect((await convertDefinitionV3ToV4(source, { ...answers, [first.id]: bad })).ok).toBe(
          false,
        );
      const changedGraph = structuredClone(graph);
      changedGraph.nodes.find((node) => node.id === 'extra')!.label = 'Changed graph';
      expect(
        (
          await convertDefinitionV3ToV4(source, {
            ...answers,
            [policy.id]: { ...graphResolution[policy.id]!, value: changedGraph },
          })
        ).ok,
      ).toBe(false);
    },
  );

  it('F1 requires review for a counters template even without changed output shapes', async () => {
    const source = loop();
    source.nodes[1] = {
      ...source.nodes[1]!,
      kind: 'wait',
      config: {
        mode: 'input',
        prompt: '{{ counters.nodeVisits.work }}',
        exposeTo: ['api'],
        onTimeout: 'continue',
      },
    };
    const result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'output-consumer')!;
    expect(item).toMatchObject({ path: '/nodes/1/config/prompt', status: 'pending' });
    const resolved = candidate(
      await convertDefinitionV3ToV4(source, {
        [item.id]: {
          hash: item.hash,
          action: 'replace',
          value: 'Owner-reviewed prompt',
          reason: 'Removed the old counters dependency.',
        },
      }),
    );
    expect(resolved.ready).toBe(true);
  });

  it('F1 uses the actual provider comparison gate ID in decision and provider templates', async () => {
    const source = loop(
      {
        ...back,
        criteria: [
          predicate({ ...classifier, question: 'Pass {{ run.iteration }}?' }, choice, {
            type: 'choice',
            optionIds: ['yes'],
          }),
        ],
        return: { mapping: 'none' },
      },
      {
        answer: choice,
        evaluation: { kind: 'expression', jsonata: 'run.iteration >= 3 ? "yes" : "no"' },
      },
    );
    const result = candidate(await convertDefinitionV3ToV4(source));
    const gate = result.value.nodes.find(
      (node) => node.kind === 'decision' && node.config.maxPasses !== undefined,
    )!;
    expect(gate.id).toBe('done-match');
    const work = result.value.nodes.find((node) => node.id === 'work');
    if (work?.kind !== 'decision' || work.config.kind !== 'expression')
      throw new Error('missing work decision');
    expect(work.config.jsonata).toBe('gates.`done-match`.passes >= 3 ? "yes" : "no"');
    const provider = result.value.nodes.find((node) => node.id === 'done');
    if (provider?.kind !== 'decision' || provider.config.kind !== 'classifier')
      throw new Error('missing provider');
    expect(
      await renderTemplate(provider.config.question, { gates: { 'done-match': { passes: 3 } } }),
    ).toBe('Pass 3?');
    expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
  });

  it.each(['expression', 'template'] as const)(
    'F1 reviews dynamic %s iteration lookups rather than guessing',
    async (kind) => {
      const source = loop({ ...back, return: { mapping: 'none' } });
      source.nodes[1] = {
        ...source.nodes[1]!,
        kind: 'wait',
        config: {
          mode: 'input',
          prompt: kind === 'template' ? '{{ run[vars.key] }}' : '{{ run.iteration }}',
          exposeTo: ['api'],
          onTimeout: 'continue',
        },
      };
      const exit = source.nodes[2];
      if (exit?.kind !== 'exit') throw new Error('missing exit');
      if (kind === 'expression') exit.config.return.mapping = '$lookup(run, "iteration")';
      const result = candidate(await convertDefinitionV3ToV4(source));
      expect(
        result.reviewItems.some(
          (item) => item.kind === 'output-consumer' && item.status === 'pending',
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['expression', 'messages.(run.iteration)'],
    ['template', '{% for run in messages %}{{ run.iteration }}{% endfor %}'],
    ['template', '{% assign gates = trigger.payload %}{{ run.iteration }}'],
  ] as const)(
    'F1 keeps context-dependent %s iteration reads for owner review',
    async (kind, text) => {
      const source = loop({ ...back, return: { mapping: kind === 'expression' ? text : 'none' } });
      if (kind === 'template')
        source.nodes[1] = {
          ...source.nodes[1]!,
          kind: 'wait',
          config: { mode: 'input', prompt: text, exposeTo: ['api'], onTimeout: 'continue' },
        };
      const result = candidate(await convertDefinitionV3ToV4(source));
      expect(result.reviewItems.some((item) => item.kind === 'iteration-consumer')).toBe(false);
      expect(result.reviewItems.find((item) => item.kind === 'output-consumer')).toMatchObject({
        status: 'pending',
        oldValue: text,
        proposedValue: text,
      });
    },
  );

  it.each([
    [
      'schema',
      { criteria: [{ when: 'last-output-matches', jsonSchema: {} }] },
      'V4_EXIT_SCHEMA_POLICY_REQUIRED',
    ],
    [
      'iterations',
      { criteria: [{ when: 'max-iterations', value: 1 }] },
      'V4_TERMINAL_LIMIT_POLICY_REQUIRED',
    ],
    [
      'duration',
      { criteria: [{ when: 'max-duration', seconds: 2 }] },
      'V4_TERMINAL_LIMIT_POLICY_REQUIRED',
    ],
  ] as const)(
    'F2 accepts an authored %s exit graph and refuses absent, stale and malformed answers',
    async (_name, exit, code) => {
      const source = loop(exit),
        refused = await convertDefinitionV3ToV4(source);
      expect(refused.ok).toBe(false);
      const item = refused.reviewItems.find((entry) => entry.kind === 'exit-policy')!;
      expect(item).toMatchObject({
        id: '/nodes/2/config:exit-policy',
        status: 'pending',
        proposedValue: null,
      });
      if (!refused.ok)
        expect(refused.issues.find((entry) => entry.code === code)?.message).toContain(item.id);
      const graph = {
        nodes: [
          {
            id: 'done',
            kind: 'exit',
            label: 'Reviewed terminal policy',
            config: { outcome: 'exhausted', returns: 'none', destinations: [] },
          },
        ],
        edges: [],
      };
      const answer = {
        hash: item.hash,
        action: 'replace' as const,
        value: graph,
        reason: 'Owner approved this exact terminal policy.',
      };
      const converted = candidate(await convertDefinitionV3ToV4(source, { [item.id]: answer }));
      expect(converted.ready).toBe(true);
      for (const bad of [
        { ...answer, hash: '0'.repeat(64) },
        { ...answer, value: { nodes: 'malformed', edges: [] } },
        { ...answer, action: 'approve' as const, value: undefined },
      ])
        expect((await convertDefinitionV3ToV4(source, { [item.id]: bad })).ok).toBe(false);
      expect({ refused, converted }).toMatchSnapshot();
    },
  );

  it('F3 identifies the formerly shared budget on each actual gate', async () => {
    const result = candidate(await convertDefinitionV3ToV4(twoLoopBacks()));
    const items = result.reviewItems.filter((entry) => entry.kind === 'shared-iteration-budget');
    expect(items.map((entry) => entry.nodeId)).toEqual(['done', 'again']);
    for (const item of items) {
      expect(item.status).toBe('pending');
      expect(item.reason).toContain('shared one iteration budget');
      expect(item.reason).toContain('MAX_NODE_VISITS');
      expect(result.value.nodes.find((node) => node.id === item.nodeId)?.config).toMatchObject({
        maxPasses: 5,
      });
    }
    expect(
      candidate(await convertDefinitionV3ToV4(loop(back))).reviewItems.some(
        (entry) => entry.kind === 'shared-iteration-budget',
      ),
    ).toBe(false);
  });

  it.each(['max-iterations', 'max-duration'] as const)(
    'F4 names %s changing from before a predicate to after evaluation',
    async (when) => {
      const limit = when === 'max-iterations' ? { when, value: 3 } : { when, seconds: 20 };
      const source = loop({
        ...back,
        criteria: [limit, predicate({ kind: 'expression', jsonata: 'true' })],
      });
      const result = candidate(await convertDefinitionV3ToV4(source));
      const item = result.reviewItems.find((entry) => entry.kind === 'ordered-limit')!;
      expect(item).toMatchObject({ path: '/nodes/2/config/criteria/0', status: 'pending' });
      expect(item.reason).toContain('before that predicate ran');
      expect(item.reason).toContain('evaluate first');
      expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
      const after = candidate(
        await convertDefinitionV3ToV4(
          loop({ ...back, criteria: [predicate({ kind: 'expression', jsonata: 'true' }), limit] }),
        ),
      );
      expect(after.reviewItems.some((entry) => entry.kind === 'ordered-limit')).toBe(false);
    },
  );

  it.each(['none', 'conditional', 'constant'] as const)(
    'F5 reports ignored continuation with a %s terminal exit',
    async (shape) => {
      const source = loop({
        loopBack: { targetNodeId: 'work' },
        criteria:
          shape === 'none'
            ? []
            : [
                predicate({
                  kind: 'expression',
                  jsonata: shape === 'constant' ? 'true' : 'trigger.payload.ready = true',
                }),
              ],
      });
      source.edges.push({
        id: 'ignored-continuation',
        from: { node: 'done', port: 'loopBack' },
        to: { node: 'work', port: 'in' },
      });
      const result = candidate(await convertDefinitionV3ToV4(source));
      const item = result.reviewItems.find((entry) => entry.kind === 'ignored-loop-back')!;
      expect(item.status).toBe('pending');
      expect(item.oldValue).toMatchObject({
        loopBack: { targetNodeId: 'work' },
        edges: [{ id: 'ignored-continuation' }],
      });
      expect(result.value.edges.some((edge) => edge.id === 'ignored-continuation')).toBe(false);
      expect(candidate(await convertDefinitionV3ToV4(source, approvals(result))).ready).toBe(true);
      expect({ value: result.value, reviews: result.reviewItems }).toMatchSnapshot();
    },
  );
});

describe('consumers, refusals and exact resolutions', () => {
  it.each([
    [
      'classifier',
      'outputs.work.value.answer.probabilities',
      'expression',
      'outputs.work.value.observation.answer.probabilities',
    ],
    [
      'classifier',
      '{{ outputs.work.value.answer.legend }}',
      'template',
      '{{ outputs.work.value.observation.answer.legend }}',
    ],
    [
      'expression',
      'outputs.work.value.answer.optionId',
      'expression',
      'outputs.work.value.observation.routeId',
    ],
    [
      'llm',
      '{{ outputs.work.value.answer.confidence }}',
      'template',
      '{{ outputs.work.value.observation.confidence }}',
    ],
    [
      'expression',
      'lastOutput.value.answer.holds',
      'expression',
      '(lastOutput.value.observation.routeId = "yes")',
    ],
    [
      'llm',
      '{{ lastOutput.value.answer.optionId }}',
      'template',
      '{{ lastOutput.value.observation.routeId }}',
    ],
    [
      'classifier',
      'outputs.work.value.answer.kind',
      'expression',
      'outputs.work.value.answer.kind',
    ],
    [
      'expression',
      'outputs.work.value.answer.trueProbability',
      'expression',
      'outputs.work.value.answer.trueProbability',
    ],
    [
      'expression',
      '{{ outputs.work.value.answer.holds }}',
      'template',
      '{{ outputs.work.value.answer.holds }}',
    ],
    [
      'expression',
      'outputs[vars.node].value.answer.holds',
      'expression',
      'outputs[vars.node].value.answer.holds',
    ],
    ['classifier', '"outputs.work.value.answer"', 'expression', '"outputs.work.value.answer"'],
    [
      'classifier',
      'outputs.work.value.`answer`.holds',
      'expression',
      'outputs.work.value.`answer`.holds',
    ],
    [
      'expression',
      '{"x":outputs.work.value.answer.optionId,"y":lastOutput.value.answer.confidence}',
      'expression',
      '{"x":outputs.work.value.observation.routeId,"y":lastOutput.value.observation.confidence}',
    ],
  ] as const)('proposes %s payload paths using tokens: %s', (kind, text, language, expected) => {
    const config = loop(
      {},
      {
        answer: noul,
        evaluation:
          kind === 'expression' ? { kind, jsonata: 'true' } : kind === 'llm' ? llm : classifier,
      },
    ).nodes[1];
    if (config?.kind !== 'decision') throw new Error('missing fixture decision');
    expect(proposeAnswerConsumer(text, language, new Map([['work', config.config]]), 'work')).toBe(
      expected,
    );
  });

  it('applies a reviewed exit graph and raises the independent cap to its pass limit', async () => {
    const source = loop(back),
      result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'exit-policy')!;
    const graph = structuredClone(item.proposedValue) as {
      nodes: LoopDefinition['nodes'];
      edges: LoopDefinition['edges'];
    };
    const gate = graph.nodes.find((node) => node.id === 'done');
    if (gate?.kind !== 'decision') throw new Error('missing gate');
    gate.config.maxPasses = 8;
    const resolutions = approvals(result);
    resolutions[item.id] = {
      hash: item.hash,
      action: 'replace',
      value: graph,
      reason: 'Owner approved the authored graph.',
    };
    const converted = candidate(await convertDefinitionV3ToV4(source, resolutions));
    expect(converted.ready).toBe(true);
    expect(converted.value.settings.maxNodeVisits).toBe(8);
    for (const value of [
      null,
      { nodes: [], edges: [] },
      { nodes: graph.nodes, edges: 'bad' },
      { ...graph, extra: true },
      { nodes: [...graph.nodes, source.nodes[1]], edges: graph.edges },
      { nodes: graph.nodes, edges: [...graph.edges, source.edges[0]] },
    ]) {
      const refused = await convertDefinitionV3ToV4(source, {
        [item.id]: { hash: item.hash, action: 'replace', value, reason: 'Invalid fragment' },
      });
      expect(refused.ok).toBe(false);
    }
  });

  it('refuses overlapping graph and source replacements', async () => {
    const source = loop({ ...back, return: { mapping: '$lookup($$, "lastOutput")' } });
    const result = candidate(await convertDefinitionV3ToV4(source));
    const graph = result.reviewItems.find((item) => item.kind === 'exit-policy')!,
      mapping = result.reviewItems.find((item) => item.kind === 'exit-return')!;
    const resolutions = approvals(result);
    resolutions[graph.id] = {
      hash: graph.hash,
      action: 'replace',
      value: graph.proposedValue,
      reason: 'Graph',
    };
    resolutions[mapping.id] = {
      hash: mapping.hash,
      action: 'replace',
      value: 'outputs.work.value',
      reason: 'Source',
    };
    const refused = await convertDefinitionV3ToV4(source, resolutions);
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.issues.map((item) => item.code)).toContain('V4_RESOLUTION_CONFLICT');
  });

  it('accepts opaque configuration replacements and refuses overlapping source edits', async () => {
    const raw = JSON.parse(JSON.stringify(loop(back))) as { nodes: Record<string, unknown>[] };
    raw.nodes[1] = {
      id: 'work',
      kind: 'script',
      label: 'Work',
      config: { command: 'node', args: ['{{ lastOutput.value.answer.holds }}'], stdin: 'thread' },
    };
    const source = V3LoopDefinitionSchema.parse(raw),
      result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'opaque-consumer')!;
    const resolutions = approvals(result);
    const replacement = {
      ...(item.proposedValue as Record<string, unknown>),
      args: ['reviewed.mjs'],
    };
    for (const key of Object.keys(resolutions))
      if (key.startsWith(item.path + '/')) delete resolutions[key];
    resolutions[item.id] = {
      hash: item.hash,
      action: 'replace',
      value: replacement,
      reason: 'Owner reviewed the script data contract.',
    };
    const converted = candidate(await convertDefinitionV3ToV4(source, resolutions));
    expect(converted.value.nodes.find((node) => node.id === 'work')?.config).toMatchObject({
      args: ['reviewed.mjs'],
    });
    const child = result.reviewItems.find((entry) => entry.kind === 'output-consumer')!;
    const conflicting = await convertDefinitionV3ToV4(source, {
      ...resolutions,
      [child.id]: { hash: child.hash, action: 'approve', reason: 'Overlaps' },
    });
    expect(conflicting.ok).toBe(false);
    const bad = await convertDefinitionV3ToV4(source, {
      [child.id]: { hash: child.hash, action: 'replace', value: 123, reason: 'Wrong source type' },
    });
    expect(bad.ok).toBe(false);
  });

  it('keeps generated identities bounded and quotes hyphenated producer IDs', async () => {
    const source = loop(back),
      exitId = 'd'.repeat(64);
    source.nodes[2]!.id = exitId;
    source.edges[1]!.to.node = exitId;
    source.nodes[1]!.id = 'work-node';
    source.edges[0]!.to.node = 'work-node';
    source.edges[1]!.from.node = 'work-node';
    const exit = source.nodes[2];
    if (exit?.kind !== 'exit') throw new Error('missing exit');
    exit.config.loopBack!.targetNodeId = 'work-node';
    const result = candidate(await convertDefinitionV3ToV4(source));
    expect(result.value.nodes.every((node) => node.id.length <= 64)).toBe(true);
    expect(result.value.nodes.find((node) => node.kind === 'exit')?.config).toMatchObject({
      returns: 'outputs.`work-node`.value',
    });
  });

  it('reviews ignored continuation and ambiguous return producers without guessing', async () => {
    const ignored = candidate(
      await convertDefinitionV3ToV4(loop({ loopBack: { targetNodeId: 'work' } })),
    );
    expect(
      ignored.reviewItems.some(
        (item) => item.kind === 'ignored-loop-back' && item.status === 'pending',
      ),
    ).toBe(true);
    const raw = JSON.parse(
      JSON.stringify(loop({ ...back, return: { mapping: 'lastOutput.value' } })),
    ) as { nodes: Record<string, unknown>[] };
    raw.nodes[1] = {
      id: 'work',
      kind: 'script',
      label: 'No output',
      config: { command: 'noop', stdout: 'ignore' },
    };
    const result = candidate(await convertDefinitionV3ToV4(V3LoopDefinitionSchema.parse(raw)));
    expect(result.reviewItems.find((item) => item.kind === 'exit-return')?.status).toBe('pending');
    expect((await convertDefinitionV3ToV4(loop(), [] as unknown as DefinitionResolutions)).ok).toBe(
      false,
    );
    expect(
      (await convertDefinitionV3ToV4(loop(), null as unknown as DefinitionResolutions)).ok,
    ).toBe(false);
  });
  it.each([
    ['outputs.pick.value.answer.holds', 'expression', true],
    ['outputs.pick.value.answer.optionId', 'expression', true],
    ['outputs.pick.value.answer.probabilities', 'expression', true],
    ['$lookup(outputs, vars.node)', 'expression', true],
    ['$eval("lastOutput")', 'expression', true],
    ['($copy := lastOutput; $copy.value)', 'expression', true],
    ['$$', 'expression', true],
    ['outputs.*', 'expression', true],
    ['{{ outputs.pick.value.answer.confidence }}', 'template', true],
    ['{{ outputs[vars.node].value }}', 'template', true],
    ['{% assign saved = lastOutput %}{{ saved.value.answer.legend }}', 'template', true],
    ['"lastOutput answer.holds"', 'expression', false],
    ['literal lastOutput answer.holds', 'template', false],
    ['trigger.payload', 'expression', false],
    ['$count([1,2])', 'expression', false],
  ] as const)('classifies parsed %s consumers', (source, kind, expected) =>
    expect(consumerNeedsReview(source, kind)).toBe(expected),
  );

  it('rewrites only proven root names and preserves literals/nested keys', () => {
    expect(
      rewriteLastOutput(
        '{"literal":"lastOutput", "x": lastOutput.value, "y": foo.lastOutput}',
        'outputs.work',
      ),
    ).toBe('{"literal":"lastOutput", "x": outputs.work.value, "y": foo.lastOutput}');
    for (const text of [
      '$lookup($$, "lastOutput")',
      '$eval("lastOutput")',
      'lastOutput.*',
      'lastOutput.value[0]',
    ])
      expect(rewriteLastOutput(text, 'outputs.work')).toBeNull();
  });

  it('reviews mutations, schemas, scripts, Liquid and JSONata at source pointers', async () => {
    const source = loop(
      {},
      { answer: choice, evaluation: { kind: 'expression', jsonata: '"yes"' } },
    );
    source.variables = { saved: { type: 'object', properties: { answer: { type: 'object' } } } };
    const raw = JSON.parse(JSON.stringify(source)) as { nodes: unknown[]; edges: unknown[] };
    raw.nodes.push({
      id: 'capture',
      kind: 'mutate',
      label: 'Capture',
      config: {
        operations: [
          {
            op: 'set',
            path: '/vars/saved',
            value: { kind: 'expression', jsonata: 'lastOutput.value.answer' },
          },
          { op: 'append-message', content: '{{ outputs.work.value.answer.optionId }}' },
          {
            op: 'coerce',
            source: '/lastOutput/value/answer',
            target: '/vars/saved',
            jsonSchema: { type: 'object', required: ['answer'] },
          },
        ],
      },
    });
    // Both decision routes enter the capture; captured values require review even without a name match.
    raw.edges = source.edges.map((edge) =>
      edge.from.node === 'work' ? { ...edge, to: { node: 'capture', port: 'in' } } : edge,
    );
    raw.edges.push({
      id: 'capture-done',
      from: { node: 'capture', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    const input = V3LoopDefinitionSchema.parse(raw);
    const result = candidate(await convertDefinitionV3ToV4(input));
    expect(result.reviewItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['output-consumer', 'opaque-consumer', 'variable-schemas']),
    );
    const item = result.reviewItems.find((entry) => entry.path.endsWith('/content'))!;
    const resolutions = approvals(result);
    resolutions[item.id] = {
      hash: item.hash,
      action: 'replace',
      value: '{{ outputs.work.value.observation.routeId }}',
      reason: 'Read the reviewed route payload.',
    };
    expect(candidate(await convertDefinitionV3ToV4(input, resolutions)).ready).toBe(true);
  });

  it('rewires provable returns and reviews ambiguous producers and dynamic returns', async () => {
    const direct = candidate(
      await convertDefinitionV3ToV4(
        loop({ ...back, return: { mapping: '{"value":lastOutput.value,"text":"lastOutput"}' } }),
      ),
    );
    expect(direct.value.nodes.find((node) => node.kind === 'exit')?.config).toMatchObject({
      returns: '{"value":outputs.work.value,"text":"lastOutput"}',
    });
    const source = loop(
      { ...back, return: { mapping: 'lastOutput.value.answer' } },
      { answer: choice, evaluation: { kind: 'expression', jsonata: '"yes"' } },
    );
    expect(
      candidate(await convertDefinitionV3ToV4(source)).reviewItems.find(
        (item) => item.kind === 'exit-return',
      )?.status,
    ).toBe('pending');
    const dynamic = candidate(
      await convertDefinitionV3ToV4(
        loop({ ...back, return: { mapping: '$lookup($$, "lastOutput")' } }),
      ),
    );
    expect(dynamic.reviewItems.find((item) => item.kind === 'exit-return')?.status).toBe('pending');
  });

  it('accepts reviewed instruction replacements and rejects stale, unknown, unused and malformed resolutions', async () => {
    const source = loop({}, { answer: noul, evaluation: llm });
    const result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'llm-instructions')!;
    const resolutions = approvals(result);
    resolutions[item.id] = {
      hash: item.hash,
      action: 'replace',
      value: 'Choose yes for readiness; otherwise no.',
      reason: 'Approved instructions.',
    };
    const converted = candidate(await convertDefinitionV3ToV4(source, resolutions));
    expect(converted.value.nodes[1]?.config).toMatchObject({
      instructions: 'Choose yes for readiness; otherwise no.',
    });
    for (const bad of [
      { ...resolutions, unknown: resolutions[item.id]! },
      { [item.id]: { ...resolutions[item.id]!, hash: '0'.repeat(64) } },
      { [item.id]: { ...resolutions[item.id]!, reason: ' ' } },
      { [item.id]: { ...resolutions[item.id]!, value: 123 } },
      { [item.id]: { ...resolutions[item.id]!, value: '{% if %}' } },
      { [item.id]: { ...resolutions[item.id]!, action: 'approve', value: 'forbidden' } },
      { [item.id]: { ...resolutions[item.id]!, extra: true } },
    ])
      expect((await convertDefinitionV3ToV4(source, bad as DefinitionResolutions)).ok).toBe(false);
    const automatic = result.reviewItems.find((entry) => entry.status === 'automatic')!;
    expect(
      (
        await convertDefinitionV3ToV4(source, {
          [automatic.id]: { hash: automatic.hash, action: 'approve', reason: 'Unused' },
        })
      ).ok,
    ).toBe(false);
    expect((await convertDefinitionV3ToV4({ ...source, name: 'changed' }, resolutions)).ok).toBe(
      false,
    );
  });

  it.each([
    [
      { criteria: [{ when: 'last-output-matches', jsonSchema: { type: 'object' } }] },
      'V4_EXIT_SCHEMA_POLICY_REQUIRED',
    ],
    [{ criteria: [{ when: 'max-duration', seconds: 2 }] }, 'V4_TERMINAL_LIMIT_POLICY_REQUIRED'],
    [
      { ...back, criteria: [{ when: 'max-duration', seconds: 40_000_000 }] },
      'V4_DEFINITION_INVALID',
    ],
  ])('refuses unsupported policy without approximating it', async (exit, code) => {
    const result = await convertDefinitionV3ToV4(loop(exit));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain(code);
  });

  it('refuses malformed sources, invalid snippets, bad edges and reserved ids', async () => {
    const badSource = loop();
    badSource.schemaVersion = 4 as 3;
    expect((await convertDefinitionV3ToV4(badSource)).ok).toBe(false);
    const invalid = loop({}, { answer: choice, evaluation: { kind: 'expression', jsonata: '[' } });
    expect((await convertDefinitionV3ToV4(invalid)).ok).toBe(false);
    const dangling = loop(back);
    dangling.edges.push({
      id: 'bad',
      from: { node: 'done', port: 'out' },
      to: { node: 'work', port: 'in' },
    });
    const result = await convertDefinitionV3ToV4(dangling);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain('V3_EXIT_EDGE');
    const reserved = loop(
      {},
      {
        answer: {
          ...choice,
          options: [{ ...choice.options[0], id: 'limit-reached' }, choice.options[1]],
        },
        evaluation: { kind: 'expression', jsonata: '"no"' },
      },
    );
    expect((await convertDefinitionV3ToV4(reserved)).ok).toBe(false);
  });

  it('hashes canonical data with SHA-256 and source key order does not change review bindings', async () => {
    expect(await definitionReviewHash({ b: 2, a: 1 })).toBe(
      createHash('sha256').update('{"a":1,"b":2}').digest('hex'),
    );
    expect(await definitionReviewHash(null)).toBe(
      createHash('sha256').update('null').digest('hex'),
    );
    const source = loop(back),
      first = candidate(await convertDefinitionV3ToV4(source));
    const reordered = Object.fromEntries(Object.entries(source).reverse()) as V3LoopDefinition;
    const second = candidate(await convertDefinitionV3ToV4(reordered));
    expect(second.reviewItems).toEqual(first.reviewItems);
  });

  it('applies reviewed variable schemas and refuses non-JSON resolution values', async () => {
    const source = loop(back);
    source.variables = { saved: { type: 'object', required: ['answer'] } };
    const result = candidate(await convertDefinitionV3ToV4(source));
    const item = result.reviewItems.find((entry) => entry.kind === 'variable-schemas')!;
    const resolutions = approvals(result);
    resolutions[item.id] = {
      hash: item.hash,
      action: 'replace',
      value: { saved: { type: 'object', required: ['observation'] } },
      reason: 'Approved the new saved payload schema.',
    };
    expect(
      candidate(await convertDefinitionV3ToV4(source, resolutions)).value.variables.saved,
    ).toMatchObject({ required: ['observation'] });
    expect(
      (
        await convertDefinitionV3ToV4(source, {
          [item.id]: { hash: item.hash, action: 'replace', value: undefined, reason: 'Not JSON' },
        })
      ).ok,
    ).toBe(false);
  });

  it('does not infer stable output shapes through mutations that can overwrite the output containers', async () => {
    const raw = JSON.parse(
      JSON.stringify(loop({ ...back, return: { mapping: 'outputs.work.value.answer' } })),
    ) as { nodes: unknown[]; edges: unknown[] };
    raw.nodes.push({
      id: 'rewrite',
      kind: 'mutate',
      label: 'Rewrite',
      config: {
        operations: [
          {
            op: 'set',
            path: '/outputs/work/value',
            value: { kind: 'expression', jsonata: 'lastOutput.value' },
          },
        ],
      },
    });
    raw.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'rewrite' } },
      { id: 'c', from: { node: 'rewrite', port: 'out' }, to: { node: 'done' } },
    ];
    const result = candidate(await convertDefinitionV3ToV4(V3LoopDefinitionSchema.parse(raw)));
    expect(result.reviewItems.find((item) => item.kind === 'exit-return')?.status).toBe('pending');
  });
});

it('binds one decoding review to each frozen webhook and rejects stale approval or invalid current headers', async () => {
  const source = loop();
  const hook = V3NodeConfigSchemas.trigger.parse({
    subtype: 'webhook',
    signature: { scheme: 'hmac-sha256', header: 'X-Event-Signature', secretRef: 'key' },
    replayWindowSeconds: 42,
    dedupeKey: 'id',
  });
  source.nodes[0] = { ...source.nodes[0]!, kind: 'trigger', config: hook };
  source.nodes.push({
    id: 'other-hook',
    kind: 'trigger',
    label: 'Other',
    ui: source.nodes[0].ui,
    config: V3NodeConfigSchemas.trigger.parse({
      subtype: 'webhook',
      signature: { scheme: 'hmac-sha256-body', secretRef: 'other' },
    }),
  });
  source.edges.push({
    id: 'other-work',
    from: { node: 'other-hook', port: 'out' },
    to: { node: 'work', port: 'in' },
  });
  const result = candidate(await convertDefinitionV3ToV4(source));
  expect(result.reviewItems.filter((item) => item.kind === 'webhook-json-decoding')).toHaveLength(
    2,
  );
  expect(result.value.nodes[0]?.config).toMatchObject({
    authentication: { header: 'x-event-signature', windowSeconds: 42 },
    dedupeKey: 'id',
  });
  const approved = candidate(await convertDefinitionV3ToV4(source, approvals(result)));
  expect(approved.ready).toBe(true);
  const changed = structuredClone(source);
  const first = changed.nodes[0];
  if (first?.kind !== 'trigger' || first.config.subtype !== 'webhook')
    throw new Error('missing webhook');
  first.config.signature.secretRef = 'changed';
  expect(await convertDefinitionV3ToV4(changed, approvals(result))).toMatchObject({
    ok: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: 'V4_RESOLUTION_INVALID' })]),
  });
  first.config.signature.header = 'invalid header';
  expect(await convertDefinitionV3ToV4(changed)).toMatchObject({ ok: false });
});
