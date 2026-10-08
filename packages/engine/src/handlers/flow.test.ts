import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { ChoiceResult } from '../ports.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

type DecisionInput = Extract<LoopDefinitionInput['nodes'][number], { kind: 'decision' }>['config'];
const classifier = {
  kind: 'classifier',
  model: 'jev',
  question: 'Is {{ trigger.payload.value }} good?',
} as const;
const llm = {
  kind: 'llm',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
  question: 'Q',
} as const;
function decisionLoop(
  name: string,
  evaluation: DecisionInput['evaluation'],
  recordAlternatives = true,
): LoopDefinitionInput {
  return {
    schemaVersion: 3,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Choose',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'good', label: 'Good outcome', criteria: 'Acceptable' },
              { id: 'bad', label: 'Bad outcome', criteria: 'Needs work' },
            ],
          },
          evaluation,
          recordAlternatives,
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: 'outputs.decide.value.answer.optionId' } },
      },
    ],
    edges: [
      { id: 'start-decide', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'good', from: { node: 'decide', port: 'good' }, to: { node: 'done' } },
      { id: 'bad', from: { node: 'decide', port: 'bad' }, to: { node: 'done' } },
    ],
  };
}
function answer(
  optionId = 'good',
  confidence: number | null = 0.8,
  probabilities: ChoiceResult['probabilities'] = { good: 0.8, bad: 0.2 },
): ChoiceResult {
  return { type: 'choice', optionId, confidence, probabilities };
}

