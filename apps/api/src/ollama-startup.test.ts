import { randomUUID } from 'node:crypto';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ChatSession,
  ChatTurn,
  HarnessDefaults,
  LoopDefinition,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition, readinessFailure } from '@graphgoblin/domain';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { discoveredModel, type OllamaServices } from '@graphgoblin/infrastructure/ollama';
import { SqliteOllamaRepository } from '@graphgoblin/infrastructure/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer, LOCAL_OWNER, type Container } from './container.js';
import type { ApiInstance } from './types.js';

const exactModel = 'team/qwen3.5:9b-q4_K_M';
const fixtureReply = { protocol: 'graphgoblin.chat.v1', reply: 'Exact selected fixture model' };
const origin = 'http://models.example:11434';
let dataDir: string;
let container: Container | undefined;
let app: ApiInstance | undefined;

beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(join(tmpdir(), 'gg-ollama-startup-')));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await container?.stop();
  container = undefined;
  globalThis.gc?.();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function config(defaults: HarnessDefaults) {
  return loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'gateway.db').replaceAll('\\', '/')}`,
    GG_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
    GG_DEFAULTS: JSON.stringify(defaults),
    GG_OLLAMA_ENABLED: 'true',
    GG_OLLAMA_URL: origin,
  });
}

function adapters(offline = false) {
  const ollama = new FakeHarness([{ structured: fixtureReply }], 'ollama');
  if (offline) ollama.preflightResult = readinessFailure('ollama', 'transport');
  const codex = new FakeHarness([{ structured: fixtureReply }]);
  const claude = new FakeHarness([{ structured: fixtureReply }], 'claude');
  const service = {
    harness: ollama,
    view: vi.fn(() =>
      Promise.resolve({
        connection: { enabled: true, baseUrl: origin, revision: 1 },
        discovery: { state: 'idle' as const },
      }),
    ),
    configure: vi.fn(() =>
      Promise.reject(new Error('Connection edits are outside this startup fixture')),
    ),
    refresh: vi.fn(() => Promise.resolve({ state: 'idle' as const })),
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
  } satisfies OllamaServices;
  return { ollama, codex, claude, service, harnesses: { ollama, codex, claude } };
}

async function boot(defaults: HarnessDefaults, offline = false) {
  const fixture = adapters(offline);
  container = await createContainer(config(defaults), {
    harnesses: fixture.harnesses,
    ollama: fixture.service,
    startTimers: false,
  });
  await container.start();
  app = await buildApp(container, { logger: false });
  await app.ready();
  return fixture;
}

async function conversation() {
  const response = await app!.inject({ method: 'POST', url: '/chat/conversations', payload: {} });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

async function assertBlocked(expectedCode: string) {
  const status = await app!.inject('/chat/session');
  expect(status.statusCode, status.body).toBe(200);
  expect(status.json<ChatSession>().readiness.text).toMatchObject({
    ready: false,
    code: expectedCode === 'MODEL_UNAVAILABLE' ? expectedCode : 'CHAT_NOT_READY',
  });
  const gateway = status.json<ChatSession>().systemLoopId!;
  const current = (await app!.inject(`/loops/${gateway}`)).json<{
    current: { definition: LoopDefinition };
  }>();
  const validation = await app!.inject({
    method: 'POST',
    url: `/loops/${gateway}/validate`,
    payload: { definition: current.current.definition },
  });
  expect(validation.statusCode, validation.body).toBe(200);
  expect(validation.json<{ publishable: boolean; issues: { code: string }[] }>()).toMatchObject({
    publishable: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
  });
  const id = await conversation();
  const requestId = randomUUID();
  const refused = await app!.inject({
    method: 'POST',
    url: `/chat/conversations/${id}/turns`,
    payload: { requestId, input: { kind: 'text', text: 'Do not execute an unavailable model' } },
  });
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.json<{ code: string }>().code).toBe('CHAT_NOT_READY');
  expect((await app!.inject(`/chat/conversations/${id}/requests/${requestId}`)).statusCode).toBe(
    404,
  );
  expect(await container!.repos.runs.list({})).toEqual([]);
  return id;
}

async function seedAvailable(repository: SqliteOllamaRepository, model = exactModel) {
  const at = container!.ports.clock.now().toISOString();
  const current = await repository.read({ enabled: true, baseUrl: origin });
  const detected = discoveredModel(model, 'fixture-digest', current.connection.revision, at, {
    capabilities: ['completion'],
  });
  expect(await repository.reconcile(current.connection.revision, at, [detected])).toBe(true);
  return { at, revision: current.connection.revision };
}

describe('dynamic Ollama process-default startup admission', () => {
  it.each([exactModel, 'gpt-6-luna'])(
    'boots a fresh database before discovery for exact model %s, then uses that unchanged selection after discovery',
    async (model) => {
      const defaults = { byHarness: { ollama: { model, effort: 'none' as const } } };
      const fixture = await boot(defaults);
      expect(fixture.service.start).toHaveBeenCalledOnce();
      expect(fixture.service.refresh).not.toHaveBeenCalled();
      expect(
        (await container!.repos.catalog.list()).filter((entry) => entry.harness === 'ollama'),
      ).toEqual([]);
      expect((await app!.inject('/settings')).statusCode).toBe(200);
      const id = await assertBlocked('MODEL_UNAVAILABLE');
      expect(fixture.ollama.started).toEqual([]);
      await seedAvailable(new SqliteOllamaRepository(container!.handle.db), model);
      expect((await app!.inject('/chat/session')).json<ChatSession>().readiness.text.ready).toBe(
        true,
      );
      const accepted = await app!.inject({
        method: 'POST',
        url: `/chat/conversations/${id}/turns`,
        payload: {
          requestId: randomUUID(),
          input: { kind: 'text', text: 'Explicit send after discovery' },
        },
      });
      expect(accepted.statusCode, accepted.body).toBe(202);
      await container!.manager.waitForIdle();
      expect(fixture.ollama.started).toHaveLength(1);
      expect(fixture.ollama.started[0]).toMatchObject({ model, effort: 'none' });
      const completed = await app!.inject(`/chat/turns/${accepted.json<ChatTurn>().id}`);
      expect(completed.json<ChatTurn>().response).toEqual(fixtureReply);
      expect(container!.config.defaults).toEqual(defaults);
    },
  );

  it.each([
    ['missing', 'MODEL_UNAVAILABLE'],
    ['unsupported', 'MODEL_UNAVAILABLE'],
    ['unsupported-effort', 'EFFORT_UNSUPPORTED'],
    ['disabled', 'MODEL_DISABLED'],
    ['offline', 'HARNESS_READINESS_TRANSPORT'],
  ] as const)(
    'boots after a restart with cached %s model state while Chat remains blocked and Settings remain editable',
    async (state, expectedCode) => {
      const defaults: HarnessDefaults = {
        byHarness: {
          ollama: { model: exactModel, effort: state === 'unsupported-effort' ? 'high' : 'none' },
        },
      };
      const first = await boot(defaults);
      const gateway = (await container!.repos.chat.getBinding({
        ownerId: LOCAL_OWNER,
        audienceKey: 'gateway',
      }))!.loopId;
      const repository = new SqliteOllamaRepository(container!.handle.db);
      const { at, revision } = await seedAvailable(repository);
      if (state === 'missing') await repository.reconcile(revision, at, []);
      if (state === 'unsupported')
        await repository.reconcile(revision, at, [
          discoveredModel(exactModel, 'unsupported-digest', revision, at, {
            capabilities: ['embedding'],
          }),
        ]);
      if (state === 'disabled')
        await container!.repos.catalog.setEnabled('ollama', exactModel, false);
      if (state === 'offline')
        await repository.fail(revision, at, {
          code: 'OFFLINE',
          message: 'Fixture service is unavailable',
        });
      expect(first.ollama.started).toEqual([]);
      await app!.close();
      app = undefined;
      await container!.stop();
      container = undefined;
      const next = await boot(defaults, state === 'offline');
      expect(
        (await container!.repos.chat.getBinding({ ownerId: LOCAL_OWNER, audienceKey: 'gateway' }))
          ?.loopId,
      ).toBe(gateway);
      await assertBlocked(expectedCode);
      expect(next.ollama.started).toEqual([]);
      expect((await app!.inject('/settings')).statusCode).toBe(200);
      const changed = await app!.inject({
        method: 'PUT',
        url: '/settings',
        payload: {
          defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
        },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const cleared = await app!.inject({
        method: 'PUT',
        url: '/settings',
        payload: { defaults: { byHarness: {} } },
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      // An unavailable dynamic process default cannot block an unrelated explicitly selected CLI workflow.
      for (const harness of ['codex', 'claude'] as const) {
        const definition = createSystemChatDefinition({ name: `Independent ${harness}`, harness });
        const node = definition.nodes.find((candidate) => candidate.kind === 'inference')!;
        if (node.kind !== 'inference') throw new Error('Expected inference fixture');
        node.config.model = harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5';
        node.config.effort = 'low';
        const created = await app!.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition },
        });
        expect(created.statusCode, created.body).toBe(201);
        const loopId = created.json<{ loop: { id: string } }>().loop.id;
        const published = await app!.inject({
          method: 'POST',
          url: `/loops/${loopId}/publish`,
          payload: {},
        });
        expect(published.statusCode, published.body).toBe(200);
        const run = await app!.inject({
          method: 'POST',
          url: `/loops/${loopId}/runs`,
          payload: {
            triggerNodeId: 'chat-input',
            input: {
              protocol: 'graphgoblin.chat.v1',
              conversationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
              requestId: randomUUID(),
              turn: 1,
              history: [],
              input: { kind: 'text', text: 'Independent workflow' },
            },
          },
        });
        expect(run.statusCode, run.body).toBe(202);
        await container!.manager.waitForIdle();
        expect(next[harness].started).toHaveLength(1);
        const runId = run.json<{ run: { id: string } }>().run.id;
        expect((await app!.inject(`/runs/${runId}`)).json()).toMatchObject({
          status: 'succeeded',
          result: fixtureReply,
        });
      }
      expect(container!.config.defaults).toEqual(defaults);
      expect(next.ollama.started).toEqual([]);
    },
  );

  it('keeps a model-only process default partial instead of inventing an effort', async () => {
    const defaults = { byHarness: { ollama: { model: exactModel } } };
    const fixture = await boot(defaults);
    await seedAvailable(new SqliteOllamaRepository(container!.handle.db));
    await assertBlocked('EFFORT_UNRESOLVED');
    expect(fixture.ollama.started).toEqual([]);
    expect(container!.config.defaults).toEqual(defaults);
    const corrected = await app!.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        defaults: { byHarness: { ollama: { effort: 'none' } } },
      },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect((await app!.inject('/chat/session')).json<ChatSession>().readiness.text.ready).toBe(
      true,
    );
    expect(container!.config.defaults).toEqual(defaults);
  });

  it('still refuses an Ollama effort-only process default before creating a database', async () => {
    await expect(
      createContainer(config({ byHarness: { ollama: { effort: 'none' } } }), {
        startTimers: false,
        ollama: adapters().service,
      }),
    ).rejects.toMatchObject({
      code: 'EVALUATION_INVALID_CONFIGURATION',
      details: { code: 'MODEL_UNRESOLVED', harness: 'ollama', level: 'process', path: 'model' },
    });
    await expect(access(join(dataDir, 'gateway.db'))).rejects.toThrow();
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toThrow();
  });

  it.each([
    '{broken',
    '{"byHarness":{"ollama":{"model":12}}}',
    '{"byHarness":{"ollama":{"model":"exact:tag","effort":"invented"}}}',
    '{"byHarness":{"unknown":{"model":"exact:tag"}}}',
  ])('still refuses malformed process defaults before startup: %s', (value) => {
    expect(() => loadConfig({ GG_DATA_DIR: dataDir, GG_DEFAULTS: value })).toThrow();
  });

  it.each([
    ['codex', 'gpt-5.5'],
    ['claude', 'claude-haiku-5-5'],
  ] as const)(
    'retains %s effort refusal beside a deferred Ollama process default',
    async (harness, model) => {
      const defaults: HarnessDefaults = {
        byHarness: {
          ollama: { model: exactModel, effort: 'none' },
          [harness]: { model, effort: 'none' },
        },
      };
      await expect(
        createContainer(config(defaults), { startTimers: false, ollama: adapters().service }),
      ).rejects.toMatchObject({
        code: 'EVALUATION_INVALID_CONFIGURATION',
        details: {
          code: 'EFFORT_UNSUPPORTED',
          harness,
          level: 'process',
          path: 'effort',
        },
      });
      await expect(access(join(dataDir, 'gateway.db'))).rejects.toThrow();
    },
  );
});
