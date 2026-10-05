import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

function decisionLoop(name: string, config: Record<string, unknown>): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
      {
        id: 'decide',
        kind: 'decision',
        label: 'D',
        config: {
          routes: [
            { label: 'good', description: 'fine' },
            { label: 'bad', description: 'not fine' },
          ],
          question: 'Is {{ trigger.payload.value }} good?',
          ...config,
        },
      } as LoopDefinitionInput['nodes'][number],
      {
        id: 'mark-good',
        kind: 'mutate',
        label: 'G',
        config: {
          operations: [
            { op: 'set', path: '/vars/verdict', value: { kind: 'literal', value: 'good' } },
          ],
        },
      },
      {
        id: 'mark-bad',
        kind: 'mutate',
        label: 'B',
        config: {
          operations: [
            { op: 'set', path: '/vars/verdict', value: { kind: 'literal', value: 'bad' } },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'D', config: { return: { mapping: 'vars.verdict' } } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
      { id: 'e2', from: { node: 'decide', port: 'good' }, to: { node: 'mark-good' } },
      { id: 'e3', from: { node: 'decide', port: 'bad' }, to: { node: 'mark-bad' } },
      { id: 'e4', from: { node: 'mark-good', port: 'out' }, to: { node: 'done' } },
      { id: 'e5', from: { node: 'mark-bad', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

describe('decision node', () => {
  it.each(['jev', 'codex'] as const)(
    'summarizes %s exceptions without retaining provider messages, stacks, names or arbitrary codes',
    async (strategy) => {
      const engine = await createTestEngine();
      const marker = 'gg-provider-error-private-regression';
      const decider = strategy === 'jev' ? engine.ports.jev : engine.ports.codexDecider;
      for (const code of ['DECIDER_INVALID_RESPONSE', `DECIDER_${marker}`, undefined]) {
        decider.choose = () =>
          Promise.reject(
            Object.assign(new Error(marker), { name: marker, ...(code ? { code } : {}) }),
          );
        const version = engine.publish(
          decisionLoop(`error-${code ?? 'none'}`, { strategy: [strategy] }),
        );
        const run = await engine.runToIdle(version.loopId);
        expect(run.failure).toMatchObject({
          code: 'INTERNAL_ERROR',
          nodeId: 'decide',
          details: { strategy },
        });
        expect(run.failure?.details).toEqual({
          strategy,
          ...(code === 'DECIDER_INVALID_RESPONSE' ? { code } : {}),
        });
        expect(JSON.stringify(run)).not.toContain(marker);
        expect(JSON.stringify(engine.events(run.id))).not.toContain(marker);
      }
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Exercise an untrusted provider that rejects with a raw string.
      decider.choose = () => Promise.reject(marker);
      const version = engine.publish(decisionLoop('string-error', { strategy: [strategy] }));
      const run = await engine.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Decision provider request failed',
      });
      expect(JSON.stringify(run)).not.toContain(marker);
      expect(JSON.stringify(engine.events(run.id))).not.toContain(marker);
    },
  );
  it('routes with an expression and records the decision', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      decisionLoop('expr', {
        strategy: ['expression'],
        expression: { jsonata: 'trigger.payload.value > 5 ? "good" : "bad"' },
      }),
    );
    const good = await engine.runToIdle(version.loopId, { value: 10 });
    expect(good.result).toBe('good');
    const bad = await engine.runToIdle(version.loopId, { value: 1 });
    expect(bad.result).toBe('bad');
    const decision = engine.events(good.id).find((e) => e.type === 'decision.made');
    expect(decision).toMatchObject({ strategy: 'expression', route: 'good' });
    const thread = await engine.manager.getThread(good.id);
    expect(thread?.outputs['decide']?.value).toEqual({
      route: 'good',
      strategy: 'expression',
      confidence: null,
    });
  });

  it('asks Jev first, falls back to Codex on low confidence, and records alternatives', async () => {
    const engine = await createTestEngine();
    engine.ports.jev = Object.assign(engine.ports.jev, {});
    const jevAnswers = [
      { label: 'bad', confidence: 0.3, alternatives: [{ label: 'good', confidence: 0.3 }] },
    ];
    engine.ports.deciders = [
      Object.assign(engine.ports.jev, { choose: () => Promise.resolve(jevAnswers[0]) }),
      Object.assign(engine.ports.codexDecider, {
        choose: () => Promise.resolve({ label: 'good', confidence: 0.9 }),
      }),
    ];
    const version = engine.publish(
      decisionLoop('jev', {
        strategy: ['jev', 'codex'],
        jev: { minConfidence: 0.5 },
        codex: { model: 'gpt-6-sol', effort: 'xhigh' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { value: 7 });
    expect(run.result).toBe('good');
    const decision = engine.events(run.id).find((e) => e.type === 'decision.made');
    expect(decision).toMatchObject({ strategy: 'codex', route: 'good', confidence: 0.9 });
  });

  it('uses Jev when confident and includes selected context', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      decisionLoop('jev2', {
        strategy: ['jev'],
        context: { messages: 'all', vars: [], includeLastOutput: false },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { value: 7 });
    expect(run.result).toBe('good');
    expect(engine.ports.jev.choices[0]?.question).toBe('Is 7 good?');
    expect(engine.ports.jev.choices[0]?.context).toMatchObject({ trigger: { value: 7 }, vars: {} });
  });

  it('skips unavailable deciders and unknown labels, then fails with DECISION_NO_ROUTE', async () => {
    const engine = await createTestEngine();
    engine.ports.jev.isAvailable = false;
    engine.ports.deciders = [
      engine.ports.jev,
      Object.assign(engine.ports.codexDecider, { choose: () => Promise.resolve({ label: 'meh' }) }),
    ];
    const version = engine.publish(
      decisionLoop('none', {
        strategy: ['jev', 'codex', 'expression'],
        expression: { jsonata: '"nope"' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { value: 7 });
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('DECISION_NO_ROUTE');
    expect(run.failure?.message).toMatch(/jev unavailable/);
    expect(run.failure?.message).toContain('codex chose a route that is not declared on this node');
    expect(run.failure?.message).toContain(
      'expression returned a route that is not declared on this node',
    );
  });

  it.each(['jev', 'codex'] as const)(
    'keeps %s unknown-label fallback without persisting the raw answer',
    async (strategy) => {
      const engine = await createTestEngine();
      const marker = 'gg-provider-bearer-private-regression';
      const decider = strategy === 'jev' ? engine.ports.jev : engine.ports.codexDecider;
      decider.choose = () => Promise.resolve({ label: marker, confidence: 1 });
      const fallback = engine.publish(
        decisionLoop('fallback', {
          strategy: [strategy, 'expression'],
          expression: { jsonata: '"good"' },
        }),
      );
      const routed = await engine.runToIdle(fallback.loopId);
      expect(routed).toMatchObject({ status: 'succeeded', result: 'good' });
      expect(
        engine.events(routed.id).find((event) => event.type === 'decision.made'),
      ).toMatchObject({ strategy: 'expression', route: 'good' });
      const only = engine.publish(decisionLoop('only', { strategy: [strategy] }));
      const failed = await engine.runToIdle(only.loopId);
      expect(failed.failure).toMatchObject({
        code: 'DECISION_NO_ROUTE',
        nodeId: 'decide',
        details: { tried: [`${strategy} chose a route that is not declared on this node`] },
      });
      for (const run of [routed, failed]) {
        expect(JSON.stringify(run)).not.toContain(marker);
        expect(JSON.stringify(engine.events(run.id))).not.toContain(marker);
      }
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
      schemaVersion: 1,
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
  it('loops back until exhausted and reports the iteration count', async () => {
    const engine = await createTestEngine();
    const loop: LoopDefinitionInput = {
      schemaVersion: 1,
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
              strategy: 'expression',
              jsonata: 'vars.answer = 42',
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
              strategy: 'codex',
              question: 'Done with {{ trigger.payload }}?',
              outcome: 'failure',
            },
          ],
        },
      ),
    );
    const run = await engine.runToIdle(version.loopId, 'task');
    expect(run.status).toBe('failed');
    expect(run.outcome).toBe('failure');
    expect(engine.ports.codexDecider.judgements[0]).toMatchObject({
      question: 'Done with task?',
      model: 'gpt-6-luna',
      effort: 'low',
    });

    engine.ports.deciders = [];
    const none = await engine.runToIdle(version.loopId, 'task');
    expect(none.failure?.code).toBe('DECIDER_UNAVAILABLE');
  });
});
