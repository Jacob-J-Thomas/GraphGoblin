import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { CHAT_PROTOCOL, NodeSchema, type ChatSendInput } from '@graphgoblin/contracts';
import { fakeUlid, samplePin } from '@graphgoblin/contracts/testing';
import { createSystemChatDefinition, enableChatAudio, stableStringify } from '@graphgoblin/domain';
import { createInitialThread, type RunAdmission } from '@graphgoblin/engine';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, openDatabase, type DatabaseHandle } from './db.js';
import { SqliteChatRepository, type ChatScope } from './chat.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteTriggerAdmission } from './admission.js';
import { SqliteEventStore } from './events.js';
import {
  chatAudio,
  chatPairings,
  chatTurns,
  loopVersions,
  loops,
  runEvents,
  runs,
} from './schema.js';
import { deleteRuns } from './delete-runs.js';
let handle: DatabaseHandle,
  repo: SqliteChatRepository,
  loopRepo: SqliteLoopRepository,
  admission: SqliteTriggerAdmission;
const clock = new FakeClock(Date.parse('2030-01-01T00:00:00.000Z'));
let ids: FakeIds;
const scope: ChatScope = { ownerId: 'local', audienceKey: 'gateway' };
const def = () => createSystemChatDefinition({ name: 'Gateway Chat', harness: 'codex' });
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
beforeEach(async () => {
  clock.set('2030-01-01T00:00:00.000Z');
  handle = await openMemoryDatabase();
  ids = new FakeIds();
  repo = new SqliteChatRepository(handle.db, clock, ids);
  loopRepo = new SqliteLoopRepository(handle.db, clock, ids);
  admission = new SqliteTriggerAdmission(handle.db, new SqliteEventStore(handle.db, clock), clock);
});
afterEach(() => handle.close());
async function prepare(
  input: ChatSendInput = { kind: 'text', text: 'Hello' },
  requestId: string = randomUUID(),
  conversationId?: string,
  expectedLastTurn = 0,
  audience = scope,
): Promise<RunAdmission> {
  const binding =
    (await repo.getBinding(audience)) ?? (await repo.ensureGateway(audience.ownerId, def()));
  const loop = await loopRepo.getLoop(binding.loopId);
  const versionId = loop!.currentVersionId!;
  const conversation = conversationId ?? (await repo.createConversation(audience)).id;
  const now = clock.now().toISOString(),
    runId = ids.next(),
    invocationId = ids.next();
  const audio = input.kind === 'audio' ? await repo.getAudio(audience, input.audioId) : undefined;
  const payload = {
    protocol: CHAT_PROTOCOL,
    conversationId: conversation,
    requestId,
    turn: expectedLastTurn + 1,
    input:
      input.kind === 'text'
        ? input
        : {
            kind: 'audio',
            audio: {
              id: audio!.id,
              mimeType: audio!.mimeType,
              bytes: audio!.bytes,
              path: audio!.path,
            },
          },
    history: [],
  };
  const initialThread = createInitialThread({
    runId,
    loopId: binding.loopId,
    versionId,
    invocation: {
      id: invocationId,
      source: 'manual.api',
      trigger: { nodeId: 'chat-input', kind: 'manual', payload, receivedAt: now },
    },
  });
  const run = {
    id: runId,
    ownerId: audience.ownerId,
    loopId: binding.loopId,
    versionId,
    pinned: samplePin(),
    invocationId,
    status: 'queued' as const,
    iteration: 1,
    createdAt: now,
    lastEventSeq: 0,
  };
  return {
    run,
    initialThread,
    queued: { type: 'run.queued', versionId, pinned: run.pinned, initialThread },
    pinnedLoopIds: [run.loopId],
    conversationTurn: {
      id: ids.next(),
      conversationId: conversation,
      requestId,
      requestHash: hash(input),
      expectedLastTurn,
      audienceKey: audience.audienceKey,
      input,
      ...(input.kind === 'audio' ? { audioId: input.audioId } : {}),
    },
  };
}
async function upload(audience = scope) {
  const id = await repo.reserveAudio(audience);
  await repo.completeAudio(audience, id, {
    mimeType: 'audio/webm',
    bytes: 3,
    sha256: 'a'.repeat(64),
    path: '/tmp/chat-audio/' + id + '.audio',
  });
  return id;
}
function audioDefinition() {
  const normalizer = NodeSchema.parse({
    id: 'chat-normalize',
    kind: 'script',
    label: 'Normalize',
    config: { command: 'normalize', stdin: 'thread', stdout: 'last-output' },
  });
  if (normalizer.kind !== 'script') throw new Error('fixture');
  return enableChatAudio(def(), normalizer);
}
function replay(source: RunAdmission): RunAdmission {
  const result = structuredClone(source);
  delete result.conversationTurn;
  result.run.id = ids.next();
  result.run.invocationId = ids.next();
  result.initialThread.run.id = result.run.id;
  result.initialThread.invocation.id = result.run.invocationId;
  const replayOf = { runId: source.run.id, nodeId: 'chat-input' };
  result.initialThread.invocation.replayOf = replayOf;
  result.queued = { ...result.queued, initialThread: result.initialThread, replayOf };
  result.replayIntent = { sourceRunId: source.run.id, nodeId: 'chat-input', observedSeq: 1 };
  return result;
}
async function finish(runId: string) {
  await handle.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, runId));
}
describe('durable chat identities', () => {
  it('seeds once, joins classification through every loop read, protects save/publication/deletion and reports corruption', async () => {
    const [a, b] = await Promise.all([
      repo.ensureGateway('local', def()),
      repo.ensureGateway('local', def()),
    ]);
    expect(a).toEqual(b);
    expect(await loopRepo.listLoops('local')).toHaveLength(1);
    expect((await loopRepo.getLoop(a.loopId))?.system).toEqual({
      kind: 'chat',
      protocol: CHAT_PROTOCOL,
      audience: { kind: 'gateway' },
    });
    expect((await loopRepo.listPublished())[0]?.system).toBeDefined();
    expect((await loopRepo.listWithRunSummaries('local'))[0]?.system).toBeDefined();
    await expect(loopRepo.delete(a.loopId)).rejects.toMatchObject({
      code: 'SYSTEM_LOOP_PROTECTED',
    });
    const invalid = def();
    invalid.nodes = invalid.nodes.filter((node) => node.id !== 'chat-input');
    await expect(loopRepo.saveDraft(a.loopId, invalid)).rejects.toMatchObject({
      code: 'SYSTEM_CHAT_CONTRACT_INVALID',
    });
    await expect(repo.ensureGateway('other', invalid)).rejects.toMatchObject({
      code: 'SYSTEM_CHAT_CONTRACT_INVALID',
    });
    const incomplete = def();
    const exit = incomplete.nodes.find((node) => node.kind === 'exit')!;
    if (exit.kind === 'exit') exit.config.returns = 'none';
    await loopRepo.saveDraft(a.loopId, incomplete);
    await expect(loopRepo.publish(a.loopId)).rejects.toMatchObject({
      code: 'SYSTEM_CHAT_CONTRACT_INVALID',
    });
    const draft = await loopRepo.saveDraft(a.loopId, def());
    await handle.db
      .update(loopVersions)
      .set({ definition: invalid })
      .where(eq(loopVersions.id, draft.id));
    await expect(loopRepo.publish(a.loopId)).rejects.toMatchObject({
      code: 'SYSTEM_CHAT_CONTRACT_INVALID',
    });
    await handle.db.delete(loops).where(eq(loops.id, a.loopId));
    await expect(repo.getBinding(scope)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    await expect(repo.ensureGateway('local', def())).rejects.toMatchObject({
      code: 'CHAT_NOT_READY',
    });
  });
  it('does not publish a system draft changed after its validated read', async () => {
    const binding = await repo.ensureGateway('local', def());
    await loopRepo.saveDraft(binding.loopId, def());
    const readVersion = loopRepo.getVersion.bind(loopRepo);
    const spy = vi.spyOn(loopRepo, 'getVersion').mockImplementationOnce(async (id) => {
      const frozen = await readVersion(id);
      const changed = def();
      const exit = changed.nodes.find((node) => node.kind === 'exit')!;
      if (exit.kind === 'exit') exit.config.returns = 'none';
      await loopRepo.saveDraft(binding.loopId, changed);
      return frozen;
    });
    await expect(loopRepo.publish(binding.loopId)).rejects.toMatchObject({
      code: 'SYSTEM_CHAT_CONTRACT_INVALID',
    });
    spy.mockRestore();
    expect((await loopRepo.getLoop(binding.loopId))?.draftVersionId).toBeDefined();
  });
  it('clones the current publication atomically, retries one claim, rejects competing/expired/revoked identities and keeps loops', async () => {
    const bound = await repo.ensureGateway('local', def());
    const pair = await repo.createPairing('local', 'a'.repeat(64), '2030-01-01T00:10:00.000Z');
    const input = {
      codeHash: 'a'.repeat(64),
      claimId: randomUUID(),
      tokenHash: 'b'.repeat(64),
      label: 'Kitchen',
    };
    const [first, retry] = await Promise.all([repo.claimPairing(input), repo.claimPairing(input)]);
    expect(first).toEqual(retry);
    expect(first.loopId).not.toBe(bound.loopId);
    expect((await loopRepo.getLoop(first.loopId))?.system?.audience).toEqual({
      kind: 'device',
      deviceId: first.id,
    });
    expect(await repo.authenticateDevice(input.tokenHash)).toMatchObject({
      ownerId: 'local',
      device: { id: first.id },
    });
    expect(await repo.authenticateDevice('unknown')).toBeUndefined();
    expect(await repo.listDevices('local')).toHaveLength(1);
    expect(await repo.listDevices('other')).toEqual([]);
    await expect(repo.claimPairing({ ...input, claimId: randomUUID() })).rejects.toMatchObject({
      code: 'CHAT_PAIRING_INVALID',
    });
    await expect(repo.claimPairing({ ...input, tokenHash: 'c'.repeat(64) })).rejects.toMatchObject({
      code: 'CHAT_PAIRING_INVALID',
    });
    expect((await repo.updateDevice('local', first.id, 'Office')).label).toBe('Office');
    await expect(repo.updateDevice('other', first.id, 'No')).rejects.toMatchObject({
      code: 'CHAT_NOT_FOUND',
    });
    const revoked = await repo.revokeDevice('local', first.id);
    expect((await repo.revokeDevice('local', first.id)).revokedAt).toBe(revoked.revokedAt);
    expect(await repo.authenticateDevice(input.tokenHash)).toBeUndefined();
    await expect(repo.claimPairing(input)).rejects.toMatchObject({ code: 'CHAT_PAIRING_INVALID' });
    expect(await loopRepo.listLoops('local')).toHaveLength(2);
    await handle.db
      .update(chatPairings)
      .set({ expiresAt: '2029-01-01T00:00:00.000Z' })
      .where(eq(chatPairings.id, pair.id));
    await expect(repo.claimPairing(input)).rejects.toMatchObject({ code: 'CHAT_PAIRING_INVALID' });
    await expect(repo.claimPairing({ ...input, codeHash: 'z'.repeat(64) })).rejects.toMatchObject({
      code: 'CHAT_PAIRING_INVALID',
    });
  });
  it('does not create orphan devices or loops when seed is absent, unpublished, invalid, or token is already owned', async () => {
    const input = {
      codeHash: 'a'.repeat(64),
      claimId: randomUUID(),
      tokenHash: 'b'.repeat(64),
      label: 'Phone',
    };
    await repo.createPairing('local', input.codeHash, '2030-01-01T00:10:00.000Z');
    await expect(repo.claimPairing(input)).rejects.toMatchObject({
      code: 'CHAT_PAIRING_UNAVAILABLE',
    });
    const bound = await repo.ensureGateway('local', def());
    await handle.db.update(loops).set({ currentVersionId: null }).where(eq(loops.id, bound.loopId));
    await expect(repo.claimPairing(input)).rejects.toMatchObject({
      code: 'CHAT_PAIRING_UNAVAILABLE',
    });
    const version = (await loopRepo.listVersions(bound.loopId))[0]!;
    await handle.db
      .update(loops)
      .set({ currentVersionId: version.id })
      .where(eq(loops.id, bound.loopId));
    const device = await repo.claimPairing(input);
    await repo.createPairing('local', 'c'.repeat(64), '2030-01-01T00:10:00.000Z');
    await expect(repo.claimPairing({ ...input, codeHash: 'c'.repeat(64) })).rejects.toMatchObject({
      code: 'CHAT_PAIRING_INVALID',
    });
    expect((await repo.listDevices('local')).map((row) => row.id)).toEqual([device.id]);
    expect(await handle.db.select().from(loops)).toHaveLength(2);
  });
  it('atomically admits one run/event/turn/counter for concurrent retry and rejects body changes, stale context and busy turns', async () => {
    const a = await prepare();
    const b = await prepare(
      a.conversationTurn!.input,
      a.conversationTurn!.requestId,
      a.conversationTurn!.conversationId,
    );

    const [one, two] = await Promise.all([admission.create(a), admission.create(b)]);
    expect(one.id).toBe(two.id);
    expect(await handle.db.select().from(runs)).toHaveLength(1);
    expect(await handle.db.select().from(chatTurns)).toHaveLength(1);
    const conversationId = a.conversationTurn!.conversationId;
    expect((await repo.getConversation(scope, conversationId))?.lastTurn).toBe(1);
    expect((await repo.context(scope, conversationId))?.active).toBe(true);
    const changed = await prepare(
      { kind: 'text', text: 'Changed' },
      a.conversationTurn!.requestId,
      conversationId,
    );
    await expect(admission.create(changed)).rejects.toMatchObject({
      code: 'CHAT_REQUEST_CONFLICT',
    });
    await expect(
      admission.create(
        await prepare({ kind: 'text', text: 'Second' }, randomUUID(), conversationId, 0),
      ),
    ).rejects.toMatchObject({ code: 'CHAT_STALE_CONTEXT' });
    await expect(
      admission.create(
        await prepare({ kind: 'text', text: 'Second' }, randomUUID(), conversationId, 1),
      ),
    ).rejects.toMatchObject({ code: 'CHAT_BUSY' });
    await finish(one.id);
    expect((await repo.context(scope, conversationId))?.turns).toHaveLength(1);
    expect((await repo.context(scope, conversationId))?.active).toBe(false);
    expect(
      await repo.contextHistory(scope, conversationId, { beforeTurn: 2, limit: 1 }),
    ).toMatchObject([{ turn: 1 }]);
    const next = await prepare({ kind: 'text', text: 'Second' }, randomUUID(), conversationId, 1);
    await admission.create(next);
    expect(await repo.listTurns(scope, conversationId, { after: 1, limit: 1 })).toMatchObject([
      { turn: 2 },
    ]);
    expect((await repo.getTurn(scope, a.conversationTurn!.id))?.runId).toBe(one.id);
    expect((await repo.findRequest(scope, conversationId, a.conversationTurn!.requestId))?.id).toBe(
      a.conversationTurn!.id,
    );
    expect(
      await repo.getTurn({ ownerId: 'other', audienceKey: 'gateway' }, a.conversationTurn!.id),
    ).toBeUndefined();
    expect(await repo.listConversations(scope, { limit: 1 })).toHaveLength(1);
    expect(await repo.listConversations(scope, { before: fakeUlid('none') })).toBeDefined();
  });
  it('refuses inconsistent canonical attachments and invalid pinned boundaries before mutation', async () => {
    const original = await prepare();
    const badHash = structuredClone(original);
    badHash.conversationTurn!.requestHash = 'a'.repeat(64);
    await expect(admission.create(badHash)).rejects.toMatchObject({
      code: 'CHAT_REQUEST_CONFLICT',
    });
    const badPayload = structuredClone(original);
    badPayload.initialThread.invocation.trigger.payload = null;
    badPayload.queued = { ...badPayload.queued, initialThread: badPayload.initialThread };
    await expect(admission.create(badPayload)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    const changed = structuredClone(original);
    const payload = changed.initialThread.invocation.trigger.payload as Record<string, unknown>;
    payload.input = { kind: 'text', text: 'Different' };
    changed.queued = { ...changed.queued, initialThread: changed.initialThread };
    await expect(admission.create(changed)).rejects.toMatchObject({
      code: 'CHAT_REQUEST_CONFLICT',
    });
    await handle.db
      .update(loopVersions)
      .set({ status: 'draft' })
      .where(eq(loopVersions.id, original.run.versionId));
    await expect(admission.create(original)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    expect(await handle.db.select().from(runs)).toEqual([]);
    expect(await repo.context(scope, 'missing')).toBeUndefined();
    expect(await repo.getConversation(scope, 'missing')).toBeUndefined();
    expect(await repo.findRequest(scope, 'missing', randomUUID())).toBeUndefined();
    await expect(
      repo.createConversation({ ownerId: 'other', audienceKey: 'gateway' }),
    ).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
  });
  it('permits canonical generic text and verifies native replay source input before retaining its authority', async () => {
    const source = await prepare();
    delete source.conversationTurn;
    await admission.create(source);
    const fork = replay(source);
    await admission.create(fork);
    const forged = replay(source);
    forged.initialThread.invocation.trigger.payload = null;
    forged.queued = { ...forged.queued, initialThread: forged.initialThread };
    await expect(admission.create(forged)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    const foreign = structuredClone(source);
    foreign.run.id = ids.next();
    foreign.run.ownerId = 'other';
    foreign.initialThread.run.id = foreign.run.id;
    foreign.queued = { ...foreign.queued, initialThread: foreign.initialThread };
    await expect(admission.create(foreign)).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
  });
  it('recovers exact complete native admission after commit acknowledgement loss, without replay or queued re-notification', async () => {
    const input = await prepare();
    const events = new SqliteEventStore(handle.db, clock);
    admission = new SqliteTriggerAdmission(handle.db, events, clock);
    let notified = 0;
    events.subscribe(input.run.id, () => {
      notified++;
    });
    const transaction = handle.db.transaction.bind(handle.db);
    const spy = vi
      .spyOn(handle.db, 'transaction')
      .mockImplementationOnce(async (callback, config) => {
        await transaction(callback, config);
        throw new Error('commit acknowledgement lost');
      });
    const run = await admission.create(input);
    spy.mockRestore();
    expect(run.id).toBe(input.run.id);
    expect(notified).toBe(0);
    expect(await events.read(run.id)).toHaveLength(1);
    expect(await handle.db.select().from(chatTurns)).toHaveLength(1);
    expect(
      (await repo.getConversation(scope, input.conversationTurn!.conversationId))?.lastTurn,
    ).toBe(1);
  });
  it('refuses acknowledgement recovery when complete committed native proof is missing', async () => {
    const input = await prepare();
    const transaction = handle.db.transaction.bind(handle.db);
    const spy = vi
      .spyOn(handle.db, 'transaction')
      .mockImplementationOnce(async (callback, config) => {
        await transaction(callback, config);
        await handle.db.delete(runEvents).where(eq(runEvents.runId, input.run.id));
        throw new Error('original lost acknowledgement');
      });
    await expect(admission.create(input)).rejects.toThrow('original lost acknowledgement');
    spy.mockRestore();
  });
  it('rolls back admission on a failing chat write and leaves neither native run nor turn', async () => {
    const input = await prepare();
    await handle.client.execute(
      "CREATE TRIGGER reject_chat_turn BEFORE INSERT ON chat_turns BEGIN SELECT RAISE(ABORT, 'injected chat failure'); END",
    );
    await expect(admission.create(input)).rejects.toThrow('Failed query: insert into');
    expect(await handle.db.select().from(runs)).toEqual([]);
    expect(await handle.db.select().from(chatTurns)).toEqual([]);
    expect(
      (await repo.getConversation(scope, input.conversationTurn!.conversationId))?.lastTurn,
    ).toBe(0);
  });
  it('checks ownership and live revocation at commit, including auth-to-admission races', async () => {
    await repo.ensureGateway('local', def());
    await repo.createPairing('local', 'a'.repeat(64), '2030-01-01T00:10:00.000Z');
    const device = await repo.claimPairing({
      codeHash: 'a'.repeat(64),
      claimId: randomUUID(),
      tokenHash: 'b'.repeat(64),
      label: 'Room',
    });
    const deviceScope = { ownerId: 'local', audienceKey: 'device:' + device.id };
    const input = await prepare(undefined, undefined, undefined, 0, deviceScope);
    await repo.revokeDevice('local', device.id);
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_DEVICE_REVOKED' });
    input.run.ownerId = 'other';
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
    expect(await handle.db.select().from(runs)).toEqual([]);
  });
  it('retains durable request tombstones after deletion and never re-executes the old key', async () => {
    const input = await prepare();
    await admission.create(input);
    await finish(input.run.id);
    await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, input.run.id)));
    const turn = await repo.findRequest(
      scope,
      input.conversationTurn!.conversationId,
      input.conversationTurn!.requestId,
    );
    expect(turn).toMatchObject({ historyDeleted: true });
    expect(turn?.input).toBeUndefined();
    expect(await repo.listTurns(scope, input.conversationTurn!.conversationId)).toEqual([]);
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_HISTORY_DELETED' });
    expect(await handle.db.select().from(runs)).toEqual([]);
  });
  it('returns an acknowledged admission after closing/reopening the store and does not repeat seeds or pair claims', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-chat-restart-'));
    let durable = openDatabase({ url: 'file:' + join(dir, 'db.sqlite') });
    try {
      await durable.migrate();
      let storage = new SqliteChatRepository(durable.db, clock, new FakeIds());
      const binding = await storage.ensureGateway('local', def());
      await storage.createPairing('local', 'a'.repeat(64), '2030-01-01T00:10:00.000Z');
      const claim = {
        codeHash: 'a'.repeat(64),
        claimId: randomUUID(),
        tokenHash: 'b'.repeat(64),
        label: 'Phone',
      };
      const device = await storage.claimPairing(claim);
      const frozen = await prepare();
      const conversation = await storage.createConversation(scope);
      frozen.conversationTurn!.conversationId = conversation.id;
      frozen.run.loopId = binding.loopId;
      frozen.initialThread.run.loopId = binding.loopId;
      const targetLoop = await new SqliteLoopRepository(durable.db, clock, new FakeIds()).getLoop(
        binding.loopId,
      );
      frozen.run.versionId = targetLoop!.currentVersionId!;
      frozen.initialThread.run.versionId = frozen.run.versionId;
      const payload = frozen.initialThread.invocation.trigger.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload))
        payload['conversationId'] = conversation.id;
      frozen.queued = {
        ...frozen.queued,
        versionId: frozen.run.versionId,
        initialThread: frozen.initialThread,
      };
      frozen.pinnedLoopIds = [binding.loopId];
      await new SqliteTriggerAdmission(
        durable.db,
        new SqliteEventStore(durable.db, clock),
        clock,
      ).create(frozen);
      durable.close();
      durable = openDatabase({ url: 'file:' + join(dir, 'db.sqlite') });
      await durable.migrate();
      storage = new SqliteChatRepository(durable.db, clock, new FakeIds());
      expect(await storage.ensureGateway('local', def())).toEqual(binding);
      expect(await storage.claimPairing(claim)).toEqual(device);
      expect(await durable.db.select().from(loops)).toHaveLength(2);
      const events = new SqliteEventStore(durable.db, clock);
      expect((await new SqliteTriggerAdmission(durable.db, events, clock).create(frozen)).id).toBe(
        frozen.run.id,
      );
      expect(
        (await storage.findRequest(scope, conversation.id, frozen.conversationTurn!.requestId))
          ?.runId,
      ).toBe(frozen.run.id);
      expect(await durable.db.select().from(runs)).toHaveLength(1);
      expect(await events.read(frozen.run.id)).toHaveLength(1);
    } finally {
      durable.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
describe('audio metadata lifecycle', () => {
  it('reserves quota before bytes, permits three ready uploads, expires abandoned work and retries exact-ID cleanup until acknowledged', async () => {
    const id = await repo.reserveAudio(scope);
    await expect(repo.reserveAudio(scope)).rejects.toMatchObject({ code: 'CHAT_AUDIO_QUOTA' });
    expect(await repo.protectedAudioIds()).toEqual(new Set([id]));
    await repo.failAudio(scope, id);
    expect(await repo.cleanupAudio()).toEqual([id]);
    expect(await repo.cleanupAudio()).toEqual([id]);
    await repo.audioDeleted(id);
    expect(await repo.cleanupAudio()).toEqual([]);
    const ids = [await upload(), await upload(), await upload()];
    await expect(repo.reserveAudio(scope)).rejects.toMatchObject({ code: 'CHAT_AUDIO_QUOTA' });
    await repo.discardAudio(scope, ids[0]!);
    await repo.discardAudio(scope, 'missing');
    await repo.discardAudio({ ownerId: 'other', audienceKey: 'gateway' }, ids[1]!);
    const pending = await repo.reserveAudio(scope);
    await repo.recoverAudioReservations();
    expect(await repo.cleanupAudio()).toContain(pending);
    expect(await repo.cleanupAudio('2031-01-01T00:00:00.000Z')).toEqual(
      expect.arrayContaining(ids),
    );
  });
  it('reports the same audio quota refusal when the gateway has eight in-flight uploads', async () => {
    for (let index = 0; index < 8; index++)
      await repo.reserveAudio({
        ownerId: 'local',
        audienceKey: 'device:' + fakeUlid(`upload-${index}`),
      });
    await expect(repo.reserveAudio(scope)).rejects.toMatchObject({ code: 'CHAT_AUDIO_QUOTA' });
  });
  it('reserves worst-case bytes across retained consumed uploads and enforces audience and gateway byte quotas', async () => {
    const retained = async (ownerId: string, audienceKey: string, bytes: number) =>
      handle.db.insert(chatAudio).values({
        id: ids.next(),
        ownerId,
        audienceKey,
        mimeType: 'audio/webm',
        bytes,
        sha256: 'a'.repeat(64),
        path: '/tmp/retained',
        expiresAt: '2020-01-01T00:00:00.000Z',
        state: 'consumed',
        consumedTurnId: fakeUlid('old-turn'),
      });
    for (let i = 0; i < 6; i++) await retained('local', 'gateway', 10 * 1024 * 1024);
    await expect(repo.reserveAudio(scope)).rejects.toMatchObject({ code: 'CHAT_AUDIO_QUOTA' });
    for (let i = 0; i < 19; i++)
      await retained('another', 'device:' + fakeUlid('another'), 10 * 1024 * 1024);
    await expect(
      repo.reserveAudio({ ownerId: 'third', audienceKey: 'gateway' }),
    ).rejects.toMatchObject({ code: 'CHAT_AUDIO_QUOTA' });
  });
  it('redacts credential-bearing driver errors and throttles the durable device last-seen timestamp', async () => {
    await repo.ensureGateway('local', def());
    await repo.createPairing('local', 'a'.repeat(64), '2030-01-01T00:10:00.000Z');
    await expect(
      repo.createPairing('local', 'a'.repeat(64), '2030-01-01T00:10:00.000Z'),
    ).rejects.toMatchObject({
      code: 'CHAT_NOT_READY',
      message: 'Chat credential storage is unavailable',
    });
    const device = await repo.claimPairing({
      codeHash: 'a'.repeat(64),
      claimId: randomUUID(),
      tokenHash: 'b'.repeat(64),
      label: 'Device',
    });
    const first = await repo.authenticateDevice('b'.repeat(64));
    expect(await repo.authenticateDevice('b'.repeat(64))).toEqual(first);
    expect((await repo.listDevices('local'))[0]?.id).toBe(device.id);
  });
  it('rejects invalid metadata, stale reservation and foreign/unknown access without exposing paths', async () => {
    const id = await repo.reserveAudio(scope);
    await expect(
      repo.completeAudio(scope, id, {
        mimeType: 'audio/wav',
        bytes: 0,
        sha256: 'a'.repeat(64),
        path: '/tmp/a',
      }),
    ).rejects.toMatchObject({ code: 'CHAT_AUDIO_EXPIRED' });
    await expect(
      repo.completeAudio(scope, id, {
        mimeType: 'audio/wav',
        bytes: 1,
        sha256: 'a'.repeat(64),
        path: 'relative',
      }),
    ).rejects.toMatchObject({ code: 'CHAT_AUDIO_EXPIRED' });
    await handle.db
      .update(chatAudio)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(chatAudio.id, id));
    await expect(
      repo.completeAudio(scope, id, {
        mimeType: 'audio/wav',
        bytes: 1,
        sha256: 'a'.repeat(64),
        path: '/tmp/a',
      }),
    ).rejects.toMatchObject({ code: 'CHAT_AUDIO_EXPIRED' });
    await expect(repo.getAudio(scope, id)).rejects.toMatchObject({ code: 'CHAT_AUDIO_EXPIRED' });
    expect(await repo.getAudio({ ownerId: 'other', audienceKey: 'gateway' }, id)).toBeUndefined();
    expect(await repo.getAudio(scope, 'missing')).toBeUndefined();
    await repo.reserveAudio(scope);
  });
  it('refuses stale, foreign or changed audio metadata at native commit without consuming it', async () => {
    const binding = await repo.ensureGateway('local', audioDefinition());
    const audioId = await upload();
    const input = await prepare({ kind: 'audio', audioId });
    const audio = (await repo.getAudio(scope, audioId))!;
    await handle.db
      .update(chatAudio)
      .set({ path: '/private/changed' })
      .where(eq(chatAudio.id, audioId));
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    await handle.db
      .update(chatAudio)
      .set({ path: audio.path, state: 'pending-delete' })
      .where(eq(chatAudio.id, audioId));
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_AUDIO_EXPIRED' });
    await handle.db
      .update(chatAudio)
      .set({ state: 'ready', ownerId: 'foreign' })
      .where(eq(chatAudio.id, audioId));
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
    await handle.db.update(chatAudio).set({ ownerId: 'local' }).where(eq(chatAudio.id, audioId));
    const version = (await loopRepo.getLoop(binding.loopId))!.currentVersionId!;
    await handle.db
      .update(loopVersions)
      .set({ definition: def() })
      .where(eq(loopVersions.id, version));
    await expect(admission.create(input)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    expect(await handle.db.select().from(runs)).toEqual([]);
    expect((await repo.getAudio(scope, audioId))?.state).toBe('ready');
  });
  it('readback of lost commit acknowledgement requires and preserves the consumed audio link', async () => {
    await repo.ensureGateway('local', audioDefinition());
    const audioId = await upload();
    const input = await prepare({ kind: 'audio', audioId });
    const transaction = handle.db.transaction.bind(handle.db);
    const spy = vi
      .spyOn(handle.db, 'transaction')
      .mockImplementationOnce(async (callback, config) => {
        await transaction(callback, config);
        throw new Error('commit acknowledgement lost');
      });
    expect((await admission.create(input)).id).toBe(input.run.id);
    spy.mockRestore();
    expect((await repo.getAudio(scope, audioId))?.consumedTurnId).toBe(input.conversationTurn!.id);
  });
  it.each(['initialThread', 'threadSnapshot'] as const)(
    'retains a Windows audio path encoded in a surviving %s until its final history is deleted',
    async (reference) => {
      await repo.ensureGateway('local', audioDefinition());
      const audioId = await upload();
      // Emulate a Windows data directory while exercising the real JSON columns on every host.
      const windowsPath = `C:\\GraphGoblin\\chat-audio\\${audioId}.audio`;
      await handle.db.update(chatAudio).set({ path: windowsPath }).where(eq(chatAudio.id, audioId));
      const original = await prepare({ kind: 'audio', audioId });
      await admission.create(original);
      await finish(original.run.id);

      const keeper = await prepare({ kind: 'text', text: 'Retain the voice input' });
      if (reference === 'initialThread') keeper.initialThread.vars.audioPath = windowsPath;
      await admission.create(keeper);
      if (reference === 'threadSnapshot') {
        const snapshot = structuredClone(keeper.initialThread);
        snapshot.vars.audioPath = windowsPath;
        await handle.db
          .update(runs)
          .set({ threadSnapshot: snapshot })
          .where(eq(runs.id, keeper.run.id));
      }
      await finish(keeper.run.id);
      const stored = (
        await handle.client.execute({
          sql: 'SELECT initial_thread, thread_snapshot FROM runs WHERE id = ?',
          args: [keeper.run.id],
        })
      ).rows[0];
      expect(
        stored?.[reference === 'initialThread' ? 'initial_thread' : 'thread_snapshot'],
      ).toContain(JSON.stringify(windowsPath));

      const unrelated = await prepare({ kind: 'text', text: 'Unrelated history' });
      await admission.create(unrelated);
      await finish(unrelated.run.id);
      await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, unrelated.run.id)));
      expect((await repo.getAudio(scope, audioId))?.state).toBe('consumed');
      expect(await repo.cleanupAudio()).toEqual([]);

      await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, original.run.id)));
      expect((await repo.getAudio(scope, audioId))?.state).toBe('consumed');
      expect(await repo.cleanupAudio()).toEqual([]);
      await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, keeper.run.id)));
      expect(await repo.cleanupAudio()).toEqual([audioId]);
    },
  );
  it('claims bytes exactly once, validates immutable metadata, retains consumed files for native replays, then queues final deletion', async () => {
    const definition = audioDefinition();
    await repo.ensureGateway('local', definition);
    const audioId = await upload();
    const input = await prepare({ kind: 'audio', audioId });
    const arbitrary = structuredClone(input);
    delete arbitrary.conversationTurn;
    await expect(admission.create(arbitrary)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    const admitted = await admission.create(input);
    expect((await repo.getAudio(scope, audioId))?.consumedTurnId).toBe(input.conversationTurn!.id);
    await expect(repo.discardAudio(scope, audioId)).rejects.toMatchObject({
      code: 'CHAT_AUDIO_CONSUMED',
    });
    expect(await repo.cleanupAudio('2031-01-01T00:00:00.000Z')).toEqual([]);
    expect(
      (
        await admission.create(
          await prepare(
            { kind: 'audio', audioId },
            input.conversationTurn!.requestId,
            input.conversationTurn!.conversationId,
          ),
        )
      ).id,
    ).toBe(admitted.id);
    await finish(admitted.id);
    const retry = await prepare(
      { kind: 'audio', audioId },
      randomUUID(),
      input.conversationTurn!.conversationId,
      1,
    );
    await expect(admission.create(retry)).rejects.toMatchObject({ code: 'CHAT_AUDIO_CONSUMED' });
    const fork = structuredClone(input);
    delete fork.conversationTurn;
    fork.run.id = ids.next();
    fork.run.invocationId = ids.next();
    fork.initialThread.run.id = fork.run.id;
    fork.initialThread.invocation.id = fork.run.invocationId;
    const replayOf = { runId: admitted.id, nodeId: 'chat-input' };
    fork.initialThread.invocation.replayOf = replayOf;
    fork.queued = { ...fork.queued, initialThread: fork.initialThread, replayOf };
    fork.replayIntent = { sourceRunId: admitted.id, nodeId: 'chat-input', observedSeq: 1 };
    await handle.db
      .update(chatAudio)
      .set({ state: 'pending-delete' })
      .where(eq(chatAudio.id, audioId));
    await expect(admission.create(fork)).rejects.toMatchObject({ code: 'CHAT_NOT_READY' });
    await handle.db.update(chatAudio).set({ state: 'consumed' }).where(eq(chatAudio.id, audioId));
    await admission.create(fork);
    await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, admitted.id)));
    expect(await repo.cleanupAudio()).toEqual([]);
    await finish(fork.run.id);
    await handle.db.transaction((tx) => deleteRuns(tx, eq(runs.id, fork.run.id)));
    expect(await repo.cleanupAudio()).toEqual([audioId]);
  });
});
