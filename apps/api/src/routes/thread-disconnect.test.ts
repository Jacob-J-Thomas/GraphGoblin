import { once } from 'node:events';
import { Agent, get } from 'node:http';
import type { Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { ContextThreadSchema, type RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { reconcileThread } from '@graphgoblin/domain';
import type { EventDraft } from '@graphgoblin/engine';
import { registerAuth } from '../plugins/auth.js';
import { registerErrorHandler } from '../plugins/errors.js';
import { requestValidatorCompiler } from '../plugins/request-validation.js';
import { historicalThread } from '../run-history.js';
import { createTestApp } from '../testing/test-app.js';
import { registerRunRoutes } from './runs.js';
import { registerSystemRoutes } from './system.js';

type Stage =
  'before handler' | 'ownership' | 'initial' | 'checkpoint' | 'boundary' | 'page' | 'yield';
type Headers = Record<string, string>;

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function observeRequest(hold?: Stage) {
  return {
    hold,
    operations: [] as Stage[],
    reached: deferred(),
    release: deferred(),
    closed: deferred<boolean>(),
    settled: deferred<number>(),
    inputEnded: false,
    sends: 0,
    errors: [] as Error[],
  };
}

function read(url: string, headers: Headers = {}, agent?: Agent) {
  return new Promise<{ status: number | undefined; body: string; socket: Socket }>(
    (resolve, reject) => {
      get(url, { headers, agent }, (response) => {
        const socket = response.socket;
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (text: string) => {
          body += text;
        });
        response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode, body, socket }));
      }).once('error', reject);
    },
  );
}

