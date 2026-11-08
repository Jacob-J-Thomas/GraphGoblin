import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_PROTOCOL, LoopDefinitionSchema, type ChatLoopInput } from '@graphgoblin/contracts';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import { ChatAdmissionError, EngineRequestError } from '@graphgoblin/engine';
import { ChatRepositoryError, type ChatStoredTurn } from '@graphgoblin/infrastructure/sqlite';
import { createTestApp, type TestApp } from '../testing/test-app.js';
import type { AuthContext } from '../plugins/auth.js';
import { ChatService } from './service.js';
import { ChatError } from './errors.js';

let t: TestApp;
let service: ChatService;
const auth: AuthContext = { ownerId: 'local', actor: { kind: 'user', id: 'local' }, scopes: '*' };
beforeEach(async () => {
  t = await createTestApp();
  service = new ChatService(t.container);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});
async function freshConversation() {
  return t.container.repos.chat.createConversation({ ownerId: 'local', audienceKey: 'gateway' });
}
async function admitted(): Promise<ChatStoredTurn> {
  const conversation = await freshConversation();
  t.harness.script([{ structured: { protocol: CHAT_PROTOCOL, reply: 'Actual reply' } }]);
  const requestId = randomUUID();
  await service.send(auth, conversation.id, {
    requestId,
    input: { kind: 'text', text: 'User text' },
  });
  await t.idle();
  return (await t.container.repos.chat.findRequest(
    { ownerId: 'local', audienceKey: 'gateway' },
    conversation.id,
    requestId,
  ))!;
}

describe('durable native result projection', () => {
  it('treats tombstones/missing history as gone and rejects noncanonical successful values or missing pins', async () => {
    const stored = await admitted();
    await expect(service.project({ ...stored, historyDeleted: true })).rejects.toMatchObject({
      code: 'CHAT_HISTORY_DELETED',
    });
    const { input: _input, ...missingInput } = stored;
    await expect(service.project(missingInput)).rejects.toMatchObject({
      code: 'CHAT_HISTORY_DELETED',
    });
    const get = vi.spyOn(t.container.repos.runs, 'get');
    get.mockResolvedValueOnce(undefined);
    await expect(service.project(stored)).rejects.toMatchObject({ code: 'CHAT_HISTORY_DELETED' });
    await t.container.repos.runs.update(stored.runId, {
      result: { text: 'must not display arbitrary aliases' },
    });
    expect((await service.project(stored)).error?.code).toBe('CHAT_RESPONSE_INVALID');
    const version = vi.spyOn(t.container.repos.loops, 'getVersion');
    version.mockResolvedValueOnce(undefined);
    expect((await service.project(stored)).error?.code).toBe('CHAT_RESPONSE_INVALID');
    const run = await t.container.repos.runs.get(stored.runId);
    const pinned = await t.container.repos.loops.getVersion(run!.versionId);
    const invalid = structuredClone(pinned!);
    invalid.definition.nodes = [];
    version.mockResolvedValueOnce(invalid);
    expect((await service.project(stored)).error?.code).toBe('CHAT_RESPONSE_INVALID');
    await t.container.repos.runs.update(stored.runId, {
      status: 'failed',
      failure: {
        code: 'SCRIPT_EXIT_CODE',
        message: 'PRIVATE_STDOUT_TOKEN',
        resumable: false,
      },
    });
    const failed = await service.project(stored);
    expect(failed.error?.code).toBe('SCRIPT_EXIT_CODE');
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_STDOUT_TOKEN');
    await t.container.repos.runs.update(stored.runId, { status: 'exhausted', failure: undefined });
    expect((await service.project(stored)).error).toMatchObject({
      code: 'CHAT_RUN_FAILED',
      message: 'the workflow reached its execution limit',
    });
  });

  it('builds most recent whole valid pairs, enforces the character bound, and omits deleted/invalid history', async () => {
    const stored = await admitted();
    const projected = await service.project(stored);
    const project = vi.spyOn(service, 'project');
    project.mockImplementation((row) =>
      Promise.resolve({
        ...projected,
        turn: row.turn,
        input: { kind: 'text', text: `user${row.turn}` },
        response: { protocol: CHAT_PROTOCOL, reply: `reply${row.turn}` },
      }),
    );
    const rows = Array.from({ length: 15 }, (_, index) => ({ ...stored, turn: index + 1 }));
    let history = await service.history(rows);
    expect(history).toHaveLength(24);
    expect(history[0]?.text).toBe('user4');
    project.mockResolvedValue({
      ...projected,
      input: { kind: 'text', text: 'u'.repeat(16_000) },
      response: { protocol: CHAT_PROTOCOL, reply: 'r'.repeat(32_000) },
    });
    history = await service.history(rows);
    expect(history).toHaveLength(2);
    expect(history.reduce((sum, message) => sum + message.text.length, 0)).toBe(48_000);
    project.mockResolvedValueOnce({
      ...projected,
      input: { kind: 'audio', audioId: stored.id },
      inputTranscript: 'real transcript',
    });
    expect((await service.history([stored]))[0]?.text).toBe('real transcript');
    const { response: _response, ...withoutResponse } = projected;
    project.mockResolvedValueOnce({
      ...withoutResponse,
      input: { kind: 'audio', audioId: stored.id },
    });
    expect(await service.history([stored])).toEqual([]);
    expect(await service.history([{ ...stored, historyDeleted: true }])).toEqual([]);
    project.mockRejectedValueOnce(new ChatError('CHAT_HISTORY_DELETED', 410, 'gone'));
    expect(await service.history([stored])).toEqual([]);
    project.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(service.history([stored])).rejects.toThrow('storage unavailable');
  });
});