describe('decision node', () => {
  it('records the canonical expression answer without rendering provider questions', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      decisionLoop('expression', {
        kind: 'expression',
        jsonata: 'trigger.payload.value > 5 ? "good" : "bad"',
      }),
    );
    const good = await e.runToIdle(v.loopId, { value: 10 });
    const bad = await e.runToIdle(v.loopId, { value: 1 });
    expect(good.result).toBe('good');
    expect(bad.result).toBe('bad');
    const payload = {
      answer: { type: 'choice', optionId: 'good', confidence: null, probabilities: null },
      portId: 'good',
      provenance: {
        kind: 'expression',
        provider: null,
        classifierId: null,
        model: null,
        effort: null,
      },
    };
    expect(e.events(good.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
      ...payload,
      diagnostics: [],
    });
    expect((await e.manager.getThread(good.id))?.outputs['decide']?.value).toEqual(payload);
    expect(e.ports.jev.choices).toEqual([]);
    expect(e.ports.codexDecider.choices).toEqual([]);
  });
  it.each(['true', '42', 'null', '[]', '{}', '"unknown"'])(
    'does not coerce expression result %s into a route',
    async (jsonata) => {
      const e = await createTestEngine();
      const r = await e.runToIdle(
        e.publish(decisionLoop('expression-invalid', { kind: 'expression', jsonata })).loopId,
      );
      expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
      expect(e.eventTypes(r.id)).not.toContain('decision.made');
    },
  );
  it('types expression evaluation failures without retaining authored/private error text', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(
        decisionLoop('expression-throws', { kind: 'expression', jsonata: '$error("private")' }),
      ).loopId,
    );
    expect(r.failure).toMatchObject({ code: 'EVALUATION_EXPRESSION_FAILED', resumable: false });
    expect(JSON.stringify(r)).not.toContain('private');
  });
  it('passes stable ids, display labels and criteria and records classifier probabilities', async () => {
    const e = await createTestEngine();
    e.ports.jev.choose = () => Promise.resolve(answer());
    const r = await e.runToIdle(e.publish(decisionLoop('classifier', classifier)).loopId, {
      value: 7,
    });
    expect(r.result).toBe('good');
    expect(e.ports.classifiers.requests).toEqual([
      { ownerId: 'local', modelId: 'jev', primitive: 'choice' },
    ]);
    expect(e.events(r.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
      answer: answer(),
      portId: 'good',
      provenance: {
        kind: 'classifier',
        provider: 'typesafe',
        classifierId: 'jev',
        model: 'jev-latest',
        effort: null,
      },
      diagnostics: [],
    });
  });
  it('keeps the full-thread question and selected state exposure distinct', async () => {
    const e = await createTestEngine();
    const loop = decisionLoop('question-context', {
      ...classifier,
      question: '{{ vars.hidden }} / {{ messages.first.content }}',
      context: { messages: 'none', vars: ['visible', 'missing'], includeLastOutput: true },
    });
    loop.nodes.splice(1, 0, {
      id: 'prep',
      kind: 'mutate',
      label: 'Prepare',
      config: {
        operations: [
          {
            op: 'set',
            path: '/vars/hidden',
            value: { kind: 'literal', value: 'full-thread-only' },
          },
          { op: 'set', path: '/vars/visible', value: { kind: 'literal', value: 'selected' } },
          { op: 'append-message', role: 'note', content: 'old message' },
          {
            op: 'set',
            path: '/lastOutput',
            value: {
              kind: 'literal',
              value: { nodeId: 'prep', value: 'last output', at: '2026-10-02T12:00:00.000Z' },
            },
          },
        ],
      },
    });
    loop.edges[0] = {
      id: 'start-prep',
      from: { node: 'start', port: 'out' },
      to: { node: 'prep' },
    };
    loop.edges.push({
      id: 'prep-decide',
      from: { node: 'prep', port: 'out' },
      to: { node: 'decide' },
    });
    const r = await e.runToIdle(e.publish(loop).loopId, { value: 7 });
    expect(r.status).toBe('succeeded');
    expect(e.ports.jev.choices[0]).toMatchObject({
      question: 'full-thread-only / old message',
      context: {
        trigger: { value: 7 },
        messages: [],
        vars: { visible: 'selected' },
        lastOutput: 'last output',
      },
      options: [
        { id: 'good', label: 'Good outcome', criteria: 'Acceptable' },
        { id: 'bad', label: 'Bad outcome', criteria: 'Needs work' },
      ],
    });
    const noOutput = await e.runToIdle(
      e.publish(
        decisionLoop('no-output', {
          ...classifier,
          context: { includeLastOutput: false, vars: [] },
        }),
      ).loopId,
    );
    expect(noOutput.status).toBe('succeeded');
    expect(e.ports.jev.choices.at(-1)?.context).not.toHaveProperty('lastOutput');
  });
  it('rejects low classifier confidence without another evaluator call', async () => {
    const e = await createTestEngine();
    e.ports.jev.choose = () => Promise.resolve(answer('bad', 0.3, { good: 0.7, bad: 0.3 }));
    const r = await e.runToIdle(
      e.publish(decisionLoop('low', { ...classifier, minConfidence: 0.5 })).loopId,
    );
    expect(r.failure).toMatchObject({ code: 'EVALUATION_RESULT_REJECTED', resumable: false });
    expect(e.ports.codexDecider.choices).toEqual([]);
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
  });
  it('omits rejected Choice alternatives while retaining selected answer, confidence and gate', async () => {
    const e = await createTestEngine();
    e.ports.jev.choose = () => Promise.resolve(answer('bad', 0.3, { good: 0.7, bad: 0.3 }));
    const r = await e.runToIdle(
      e.publish(
        decisionLoop('low-without-alternatives', { ...classifier, minConfidence: 0.5 }, false),
      ).loopId,
    );
    expect(r.failure).toMatchObject({
      code: 'EVALUATION_RESULT_REJECTED',
      details: {
        answer: { type: 'choice', optionId: 'bad', confidence: 0.3, probabilities: null },
        provenance: { kind: 'classifier', classifierId: 'jev' },
        acceptance: { status: 'rejected', minConfidence: 0.5 },
      },
    });
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
    expect((await e.manager.getThread(r.id))?.outputs['decide']).toBeUndefined();
    const failed = e.events(r.id).find((event) => event.type === 'run.failed');
    expect(failed).toMatchObject({ failure: { details: { answer: { probabilities: null } } } });
  });
  it.each([
    answer('unknown'),
    answer('good', null),
    answer('good', 1, null),
    answer('good', NaN),
    answer('good', Infinity),
    answer('good', 2),
    answer('good', -1),
    answer('good', 1, { good: 1 }),
    answer('good', 1, { good: 1, private: 0 }),
  ])('rejects invalid classifier responses without recording them (%j)', async (value) => {
    const e = await createTestEngine();
    e.ports.jev.choose = () => Promise.resolve(value);
    const r = await e.runToIdle(e.publish(decisionLoop('invalid', classifier)).loopId);
    expect(r.failure).toMatchObject({ code: 'EVALUATION_INVALID_RESPONSE', resumable: false });
    expect(e.eventTypes(r.id)).not.toContain('decision.made');
    expect(JSON.stringify(e.events(r.id))).not.toContain('private');
  });
  it('omits probability recording when requested while retaining its checked selected answer', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(decisionLoop('no-probabilities', classifier, false)).loopId,
    );
    expect(e.events(r.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
      answer: { probabilities: null },
      diagnostics: [],
    });
    expect((await e.manager.getThread(r.id))?.outputs['decide']?.value).toMatchObject({
      answer: { probabilities: null },
    });
  });
  it('records resolved LLM provenance and keeps informational confidence separate from probability', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(
        decisionLoop('llm', {
          ...llm,
          model: { mode: 'explicit', value: 'gpt-6-sol' },
          effort: { mode: 'explicit', value: 'xhigh' },
        }),
      ).loopId,
    );
    expect(r.result).toBe('good');
    expect(e.ports.codexDecider.choices[0]).toMatchObject({ model: 'gpt-6-sol', effort: 'xhigh' });
    expect(e.events(r.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
      provenance: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'gpt-6-sol',
        effort: 'xhigh',
      },
      answer: { confidence: 1, probabilities: null },
    });
  });
  it.each([answer(), answer('good', null, null)])(
    'rejects LLM evidence with classifier probabilities or absent confidence',
    async (value) => {
      const e = await createTestEngine();
      e.ports.codexDecider.choose = () => Promise.resolve(value);
      const r = await e.runToIdle(e.publish(decisionLoop('bad-llm', llm, false)).loopId);
      expect(r.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
    },
  );
  it('reports a missing LLM evaluator as resumable without substituting classifier', async () => {
    const e = await createTestEngine();
    e.ports.codexDecider.isAvailable = false;
    const r = await e.runToIdle(e.publish(decisionLoop('missing-llm', llm)).loopId);
    expect(r.failure).toMatchObject({ code: 'EVALUATION_UNAVAILABLE', resumable: true });
    expect(e.ports.jev.choices).toEqual([]);
  });
  it.each([
    ['DECIDER_INVALID_RESPONSE', undefined, 'EVALUATION_INVALID_RESPONSE', false],
    ['DECIDER_UNAVAILABLE', undefined, 'EVALUATION_UNAVAILABLE', true],
    ['DECIDER_NOT_AUTHENTICATED', 401, 'EVALUATION_PROVIDER_FAILED', true],
    ['DECIDER_RATE_LIMITED', 429, 'EVALUATION_PROVIDER_FAILED', true],
    ['DECIDER_UNREACHABLE', undefined, 'EVALUATION_PROVIDER_FAILED', true],
    ['DECIDER_TIMEOUT', undefined, 'EVALUATION_PROVIDER_FAILED', true],
    ['DECIDER_HTTP_ERROR', 503, 'EVALUATION_PROVIDER_FAILED', true],
    ['DECIDER_HTTP_ERROR', 400, 'EVALUATION_PROVIDER_FAILED', false],
    ['DECIDER_REDIRECT', 302, 'EVALUATION_PROVIDER_FAILED', false],
    ['RAW_PRIVATE_CODE', undefined, 'EVALUATION_PROVIDER_FAILED', false],
  ] as const)(
    'maps provider failure %s to exact resumability',
    async (code, status, expected, resumable) => {
      const e = await createTestEngine();
      e.ports.jev.choose = () =>
        Promise.reject(
          Object.assign(new Error('private-provider-marker'), {
            name: 'private-provider-marker',
            code,
            status,
          }),
        );
      const r = await e.runToIdle(e.publish(decisionLoop('provider-failure', classifier)).loopId);
      expect(r.failure).toMatchObject({ code: expected, resumable });
      for (const data of [r, e.events(r.id), e.ports.logger.lines])
        expect(JSON.stringify(data)).not.toContain('private-provider-marker');
    },
  );
  it('does not retain raw string provider failures', async () => {
    const e = await createTestEngine();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Malformed third-party rejection is an engine boundary input.
    e.ports.jev.choose = () => Promise.reject('private raw rejection');
    const r = await e.runToIdle(e.publish(decisionLoop('raw-error', classifier)).loopId);
    expect(r.failure).toMatchObject({ code: 'EVALUATION_PROVIDER_FAILED', resumable: false });
    expect(JSON.stringify(r)).not.toContain('private raw rejection');
  });
  it.each(
    [3, 8].flatMap((count) => ['expression', 'classifier', 'llm'].map((kind) => ({ count, kind }))),
  )(
    'routes the same stable id with $count options after reorder and numeric display labels ($kind)',
    async ({ count, kind }) => {
      const e = await createTestEngine();
      const selectedId = 'option-c';
      const options = Array.from({ length: count }, (_, index) => ({
        id: 'option-' + String.fromCharCode(97 + index),
        label: String(index + 1),
        criteria: 'Criterion ' + String(index + 1),
      }));
      for (const reverse of [false, true]) {
        const definition = decisionLoop(
          'stable-' + kind + '-' + String(count) + '-' + String(reverse),
          kind === 'expression'
            ? { kind: 'expression', jsonata: '"option-c"' }
            : kind === 'classifier'
              ? classifier
              : llm,
        );
        const node = definition.nodes[1];
        if (node?.kind !== 'decision' || node.config.answer.type !== 'choice')
          throw new Error('Expected Choice decision');
        node.config.answer.options = reverse ? [...options].reverse() : options;
        definition.edges = definition.edges.filter((edge) => edge.from.node !== 'decide');
        definition.edges.push(
          ...options.map((option) => ({
            id: 'edge-' + option.id,
            from: { node: 'decide', port: option.id },
            to: { node: 'done' },
          })),
        );
        const decider = kind === 'classifier' ? e.ports.jev : e.ports.codexDecider;
        decider.choose = (request) => {
          decider.choices.push(request);
          return Promise.resolve(
            answer(
              selectedId,
              1,
              kind === 'classifier'
                ? Object.fromEntries(
                    request.options.map((option) => [option.id, option.id === selectedId ? 1 : 0]),
                  )
                : null,
            ),
          );
        };
        const r = await e.runToIdle(e.publish(definition).loopId);
        expect(r.result).toBe(selectedId);
        expect(e.events(r.id).find((ev) => ev.type === 'decision.made')).toMatchObject({
          portId: selectedId,
          answer: { optionId: selectedId },
        });
        if (kind !== 'expression')
          expect(decider.choices.at(-1)?.options.map((option) => option.id)).toEqual(
            node.config.answer.options.map((option) => option.id),
          );
      }
    },
  );
  it.each(['unknown', 'disabled', 'effort', 'shadowed-default'])(
    'applies catalog admission inside the manager (%s)',
    async (problem) => {
      const e = await createTestEngine();
      let evaluation: DecisionInput['evaluation'] = llm;
      if (problem === 'unknown')
        evaluation = { ...llm, model: { mode: 'explicit', value: 'unknown' } };
      if (problem === 'disabled') e.ports.modelCatalog.entries[0]!.enabled = false;
      if (problem === 'effort') {
        e.ports.modelCatalog.entries[0]!.efforts = ['low'];
        evaluation = { ...llm, effort: { mode: 'explicit', value: 'max' } };
      }
      if (problem === 'shadowed-default') {
        e.settings.ownerDefaults = () =>
          Promise.resolve({ byHarness: { codex: { model: 'unknown' } } });
        evaluation = { ...llm, model: { mode: 'explicit', value: 'gpt-6-sol' } };
      }
      const r = await e.runToIdle(e.publish(decisionLoop('catalog-' + problem, evaluation)).loopId);
      expect(r.failure).toMatchObject({
        code: problem === 'effort' ? 'EVALUATION_INVALID_CONFIGURATION' : 'EVALUATION_UNAVAILABLE',
        resumable: problem !== 'effort',
      });
      expect(e.ports.codexDecider.choices).toEqual([]);
    },
  );
});

