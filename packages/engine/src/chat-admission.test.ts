import { afterEach, describe, expect, it } from 'vitest';
import { fakeUlid, samplePin, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  parseRunAdmission,
  parseConversationTurn,
  type ConversationTurnAdmission,
  type RunAdmission,
} from './admission.js';
import { createSystemChatDefinition, enableChatAudio } from '@graphgoblin/domain';
import { NodeSchema } from '@graphgoblin/contracts';
import { createInitialThread } from './thread.js';
import { createFakePorts, InMemoryTriggerAdmission } from './testing/fakes.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';
function attachment(): ConversationTurnAdmission {
  return {
    id: fakeUlid('turn'),
    conversationId: fakeUlid('conversation'),
    requestId: '00000000-0000-4000-8000-000000000001',
    requestHash: 'a'.repeat(64),
    expectedLastTurn: 0,
    audienceKey: 'gateway',
    input: { kind: 'text', text: 'Hello' },
  };
}
function intent(turn = attachment()): RunAdmission {
  const run = {
    id: fakeUlid('run'),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    pinned: samplePin(),
    invocationId: fakeUlid('invocation'),
    status: 'queued' as const,
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'manual.api',
      trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  return {
    run,
    initialThread,
    conversationTurn: turn,
    pinnedLoopIds: [run.loopId],
    queued: { type: 'run.queued', versionId: run.versionId, pinned: run.pinned, initialThread },
  };
}
function setup() {
  const ports = createFakePorts();
  const input = intent();
  ports.admission.chatConversations.set(input.conversationTurn!.conversationId, {
    ownerId: 'local',
    audienceKey: 'gateway',
    loopId: input.run.loopId,
    lastTurn: 0,
  });
  return { ports, input };
}
describe('frozen native conversation attachments', () => {
  it('parses text and audio identities and refuses malformed attachments', () => {
    expect(parseRunAdmission(intent()).conversationTurn).toEqual(attachment());
    const audioId = fakeUlid('audio');
    const audio = { ...attachment(), input: { kind: 'audio' as const, audioId }, audioId };
    expect(parseConversationTurn(audio)).toEqual(audio);
    for (const value of [
      null,
      [],
      1,
      { ...attachment(), id: 'bad' },
      { ...attachment(), requestId: 'bad' },
      { ...attachment(), requestHash: 'bad' },
      { ...attachment(), expectedLastTurn: -1 },
      { ...attachment(), audienceKey: 'other' },
      { ...attachment(), audioId },
      { ...audio, audioId: fakeUlid('different') },
      { ...audio, audioId: undefined },
      { ...attachment(), input: { kind: 'text', text: '' } },
    ])
      expect(() => parseConversationTurn(value)).toThrow();
    const child = intent();
    child.run.parentRunId = fakeUlid('parent');
    child.parentNodeId = 'sub';
    expect(() => parseRunAdmission(child)).toThrow();
  });
  it('commits once, returns a duplicate run, refuses changed or deleted identity and stages chat failure before any write', async () => {
    const { ports, input } = setup();
    const created = await ports.admission.create(input);
    expect(created.id).toBe(input.run.id);
    const duplicate = structuredClone(input);
    duplicate.run.id = fakeUlid('retry');
    duplicate.initialThread.run.id = duplicate.run.id;
    duplicate.queued = { ...duplicate.queued, initialThread: duplicate.initialThread };
    expect((await ports.admission.create(duplicate)).id).toBe(created.id);
    duplicate.conversationTurn!.requestHash = 'b'.repeat(64);
    await expect(ports.admission.create(duplicate)).rejects.toMatchObject({
      code: 'CHAT_REQUEST_CONFLICT',
    });
    ports.admission.chatTurns.get(
      JSON.stringify([attachment().conversationId, attachment().requestId]),
    )!.historyDeleted = true;
    await expect(ports.admission.create(input)).rejects.toMatchObject({
      code: 'CHAT_HISTORY_DELETED',
    });
    const fresh = setup();
    const failing = new InMemoryTriggerAdmission(
      fresh.ports.runs,
      fresh.ports.events,
      fresh.ports.loops,
      (write) => {
        if (write === 'create.chat') throw new Error('chat write');
      },
    );
    failing.chatConversations.set(attachment().conversationId, {
      ownerId: 'local',
      audienceKey: 'gateway',
      loopId: fresh.input.run.loopId,
      lastTurn: 0,
    });
    await expect(failing.create(fresh.input)).rejects.toThrow('chat write');
    expect(await fresh.ports.runs.get(fresh.input.run.id)).toBeUndefined();
    expect(failing.chatTurns.size).toBe(0);
  });
  it('enforces ownership, revocation, counter and outstanding native status', async () => {
    const { ports, input } = setup();
    const conversation = ports.admission.chatConversations.get(attachment().conversationId)!;
    conversation.ownerId = 'other';
    await expect(ports.admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
    conversation.ownerId = 'local';
    ports.admission.revokedChatDevices.add('gateway');
    await expect(ports.admission.create(input)).rejects.toMatchObject({
      code: 'CHAT_DEVICE_REVOKED',
    });
    ports.admission.revokedChatDevices.clear();
    conversation.lastTurn = 2;
    await expect(ports.admission.create(input)).rejects.toMatchObject({
      code: 'CHAT_STALE_CONTEXT',
    });
    conversation.lastTurn = 0;
    await ports.admission.create(input);
    const next = intent({
      ...attachment(),
      id: fakeUlid('turn2'),
      requestId: '00000000-0000-4000-8000-000000000002',
      expectedLastTurn: 1,
    });
    await expect(ports.admission.create(next)).rejects.toMatchObject({ code: 'CHAT_BUSY' });
  });
  it('owns, expires and consumes audio only with an accepted turn', async () => {
    const { ports, input } = setup();
    const audioId = fakeUlid('audio');
    input.conversationTurn = { ...attachment(), input: { kind: 'audio', audioId }, audioId };
    await expect(ports.admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
    const audio: {
      ownerId: string;
      audienceKey: string;
      expiresAt: string;
      consumedTurnId?: string;
    } = {
      ownerId: 'local',
      audienceKey: 'gateway',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    ports.admission.chatAudio.set(audioId, audio);
    await expect(ports.admission.create(input)).rejects.toMatchObject({
      code: 'CHAT_AUDIO_EXPIRED',
    });
    audio.expiresAt = '2030-01-01T00:00:00.000Z';
    audio.consumedTurnId = 'other';
    await expect(ports.admission.create(input)).rejects.toMatchObject({
      code: 'CHAT_AUDIO_CONSUMED',
    });
    delete audio.consumedTurnId;
    await ports.admission.create(input);
    expect(audio.consumedTurnId).toBe(attachment().id);
  });
});
let engine: TestEngine | undefined;
afterEach(() => engine?.manager.stop());
it('RunManager carries the frozen attachment through native policy, lock and admission', async () => {
  engine = await createTestEngine();
  const version = engine.publish(
    singleNodeLoop('Chat turn', {
      id: 'effect',
      kind: 'mutate',
      label: 'Effect',
      config: { operations: [{ op: 'append-message', content: 'done' }] },
    }),
  );
  engine.ports.admission.chatConversations.set(attachment().conversationId, {
    ownerId: 'local',
    audienceKey: 'gateway',
    loopId: version.loopId,
    lastTurn: 0,
  });
  const attached = attachment();
  const run = await engine.start(version.loopId, null, { conversationTurn: attached });
  attached.input = { kind: 'text', text: 'After admission mutation' };
  const stored = [...engine.ports.admission.chatTurns.values()][0]!;
  expect(stored.input).toEqual({ kind: 'text', text: 'Hello' });
  expect(stored.runId).toBe(run.id);
  await engine.manager.waitForIdle();
});

it('system starts reject audio paths through generic, draft and child entry points before execution', async () => {
  engine = await createTestEngine();
  const normalizer = NodeSchema.parse({
    id: 'chat-normalize',
    kind: 'script',
    label: 'Normalize',
    config: { command: 'normalize', stdin: 'thread', stdout: 'last-output' },
  });
  if (normalizer.kind !== 'script') throw new Error('fixture');
  const definition = enableChatAudio(
    createSystemChatDefinition({ name: 'System', harness: 'codex' }),
    normalizer,
  );
  const version = engine.publish(definition);
  engine.ports.loops.systemChatBindings.set(version.loopId, {
    kind: 'chat',
    protocol: 'graphgoblin.chat.v1',
    audience: { kind: 'gateway' },
  });
  const payload = {
    protocol: 'graphgoblin.chat.v1',
    conversationId: attachment().conversationId,
    requestId: attachment().requestId,
    turn: 1,
    input: {
      kind: 'audio',
      audio: {
        id: fakeUlid('unowned'),
        mimeType: 'audio/wav',
        bytes: 1,
        path: '/arbitrary/private',
      },
    },
    history: [],
  };
  await expect(engine.start(version.loopId, payload)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(
    engine.start(version.loopId, payload, {
      parentRunId: fakeUlid('parent'),
      parentNodeId: 'child',
      source: 'subloop',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const draft = structuredClone(definition);
  draft.edges = [];
  const broken = engine.publish(draft, { loopId: version.loopId, version: 2, status: 'draft' });
  await expect(
    engine.start(version.loopId, null, { versionId: broken.id, allowDraft: true }),
  ).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
  expect(engine.ports.scripts.calls).toHaveLength(0);
  expect(await engine.ports.runs.listRecoveryCandidates()).toEqual([]);
});