describe('admission uncertainty and counter recovery', () => {
  it('rebuilds a stale snapshot once, then returns the same native admitted identity after lost acknowledgement', async () => {
    const conversation = await freshConversation();
    t.harness.script([{ structured: { protocol: CHAT_PROTOCOL, reply: 'One native reply' } }]);
    const original = t.container.manager.startRun.bind(t.container.manager);
    const start = vi.spyOn(t.container.manager, 'startRun');
    start.mockRejectedValueOnce(new ChatAdmissionError('CHAT_STALE_CONTEXT', 'stale'));
    start.mockImplementationOnce(async (input, check) => {
      await original(input, check);
      throw new Error('commit acknowledgement lost');
    });
    const requestId = randomUUID();
    const turn = await service.send(auth, conversation.id, {
      requestId,
      input: { kind: 'text', text: 'once' },
    });
    expect(start).toHaveBeenCalledTimes(2);
    await t.idle();
    expect((await t.container.repos.runs.list({})).map((run) => run.id)).toEqual([turn.runId]);
    expect(
      (
        await service.send(auth, conversation.id, {
          requestId,
          input: { kind: 'text', text: 'once' },
        })
      ).id,
    ).toBe(turn.id);
  });

  it('stops after a second stale snapshot and never retries an unknown fresh identity', async () => {
    const conversation = await freshConversation();
    const start = vi
      .spyOn(t.container.manager, 'startRun')
      .mockRejectedValue(new ChatAdmissionError('CHAT_STALE_CONTEXT', 'stale'));
    const request = { requestId: randomUUID(), input: { kind: 'text' as const, text: 'once' } };
    await expect(service.send(auth, conversation.id, request)).rejects.toMatchObject({
      code: 'CHAT_STALE_CONTEXT',
    });
    expect(start).toHaveBeenCalledTimes(2);
    start.mockReset().mockResolvedValue(undefined as never);
    await expect(service.send(auth, conversation.id, request)).rejects.toMatchObject({
      code: 'CHAT_ADMISSION_UNCERTAIN',
    });
    expect(await t.container.repos.runs.list({})).toHaveLength(0);
  });

  it('keeps typed admission refusals and reports unknown commit acknowledgement failures as uncertain', async () => {
    const conversation = await freshConversation();
    const start = vi.spyOn(t.container.manager, 'startRun');
    const request = { requestId: randomUUID(), input: { kind: 'text' as const, text: 'once' } };
    start.mockRejectedValueOnce(new EngineRequestError('SHUTTING_DOWN', 'shutting down'));
    await expect(service.send(auth, conversation.id, request)).rejects.toMatchObject({
      code: 'SHUTTING_DOWN',
    });
    start.mockRejectedValueOnce(new ChatRepositoryError('CHAT_AUDIO_EXPIRED', 'audio expired'));
    await expect(service.send(auth, conversation.id, request)).rejects.toMatchObject({
      code: 'CHAT_AUDIO_EXPIRED',
    });
    start.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_PARAMETERS'));
    await expect(service.send(auth, conversation.id, request)).rejects.toMatchObject({
      code: 'CHAT_ADMISSION_UNCERTAIN',
      status: 503,
    });
    expect(await t.container.repos.runs.list({})).toHaveLength(0);
  });

  it('returns no setup identity for an unpublished/corrupt binding and rethrows unexpected storage failures', async () => {
    const binding = vi.spyOn(t.container.repos.chat, 'getBinding').mockResolvedValue(undefined);
    expect((await service.session(auth)).readiness.text.ready).toBe(false);
    expect((await service.session(auth)).systemLoopId).toBeUndefined();
    binding.mockRejectedValue(new Error('storage unavailable'));
    await expect(service.session(auth)).rejects.toThrow('storage unavailable');
  });

  it('recovers a duplicate that commits between its early lookup and the context snapshot', async () => {
    const stored = await admitted();
    const conversation = (await t.container.repos.chat.getConversation(
      { ownerId: 'local', audienceKey: 'gateway' },
      stored.conversationId,
    ))!;
    const lookup = vi.spyOn(t.container.repos.chat, 'findRequest');
    lookup.mockResolvedValueOnce(undefined);
    vi.spyOn(t.container.repos.chat, 'context').mockResolvedValue({
      conversation,
      turns: [],
      active: true,
    });
    expect(
      (
        await service.send(auth, stored.conversationId, {
          requestId: stored.requestId,
          input: stored.input!,
        })
      ).id,
    ).toBe(stored.id);
    lookup.mockResolvedValueOnce(undefined);
    await expect(
      service.send(auth, stored.conversationId, {
        requestId: stored.requestId,
        input: { kind: 'text', text: 'different body' },
      }),
    ).rejects.toMatchObject({ code: 'CHAT_REQUEST_CONFLICT' });
  });

  it('pages past one hundred invalid terminal results to find older valid history', async () => {
    const stored = await admitted();
    const conversation = (await t.container.repos.chat.getConversation(
      { ownerId: 'local', audienceKey: 'gateway' },
      stored.conversationId,
    ))!;
    const valid = await service.project(stored);
    const { response: _response, ...invalid } = valid;
    vi.spyOn(service, 'project').mockImplementation((row) =>
      Promise.resolve(row.turn === 1 ? valid : invalid),
    );
    vi.spyOn(t.container.repos.chat, 'context').mockResolvedValueOnce({
      conversation: { ...conversation, lastTurn: 101 },
      active: false,
      turns: Array.from({ length: 100 }, (_, index) => ({ ...stored, turn: index + 2 })),
    });
    const page = vi.spyOn(t.container.repos.chat, 'contextHistory').mockResolvedValueOnce([stored]);
    const start = vi.spyOn(t.container.manager, 'startRun').mockResolvedValue(undefined as never);
    await expect(
      service.send(auth, conversation.id, {
        requestId: randomUUID(),
        input: { kind: 'text', text: 'next' },
      }),
    ).rejects.toMatchObject({ code: 'CHAT_ADMISSION_UNCERTAIN' });
    expect(page).toHaveBeenCalledWith(
      { ownerId: 'local', audienceKey: 'gateway' },
      conversation.id,
      { beforeTurn: 2, limit: 100 },
    );
    expect((start.mock.calls[0]![0].payload as ChatLoopInput).history).toEqual([
      { role: 'user', text: 'User text' },
      { role: 'assistant', text: 'Actual reply' },
    ]);
  });
});

