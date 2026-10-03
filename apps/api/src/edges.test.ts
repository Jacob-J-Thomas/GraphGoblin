import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopNotFoundError } from '@graphgoblin/infrastructure/sqlite';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { EventStorePort } from '@graphgoblin/engine';
import { z } from 'zod';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { main } from './main.js';
import { problem } from './plugins/errors.js';
import { streamRunEvents } from './sse.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

const inferLoop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'infer',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
    { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'hi' } } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
    { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
  ],
};

const returnLoop: LoopDefinitionInput = {
  schemaVersion: 1,
  name: 'returns',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
    { id: 'wait', kind: 'wait', label: 'W', config: { mode: 'input', prompt: 'Value?' } },
    { id: 'done', kind: 'exit', label: 'D', config: { return: { mapping: 'lastOutput.value' } } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};

describe('scopes', () => {
  it('rejects every write route for a key without the matching scope', async () => {
    const { token } = await t.container.repos.apiKeys.create('local', 'reader', ['loops:read']);
    const headers = { authorization: `Bearer ${token}` };
    const id = await t.publishLoop(minimalLoop());
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();

    const writes: { method: 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object }[] = [
      { method: 'POST', url: '/loops/import', payload: minimalLoop() },
      { method: 'PUT', url: `/loops/${id}/draft`, payload: { definition: minimalLoop() } },
      { method: 'POST', url: `/loops/${id}/publish` },
      { method: 'DELETE', url: `/loops/${id}` },
      { method: 'POST', url: `/loops/${id}/runs`, payload: {} },
      { method: 'POST', url: `/runs/${run.id}/cancel` },
      { method: 'POST', url: `/runs/${run.id}/pause` },
      { method: 'POST', url: `/runs/${run.id}/resume` },
      { method: 'POST', url: `/runs/${run.id}/input`, payload: { input: 1 } },
      { method: 'POST', url: `/runs/${run.id}/signals/go`, payload: {} },
      { method: 'PUT', url: '/settings', payload: { a: 1 } },
      { method: 'DELETE', url: '/settings/a' },
      { method: 'PUT', url: '/secrets/token', payload: { value: 'x' } },
      { method: 'DELETE', url: '/secrets/token' },
      { method: 'POST', url: '/api-keys', payload: { label: 'x' } },
      { method: 'DELETE', url: '/api-keys/whatever' },
      {
        method: 'PUT',
        url: '/model-catalog/codex/m',
        payload: { displayName: 'M', efforts: ['low'], defaultEffort: 'low' },
      },
      { method: 'DELETE', url: '/model-catalog/codex/m' },
      { method: 'POST', url: '/events', payload: { type: 'x' } },
    ];
    for (const write of writes) {
      const response = await t.app.inject({ ...write, headers });
      expect({ url: write.url, method: write.method, status: response.statusCode }).toEqual({
        url: write.url,
        method: write.method,
        status: 403,
      });
      expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('loop and run route branches', () => {
  it('shows the published version without a draft and reports a missing published export', async () => {
    const id = await t.publishLoop(minimalLoop());
    const detail = (await t.app.inject(`/loops/${id}`)).json<{
      current?: { status: string };
      draft?: unknown;
    }>();
    expect(detail.current?.status).toBe('published');
    expect(detail.draft).toBeUndefined();

    const created = (
      await t.app.inject({ method: 'POST', url: '/loops', payload: { definition: minimalLoop() } })
    ).json<{ loop: { id: string } }>();
    const missing = await t.app.inject(`/loops/${created.loop.id}/export`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      code: 'VERSION_NOT_FOUND',
      detail: 'the loop has no published version',
    });
  });

  it('starts runs with every optional body field, signals without a payload, and delivers event return channels', async () => {
    const id = await t.publishLoop(returnLoop);
    const version = await t.container.repos.loops.getLatestPublished(id);
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: {
        triggerNodeId: 'start',
        versionId: version!.id,
        return: [{ kind: 'event', eventType: 'loop-done' }],
      },
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json<{ run: RunRecord }>().run.id;
    await t.idle();
    const signal = await t.app.inject({
      method: 'POST',
      url: `/runs/${runId}/signals/go`,
      payload: {},
    });
    expect(signal.json()).toMatchObject({ woke: false });
    await t.app.inject({
      method: 'POST',
      url: `/runs/${runId}/input`,
      payload: { input: { answer: 42 } },
    });
    await t.idle();
    expect((await t.app.inject(`/runs/${runId}`)).json<RunRecord>().status).toBe('succeeded');
    const events = (await t.app.inject('/events')).json<{
      items: { type: string; payload: unknown }[];
    }>();
    expect(events.items).toEqual([
      expect.objectContaining({
        type: 'loop-done',
        ownerId: 'local',
        payload: expect.objectContaining({ runId, outcome: 'success', result: { answer: 42 } }),
      }),
    ]);

    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: { ...returnLoop, name: 'draft-run' } },
    });
    const draftRun = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: { allowDraft: true },
    });
    expect(draftRun.statusCode).toBe(202);
    await t.idle();
    const thread = (
      await t.app.inject(`/runs/${draftRun.json<{ run: RunRecord }>().run.id}/thread`)
    ).json<{ versionId: string }>();
    expect(thread.versionId).not.toBe(version!.id);
  });

  it('reports missing artifact content', async () => {
    t.harness.script([
      { finalText: 'hello', items: [{ id: 'i1', type: 'message', summary: 'hello' }] },
    ]);
    const id = await t.publishLoop(inferLoop);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const thread = (await t.app.inject(`/runs/${run.id}/thread`)).json<{
      artifacts: { id: string }[];
    }>();
    await rm(join(t.dataDir, 'artifacts'), { recursive: true, force: true });
    const missing = await t.app.inject(`/runs/${run.id}/artifacts/${thread.artifacts[0]!.id}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
      detail: 'the artifact content is missing',
    });
  });

  it('skips unset harnesses and reports non-Error preflight failures', async () => {
    t.harness.preflight = () => Promise.reject(new Error('unused'));
    (t.container.ports.harnesses as Record<string, unknown>).codex = undefined;
    const none = (await t.app.inject('/harness/preflight')).json<{
      items: { problems: string[] }[];
    }>();
    expect(none.items[0]?.problems).toEqual(['no harness adapter is configured']);
    t.container.ports.harnesses.codex = t.harness;
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- third-party harnesses may reject with non-Error values
    t.harness.preflight = () => Promise.reject('plain failure');
    const failed = (await t.app.inject('/harness/preflight')).json<{
      items: { problems: string[] }[];
    }>();
    expect(failed.items[0]?.problems).toEqual(['plain failure']);
  });
});

describe('error handler', () => {
  it('maps every error family to problem details', async () => {
    const app = await buildApp(t.container);
    app.get(
      '/probe/serialize',
      { schema: { response: { 200: z.object({ a: z.string() }) } } },
      () => ({ a: 1 }) as unknown as { a: string },
    );
    app.get('/probe/loop', () => {
      throw new LoopNotFoundError('loop-x');
    });
    app.get('/probe/teapot', () => {
      throw Object.assign(new Error('short and stout'), { statusCode: 418, code: 'TEAPOT' });
    });
    app.get('/probe/bad', () => {
      throw Object.assign(new Error('bad'), { statusCode: 400 });
    });
    app.get('/probe/unavailable', () => {
      throw Object.assign(new Error('down'), { statusCode: 503 });
    });
    app.get('/probe/redirect', () => {
      throw Object.assign(new Error('odd'), { statusCode: 302 });
    });
    app.get('/probe/crash', () => {
      throw new Error('kaboom');
    });
    app.get('/probe/bare', (_request, reply) => problem(reply, 409, 'BARE_CONFLICT'));
    try {
      const expectProblem = async (
        url: string,
        status: number,
        code: string,
      ): Promise<Record<string, unknown>> => {
        const response = await app.inject(url);
        expect({ url, status: response.statusCode }).toEqual({ url, status });
        expect(response.headers['content-type']).toMatch(/problem\+json/);
        const body = response.json<Record<string, unknown>>();
        expect(body.code).toBe(code);
        return body;
      };
      await expectProblem('/probe/serialize', 500, 'RESPONSE_INVALID');
      await expectProblem('/probe/loop', 404, 'LOOP_NOT_FOUND');
      expect(await expectProblem('/probe/teapot', 418, 'TEAPOT')).toMatchObject({
        detail: 'short and stout',
      });
      await expectProblem('/probe/bad', 400, 'BAD_REQUEST');
      await expectProblem('/probe/unavailable', 500, 'INTERNAL_ERROR');
      await expectProblem('/probe/redirect', 500, 'INTERNAL_ERROR');
      expect(await expectProblem('/probe/crash', 500, 'INTERNAL_ERROR')).not.toHaveProperty(
        'detail',
        'kaboom',
      );
      expect(await expectProblem('/probe/bare', 409, 'BARE_CONFLICT')).not.toHaveProperty('detail');
    } finally {
      await app.close();
    }
  });

  it('serves Swagger UI when enabled', async () => {
    const withUi = await createTestApp({ env: { GG_SWAGGER_UI: 'true' } });
    try {
      const docs = await withUi.app.inject('/docs/');
      expect(docs.statusCode).toBe(200);
      expect(docs.headers['content-type']).toMatch(/html/);
    } finally {
      await withUi.close();
    }
  });
});

describe('SSE framing', () => {
  function event(seq: number, type: RunEvent['type'] = 'run.waiting'): RunEvent {
    return {
      runId: 'r1',
      seq,
      type,
      at: '2026-10-02T00:00:00.000Z',
      payload: {},
    } as unknown as RunEvent;
  }

  it('merges events appended during replay in order, sends heartbeats, and ignores events after the end', async () => {
    let listener: ((e: RunEvent) => void) | undefined;
    const store = {
      subscribe: (_runId: string, l: (e: RunEvent) => void) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
      read: () => {
        // Two live events arrive while history is being read, out of order, one overlapping it.
        listener?.(event(3));
        listener?.(event(2));
        return Promise.resolve([event(1), event(2)]);
      },
    } as unknown as EventStorePort;
    const app = await buildApp(t.container, { logger: false });
    app.get('/probe/sse', (request, reply) =>
      streamRunEvents(request, reply, store, 'r1', 0, { heartbeatMs: 5 }),
    );
    try {
      const pending = app.inject('/probe/sse');
      await vi.waitFor(() => expect(listener).toBeDefined());
      await new Promise((r) => setTimeout(r, 40));
      const finish = listener!;
      finish(event(4, 'run.finished'));
      finish(event(5, 'run.waiting'));
      const response = await pending;
      const ids = [...response.body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
      expect(ids).toEqual([1, 2, 3, 4]);
      expect(response.body).toContain(': heartbeat');
      expect(response.body.trimEnd().endsWith('}')).toBe(true);
      expect(listener).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('test helper', () => {
  it('surfaces create and publish failures', async () => {
    await expect(t.publishLoop({ nope: true } as unknown as LoopDefinitionInput)).rejects.toThrow(
      /create loop failed/,
    );
    const broken = minimalLoop();
    broken.edges = [];
    await expect(t.publishLoop(broken)).rejects.toThrow(/publish failed/);
  });
});

describe('composition defaults', () => {
  it('opens a file database, generates a master key, and runs with default ports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-container-'));
    try {
      const config = loadConfig({ GG_DATA_DIR: join(dir, 'data'), GG_TIMER_POLL_MS: '50' });
      const container = await createContainer(config);
      await container.start();
      try {
        expect(container.masterKey).toHaveLength(32);
        expect(container.ports.clock.now()).toBeInstanceOf(Date);
        const { logger } = container.ports;
        expect([
          logger.debug({}, 'd'),
          logger.info({}, 'i'),
          logger.warn({}, 'w'),
          logger.error({}, 'e'),
        ]).toEqual([undefined, undefined, undefined, undefined]);
        expect((await container.repos.catalog.list()).length).toBeGreaterThan(0);
      } finally {
        await container.stop();
      }
      // Reopening the same file keeps the data and the generated key.
      const again = await createContainer(config);
      await again.start();
      try {
        expect(again.masterKey.equals(container.masterKey)).toBe(true);
      } finally {
        await again.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 30_000);
});

describe('main shutdown', () => {
  it('closes the app and container once on SIGINT or SIGTERM, then exits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-main-'));
    const previous = { ...process.env };
    const beforeInt = process.listeners('SIGINT');
    const beforeTerm = process.listeners('SIGTERM');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    Object.assign(process.env, {
      GG_DATA_DIR: dir,
      GG_DB_URL: ':memory:',
      GG_PORT: '0',
      GG_LOG_LEVEL: 'silent',
      GG_SWAGGER_UI: 'false',
      GG_HOST: '127.0.0.1',
      GG_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
    });
    const added: { signal: 'SIGINT' | 'SIGTERM'; listener: (...args: unknown[]) => void }[] = [];
    try {
      const { app } = await main();
      for (const [signal, before] of [
        ['SIGINT', beforeInt],
        ['SIGTERM', beforeTerm],
      ] as const) {
        for (const listener of process.listeners(signal))
          if (!before.includes(listener))
            added.push({ signal, listener: listener as (...args: unknown[]) => void });
      }
      expect(added.map((a) => a.signal).sort()).toEqual(['SIGINT', 'SIGTERM']);
      for (const { signal, listener } of added) listener(signal);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(exit).toHaveBeenCalledTimes(1);
      expect(app.server.listening).toBe(false);
    } finally {
      for (const { signal, listener } of added) process.removeListener(signal, listener);
      process.env = previous;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 30_000);
});