describe('mutate node', () => {
  it('applies operations and repairs coerce failures through the structured port', async () => {
    const engine = await createTestEngine();
    engine.ports.structuredFake.respondWith(() => ({ ok: true }));
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const version = engine.publish(
      singleNodeLoop('mut', {
        id: 'mut',
        kind: 'mutate',
        label: 'M',
        config: {
          operations: [
            { op: 'set', path: '/vars/raw', value: { kind: 'literal', value: { ok: 'yes' } } },
            {
              op: 'coerce',
              source: '/vars/raw',
              jsonSchema: schema,
              target: '/vars/clean',
              repair: { maxAttempts: 1 },
            },
            { op: 'append-message', content: 'clean is {{ vars.clean.ok }}' },
          ],
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.vars['clean']).toEqual({ ok: true });
    expect(thread?.messages.at(-1)?.content).toBe('clean is true');
    expect(engine.ports.structuredFake.requests[0]?.prompt).toMatch(/Validation errors/);
  });

  it('continues raw or fails when repair cannot help', async () => {
    const engine = await createTestEngine();
    engine.ports.structuredFake.respondWith(() => ({ ok: 'still wrong' }));
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const raw = engine.publish(
      singleNodeLoop('raw', {
        id: 'mut',
        kind: 'mutate',
        label: 'M',
        config: {
          operations: [
            {
              op: 'coerce',
              source: '/vars/missing',
              jsonSchema: schema,
              target: '/vars/clean',
              repair: { maxAttempts: 1, onFailure: 'continue-raw' },
            },
          ],
        },
      }),
    );
    const okRun = await engine.runToIdle(raw.loopId);
    expect(okRun.status).toBe('succeeded');
    expect((await engine.manager.getThread(okRun.id))?.vars['clean']).toBeNull();

    const strict = engine.publish(
      singleNodeLoop('strict', {
        id: 'mut',
        kind: 'mutate',
        label: 'M',
        config: {
          operations: [
            {
              op: 'coerce',
              source: '/vars/missing',
              jsonSchema: schema,
              target: '/vars/clean',
              repair: { maxAttempts: 1 },
            },
          ],
        },
      }),
    );
    const failed = await engine.runToIdle(strict.loopId);
    expect(failed.failure?.code).toBe('OUTPUT_SCHEMA_MISMATCH');

    delete engine.ports.structured;
    const noProvider = await engine.runToIdle(strict.loopId);
    expect(noProvider.failure?.code).toBe('DECIDER_UNAVAILABLE');
  });

  it('reports mutation errors as unavoidable failures', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('bad', {
        id: 'mut',
        kind: 'mutate',
        label: 'M',
        config: {
          operations: [{ op: 'set', path: '/run/id', value: { kind: 'literal', value: 'x' } }],
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('INTERNAL_ERROR');
    expect(run.failure?.message).toMatch(/not in a mutable region/);
  });
});

describe('script node', () => {
  it('passes the thread on stdin, renders args, resolves secrets, and stores JSON stdout', async () => {
    const engine = await createTestEngine({}, { secrets: { token: 's3cret' } });
    engine.ports.scripts.respondWith((req) => ({
      exitCode: 0,
      stdout: JSON.stringify({
        got: req.args,
        env: req.env['TOKEN'],
        hasStdin: typeof req.stdin === 'string',
      }),
      stderr: '',
      timedOut: false,
    }));
    const version = engine.publish(
      singleNodeLoop('script', {
        id: 'script',
        kind: 'script',
        label: 'S',
        config: {
          command: 'node',
          args: ['check.js', '{{ trigger.payload.n }}'],
          env: { TOKEN: 'secret:token', PLAIN: 'x' },
          cwd: '/work',
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { n: 4 });
    expect(run.status).toBe('succeeded');
    expect(engine.ports.scripts.calls[0]).toMatchObject({
      command: 'node',
      cwd: '/work',
      env: { TOKEN: 's3cret', PLAIN: 'x' },
    });
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.lastOutput?.value).toEqual({
      got: ['check.js', '4'],
      env: 's3cret',
      hasStdin: true,
    });
  });

  it('applies a JSON patch from stdout and rejects patches outside mutable regions', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: JSON.stringify([{ op: 'add', path: '/vars/fromScript', value: 1 }]),
      stderr: '',
      timedOut: false,
    }));
    const version = engine.publish(
      singleNodeLoop('patch', {
        id: 'script',
        kind: 'script',
        label: 'S',
        config: { command: 'x', stdout: 'patch', stdin: 'last-output' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect((await engine.manager.getThread(run.id))?.vars['fromScript']).toBe(1);
    expect(engine.ports.scripts.calls[0]?.stdin).toBe('null');

    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: JSON.stringify([{ op: 'add', path: '/run/id', value: 1 }]),
      stderr: '',
      timedOut: false,
    }));
    expect((await engine.runToIdle(version.loopId)).failure?.message).toMatch(
      /outside the mutable regions/,
    );
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: 'not json',
      stderr: '',
      timedOut: false,
    }));
    expect((await engine.runToIdle(version.loopId)).failure?.message).toMatch(/not a JSON patch/);
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: JSON.stringify([{ op: 'explode' }]),
      stderr: '',
      timedOut: false,
    }));
    expect((await engine.runToIdle(version.loopId)).failure?.message).toMatch(
      /not a valid JSON patch/,
    );
  });

  it('routes by exit code, ignores stdout when told, and fails on unmapped codes, timeouts, and missing secrets', async () => {
    const engine = await createTestEngine();
    const loop: LoopDefinitionInput = {
      schemaVersion: 3,
      name: 'codes',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'script',
          kind: 'script',
          label: 'S',
          config: {
            command: 'x',
            stdout: 'ignore',
            stdin: 'none',
            exitCodeRoutes: { '3': 'retry' },
            timeoutSeconds: 5,
            env: { K: 'secret:nope' },
          },
        },
        {
          id: 'mark',
          kind: 'mutate',
          label: 'M',
          config: {
            operations: [
              { op: 'set', path: '/vars/retried', value: { kind: 'literal', value: true } },
            ],
          },
        },
        { id: 'done', kind: 'exit', label: 'D', config: { return: { mapping: 'vars' } } },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'script' } },
        { id: 'e2', from: { node: 'script', port: 'out' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'script', port: 'retry' }, to: { node: 'mark' } },
        { id: 'e4', from: { node: 'mark', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const version = engine.publish(loop);
    expect((await engine.runToIdle(version.loopId)).failure?.code).toBe('SECRET_MISSING');

    const withSecret = await createTestEngine({}, { secrets: { nope: 'v' } });
    const v2 = withSecret.publish(loop);
    withSecret.ports.scripts.respondWith(() => ({
      exitCode: 3,
      stdout: '',
      stderr: '',
      timedOut: false,
    }));
    expect((await withSecret.runToIdle(v2.loopId)).result).toEqual({ retried: true });
    withSecret.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: 'ignored',
      stderr: '',
      timedOut: false,
    }));
    const plain = await withSecret.runToIdle(v2.loopId);
    expect(plain.result).toEqual({});
    withSecret.ports.scripts.respondWith(() => ({
      exitCode: 7,
      stdout: '',
      stderr: 'bad',
      timedOut: false,
    }));
    expect((await withSecret.runToIdle(v2.loopId)).failure).toMatchObject({
      code: 'SCRIPT_EXIT_CODE',
      details: { exitCode: 7, stderr: 'bad' },
    });
    withSecret.ports.scripts.respondWith(() => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    }));
    expect((await withSecret.runToIdle(v2.loopId)).failure?.code).toBe('SCRIPT_TIMEOUT');
    expect(withSecret.ports.scripts.calls.at(-1)?.timeoutMs).toBe(5000);
  });
});