describe('historical thread response lifetime', () => {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  let test: Awaited<ReturnType<typeof createTestApp>>;
  let base: string;
  let headers: Headers;
  let history: string;
  let current: string;
  let runId: string;
  let expectedBody: string;
  let currentBody: string;
  let checkpointSeq: number;
  let observation: ReturnType<typeof observeRequest>;
  const observedHeaders = () => ({ ...headers, 'x-observe-history': 'yes' });

  async function holdAt(control: typeof observation, stage: Stage) {
    if (control.hold !== stage) return;
    control.reached.resolve();
    await control.release.promise;
  }

  beforeAll(async () => {
    test = await createTestApp({ requireApiKey: true });
    const key = await test.container.repos.apiKeys.create('local', 'history-test', ['*']);
    headers = { authorization: `Bearer ${key.token}` };
    const loopId = await test.publishLoop(minimalLoop(), headers);
    const start = async () => {
      const result = await test.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        headers,
        payload: {},
      });
      expect(result.statusCode, result.body).toBe(202);
      await test.idle();
      return result.json<{ run: RunRecord }>().run.id;
    };
    runId = await start();
    const currentPath = `/runs/${await start()}/thread`;
    const { runs, events } = test.container.repos;
    const initial = await runs.getInitialThread(runId);
    const checkpoint = await runs.getThreadCheckpoint(runId);
    if (!initial || !checkpoint?.replayState)
      throw new Error('Fixture must have a replay checkpoint');
    checkpointSeq = checkpoint.seq;
    await events.append(
      runId,
      Array.from({ length: 150 }, (_, count): EventDraft[] => [
        { type: 'node.started', nodeId: 'work', kind: 'mutate', attempt: 1, configHash: 'h' },
        {
          type: 'node.finished',
          nodeId: 'work',
          patch: [{ op: 'add', path: '/vars/count', value: count + 1 }],
          durationMs: 1,
        },
      ]).flat(),
    );
    const at = checkpointSeq + 259;
    const expected = reconcileThread(initial, await events.read(runId), undefined, at);
    expectedBody = JSON.stringify(ContextThreadSchema.parse(expected));
    currentBody = (await test.app.inject({ url: currentPath, headers })).body;

    app.setValidatorCompiler(requestValidatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    registerAuth(app, test.container);
    app.addHook('onRoute', (route) => {
      if (route.method !== 'GET' || route.url !== '/runs/:id/thread') return;
      const handler = route.handler;
      route.handler = async function (request, reply) {
        if (request.headers['x-observe-history'] !== 'yes')
          return handler.call(this, request, reply);
        const control = observation;
        reply.raw.once('close', () => control.closed.resolve(reply.raw.writableFinished));
        const originalListeners = reply.raw.listeners('close');
        try {
          // A completed, bodyless incoming message still has a live outgoing response.
          if (!request.raw.readableEnded) {
            const ended = once(request.raw, 'end');
            request.raw.resume();
            await ended;
          }
          control.inputEnded = request.raw.readableEnded;
          await holdAt(control, 'before handler');
          return await handler.call(this, request, reply);
        } finally {
          control.settled.resolve(
            reply.raw.listeners('close').filter((listener) => !originalListeners.includes(listener))
              .length,
          );
        }
      };
    });
    app.addHook('onError', (request, _reply, error, done) => {
      if (request.headers['x-observe-history'] === 'yes') observation.errors.push(error);
      done();
    });
    app.addHook('onSend', (request, _reply, payload, done) => {
      if (request.headers['x-observe-history'] === 'yes') observation.sends++;
      done(null, payload);
    });
    registerRunRoutes(app, test.container);
    registerSystemRoutes(app, test.container);

    function watch<Args extends unknown[], Value>(
      stage: Stage | ((...args: Args) => Stage),
      delegate: (...args: Args) => Promise<Value>,
    ) {
      return async (...args: Args) => {
        if (args[0] === runId) {
          const operation = typeof stage === 'function' ? stage(...args) : stage;
          observation.operations.push(operation);
          await holdAt(observation, operation);
        }
        return delegate(...args);
      };
    }
    runs.get = watch('ownership', runs.get.bind(runs));
    runs.getInitialThread = watch('initial', runs.getInitialThread.bind(runs));
    runs.getThreadCheckpoint = watch('checkpoint', runs.getThreadCheckpoint.bind(runs));
    events.read = watch(
      (_id, after, limit) => (after === checkpointSeq - 1 && limit === 1 ? 'boundary' : 'page'),
      events.read.bind(events),
    );
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    history = `${base}/runs/${runId}/thread?at=${at}`;
    current = base + currentPath;
  });

  beforeEach(() => {
    observation = observeRequest();
  });

  afterAll(async () => {
    try {
      await app.close();
    } finally {
      await test?.close();
    }
  });

  async function abandon(stage: Stage, whileHeld?: () => Promise<void>) {
    observation.hold = stage;
    const prematureResponse = deferred<never>();
    const client = get(history, { headers: observedHeaders(), agent: false }, (response) => {
      response.resume();
      prematureResponse.reject(new Error(`Received HTTP ${response.statusCode} before ${stage}`));
    });
    client.setTimeout(8_000, () => client.destroy(new Error(`Timed out waiting for ${stage}`)));
    client.once('error', prematureResponse.reject);
    // The client's timer cannot reject held reads, close or settlement, so the same 8 s budget
    // bounds every wait here and a stalled response still reaches the callers' cleanup.
    const expired = deferred<never>();
    const deadline = setTimeout(
      () => expired.reject(new Error(`Timed out holding ${stage}`)),
      8_000,
    );
    const bounded = <Value>(wait: Promise<Value>) => Promise.race([wait, expired.promise]);
    try {
      try {
        await bounded(Promise.race([observation.reached.promise, prematureResponse.promise]));
        if (whileHeld) await bounded(whileHeld());
        client.destroy();
        expect(await bounded(observation.closed.promise)).toBe(false);
      } finally {
        client.destroy();
        observation.release.resolve();
      }
      expect(await bounded(observation.settled.promise)).toBe(0);
    } finally {
      clearTimeout(deadline);
    }
  }

  it.each([
    ['before handler', []],
    ['ownership', ['ownership']],
    ['initial', ['ownership', 'initial']],
    ['checkpoint', ['ownership', 'initial', 'checkpoint']],
    ['boundary', ['ownership', 'initial', 'checkpoint', 'boundary']],
  ] as const)('stops at an abandoned %s boundary', async (stage, operations) => {
    await abandon(stage);
    expect(observation.operations).toEqual(operations);
    expect(observation.sends).toBe(0);
  });

  it('stops after an abandoned page while unrelated health and current reads complete', async () => {
    await abandon('page', async () => {
      const health = await read(base + '/healthz');
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ status: 'ok' });
      expect(await read(current, headers)).toMatchObject({ status: 200, body: currentBody });
    });
    expect(observation.operations).toEqual([
      'ownership',
      'initial',
      'checkpoint',
      'boundary',
      'page',
    ]);
    expect(observation.sends).toBe(0);
  });

  it('stops at an abandoned yield after a completed page while unrelated reads complete', async () => {
    const { events } = test.container.repos;
    const readEvents = events.read;
    const scheduleImmediate = globalThis.setImmediate;
    const control = observation;
    const agent = new Agent();
    const timeline: string[] = [];
    let completedPages = 0;
    let held = false;
    void control.closed.promise.then((finished) => timeline.push(`closed finished=${finished}`));
    void control.settled.promise.then(() => timeline.push('settled'));
    events.read = async (...args) => {
      const rows = await readEvents(...args);
      if (args[0] === runId && control.operations.at(-1) === 'page') {
        completedPages++;
        timeline.push(`page ${rows.length} through ${rows.at(-1)?.seq}`);
      }
      return rows;
    };
    // Hold only the real setImmediate that historicalThread schedules after its first page;
    // every other call, including unrelated requests while it is held, passes straight through.
    globalThis.setImmediate = Object.assign(
      <Args extends unknown[]>(callback: (...args: Args) => void, ...args: Args) => {
        if (
          held ||
          completedPages !== 1 ||
          !new Error().stack?.includes(`at ${historicalThread.name} (`)
        )
          return scheduleImmediate(callback, ...args);
        held = true;
        timeline.push('yield held');
        control.reached.resolve();
        return scheduleImmediate(() => {
          void control.release.promise.then(() => {
            timeline.push('yield released');
            callback(...args);
          });
        });
      },
      { __promisify__: scheduleImmediate.__promisify__ },
    );
    try {
      await abandon('yield', async () => {
        const health = await read(base + '/healthz', {}, agent);
        expect(health.status).toBe(200);
        expect(JSON.parse(health.body)).toEqual({ status: 'ok' });
        expect(await read(current, headers, agent)).toMatchObject({
          status: 200,
          body: currentBody,
        });
      });
    } finally {
      globalThis.setImmediate = scheduleImmediate;
      events.read = readEvents;
      control.release.resolve();
      agent.destroy();
    }
    expect(timeline).toEqual([
      `page 128 through ${checkpointSeq + 128}`,
      'yield held',
      'closed finished=false',
      'yield released',
      'settled',
    ]);
    expect(observation.operations).toEqual([
      'ownership',
      'initial',
      'checkpoint',
      'boundary',
      'page',
    ]);
    expect(observation.sends).toBe(0);
    expect(observation.errors).toEqual([]);
  });

  it.each(['connected', 'abandoned'] as const)(
    'handles the same %s read rejection',
    async (mode) => {
      const { events } = test.container.repos;
      const readEvents = events.read;
      events.read = async (...args) => {
        await readEvents(...args);
        throw new Error('Injected read failure');
      };
      try {
        if (mode === 'connected') {
          const response = await read(history, observedHeaders());
          expect(response.status).toBe(500);
          expect(JSON.parse(response.body)).toMatchObject({ code: 'INTERNAL_ERROR' });
          expect(await observation.settled.promise).toBe(0);
          expect(observation.errors.map((error) => error.message)).toEqual([
            'Injected read failure',
          ]);
        } else {
          await abandon('boundary');
          expect(observation.errors).toEqual([]);
          expect(observation.sends).toBe(0);
        }
      } finally {
        events.read = readEvents;
      }
    },
  );

  it('completes bodyless requests and reuses the connection after a full historical response', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await read(history, observedHeaders(), agent);
      expect(first, observation.errors.map((error) => error.message).join('\n')).toMatchObject({
        status: 200,
        body: expectedBody,
      });
      expect(observation.inputEnded).toBe(true);
      expect(await observation.settled.promise).toBe(0);
      expect(await observation.closed.promise).toBe(true);
      expect(observation.operations).toEqual([
        'ownership',
        'initial',
        'checkpoint',
        'boundary',
        'page',
        'page',
        'page',
      ]);
      const next = await read(current, headers, agent);
      expect(next).toMatchObject({ status: 200, body: currentBody });
      expect(first.socket).not.toBeNull();
      expect(next.socket).toBe(first.socket);
    } finally {
      agent.destroy();
    }
  });

  it('preserves missing-thread, validation and authorization errors', async () => {
    const { runs, apiKeys } = test.container.repos;
    const other = await apiKeys.create('another-owner', 'another-owner', ['runs:read']);
    const forbidden = await apiKeys.create('local', 'loops-only', ['loops:read']);
    for (const [url, credentials, status, code] of [
      [history, {}, 401, 'UNAUTHORIZED'],
      [history, { authorization: `Bearer ${forbidden.token}` }, 403, 'FORBIDDEN'],
      [history.replace(/\d+$/, '-1'), headers, 400, 'VALIDATION_FAILED'],
      [history, { authorization: `Bearer ${other.token}` }, 404, 'RUN_NOT_FOUND'],
    ] as const) {
      const response = await read(url, credentials);
      expect(response.status).toBe(status);
      expect(JSON.parse(response.body)).toMatchObject({ code });
    }
    expect(observation.operations).toEqual(['ownership']);
    const getInitialThread = runs.getInitialThread;
    runs.getInitialThread = () => Promise.resolve(undefined);
    try {
      const response = await read(history, observedHeaders());
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'THREAD_NOT_FOUND' });
      expect(await observation.settled.promise).toBe(0);
    } finally {
      runs.getInitialThread = getInitialThread;
    }
  });
});
