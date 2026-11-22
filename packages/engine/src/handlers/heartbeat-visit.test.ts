import { describe, expect, it } from 'vitest';
import { applyPatch, ExpressionError, TemplateError } from '@graphgoblin/domain';
import type { RunRecord } from '@graphgoblin/contracts';
import type { NodeContext } from '../handler.js';
import { ProbeBodyOverflowError } from '../errors.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from '../testing/scenario.js';
import { heartbeatHandler } from './heartbeat.js';

describe('heartbeat public handler visit evidence', () => {
  it('continues persisted beats and observations after a retry, then resets after completion', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('handler-visit', {
        id: 'hb',
        kind: 'heartbeat',
        label: 'Heartbeat',
        config: {
          intervalSeconds: 1,
          probe: { kind: 'signal-count', name: 'tick' },
          until: 'probe.count >= 3',
          maxBeats: 3,
          record: 'full',
        },
      }),
    );
    const run = await e.runToIdle(v.loopId);
    const waitId = run.waiting!.waitId;
    await e.manager.signal(run.id, 'tick', waitId);
    await e.manager.signal(run.id, 'tick', waitId);
    e.manager.stop();
    // A completed observation was persisted before an interrupted park/retry.
    await e.ports.events.append(run.id, [
      { type: 'run.woken', nodeId: 'hb', reason: 'timer' },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 2, configHash: 'fixture' },
      { type: 'heartbeat.beat', nodeId: 'hb', beat: 2, result: { name: 'tick', count: 2 } },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 3, configHash: 'fixture' },
    ]);
    const node = v.definition.nodes.find((n) => n.kind === 'heartbeat');
    if (node?.kind !== 'heartbeat') throw Error('fixture');
    const thread = await e.manager.getThread(run.id);
    if (!thread) throw Error('thread');
    const unused = () => Promise.reject(new Error('unused service'));
    const ctx: NodeContext<'heartbeat'> = {
      node,
      config: node.config,
      definition: v.definition,
      thread,
      run: { ...run, status: 'running' },
      attempt: 3,
      previousWait: run.waiting!,
      signal: new AbortController().signal,
      ports: e.ports,
      settings: e.settings,
      services: {
        render: unused,
        record: async (draft) => {
          await e.ports.events.append(run.id, [draft]);
        },
        resolveModel: unused,
        startChild: unused,
        childOutcome: unused,
        resumeChild: unused,
        events: () => e.ports.events.read(run.id),
        depth: () => Promise.resolve(0),
        workingDirectory: () => Promise.resolve({ ok: true, directory: '.' }),
        newId: () => e.ports.ids.next(),
        now: () => e.ports.clock.now().toISOString(),
      },
    };
    const continued = await heartbeatHandler.execute(ctx);
    expect(continued.kind).toBe('done');
    expect(
      e
        .events(run.id)
        .filter((ev) => ev.type === 'heartbeat.beat')
        .at(-1),
    ).toMatchObject({ beat: 3 });
    expect(applyPatch(ctx.thread, continued.patch).outputs['hb']?.value).toEqual({
      beat: 3,
      probe: { name: 'tick', count: 2 },
      exhausted: true,
    });
    await e.ports.events.append(run.id, [
      { type: 'node.finished', nodeId: 'hb', patch: continued.patch, route: 'out', durationMs: 0 },
      { type: 'signal.received', name: 'tick' },
      { type: 'signal.received', name: 'tick' },
      { type: 'node.started', nodeId: 'hb', kind: 'heartbeat', attempt: 1, configHash: 'fixture' },
    ]);
    const { previousWait: _previous, ...fresh } = ctx;
    const next = await heartbeatHandler.execute({ ...fresh, attempt: 1 });
    expect(next.kind).toBe('park');
    if (next.kind === 'park') expect(next.wait.beat).toBe(1);
    expect(
      e
        .events(run.id)
        .filter((ev) => ev.type === 'heartbeat.beat')
        .at(-1),
    ).toMatchObject({ beat: 1, result: { name: 'tick', count: 0 } });
  });
});

const badHeartbeatTemplate = 'first\n{% PRIVATE_SOURCE %}';
const heartbeatParseCause =
  'The template could not be parsed at line 2, column 1. Check its Liquid syntax.';
const heartbeatEvaluationCause =
  'The expression could not evaluate this input. Check its input type and mapping.';

function authoredHeartbeat(config: Record<string, unknown>) {
  return singleNodeLoop(
    'authored-heartbeat',
    {
      id: 'hb',
      kind: 'heartbeat',
      label: 'Heartbeat',
      config: { intervalSeconds: 1, maxBeats: 1, ...config },
    },
    { returns: 'lastOutput.value' },
  );
}