describe('exit node and return channels', () => {
  it.each(['jev', 'codex'] as const)(
    'sanitizes %s predicate failures and preserves cancellation',
    async (strategy) => {
      const engine = await createTestEngine();
      const decider = strategy === 'jev' ? engine.ports.jev : engine.ports.codexDecider;
      const marker = 'gg-private-predicate-error-regression';
      decider[strategy === 'jev' ? 'classifyNoul' : 'noul'] = (): Promise<never> =>
        Promise.reject(
          Object.assign(new Error(marker), {
            code: 'DECIDER_HTTP_ERROR',
            name: 'JevError',
            status: 400,
          }),
        );
      const version = engine.publish(
        singleNodeLoop(
          'exit-error',
          {
            id: 'noop',
            kind: 'mutate',
            label: 'M',
            config: { operations: [{ op: 'delete', path: '/vars/x' }] },
          },
          {
            criteria: [
              {
                when: 'predicate',
                answer: {
                  type: 'noul',
                  true: { label: 'Ready', criteria: 'Done' },
                  false: { label: 'Continue', criteria: 'Not done' },
                },
                evaluation:
                  strategy === 'jev'
                    ? { kind: 'classifier', model: 'jev', question: 'Done?' }
                    : {
                        kind: 'llm',
                        harness: 'codex',
                        model: { mode: 'inherit' },
                        effort: { mode: 'inherit' },
                        question: 'Done?',
                      },
                match: { type: 'noul', value: true },
                outcome: 'success',
              },
            ],
          },
        ),
      );
      const run = await engine.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: 'EVALUATION_PROVIDER_FAILED',
        message: 'Decision provider request failed',
        details: {
          code: 'DECIDER_HTTP_ERROR',
          provenance: { kind: strategy === 'jev' ? 'classifier' : 'llm' },
        },
      });
      expect(JSON.stringify([run, engine.events(run.id), engine.ports.logger.lines])).not.toContain(
        marker,
      );
      expect(engine.ports.logger.lines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({
            name: 'JevError',
            code: 'DECIDER_HTTP_ERROR',
            status: 400,
            kind: strategy === 'jev' ? 'classifier' : 'llm',
          }),
        }),
      );
      decider[strategy === 'jev' ? 'classifyNoul' : 'noul'] = (): Promise<never> =>
        Promise.reject(new DOMException('aborted', 'AbortError'));
      expect((await engine.runToIdle(version.loopId)).status).toBe('cancelled');
    },
  );
  it('loops back until exhausted and reports the iteration count', async () => {
    const engine = await createTestEngine();
    const loop: LoopDefinitionInput = {
      schemaVersion: 3,
      name: 'loop',
      settings: { maxIterations: 3 },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'count',
          kind: 'mutate',
          label: 'C',
          config: {
            operations: [
              {
                op: 'set',
                path: '/vars/n',
                value: { kind: 'expression', jsonata: '(vars.n ? vars.n : 0) + 1' },
              },
            ],
          },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'D',
          config: {
            default: 'loop-back',
            loopBack: { targetNodeId: 'count' },
            return: { mapping: 'vars.n' },
          },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'count' } },
        { id: 'e2', from: { node: 'count', port: 'out' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'done', port: 'loopBack' }, to: { node: 'count' } },
      ],
    };
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('exhausted');
    expect(run.outcome).toBe('exhausted');
    expect(run.iteration).toBe(3);
    expect(run.result).toBe(3);
    expect(engine.eventTypes(run.id).filter((t) => t === 'iteration.incremented')).toHaveLength(2);
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.run.iteration).toBe(3);
    expect(thread?.counters.nodeVisits['count']).toBe(3);
  });

  it('finishes on a criterion and delivers to every channel, recording failures per channel', async () => {
    const engine = await createTestEngine({}, { secrets: { hook: 'hs' } });
    const version = engine.publish(
      singleNodeLoop(
        'returns',
        {
          id: 'set',
          kind: 'mutate',
          label: 'M',
          config: {
            operations: [
              { op: 'set', path: '/vars/answer', value: { kind: 'literal', value: 42 } },
            ],
          },
        },
        {
          criteria: [
            {
              when: 'predicate',
              answer: { type: 'noul' },
              evaluation: { kind: 'expression', jsonata: 'vars.answer = 42' },
              match: { type: 'noul', value: true },
              outcome: 'success',
            },
          ],
          return: {
            mapping: '{ "answer": vars.answer }',
            channels: [
              { kind: 'caller' },
              { kind: 'log' },
              { kind: 'file', path: 'out/result.json' },
              { kind: 'file', path: '/abs/result.md', format: 'markdown' },
              { kind: 'file', path: 'plain.txt', format: 'text' },
              { kind: 'webhook', url: 'https://example.test/hook', secretRef: 'hook' },
              { kind: 'event', eventType: 'answer-ready' },
            ],
          },
        },
      ),
    );
    const run = await engine.runToIdle(version.loopId, null, {
      returnDefaults: [{ kind: 'log' }, { kind: 'webhook', url: 'https://example.test/default' }],
    });
    expect(run.status).toBe('succeeded');
    expect(run.result).toEqual({ answer: 42 });
    expect(engine.ports.delivery.logged).toHaveLength(1);
    expect(
      [...engine.ports.workspace.files.keys()].some((k) => k.endsWith('out/result.json')),
    ).toBe(true);
    expect(engine.ports.workspace.files.get('/abs/result.md')).toMatch(/Outcome: success/);
    expect([...engine.ports.workspace.files.values()]).toContain('{"answer":42}');
    expect(engine.ports.delivery.webhooks.map((w) => w.url)).toEqual([
      'https://example.test/hook',
      'https://example.test/default',
    ]);
    expect(engine.ports.delivery.webhooks[0]?.secret).toBe('hs');
    expect(engine.ports.delivery.events[0]).toMatchObject({
      eventType: 'answer-ready',
      payload: { result: { answer: 42 }, outcome: 'success' },
    });
    const delivered = engine.events(run.id).filter((e) => e.type === 'return.delivered');
    expect(delivered).toHaveLength(8);
  });

  it('records webhook failures and skips delivery when mapping is none', async () => {
    const engine = await createTestEngine();
    engine.ports.delivery.failWebhooks = true;
    const failing = engine.publish(
      singleNodeLoop(
        'hookfail',
        {
          id: 'noop',
          kind: 'mutate',
          label: 'M',
          config: { operations: [{ op: 'delete', path: '/vars/x' }] },
        },
        {
          return: {
            mapping: 'vars',
            channels: [{ kind: 'webhook', url: 'https://example.test/x' }],
          },
        },
      ),
    );
    const run = await engine.runToIdle(failing.loopId);
    expect(run.status).toBe('succeeded');
    const failed = engine.events(run.id).find((e) => e.type === 'return.failed');
    expect(failed).toMatchObject({ error: 'webhook endpoint returned 503' });

    const silent = engine.publish(
      singleNodeLoop('silent', {
        id: 'noop',
        kind: 'mutate',
        label: 'M',
        config: { operations: [{ op: 'delete', path: '/vars/x' }] },
      }),
      {
        loopId: engine.loopId('silent'),
      },
    );
    const quiet = await engine.runToIdle(silent.loopId, null, {
      returnDefaults: [{ kind: 'log' }],
    });
    expect(quiet.result).toBeUndefined();
    expect(engine.ports.delivery.logged).toHaveLength(0);
  });

  it('evaluates Jev and Codex predicates through the deciders and fails when none is available', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop(
        'pred',
        {
          id: 'noop',
          kind: 'mutate',
          label: 'M',
          config: { operations: [{ op: 'delete', path: '/vars/x' }] },
        },
        {
          criteria: [
            {
              when: 'predicate',
              answer: {
                type: 'noul',
                true: { label: 'Ready', criteria: 'Done' },
                false: { label: 'Continue', criteria: 'Not done' },
              },
              evaluation: {
                kind: 'llm',
                harness: 'codex',
                model: { mode: 'inherit' },
                effort: { mode: 'inherit' },
                question: 'Done with {{ trigger.payload }}?',
              },
              match: { type: 'noul', value: true },
              outcome: 'failure',
            },
          ],
        },
      ),
    );
    const run = await engine.runToIdle(version.loopId, 'task');
    expect(run.status).toBe('failed');
    expect(run.outcome).toBe('failure');
    expect(engine.ports.codexDecider.nouls[0]).toMatchObject({
      question: 'Done with task?',
      model: 'gpt-6-luna',
      effort: 'low',
    });

    engine.ports.deciders = [];
    const none = await engine.runToIdle(version.loopId, 'task');
    expect(none.failure?.code).toBe('EVALUATION_UNAVAILABLE');
  });
});
