import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_PROTOCOL,
  type ChatConversation,
  type ChatSession,
  type LoopIssue,
  type ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { SqliteOllamaRepository } from '@graphgoblin/infrastructure/sqlite';
import type { OllamaDiscoveredModel } from '@graphgoblin/infrastructure/ollama';
import { createTestApp, type TestApp } from './testing/test-app.js';

const MODEL = 'fixture-local:latest';
const OFF = 'Ollama is off in Settings';
const NEW_ADDRESS = 'Not yet listed at the new address';
let t: TestApp;
let harness: FakeHarness;
let repository: SqliteOllamaRepository;
beforeEach(async () => {
  harness = new FakeHarness([], 'ollama');
  t = await createTestApp({ harnesses: { ollama: harness } });
  repository = new SqliteOllamaRepository(t.container.handle.db);
});
afterEach(async () => {
  await t.close();
});
const definition = () => {
  const value = createSystemChatDefinition({ name: 'Local model workflow', harness: 'ollama' });
  const node = value.nodes.find((item) => item.kind === 'inference');
  if (node?.kind === 'inference') {
    node.config.model = MODEL;
    node.config.effort = 'none';
  }
  return value;
};
function model(revision: number): OllamaDiscoveredModel {
  return {
    model: MODEL,
    digest: 'sha256:fixture',
    connectionRevision: revision,
    availability: { state: 'available', checkedAt: t.clock.now().toISOString() },
    thinkingByEffort: { none: false },
    displayName: 'Fixture local',
    efforts: ['none'],
    defaultEffort: 'none',
    enabled: true,
  };
}
async function available() {
  const view = await repository.configure(
    { enabled: true, baseUrl: 'http://127.0.0.1:11434' },
    t.clock.now().toISOString(),
  );
  await repository.reconcile(view.connection.revision, t.clock.now().toISOString(), [
    model(view.connection.revision),
  ]);
  return view.connection.revision;
}
async function publicCatalog() {
  return (await t.app.inject('/model-catalog'))
    .json<{ items: ModelCatalogEntry[] }>()
    .items.find((entry) => entry.harness === 'ollama' && entry.model === MODEL);
}
async function gateway() {
  const binding = (await t.container.repos.chat.getBinding({
    ownerId: 'local',
    audienceKey: 'gateway',
  }))!;
  const value = definition();
  const saved = await t.app.inject({
    method: 'PUT',
    url: `/loops/${binding.loopId}/draft`,
    payload: { definition: value },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const published = await t.app.inject({ method: 'POST', url: `/loops/${binding.loopId}/publish` });
  expect(published.statusCode, published.body).toBe(200);
  return binding.loopId;
}

describe('dynamic Ollama model readiness', () => {
  it('admits an available exact selected model through the ordinary native run path', async () => {
    await available();
    const id = await t.publishLoop(definition());
    harness.script([
      { structured: { protocol: CHAT_PROTOCOL, reply: 'Available native fixture reply' } },
    ]);
    const start = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: {
        input: {
          protocol: CHAT_PROTOCOL,
          conversationId: t.container.ports.ids.next(),
          requestId: randomUUID(),
          turn: 1,
          input: { kind: 'text', text: 'Use the selected local model' },
          history: [],
        },
      },
    });
    expect(start.statusCode, start.body).toBe(202);
    await t.idle();
    const run = await t.container.repos.runs.get(start.json<{ run: { id: string } }>().run.id);
    expect(run).toMatchObject({
      status: 'succeeded',
      result: { protocol: CHAT_PROTOCOL, reply: 'Available native fixture reply' },
    });
    expect(harness.started).toHaveLength(1);
    expect(harness.started[0]?.model).toBe(MODEL);
  });

  it('blocks unavailable publication and manual admission without invoking an otherwise-ready harness', async () => {
    const revision = await available();
    const value = definition();
    const id = await t.publishLoop(value);
    await repository.reconcile(revision, t.clock.now().toISOString(), []);
    const save = await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: value },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json<{ issues: LoopIssue[] }>().issues).toContainEqual(
      expect.objectContaining({ code: 'MODEL_UNAVAILABLE', severity: 'warning' }),
    );
    const validation = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/validate`,
      payload: { definition: value },
    });
    expect(validation.json().publishable).toBe(false);
    const publish = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    expect(publish.statusCode, publish.body).toBe(422);
    expect(publish.json().errors).toContainEqual(
      expect.objectContaining({ code: 'MODEL_UNAVAILABLE' }),
    );
    const start = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: {
        input: {
          protocol: CHAT_PROTOCOL,
          conversationId: t.container.ports.ids.next(),
          requestId: randomUUID(),
          turn: 1,
          input: { kind: 'text', text: 'Unavailable model must not be admitted' },
          history: [],
        },
      },
    });
    expect(start.statusCode, start.body).toBe(422);
    expect(start.json().errors).toContainEqual(
      expect.objectContaining({ code: 'MODEL_UNAVAILABLE' }),
    );
    expect(await t.container.repos.runs.list({})).toHaveLength(0);
    expect(harness.started).toHaveLength(0);
  });

  it('preserves an absent dynamic model in an editable draft and blocks its publication', async () => {
    const result = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: definition() },
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json<{ issues: LoopIssue[] }>().issues).toContainEqual(
      expect.objectContaining({ code: 'MODEL_UNAVAILABLE', severity: 'warning' }),
    );
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: `/loops/${result.json<{ loop: { id: string } }>().loop.id}/publish`,
        })
      ).statusCode,
    ).toBe(422);
    expect(harness.started).toHaveLength(0);
  });

  it('propagates off/new-address reasons through catalog, chat readiness and refused sends without changing preferences', async () => {
    const revision = await available();
    await gateway();
    await t.container.repos.catalog.setEnabled('ollama', MODEL, false);
    const conversation = (
      await t.app.inject({ method: 'POST', url: '/chat/conversations', payload: {} })
    ).json<ChatConversation>();
    const assertUnavailable = async (reason: string) => {
      expect(await publicCatalog()).toMatchObject({
        enabled: false,
        availability: { state: 'missing', reason },
      });
      const session = (await t.app.inject('/chat/session')).json<ChatSession>();
      expect(session.readiness.text).toEqual({
        ready: false,
        code: 'MODEL_UNAVAILABLE',
        message: reason,
      });
      const send = await t.app.inject({
        method: 'POST',
        url: `/chat/conversations/${conversation.id}/turns`,
        payload: {
          requestId: randomUUID(),
          input: { kind: 'text', text: 'Do not submit while unavailable' },
        },
      });
      expect(send.statusCode, send.body).toBe(409);
      expect(send.json()).toMatchObject({ code: 'CHAT_NOT_READY', detail: reason });
      expect(harness.started).toHaveLength(0);
      expect(await t.container.repos.runs.list({})).toHaveLength(0);
    };
    await repository.configure(
      { enabled: false, baseUrl: 'http://127.0.0.1:11434' },
      t.clock.now().toISOString(),
    );
    await assertUnavailable(OFF);
    const current = await repository.configure(
      { enabled: true, baseUrl: 'http://127.0.0.1:22434' },
      t.clock.now().toISOString(),
    );
    await assertUnavailable(NEW_ADDRESS);
    await repository.fail(current.connection.revision, t.clock.now().toISOString(), {
      code: 'FIXTURE_UNREACHABLE',
      message: 'The new address could not be reached',
    });
    expect(
      await repository.reconcile(revision, t.clock.now().toISOString(), [model(revision)]),
    ).toBe(false);
    await assertUnavailable(NEW_ADDRESS);
    await repository.reconcile(current.connection.revision, t.clock.now().toISOString(), [
      model(current.connection.revision),
    ]);
    expect((await publicCatalog())?.enabled).toBe(false);
    expect((await t.app.inject('/chat/session')).json<ChatSession>().readiness.text).toMatchObject({
      ready: false,
      message: 'The selected model is disabled',
    });
    await t.container.repos.catalog.setEnabled('ollama', MODEL, true);
    expect((await t.app.inject('/chat/session')).json<ChatSession>().readiness.text.ready).toBe(
      true,
    );
  });
});
