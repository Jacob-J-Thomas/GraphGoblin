import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput, Node, RunEvent } from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { RunCancelledError, RunFailureError, describeError, isAbortError } from './errors.js';
import { nodeOfKind } from './handler.js';
import {
  addUsage,
  hasPath,
  jsonOrText,
  outputPatch,
  selectCollection,
  selectMessages,
  withTimeout,
} from './handlers/common.js';
import { defaultHandlers } from './handlers/index.js';
import { RunManager } from './run-manager.js';
import {
  CapturingLogger,
  FakeClock,
  FakeDecider,
  FakeProbes,
  FakeScripts,
  FakeStructured,
  FakeTimers,
  InMemoryEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  asyncIterableOf,
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
} from './testing/fakes.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import type { HarnessPort, HarnessSession } from './ports.js';

describe('errors', () => {
  it('builds failures with and without node ids and survives unserialisable details', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const plain = new RunFailureError('SCRIPT_TIMEOUT', 'slow');
    expect(plain.toFailure()).toEqual({ code: 'SCRIPT_TIMEOUT', message: 'slow', resumable: true });
    expect(plain.toFailure('n1').nodeId).toBe('n1');
    const withDetails = new RunFailureError('INTERNAL_ERROR', 'x', {
      resumable: false,
      details: circular,
      nodeId: 'own',
    });
    expect(withDetails.toFailure('other')).toMatchObject({
      nodeId: 'own',
      resumable: false,
      details: '[object Object]',
    });
  });

  it('describes errors of every shape and recognises aborts', () => {
    expect(describeError(new Error('e'))).toBe('e');
    expect(describeError({ message: 'm' })).toBe('m');
    expect(describeError('s')).toBe('s');
    expect(isAbortError(new RunCancelledError())).toBe(true);
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('run cancelled'))).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
    expect(isAbortError('nope')).toBe(false);
  });

  it('nodeOfKind narrows or throws', () => {
    const node: Node = {
      id: 'n',
      kind: 'exit',
      label: 'E',
      ui: { x: 0, y: 0 },
      config: { criteria: [], default: 'success', return: { mapping: 'none', channels: [] } },
    };
    expect(nodeOfKind(node, 'exit').kind).toBe('exit');
    expect(() => nodeOfKind(node, 'wait')).toThrow(/expected node n to be wait/);
  });
});

describe('handler helpers', () => {
  it('jsonOrText handles blanks, JSON, and text', () => {
    expect(jsonOrText('')).toBe('');
    expect(jsonOrText('   ')).toBe('');
    expect(jsonOrText(' {"a":1} ')).toEqual({ a: 1 });
    expect(jsonOrText('plain')).toBe('plain');
  });

  it('outputPatch records schema refs and replaces existing outputs', () => {
    const thread = sampleThread({
      outputs: { n: { nodeId: 'n', value: 1, at: FIXTURE_TS } },
      lastOutput: { nodeId: 'n', value: 1, at: FIXTURE_TS },
    });
    const patch = outputPatch(thread, 'n', 2, FIXTURE_TS, 'schema-1');
    expect(patch.map((p) => p.op)).toEqual(['replace', 'replace']);
    expect(patch[0]).toMatchObject({ value: { schemaRef: 'schema-1' } });
  });

  it('addUsage tolerates partial usage', () => {
    const base = {
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 3,
      reasoningOutputTokens: 4,
    };
    expect(addUsage(base, {})).toEqual(base);
    expect(
      addUsage(base, {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 1,
        reasoningOutputTokens: 1,
      }),
    ).toEqual({ inputTokens: 2, outputTokens: 3, cachedInputTokens: 4, reasoningOutputTokens: 5 });
  });

  it('selects messages and collections by every selection form', async () => {
    const { messages, artifacts } = sampleThread({
      artifacts: [{ id: 'a', kind: 'file', ref: 'r', nodeId: 'n' }],
    });
    expect(await selectMessages(messages, 'last', {})).toHaveLength(1);
    expect(await selectMessages([], 'last', {})).toEqual([]);
    expect(await selectMessages(messages, 1, {})).toEqual([messages[1]]);
    expect(await selectMessages(messages, 'none', {})).toEqual([]);
    expect(await selectMessages(messages, undefined, {})).toHaveLength(2);
    expect(await selectMessages(messages, { where: 'role = "user"' }, {})).toEqual([messages[0]]);
    expect(await selectCollection(artifacts, 'none', {})).toEqual([]);
    expect(await selectCollection(artifacts, undefined, {})).toHaveLength(1);
    expect(await selectCollection(artifacts, { where: 'kind = "file"' }, {})).toHaveLength(1);
    expect(await selectCollection(artifacts, { where: 'kind = "diff"' }, {})).toHaveLength(0);
  });

  it('withTimeout forwards an already-aborted signal and disposes cleanly', () => {
    const controller = new AbortController();
    controller.abort(new Error('early'));
    const t = withTimeout(controller.signal, 10, () => new Error('late'));
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.dispose();
    const none = withTimeout(new AbortController().signal, undefined, () => new Error('x'));
    expect(none.timedOut()).toBe(false);
    none.dispose();
  });

  it('hasPath walks objects and arrays', () => {
    const doc = { a: [1, { b: 2 }], s: 'str' };
    expect(hasPath(doc, '/a/1/b')).toBe(true);
    expect(hasPath(doc, '/a/5')).toBe(false);
    expect(hasPath(doc, '/a/x')).toBe(false);
    expect(hasPath(doc, '/s/0')).toBe(false);
    expect(hasPath(doc, '/missing')).toBe(false);
    expect(hasPath(doc, '')).toBe(true);
  });
});