it('reports nested readiness from the exact published reference and handles missing references', async () => {
  const child = await t.container.repos.loops.create(
    'local',
    createSystemChatDefinition({ name: 'Nested', harness: 'codex' }),
  );
  await t.container.repos.loops.publish(child.loop.id);
  const current = await service.published(auth);
  const build = (loopId: string, version: 'latest' | number) =>
    LoopDefinitionSchema.parse({
      ...current.version.definition,
      nodes: current.version.definition.nodes.map((node) =>
        node.id === 'respond'
          ? {
              id: 'respond',
              kind: 'subloop',
              label: 'Nested reply',
              config: { loopRef: { loopId, version } },
            }
          : node,
      ),
    });
  for (const version of ['latest', 1] as const) {
    await t.container.repos.loops.saveDraft(current.loop.id, build(child.loop.id, version));
    await t.container.repos.loops.publish(current.loop.id);
    expect((await service.session(auth)).readiness.text.ready).toBe(true);
  }
  t.harness.preflightResult = {
    state: 'cli-missing',
    ok: false,
    authenticated: false,
    problems: [],
  };
  expect((await service.session(auth)).readiness.text.ready).toBe(false);
  await t.container.repos.loops.saveDraft(
    current.loop.id,
    build(t.container.ports.ids.next(), 'latest'),
  );
  await t.container.repos.loops.publish(current.loop.id);
  expect((await service.session(auth)).readiness.text.ready).toBe(false);
});