async function assertHeartbeatFailure(
  e: TestEngine,
  run: RunRecord,
  boundary: string,
  label: string,
  cause: string,
  indices: Record<string, number> = {},
) {
  const code = boundary === 'heartbeat.until' ? 'EXPRESSION_ERROR' : 'TEMPLATE_ERROR';
  expect(run.failure).toEqual({
    code,
    nodeId: 'hb',
    resumable: false,
    message: `${label} failed. ${cause}`,
    details: { boundary, ...indices, cause: { code, message: cause } },
  });
  expect(e.events(run.id).findLast((event) => event.type === 'run.failed')).toMatchObject({
    failure: run.failure,
  });
  const effects = {
    requests: e.ports.probes.requests.length,
    scripts: e.ports.scripts.calls.length,
    beats: e.events(run.id).filter((event) => event.type === 'heartbeat.beat').length,
    timers: [...e.ports.timers.scheduled],
    events: e.events(run.id),
  };
  await expect(e.manager.resume(run.id)).rejects.toThrow();
  await e.manager.waitForIdle();
  expect(e.ports.probes.requests).toHaveLength(effects.requests);
  expect(e.ports.scripts.calls).toHaveLength(effects.scripts);
  expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(
    effects.beats,
  );
  expect(e.ports.timers.scheduled).toEqual(effects.timers);
  expect(e.events(run.id)).toEqual(effects.events);
  expect(e.ports.timers.scheduled).toHaveLength(0);
  for (const data of [run.failure, e.ports.logger.lines])
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
}