describe('fakes', () => {
  it('cover their helper branches', async () => {
    const clock = new FakeClock();
    clock.set('2026-01-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');

    const logger = new CapturingLogger();
    logger.debug({}, 'd');
    logger.info({}, 'i');
    logger.warn({}, 'w');
    expect(logger.lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn']);

    const store = new InMemoryEventStore(clock);
    const seen: RunEvent[] = [];
    const unsubscribe = store.subscribe(FIXTURE_IDS.run, (e) => seen.push(e));
    await store.append(FIXTURE_IDS.run, [{ type: 'run.queued' }]);
    unsubscribe();
    await store.append(FIXTURE_IDS.run, [{ type: 'run.started', attempt: 1 }]);
    expect(seen).toHaveLength(1);
    expect(store.all('nope')).toEqual([]);

    const runs = new InMemoryRunRepository();
    await expect(runs.update('missing', {})).rejects.toThrow(/not found/);
    await expect(runs.transition('missing', ['queued'], {})).rejects.toThrow(/not found/);

    const sessions = new InMemorySessionRepository();
    await sessions.upsert({
      runId: 'r',
      nodeId: 'a',
      attempt: 1,
      harness: 'codex',
      sessionId: 's1',
      status: 'finished',
      updatedAt: '2026-01-01T00:00:01.000Z',
      scopeKey: 'k',
    });
    await sessions.upsert({
      runId: 'r',
      nodeId: 'b',
      attempt: 1,
      harness: 'codex',
      sessionId: 's2',
      status: 'finished',
      updatedAt: '2026-01-01T00:00:02.000Z',
      scopeKey: 'k',
    });
    expect((await sessions.latestWithSession('r'))?.sessionId).toBe('s2');
    expect((await sessions.byScopeKey('k'))?.sessionId).toBe('s2');

    const decider = new FakeDecider('jev');
    expect(
      await decider.choose(
        { question: 'q', options: [{ label: 'x', description: '' }], context: null },
        new AbortController().signal,
      ),
    ).toMatchObject({ label: 'x' });
    expect(
      await decider.judge({ question: 'q', context: null }, new AbortController().signal),
    ).toMatchObject({ holds: true });
    const emptyDecider = new FakeDecider('codex');
    expect(
      (
        await emptyDecider.choose(
          { question: 'q', options: [], context: null },
          new AbortController().signal,
        )
      ).label,
    ).toBe('');

    expect(
      await new FakeStructured().complete(
        { prompt: 'p', schema: {} },
        new AbortController().signal,
      ),
    ).toEqual({ value: {} });
    expect(
      await new FakeScripts().run({
        command: 'c',
        args: [],
        cwd: '.',
        env: {},
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ exitCode: 0 });
    expect(
      await new FakeProbes().fetch(
        { method: 'GET', url: 'u', timeoutMs: 1 },
        new AbortController().signal,
      ),
    ).toMatchObject({ status: 200 });

    const timers = new FakeTimers();
    await timers.schedule('r', 'a', new Date());
    await timers.schedule('r', 'b', new Date());
    await timers.cancel('r', 'a');
    expect(timers.scheduled.map((t) => t.key)).toEqual(['b']);
    const off = timers.onFire(() => undefined);
    off();
    await timers.fire('r', 'b');
    expect(timers.scheduled).toEqual([]);

    const ports = createFakePorts();
    expect(await ports.harness.preflight()).toMatchObject({ ok: true });
    expect(await ports.workspace.resolve({ kind: 'fixed', path: '/fixed' }, {}, 'r')).toBe(
      '/fixed',
    );
    expect(await ports.workspace.resolve({ kind: 'template', template: '/t' }, {}, 'r')).toBe('/t');
    expect(await ports.loops.getPublished('nope', 1)).toBeUndefined();
  });
});

describe('run manager edge cases', () => {
  it('records dedupe keys and accepts input without a schema', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('w', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'input', prompt: 'p' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, null, { dedupeKey: 'dk-1' });
    expect((await engine.manager.getThread(run.id))?.invocation.trigger.dedupeKey).toBe('dk-1');
    await engine.manager.provideInput(run.id, 'free text');
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect((await engine.manager.getThread(done.id))?.messages.at(-1)?.content).toBe('free text');
  });

  it('rejects loops without triggers and fails edges to unknown nodes', async () => {
    const engine = await createTestEngine();
    const noTrigger = engine.publish({
      schemaVersion: 1,
      name: 'nt',
      nodes: [{ id: 'done', kind: 'exit', label: 'D', config: {} }],
      edges: [],
    });
    await expect(engine.start(noTrigger.loopId)).rejects.toMatchObject({
      code: 'TRIGGER_NOT_FOUND',
    });
    const ghost = minimalLoop();
    ghost.edges = [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ghost' } }];
    const version = engine.publish(ghost, { loopId: engine.loopId('ghost') });
    const run = await engine.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringMatching(/ghost not found/) as string,
      resumable: false,
    });
  });

  it('turns unexpected handler failures into internal errors, including non-Error throws and invalid patches', async () => {
    const ports = createFakePorts();
    const handlers = defaultHandlers();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the point
    handlers.mutate = { kind: 'mutate', execute: () => Promise.reject('boom') };
    handlers.script = {
      kind: 'script',
      execute: () =>
        Promise.resolve({
          kind: 'done',
          patch: [{ op: 'add', path: '/bogus', value: 1 }],
          route: 'out',
        }),
    };
    const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS, handlers);
    await manager.start();
    const mutateLoop = ports.loops.publish(
      '01HZZZZZZZZZZZZZZZZZZZZZZ1',
      '01HZZZZZZZZZZZZZZZZZZZZZZ2',
      1,
      LoopDefinitionSchema.parse(
        singleNodeLoop('m', {
          id: 'm',
          kind: 'mutate',
          label: 'M',
          config: { operations: [{ op: 'delete', path: '/vars/x' }] },
        }),
      ),
    );
    const scriptLoop = ports.loops.publish(
      '01HZZZZZZZZZZZZZZZZZZZZZZ3',
      '01HZZZZZZZZZZZZZZZZZZZZZZ4',
      1,
      LoopDefinitionSchema.parse(
        singleNodeLoop('s', { id: 's', kind: 'script', label: 'S', config: { command: 'x' } }),
      ),
    );
    const a = await manager.startRun({
      ownerId: 'local',
      loopId: mutateLoop.loopId,
      source: 'manual.api',
    });
    const b = await manager.startRun({
      ownerId: 'local',
      loopId: scriptLoop.loopId,
      source: 'manual.api',
    });
    await manager.waitForIdle();
    expect((await ports.runs.get(a.id))?.failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'boom',
      details: null,
    });
    expect((await ports.runs.get(b.id))?.failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringMatching(/invalid patch/) as string,
      resumable: false,
    });
    expect(ports.logger.lines.some((l) => l.level === 'error' && l.msg === 'node failed')).toBe(
      true,
    );
  });

  it('fails a run when infrastructure throws outside node execution', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(minimalLoop());
    vi.spyOn(engine.ports.runs, 'saveThread').mockRejectedValueOnce(new Error('disk full'));
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', message: 'disk full' });
    expect(
      engine.ports.logger.lines.some((l) => l.msg === 'executor crashed outside node execution'),
    ).toBe(true);
  });

  it('logs timer wake failures instead of crashing', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('w', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'duration', seconds: 1 },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    vi.spyOn(engine.ports.runs, 'get').mockRejectedValueOnce(new Error('db down'));
    await engine.ports.timers.fire(run.id, 'timer');
    expect(engine.ports.logger.lines.some((l) => l.msg === 'timer wake failed')).toBe(true);
  });

  it('leaves waiting runs alone at recovery and replays threads without snapshots', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('w', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'input', prompt: 'p' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { seed: 1 });
    engine.manager.stop();
    const second = new RunManager(engine.ports, DEFAULT_TEST_SETTINGS);
    await second.start();
    await second.waitForIdle();
    expect((await engine.ports.runs.get(run.id))?.status).toBe('waiting');
    engine.ports.runs.dropThreadSnapshot(run.id);
    await second.provideInput(run.id, { ok: true });
    await second.waitForIdle();
    const done = await engine.ports.runs.get(run.id);
    expect(done?.status).toBe('succeeded');
    const thread = await second.getThread(run.id);
    expect(thread?.outputs['start']?.value).toEqual({ seed: 1 });
    second.stop();
  });

  it('ignores a second cancel while the first is in flight and resolves the working directory from loop settings', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: 'slow', delayMs: 300 }]);
    const loop = singleNodeLoop('slow', {
      id: 'infer',
      kind: 'inference',
      label: 'I',
      config: { prompt: { template: 'go' }, capabilities: { mcpServers: ['gh'] } },
    });
    loop.settings = { workingDirectory: { kind: 'fixed', path: '/repo' } };
    const version = engine.publish(loop);
    const run = await engine.start(version.loopId);
    await waitFor(() => engine.eventTypes(run.id).includes('harness.session'));
    const first = await engine.manager.cancel(run.id);
    const second = await engine.manager.cancel(run.id);
    expect(first.cancelRequestedAt).toBeDefined();
    expect(second.cancelRequestedAt).toBe(first.cancelRequestedAt);
    const done = await engine.settle(run.id);
    expect(done.status).toBe('cancelled');
    expect(engine.ports.harness.started[0]).toMatchObject({
      workingDirectory: '/repo',
      capabilities: { mcpServers: ['gh'] },
    });
  });

  it('writes text-format file returns for non-string payloads', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop(
        'txt',
        {
          id: 'noop',
          kind: 'mutate',
          label: 'M',
          config: { operations: [{ op: 'delete', path: '/vars/x' }] },
        },
        {
          return: {
            mapping: '{ "a": 1 }',
            channels: [{ kind: 'file', path: 'out.txt', format: 'text' }],
          },
        },
      ),
    );
    await engine.runToIdle(version.loopId);
    expect([...engine.ports.workspace.files.values()]).toContain('{"a":1}');
  });
});