describe('heartbeat authored boundaries (#486)', () => {
  it('renders HTTP headers, URL and body before one successful probe', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(
        authoredHeartbeat({
          probe: {
            kind: 'http',
            method: 'POST',
            url: 'https://example.test/{{ trigger.payload }}',
            headers: { '9': 'nine {{ trigger.payload }}', later: 'last', '2': 'two' },
            body: 'body {{ trigger.payload }}',
          },
          until: 'probe.status = 200',
          record: 'full',
        }),
      ).loopId,
      'value',
    );
    expect(run.status).toBe('succeeded');
    expect(e.ports.probes.requests).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: 'https://example.test/value',
        headers: { '2': 'two', '9': 'nine value', later: 'last' },
        body: 'body value',
      }),
    ]);
    expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toEqual([
      expect.objectContaining({
        beat: 1,
        result: { status: 200, headers: {}, body: '', json: '' },
      }),
    ]);
  });

  it.each([
    [
      'headers',
      { '9': badHeartbeatTemplate, PRIVATE_HEADER: 'last', '2': 'ok' },
      'Heartbeat probe header 2',
      { headerIndex: 1 },
    ],
    ['url', undefined, 'Heartbeat probe URL', {}],
    ['body', undefined, 'Heartbeat probe body', {}],
  ] as const)(
    'fails probe %s before HTTP and beat effects',
    async (field, headers, label, indices) => {
      const e = await createTestEngine();
      const run = await e.runToIdle(
        e.publish(
          authoredHeartbeat({
            probe: {
              kind: 'http',
              method: 'POST',
              headers,
              url: field === 'url' ? badHeartbeatTemplate : 'https://example.test',
              body: field === 'body' ? badHeartbeatTemplate : 'ok',
            },
            until: 'true',
            record: 'full',
          }),
        ).loopId,
      );
      await assertHeartbeatFailure(
        e,
        run,
        `heartbeat.probe.${field}`,
        label,
        heartbeatParseCause,
        indices,
      );
      expect(e.ports.probes.requests).toHaveLength(0);
      expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(0);
    },
  );

  it('renders script arguments before resolving the workspace or running a probe', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(
        authoredHeartbeat({
          probe: { kind: 'script', command: 'probe', args: ['ok', badHeartbeatTemplate] },
        }),
      ).loopId,
    );
    await assertHeartbeatFailure(
      e,
      run,
      'heartbeat.probe.args',
      'Heartbeat probe argument 2',
      heartbeatParseCause,
      { argumentIndex: 1 },
    );
    expect(e.ports.workspace.resolved).toHaveLength(0);
    expect(e.ports.scripts.calls).toHaveLength(0);
    expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(0);
    expect(e.eventTypes(run.id)).not.toContain('script.dispatched');
  });

  it('keeps script-probe argument values and the resolved workspace on success', async () => {
    const e = await createTestEngine();
    const def = authoredHeartbeat({
      probe: { kind: 'script', command: 'probe', args: ['{{ trigger.payload }}'] },
      until: 'probe.exitCode = 0',
    });
    def.settings = {
      workingDirectory: { kind: 'template', template: '  /shared/{{ trigger.payload }}  ' },
    };
    const run = await e.runToIdle(e.publish(def).loopId, 'value');
    expect(run.status).toBe('succeeded');
    expect(e.ports.scripts.calls).toEqual([
      expect.objectContaining({ args: ['value'], cwd: '/shared/value' }),
    ]);
    expect(e.ports.workspace.resolved).toHaveLength(1);
    expect(e.eventTypes(run.id)).not.toContain('script.dispatched');
    expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(1);
  });

  it.each([
    '$error("PRIVATE_LITERAL")',
    '($error("PRIVATE_LITERAL"))',
    'true ? $error(probe.body) : false',
    '$eval("$error(\\"PRIVATE_DYNAMIC\\")")',
    '$assert(false, probe.body)',
    '$eval("a +")',
    '$eval("/((a+)+)$/")',
  ])('uses fixed until copy after one real recorded probe (%s)', async (until) => {
    const e = await createTestEngine();
    e.ports.probes.respondWith(() => ({ status: 200, headers: {}, body: 'PRIVATE_INPUT' }));
    const run = await e.runToIdle(
      e.publish(
        authoredHeartbeat({
          probe: { kind: 'http', url: 'https://example.test' },
          until,
          record: 'full',
        }),
      ).loopId,
    );
    await assertHeartbeatFailure(
      e,
      run,
      'heartbeat.until',
      'Heartbeat until predicate, beat 1',
      heartbeatEvaluationCause,
      { beat: 1 },
    );
    expect(e.ports.probes.requests).toHaveLength(1);
    const events = e.events(run.id);
    const beats = events.filter((event) => event.type === 'heartbeat.beat');
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ beat: 1, result: { body: 'PRIVATE_INPUT' } });
    expect(events.findIndex((event) => event.type === 'heartbeat.beat')).toBeLessThan(
      events.findIndex((event) => event.type === 'run.failed'),
    );
  });

  it.each([
    ['a +', 'The expression could not be parsed. Check its JSONata syntax.'],
    ['/((a+)+)$/', 'The expression uses an unsafe regular expression. Simplify the pattern.'],
  ])(
    'synthetic publish-validation bypass: top-level until %s has a specific cause',
    async (until, cause) => {
      const e = await createTestEngine();
      const run = await e.runToIdle(e.publish(authoredHeartbeat({ until })).loopId);
      await assertHeartbeatFailure(
        e,
        run,
        'heartbeat.until',
        'Heartbeat until predicate, beat 1',
        cause,
        { beat: 1 },
      );
      expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(1);
    },
  );

  it('keeps false until and valid deadline behavior, then completes on a later true until', async () => {
    const e = await createTestEngine();
    let probes = 0;
    e.ports.probes.respondWith(() => ({
      status: ++probes === 1 ? 202 : 200,
      headers: {},
      body: '',
    }));
    const run = await e.runToIdle(
      e.publish(
        authoredHeartbeat({
          probe: { kind: 'http', url: 'https://example.test' },
          until: 'probe.status = 200',
          deadline: '2026-10-02T13:00:00Z',
          maxBeats: 3,
        }),
      ).loopId,
    );
    expect(run.status).toBe('waiting');
    expect(run.waiting).toMatchObject({ beat: 1, kind: 'heartbeat' });
    await e.ports.timers.fire(run.id, 'heartbeat');
    const done = await e.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({ beat: 2, satisfied: true });
    expect(probes).toBe(2);
    expect(e.ports.timers.scheduled).toHaveLength(0);
  });

  it('reports only the two observed probes and beats on a later-visit predicate failure', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(
        authoredHeartbeat({
          probe: { kind: 'http', url: 'https://example.test' },
          maxBeats: 3,
          until: 'beat = 1 ? false : $error("PRIVATE_SECOND_BEAT")',
          record: 'full',
        }),
      ).loopId,
    );
    expect(run.status).toBe('waiting');
    await e.ports.timers.fire(run.id, 'heartbeat');
    const failed = await e.settle(run.id);
    await assertHeartbeatFailure(
      e,
      failed,
      'heartbeat.until',
      'Heartbeat until predicate, beat 2',
      heartbeatEvaluationCause,
      { beat: 2 },
    );
    expect(e.ports.probes.requests).toHaveLength(2);
    expect(
      e
        .events(run.id)
        .filter((event) => event.type === 'heartbeat.beat')
        .map((event) => event.beat),
    ).toEqual([1, 2]);
  });

  it.each([badHeartbeatTemplate, '{{ trigger.payload }}'])(
    'fails deadline after one probe and persisted summary beat (%s)',
    async (deadline) => {
      const e = await createTestEngine();
      const run = await e.runToIdle(
        e.publish(
          authoredHeartbeat({
            probe: { kind: 'http', url: 'https://example.test' },
            until: 'false',
            deadline,
            record: 'summary',
          }),
        ).loopId,
        'PRIVATE_TIMESTAMP',
      );
      await assertHeartbeatFailure(
        e,
        run,
        'heartbeat.deadline',
        'Heartbeat deadline, beat 1',
        deadline === badHeartbeatTemplate
          ? heartbeatParseCause
          : 'The value must render to a timestamp. Check the template and date format.',
        { beat: 1 },
      );
      expect(e.ports.probes.requests).toHaveLength(1);
      const beats = e.events(run.id).filter((event) => event.type === 'heartbeat.beat');
      expect(beats).toHaveLength(1);
      expect(beats[0]).not.toHaveProperty('result');
    },
  );

  it.each([badHeartbeatTemplate, 'PRIVATE_TIMESTAMP'])(
    'successful until bypasses a bad deadline (%s)',
    async (deadline) => {
      const e = await createTestEngine();
      const run = await e.runToIdle(
        e.publish(authoredHeartbeat({ until: 'true', deadline })).loopId,
      );
      expect(run.status).toBe('succeeded');
      expect(run.result).toMatchObject({ satisfied: true, beat: 1 });
    },
  );

  const externalErrors = [
    new TemplateError('PRIVATE_EXTERNAL'),
    new ExpressionError('PRIVATE_EXTERNAL'),
    Object.assign(new Error('PRIVATE_EXTERNAL'), { name: 'ExpressionError' }),
    { code: 'EXPRESSION_ERROR', message: 'PRIVATE_EXTERNAL' },
  ];
  it.each([badHeartbeatTemplate, '   '])(
    'maps only local script-probe workspace failure (%s)',
    async (template) => {
      const e = await createTestEngine();
      const def = authoredHeartbeat({ probe: { kind: 'script', command: 'probe', args: ['ok'] } });
      def.settings = { workingDirectory: { kind: 'template', template } };
      const run = await e.runToIdle(e.publish(def).loopId);
      await assertHeartbeatFailure(
        e,
        run,
        'settings.workingDirectory.template',
        'Working directory template',
        template === badHeartbeatTemplate
          ? heartbeatParseCause
          : 'The template rendered to an empty path. Supply a nonempty directory.',
      );
      expect(e.ports.workspace.resolved).toHaveLength(0);
      expect(e.ports.scripts.calls).toHaveLength(0);
      expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(0);
    },
  );
  it.each(['http', 'script', 'workspace'] as const)(
    'preserves external %s exception policy',
    async (source) => {
      for (const error of externalErrors) {
        const e = await createTestEngine();
        let calls = 0;
        const reject = () => {
          calls += 1;
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Plain lookalikes are intentional external boundary inputs.
          return Promise.reject(error);
        };
        if (source === 'http') e.ports.probes.fetch = reject;
        if (source === 'script') e.ports.scripts.run = reject;
        if (source === 'workspace') e.ports.workspace.resolve = reject;
        const run = await e.runToIdle(
          e.publish(
            authoredHeartbeat({
              probe:
                source === 'http'
                  ? { kind: 'http', url: 'https://example.test' }
                  : { kind: 'script', command: 'probe' },
            }),
          ).loopId,
        );
        expect(run.failure).toMatchObject({
          code: 'INTERNAL_ERROR',
          nodeId: 'hb',
          resumable: true,
        });
        expect(run.failure).not.toHaveProperty('details.boundary');
        expect(run.failure).not.toHaveProperty('details.cause');
        expect(calls).toBe(1);
        expect(e.events(run.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(0);
      }
    },
  );

  it('keeps probe overflow and post-response conversion separate from authored rendering', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      authoredHeartbeat({ probe: { kind: 'http', url: 'https://example.test' } }),
    );
    const fetch = e.ports.probes.fetch.bind(e.ports.probes);
    e.ports.probes.fetch = () => Promise.reject(new ProbeBodyOverflowError());
    const overflow = await e.runToIdle(v.loopId);
    expect(overflow.failure?.code).toBe('HTTP_PROBE_BODY_OVERFLOW');
    expect(overflow.failure).not.toHaveProperty('details.boundary');
    e.ports.probes.respondWith(() => ({
      status: 200,
      headers: {},
      get body(): string {
        throw new TemplateError('PRIVATE_CONVERSION');
      },
    }));
    // Restore the production fake method after the explicit fetch rejection control.
    e.ports.probes.fetch = fetch;
    const conversion = await e.runToIdle(v.loopId);
    expect(conversion.failure).toMatchObject({ code: 'INTERNAL_ERROR', resumable: true });
    expect(conversion.failure).not.toHaveProperty('details.boundary');
    expect(e.events(conversion.id).filter((event) => event.type === 'heartbeat.beat')).toHaveLength(
      0,
    );
  });
});