describe('handler edge cases', () => {
  it('decision: non-string expression results, missing context vars, and recorded alternatives', async () => {
    const engine = await createTestEngine();
    engine.ports.deciders = [
      Object.assign(engine.ports.jev, {
        choose: () =>
          Promise.resolve({
            label: 'good',
            confidence: 0.9,
            alternatives: [{ label: 'bad', confidence: 0.1 }, { label: 'good' }],
          }),
      }),
    ];
    const loop: LoopDefinitionInput = {
      schemaVersion: 1,
      name: 'alts',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'decide',
          kind: 'decision',
          label: 'D',
          config: {
            routes: [
              { label: 'good', description: '' },
              { label: 'bad', description: '' },
              { label: 'true', description: 'boolean route' },
            ],
            question: 'q',
            strategy: ['expression', 'jev'],
            expression: { jsonata: 'trigger.payload = 1 ? true : trigger.payload' },
            context: { vars: ['missing', 'topic'], messages: 'none' },
            recordAlternatives: true,
          },
        },
        { id: 'done', kind: 'exit', label: 'D', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
        { id: 'e2', from: { node: 'decide', port: 'good' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'decide', port: 'bad' }, to: { node: 'done' } },
        { id: 'e4', from: { node: 'decide', port: 'true' }, to: { node: 'done' } },
      ],
    };
    const version = engine.publish(loop);
    const boolean = await engine.runToIdle(version.loopId, 1);
    expect(engine.events(boolean.id).find((e) => e.type === 'decision.made')).toMatchObject({
      route: 'true',
      strategy: 'expression',
    });
    const viaJev = await engine.runToIdle(version.loopId, 'unknown-route');
    const decision = engine.events(viaJev.id).find((e) => e.type === 'decision.made');
    expect(decision).toMatchObject({
      strategy: 'jev',
      alternatives: [{ route: 'bad', confidence: 0.1 }, { route: 'good' }],
    });

    const noAlts = engine.publish({
      ...loop,
      name: 'noalts',
      nodes: loop.nodes.map((n) =>
        n.id === 'decide' && n.kind === 'decision'
          ? { ...n, config: { ...n.config, recordAlternatives: false } }
          : n,
      ),
    });
    const quiet = await engine.runToIdle(noAlts.loopId, 'x');
    expect(
      (
        engine.events(quiet.id).find((e) => e.type === 'decision.made') as {
          alternatives?: unknown;
        }
      ).alternatives,
    ).toBeUndefined();
  });

  it('exit: jev predicates and missing last output', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop(
        'jevexit',
        {
          id: 'noop',
          kind: 'mutate',
          label: 'M',
          config: { operations: [{ op: 'delete', path: '/vars/x' }] },
        },
        {
          criteria: [{ when: 'predicate', strategy: 'jev', question: 'done?', outcome: 'success' }],
        },
      ),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.ports.jev.judgements[0]?.context).toMatchObject({ lastOutput: null });
    expect(engine.ports.jev.judgements[0]).not.toHaveProperty('model');
  });

  it('heartbeat: POST probes render headers and bodies', async () => {
    const engine = await createTestEngine();
    engine.ports.probes.respondWith(() => ({
      status: 200,
      headers: {},
      body: 'ok',
      json: { fine: true },
    }));
    const version = engine.publish(
      singleNodeLoop('post', {
        id: 'hb',
        kind: 'heartbeat',
        label: 'H',
        config: {
          intervalSeconds: 1,
          probe: {
            kind: 'http',
            method: 'POST',
            url: 'https://x.test',
            headers: { a: '{{ vars.x }}' },
            body: 'b={{ trigger.payload }}',
          },
          until: 'probe.json.fine',
          maxBeats: 2,
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId, 'v');
    expect(run.status).toBe('succeeded');
    expect(engine.ports.probes.requests[0]).toMatchObject({
      method: 'POST',
      body: 'b=v',
      headers: { a: '' },
    });
  });

  it('script: a null exit code without a timeout is an unmapped exit code', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    }));
    const version = engine.publish(
      singleNodeLoop('nullexit', { id: 's', kind: 'script', label: 'S', config: { command: 'x' } }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({ code: 'SCRIPT_EXIT_CODE', details: { exitCode: -1 } });
  });

  it('wait: duration with a timeout keeps the timer deadline and string inputs stay strings', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('dt', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'duration', seconds: 5, timeoutSeconds: 60 },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.waiting?.until).toBe('2026-10-02T12:00:05.000Z');
    expect(engine.ports.timers.scheduled.map((t) => t.key).sort()).toEqual(['timeout', 'timer']);
  });

  it('inference: notes for tool calls, parsed final text for schemas, and errors without an error event', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([
      {
        items: [
          { id: 'i1', type: 'tool-call', summary: 'search' },
          { id: 'i2', type: 'reasoning', summary: 'thinking' },
        ],
        finalText: '{"ok":true}',
      },
    ]);
    const schema = { type: 'object', required: ['ok'] };
    const version = engine.publish(
      singleNodeLoop('notes', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: {
          prompt: { template: 'p' },
          output: { toMessages: 'final-and-notes', schema: { jsonSchema: schema, native: false } },
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.ports.harness.started[0]?.turn.outputSchema).toBeUndefined();
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.messages.map((m) => m.content)).toEqual(['Tool: search', '{"ok":true}']);
    expect(thread?.lastOutput?.value).toEqual({ ok: true });

    // A harness whose session rejects without emitting an error event or a session id.
    const silent: HarnessPort = {
      id: 'codex',
      preflight: () => Promise.resolve({ ok: true, authenticated: true, problems: [] }),
      start: (): HarnessSession => ({
        sessionId: Promise.resolve('never'),
        events: asyncIterableOf([{ type: 'turn-complete' as const }]),
        result: Promise.reject(Object.assign(new Error('socket closed'), { code: undefined })),
        cancel: () => Promise.resolve(),
      }),
      resume: () => {
        throw new Error('not used');
      },
    };
    engine.ports.harnesses.codex = silent;
    const failed = await engine.runToIdle(version.loopId);
    expect(failed.failure).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: 'harness turn failed: socket closed',
    });

    // A harness that never reports a session id cannot repair; the policy falls through to continue-raw.
    const noSession: HarnessPort = {
      ...silent,
      start: (): HarnessSession => ({
        sessionId: Promise.resolve('none'),
        events: asyncIterableOf([{ type: 'turn-complete' as const }]),
        result: Promise.resolve({
          finalText: 'not json',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
          },
          items: [],
        }),
        cancel: () => Promise.resolve(),
      }),
    };
    engine.ports.harnesses.codex = noSession;
    const raw = engine.publish(
      singleNodeLoop('raw', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: {
          prompt: { template: 'p' },
          output: {
            schema: { jsonSchema: schema, repair: { maxAttempts: 2, onFailure: 'continue-raw' } },
          },
        },
      }),
    );
    const rawRun = await engine.runToIdle(raw.loopId);
    expect(rawRun.status).toBe('succeeded');
    expect((await engine.manager.getThread(rawRun.id))?.lastOutput?.value).toBe('not json');
  });

  it('subloop: exclusions, fresh injections, default custom patches, and null results', async () => {
    const engine = await createTestEngine();
    const child = engine.publish({
      schemaVersion: 1,
      name: 'child',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'D',
          config: { return: { mapping: '$count(messages) & ":" & $count($keys(vars))' } },
        },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    });
    const parent = (name: string, sub: Record<string, unknown>): LoopDefinitionInput => ({
      schemaVersion: 1,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'prep',
          kind: 'mutate',
          label: 'P',
          config: {
            operations: [
              { op: 'set', path: '/vars/a', value: { kind: 'literal', value: 1 } },
              { op: 'append-message', content: 'parent message' },
            ],
          },
        },
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: { loopRef: { loopId: child.loopId }, ...sub },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'D',
          config: { return: { mapping: '{ "last": lastOutput.value, "vars": vars }' } },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
        { id: 'e2', from: { node: 'prep', port: 'out' }, to: { node: 'sub' } },
        { id: 'e3', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
      ],
    });
    const excluded = engine.publish(
      parent('ex', {
        input: {
          mode: 'inherit',
          exclude: ['messages', 'vars', 'artifacts', 'outputs', 'lastOutput'],
        },
      }),
    );
    const exRun = await engine.runToIdle(excluded.loopId);
    expect((exRun.result as { last: { result: string } }).last.result).toBe('0:0');

    const fresh = engine.publish(
      parent('fr', {
        input: { mode: 'fresh', inject: [{ content: 'hi' }] },
        output: { mode: 'merge', messages: 'all' },
      }),
    );
    const frRun = await engine.runToIdle(fresh.loopId);
    expect((frRun.result as { last: { result: string } }).last.result).toBe('1:0');

    const project = engine.publish(
      parent('pr', {
        input: { mode: 'project' },
        output: { mode: 'merge', vars: { strategy: 'explicit' } },
      }),
    );
    const prRun = await engine.runToIdle(project.loopId);
    expect((prRun.result as { last: { result: string } }).last.result).toBe('0:0');

    const customDefault = engine.publish(parent('cd', { output: { mode: 'custom' } }));
    const cdRun = await engine.runToIdle(customDefault.loopId);
    expect(cdRun.status).toBe('succeeded');
    expect((cdRun.result as { last: unknown }).last).toBeNull();

    const silentChild = engine.publish(minimalLoop(), { loopId: engine.loopId('silent-child') });
    const nullResult = engine.publish(
      parent('nr', { loopRef: { loopId: silentChild.loopId }, output: { resultTo: { var: 'r' } } }),
    );
    const nrRun = await engine.runToIdle(nullResult.loopId);
    expect((nrRun.result as { vars: Record<string, unknown> }).vars['r']).toBeNull();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}
