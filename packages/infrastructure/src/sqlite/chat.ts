import type {
  ChatAudioUpload,
  ChatConversation,
  ChatDevice,
  ChatSendInput,
  LoopDefinition,
} from '@graphgoblin/contracts';
import {
  CHAT_PROTOCOL,
  ChatLoopInputSchema,
  ChatTextInputJsonSchema,
} from '@graphgoblin/contracts';
import {
  stableStringify,
  systemChatCapabilities,
  systemChatIssues,
  validateJson,
} from '@graphgoblin/domain';
import type { ClockPort, IdPort, RunAdmission } from '@graphgoblin/engine';
import { ChatAdmissionError } from '@graphgoblin/engine';
import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql, type AnyColumn } from 'drizzle-orm';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { Database, SqliteTransaction } from './db.js';
import { physicalDirectory } from '../fs/physical-path.js';
import { insertLoopWithVersion } from './loops.js';
import {
  chatAudio,
  chatBindings,
  chatConversations,
  chatDevices,
  chatPairings,
  chatTurns,
  loops,
  loopVersions,
  runs,
} from './schema.js';

export interface ChatScope {
  ownerId: string;
  audienceKey: string;
}
export interface ChatStoredTurn {
  id: string;
  conversationId: string;
  requestId: string;
  requestHash: string;
  turn: number;
  runId: string;
  createdAt: string;
  input?: ChatSendInput;
  historyDeleted: boolean;
}
export interface ChatAudioMetadata extends ChatAudioUpload {
  path: string;
  sha256: string;
  state: 'ready' | 'consumed';
  consumedTurnId?: string;
}
export class ChatRepositoryError extends Error {
  constructor(
    readonly code:
      | 'CHAT_NOT_FOUND'
      | 'CHAT_NOT_READY'
      | 'CHAT_PAIRING_INVALID'
      | 'CHAT_PAIRING_UNAVAILABLE'
      | 'CHAT_BUSY'
      | 'CHAT_AUDIO_QUOTA'
      | 'CHAT_AUDIO_EXPIRED'
      | 'CHAT_AUDIO_CONSUMED'
      | 'SYSTEM_CHAT_CONTRACT_INVALID'
      | 'SYSTEM_LOOP_PROTECTED',
    message: string,
  ) {
    super(message);
    this.name = 'ChatRepositoryError';
  }
}
export const chatAudienceKey = (
  audience: { kind: 'gateway' } | { kind: 'device'; deviceId: string },
): string => (audience.kind === 'gateway' ? 'gateway' : 'device:' + audience.deviceId);
const scopeWhere = (table: { ownerId: AnyColumn; audienceKey: AnyColumn }, scope: ChatScope) =>
  and(eq(table.ownerId, scope.ownerId), eq(table.audienceKey, scope.audienceKey));
const notFound = (): never => {
  throw new ChatRepositoryError('CHAT_NOT_FOUND', 'Chat resource not found');
};
function deviceOf(row: typeof chatDevices.$inferSelect, loopId: string): ChatDevice {
  return {
    id: row.id,
    label: row.label,
    loopId,
    createdAt: row.createdAt,
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}
function conversationOf(row: typeof chatConversations.$inferSelect): ChatConversation {
  return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, lastTurn: row.lastTurn };
}
function turnOf(row: typeof chatTurns.$inferSelect): ChatStoredTurn {
  return {
    id: row.id,
    conversationId: row.conversationId,
    requestId: row.requestId,
    requestHash: row.requestHash,
    turn: row.turn,
    runId: row.runId,
    createdAt: row.createdAt,
    historyDeleted: row.historyDeleted,
    ...(row.input ? { input: row.input } : {}),
  };
}
function audioOf(row: typeof chatAudio.$inferSelect): ChatAudioMetadata {
  if (
    !row.path ||
    !row.mimeType ||
    !row.bytes ||
    !row.sha256 ||
    (row.state !== 'ready' && row.state !== 'consumed')
  )
    throw new ChatRepositoryError('CHAT_AUDIO_EXPIRED', 'Audio upload is unavailable');
  return {
    id: row.id,
    path: row.path,
    mimeType: row.mimeType,
    bytes: row.bytes,
    sha256: row.sha256,
    expiresAt: row.expiresAt,
    state: row.state,
    ...(row.consumedTurnId ? { consumedTurnId: row.consumedTurnId } : {}),
  };
}
export class SqliteChatRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}
  private now() {
    return this.clock.now().toISOString();
  }
  /** SQL driver errors can embed bind parameters; credential hashes must never escape. */
  private async sensitive<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ChatRepositoryError) throw error;
      throw new ChatRepositoryError('CHAT_NOT_READY', 'Chat credential storage is unavailable');
    }
  }
  async getBinding(scope: ChatScope) {
    const [binding] = await this.db
      .select()
      .from(chatBindings)
      .where(scopeWhere(chatBindings, scope));
    if (!binding) return undefined;
    const [loop] = await this.db
      .select({ id: loops.id, ownerId: loops.ownerId })
      .from(loops)
      .where(eq(loops.id, binding.loopId));
    if (!loop || loop.ownerId !== scope.ownerId || binding.protocol !== CHAT_PROTOCOL)
      throw new ChatRepositoryError('CHAT_NOT_READY', 'The system chat binding is unavailable');
    return { loopId: binding.loopId, protocol: CHAT_PROTOCOL };
  }
  async ensureGateway(ownerId: string, definition: LoopDefinition) {
    if (systemChatIssues(definition).length)
      throw new ChatRepositoryError('SYSTEM_CHAT_CONTRACT_INVALID', 'Invalid system chat boundary');
    const now = this.now();
    const loopId = this.ids.next(),
      versionId = this.ids.next();
    const working = definition.settings.workingDirectory;
    const physical = working.kind === 'fixed' ? await physicalDirectory(working.path) : null;
    await this.db.transaction(async (tx) => {
      const [bound] = await tx
        .select()
        .from(chatBindings)
        .where(and(eq(chatBindings.ownerId, ownerId), eq(chatBindings.audienceKey, 'gateway')));
      if (bound) return;
      await insertLoopWithVersion(tx, {
        ownerId,
        loopId,
        versionId,
        definition,
        now,
        published: true,
        physical,
      });
      await tx
        .insert(chatBindings)
        .values({ ownerId, audienceKey: 'gateway', loopId, protocol: CHAT_PROTOCOL });
    });
    return (await this.getBinding({ ownerId, audienceKey: 'gateway' }))!;
  }
  async createPairing(ownerId: string, codeHash: string, expiresAt: string) {
    const id = this.ids.next();
    await this.sensitive(() =>
      this.db
        .insert(chatPairings)
        .values({ id, ownerId, codeHash, expiresAt })
        .then(() => undefined),
    );
    return { id, expiresAt };
  }
  async claimPairing(input: {
    codeHash: string;
    claimId: string;
    tokenHash: string;
    label: string;
  }): Promise<ChatDevice> {
    const now = this.now(),
      deviceId = this.ids.next(),
      loopId = this.ids.next(),
      versionId = this.ids.next();
    const source = await this.sensitive(async () => {
      const [row] = await this.db
        .select({ versionId: loopVersions.id, definition: loopVersions.definition })
        .from(chatPairings)
        .innerJoin(
          chatBindings,
          and(
            eq(chatBindings.ownerId, chatPairings.ownerId),
            eq(chatBindings.audienceKey, 'gateway'),
          ),
        )
        .innerJoin(loops, eq(loops.id, chatBindings.loopId))
        .innerJoin(loopVersions, eq(loopVersions.id, loops.currentVersionId))
        .where(eq(chatPairings.codeHash, input.codeHash))
        .limit(1);
      const working = row?.definition.settings.workingDirectory;
      return {
        versionId: row?.versionId,
        physical: working?.kind === 'fixed' ? await physicalDirectory(working.path) : null,
      };
    });
    return this.sensitive(() =>
      this.db.transaction(async (tx) => {
        const invalid = (): never => {
          throw new ChatRepositoryError(
            'CHAT_PAIRING_INVALID',
            'Pairing code is invalid or expired',
          );
        };
        const [pair] = await tx
          .select()
          .from(chatPairings)
          .where(eq(chatPairings.codeHash, input.codeHash));
        if (!pair || pair.expiresAt <= now) return invalid();
        if (pair.claimedDeviceId) {
          if (pair.claimId !== input.claimId || pair.claimedTokenHash !== input.tokenHash)
            return invalid();
          const [device] = await tx
            .select()
            .from(chatDevices)
            .where(eq(chatDevices.id, pair.claimedDeviceId));
          const [binding] = await tx
            .select()
            .from(chatBindings)
            .where(
              and(
                eq(chatBindings.ownerId, pair.ownerId),
                eq(chatBindings.audienceKey, 'device:' + pair.claimedDeviceId),
              ),
            );
          if (!device || device.revokedAt || !binding) return invalid();
          return deviceOf(device, binding.loopId);
        }
        const [binding] = await tx
          .select()
          .from(chatBindings)
          .where(
            and(eq(chatBindings.ownerId, pair.ownerId), eq(chatBindings.audienceKey, 'gateway')),
          );
        const [gateway] = binding
          ? await tx
              .select()
              .from(loops)
              .where(and(eq(loops.id, binding.loopId), eq(loops.ownerId, pair.ownerId)))
          : [];
        const [version] = gateway?.currentVersionId
          ? await tx
              .select()
              .from(loopVersions)
              .where(
                and(
                  eq(loopVersions.id, gateway.currentVersionId),
                  eq(loopVersions.status, 'published'),
                ),
              )
          : [];
        if (
          !version ||
          version.loopId !== gateway?.id ||
          systemChatIssues(version.definition).length
        )
          throw new ChatRepositoryError(
            'CHAT_PAIRING_UNAVAILABLE',
            'Publish a valid gateway chat loop before pairing',
          );
        if (source.versionId !== version.id)
          throw new ChatRepositoryError(
            'CHAT_PAIRING_UNAVAILABLE',
            'Gateway publication changed; retry pairing',
          );
        const [tokenExists] = await tx
          .select({ id: chatDevices.id })
          .from(chatDevices)
          .where(eq(chatDevices.tokenHash, input.tokenHash));
        if (tokenExists) return invalid();
        const definition = structuredClone(version.definition);
        definition.name = input.label + ' Chat';
        await insertLoopWithVersion(tx, {
          ownerId: pair.ownerId,
          loopId,
          versionId,
          definition,
          now,
          published: true,
          physical: source.physical,
        });
        await tx.insert(chatDevices).values({
          id: deviceId,
          ownerId: pair.ownerId,
          label: input.label,
          tokenHash: input.tokenHash,
          createdAt: now,
        });
        await tx.insert(chatBindings).values({
          ownerId: pair.ownerId,
          audienceKey: 'device:' + deviceId,
          loopId,
          protocol: CHAT_PROTOCOL,
        });
        await tx
          .update(chatPairings)
          .set({
            claimId: input.claimId,
            claimedDeviceId: deviceId,
            claimedTokenHash: input.tokenHash,
            claimedAt: now,
          })
          .where(eq(chatPairings.id, pair.id));
        return { id: deviceId, label: input.label, loopId, createdAt: now };
      }),
    );
  }
  async authenticateDevice(tokenHash: string) {
    return this.sensitive(() =>
      this.db.transaction(async (tx) => {
        const [device] = await tx
          .select()
          .from(chatDevices)
          .where(and(eq(chatDevices.tokenHash, tokenHash), sql`${chatDevices.revokedAt} IS NULL`));
        if (!device) return undefined;
        const [binding] = await tx
          .select()
          .from(chatBindings)
          .where(
            and(
              eq(chatBindings.ownerId, device.ownerId),
              eq(chatBindings.audienceKey, 'device:' + device.id),
            ),
          );
        if (!binding) return undefined;
        const now = this.now();
        const lastSeenAt =
          !device.lastSeenAt || Date.parse(now) - Date.parse(device.lastSeenAt) >= 60000
            ? now
            : device.lastSeenAt;
        if (lastSeenAt !== device.lastSeenAt)
          await tx.update(chatDevices).set({ lastSeenAt }).where(eq(chatDevices.id, device.id));
        return {
          ownerId: device.ownerId,
          device: deviceOf({ ...device, lastSeenAt }, binding.loopId),
        };
      }),
    );
  }
  async listDevices(ownerId: string): Promise<ChatDevice[]> {
    const rows = await this.db
      .select({ device: chatDevices, binding: chatBindings })
      .from(chatDevices)
      .innerJoin(
        chatBindings,
        and(
          eq(chatBindings.ownerId, chatDevices.ownerId),
          eq(chatBindings.audienceKey, sql`'device:' || ${chatDevices.id}`),
        ),
      )
      .where(eq(chatDevices.ownerId, ownerId))
      .orderBy(desc(chatDevices.createdAt));
    return rows.map((row) => deviceOf(row.device, row.binding.loopId));
  }
  async updateDevice(ownerId: string, id: string, label: string) {
    return this.changeDevice(ownerId, id, { label });
  }
  async revokeDevice(ownerId: string, id: string) {
    return this.changeDevice(ownerId, id, { revokedAt: this.now() });
  }
  private async changeDevice(
    ownerId: string,
    id: string,
    change: { label?: string; revokedAt?: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [device] = await tx
        .select()
        .from(chatDevices)
        .where(and(eq(chatDevices.id, id), eq(chatDevices.ownerId, ownerId)));
      const [binding] = await tx
        .select()
        .from(chatBindings)
        .where(
          and(eq(chatBindings.ownerId, ownerId), eq(chatBindings.audienceKey, 'device:' + id)),
        );
      if (!device || !binding) return notFound();
      const update = {
        ...change,
        ...(device.revokedAt && change.revokedAt ? { revokedAt: device.revokedAt } : {}),
      };
      await tx.update(chatDevices).set(update).where(eq(chatDevices.id, id));
      return deviceOf({ ...device, ...update }, binding.loopId);
    });
  }
  async createConversation(scope: ChatScope): Promise<ChatConversation> {
    const binding = await this.getBinding(scope);
    if (!binding) throw new ChatRepositoryError('CHAT_NOT_READY', 'Chat is not configured');
    const now = this.now();
    const row = { ...scope, id: this.ids.next(), createdAt: now, updatedAt: now, lastTurn: 0 };
    await this.db.insert(chatConversations).values(row);
    return conversationOf(row);
  }
  async getConversation(scope: ChatScope, id: string) {
    const [row] = await this.db
      .select()
      .from(chatConversations)
      .where(and(scopeWhere(chatConversations, scope), eq(chatConversations.id, id)));
    return row ? conversationOf(row) : undefined;
  }
  async listConversations(scope: ChatScope, options: { limit?: number; before?: string } = {}) {
    const rows = await this.db
      .select()
      .from(chatConversations)
      .where(
        and(
          scopeWhere(chatConversations, scope),
          options.before ? lt(chatConversations.id, options.before) : undefined,
        ),
      )
      .orderBy(desc(chatConversations.id))
      .limit(Math.max(1, Math.min(50, options.limit ?? 20)));
    return rows.map(conversationOf);
  }
  async getTurn(scope: ChatScope, id: string) {
    const [row] = await this.db
      .select()
      .from(chatTurns)
      .where(and(scopeWhere(chatTurns, scope), eq(chatTurns.id, id)));
    return row ? turnOf(row) : undefined;
  }
  async findRequest(scope: ChatScope, conversationId: string, requestId: string) {
    const [row] = await this.db
      .select()
      .from(chatTurns)
      .where(
        and(
          scopeWhere(chatTurns, scope),
          eq(chatTurns.conversationId, conversationId),
          eq(chatTurns.requestId, requestId),
        ),
      );
    return row ? turnOf(row) : undefined;
  }
  async listTurns(
    scope: ChatScope,
    conversationId: string,
    options: { after?: number; limit?: number } = {},
  ) {
    const rows = await this.db
      .select()
      .from(chatTurns)
      .where(
        and(
          scopeWhere(chatTurns, scope),
          eq(chatTurns.conversationId, conversationId),
          eq(chatTurns.historyDeleted, false),
          gt(chatTurns.turn, options.after ?? 0),
        ),
      )
      .orderBy(asc(chatTurns.turn))
      .limit(Math.max(1, Math.min(50, options.limit ?? 50)));
    return rows.map(turnOf);
  }
  async context(scope: ChatScope, conversationId: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(chatConversations)
        .where(and(scopeWhere(chatConversations, scope), eq(chatConversations.id, conversationId)));
      if (!row) return undefined;
      const turns = await tx
        .select({ turn: chatTurns })
        .from(chatTurns)
        .innerJoin(runs, eq(runs.id, chatTurns.runId))
        .where(
          and(
            scopeWhere(chatTurns, scope),
            eq(chatTurns.conversationId, conversationId),
            eq(chatTurns.historyDeleted, false),
            inArray(runs.status, ['succeeded', 'failed', 'cancelled', 'exhausted']),
          ),
        )
        .orderBy(desc(chatTurns.turn))
        .limit(100);
      const [active] = await tx
        .select({ id: runs.id })
        .from(chatTurns)
        .innerJoin(runs, eq(runs.id, chatTurns.runId))
        .where(
          and(
            eq(chatTurns.conversationId, conversationId),
            inArray(runs.status, ['queued', 'running', 'waiting', 'paused']),
          ),
        )
        .limit(1);
      return {
        conversation: conversationOf(row),
        turns: turns.reverse().map((item) => turnOf(item.turn)),
        active: !!active,
      };
    });
  }
  /** Descending bounded pages let the projector find the latest twelve valid successful turns. */
  async contextHistory(
    scope: ChatScope,
    conversationId: string,
    options: { beforeTurn?: number; limit?: number } = {},
  ) {
    const rows = await this.db
      .select({ turn: chatTurns })
      .from(chatTurns)
      .innerJoin(runs, eq(runs.id, chatTurns.runId))
      .where(
        and(
          scopeWhere(chatTurns, scope),
          eq(chatTurns.conversationId, conversationId),
          eq(chatTurns.historyDeleted, false),
          eq(runs.status, 'succeeded'),
          options.beforeTurn !== undefined ? lt(chatTurns.turn, options.beforeTurn) : undefined,
        ),
      )
      .orderBy(desc(chatTurns.turn))
      .limit(Math.max(1, Math.min(100, options.limit ?? 100)));
    return rows.map((row) => turnOf(row.turn));
  }
  async reserveAudio(scope: ChatScope): Promise<string> {
    const now = this.now(),
      id = this.ids.next(),
      expiresAt = new Date(this.clock.now().getTime() + 3600000).toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .update(chatAudio)
        .set({ state: 'pending-delete' })
        .where(
          and(
            scopeWhere(chatAudio, scope),
            inArray(chatAudio.state, ['ready', 'reserved']),
            lte(chatAudio.expiresAt, now),
          ),
        );
      const [count] = await tx
        .select({
          total: sql<number>`count(*)`,
          inflight: sql<number>`sum(case when ${chatAudio.state} = 'reserved' then 1 else 0 end)`,
        })
        .from(chatAudio)
        .where(and(scopeWhere(chatAudio, scope), inArray(chatAudio.state, ['ready', 'reserved'])));
      const [global] = await tx
        .select({ total: sql<number>`count(*)` })
        .from(chatAudio)
        .where(eq(chatAudio.state, 'reserved'));
      if (
        Number(count?.total ?? 0) >= 3 ||
        Number(count?.inflight ?? 0) > 0 ||
        Number(global?.total ?? 0) >= 8
      )
        throw new ChatRepositoryError('CHAT_BUSY', 'Audio upload quota is full');
      const budget = sql<number>`coalesce(sum(case when ${chatAudio.state} = 'reserved' then 10485760 else coalesce(${chatAudio.bytes},0) end),0)`;
      const [audienceBudget] = await tx
        .select({ bytes: budget })
        .from(chatAudio)
        .where(scopeWhere(chatAudio, scope));
      const [gatewayBudget] = await tx.select({ bytes: budget }).from(chatAudio);
      if (
        Number(audienceBudget?.bytes ?? 0) + 10485760 > 64 * 1024 * 1024 ||
        Number(gatewayBudget?.bytes ?? 0) + 10485760 > 256 * 1024 * 1024
      )
        throw new ChatRepositoryError(
          'CHAT_AUDIO_QUOTA',
          'Audio storage quota is full; delete retained run history to free space',
        );
      await tx.insert(chatAudio).values({ ...scope, id, expiresAt, state: 'reserved' });
    });
    return id;
  }
  async completeAudio(
    scope: ChatScope,
    id: string,
    metadata: { mimeType: string; bytes: number; sha256: string; path: string },
  ): Promise<ChatAudioUpload> {
    if (
      !isAbsolute(metadata.path) ||
      !Number.isSafeInteger(metadata.bytes) ||
      metadata.bytes < 1 ||
      metadata.bytes > 10485760 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256)
    )
      throw new ChatRepositoryError('CHAT_AUDIO_EXPIRED', 'Invalid audio metadata');
    const [row] = await this.db
      .update(chatAudio)
      .set({ ...metadata, state: 'ready' })
      .where(
        and(
          scopeWhere(chatAudio, scope),
          eq(chatAudio.id, id),
          eq(chatAudio.state, 'reserved'),
          gt(chatAudio.expiresAt, this.now()),
        ),
      )
      .returning();
    if (!row) throw new ChatRepositoryError('CHAT_AUDIO_EXPIRED', 'Audio reservation expired');
    return {
      id: row.id,
      mimeType: metadata.mimeType,
      bytes: metadata.bytes,
      expiresAt: row.expiresAt,
    };
  }
  async getAudio(scope: ChatScope, id: string): Promise<ChatAudioMetadata | undefined> {
    const [row] = await this.db
      .select()
      .from(chatAudio)
      .where(and(scopeWhere(chatAudio, scope), eq(chatAudio.id, id)));
    if (!row) return undefined;
    return audioOf(row);
  }
  async discardAudio(scope: ChatScope, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(chatAudio)
        .where(and(scopeWhere(chatAudio, scope), eq(chatAudio.id, id)));
      if (!row) return;
      if (row.state === 'consumed')
        throw new ChatRepositoryError('CHAT_AUDIO_CONSUMED', 'Audio is already used by a turn');
      await tx.update(chatAudio).set({ state: 'pending-delete' }).where(eq(chatAudio.id, id));
    });
  }
  async failAudio(scope: ChatScope, id: string): Promise<void> {
    await this.db
      .update(chatAudio)
      .set({ state: 'pending-delete' })
      .where(
        and(scopeWhere(chatAudio, scope), eq(chatAudio.id, id), eq(chatAudio.state, 'reserved')),
      );
  }
  /** At boot all reservations are abandoned; committed files are protected until expiry/history deletion. */
  async recoverAudioReservations(): Promise<void> {
    await this.db
      .update(chatAudio)
      .set({ state: 'pending-delete' })
      .where(eq(chatAudio.state, 'reserved'));
  }
  async cleanupAudio(now = this.now(), limit = 100): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: chatAudio.id })
        .from(chatAudio)
        .where(
          or(
            eq(chatAudio.state, 'pending-delete'),
            and(eq(chatAudio.state, 'ready'), lte(chatAudio.expiresAt, now)),
          ),
        )
        .orderBy(asc(chatAudio.id))
        .limit(Math.max(1, Math.min(100, limit)));
      if (rows.length)
        await tx
          .update(chatAudio)
          .set({ state: 'pending-delete' })
          .where(
            inArray(
              chatAudio.id,
              rows.map((row) => row.id),
            ),
          );
      return rows.map((row) => row.id);
    });
  }
  async protectedAudioIds(): Promise<Set<string>> {
    return new Set(
      (await this.db.select({ id: chatAudio.id }).from(chatAudio)).map((row) => row.id),
    );
  }
  /** Ack exact-ID filesystem deletion only after it succeeded. */
  async audioDeleted(id: string): Promise<void> {
    await this.db
      .delete(chatAudio)
      .where(and(eq(chatAudio.id, id), eq(chatAudio.state, 'pending-delete')));
  }
}

/** All ownership and counter checks occur again inside native run admission. */
export async function checkChatAdmission(tx: SqliteTransaction, input: RunAdmission, now: string) {
  const turn = input.conversationTurn;
  if (!turn) {
    const [system] = await tx
      .select()
      .from(chatBindings)
      .where(eq(chatBindings.loopId, input.run.loopId));
    if (system) {
      if (system.ownerId !== input.run.ownerId)
        throw new ChatAdmissionError('CHAT_NOT_FOUND', 'System chat loop not found');
      const [version] = input.snapshot
        ? []
        : await tx.select().from(loopVersions).where(eq(loopVersions.id, input.run.versionId));
      const definition = input.snapshot?.definition ?? version?.definition;
      if (
        !definition ||
        (version && version.loopId !== input.run.loopId) ||
        systemChatIssues(definition).length
      )
        throw new ChatAdmissionError(
          'CHAT_NOT_READY',
          'The pinned system chat boundary is invalid',
        );
      const payload = input.initialThread.invocation.trigger.payload;
      if (input.replayIntent) {
        const [source] = await tx
          .select({ ownerId: runs.ownerId, loopId: runs.loopId, thread: runs.initialThread })
          .from(runs)
          .where(eq(runs.id, input.replayIntent.sourceRunId));
        if (
          !source ||
          source.ownerId !== input.run.ownerId ||
          source.loopId !== input.run.loopId ||
          stableStringify(source.thread.invocation.trigger.payload) !== stableStringify(payload)
        )
          throw new ChatAdmissionError(
            'CHAT_NOT_READY',
            'Replay chat input differs from its admitted source',
          );
        const canonical = ChatLoopInputSchema.safeParse(payload);
        if (!canonical.success)
          throw new ChatAdmissionError('CHAT_NOT_READY', 'Replay chat input is invalid');
        if (canonical.data.input.kind === 'audio') {
          const details = canonical.data.input.audio;
          const [audio] = await tx
            .select()
            .from(chatAudio)
            .where(
              and(
                eq(chatAudio.id, details.id),
                eq(chatAudio.ownerId, input.run.ownerId),
                eq(chatAudio.audienceKey, system.audienceKey),
                eq(chatAudio.state, 'consumed'),
              ),
            );
          if (
            !audio ||
            !audio.sha256 ||
            details.path !== audio.path ||
            details.mimeType !== audio.mimeType ||
            details.bytes !== audio.bytes
          )
            throw new ChatAdmissionError('CHAT_NOT_READY', 'Replay audio is unavailable');
        }
      } else if (!validateJson(ChatTextInputJsonSchema, payload).ok)
        throw new ChatAdmissionError(
          'CHAT_NOT_READY',
          'System chat starts outside Chat accept canonical text input only',
        );
    }
    return undefined;
  }
  const [prior] = await tx
    .select()
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.conversationId, turn.conversationId),
        eq(chatTurns.requestId, turn.requestId),
      ),
    );
  if (prior) {
    if (prior.ownerId !== input.run.ownerId || prior.audienceKey !== turn.audienceKey)
      throw new ChatAdmissionError('CHAT_NOT_FOUND', 'Conversation not found');
    if (prior.requestHash !== turn.requestHash)
      throw new ChatAdmissionError(
        'CHAT_REQUEST_CONFLICT',
        'Request ID was already used with different input',
      );
    if (prior.historyDeleted)
      throw new ChatAdmissionError('CHAT_HISTORY_DELETED', 'This turn history was deleted');
    const [run] = await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, prior.runId));
    if (!run) throw new ChatAdmissionError('CHAT_HISTORY_DELETED', 'This turn history was deleted');
    return prior.runId;
  }
  if (createHash('sha256').update(stableStringify(turn.input)).digest('hex') !== turn.requestHash)
    throw new ChatAdmissionError('CHAT_REQUEST_CONFLICT', 'Invalid canonical request identity');
  const canonical = ChatLoopInputSchema.safeParse(input.initialThread.invocation.trigger.payload);
  if (
    !canonical.success ||
    canonical.data.conversationId !== turn.conversationId ||
    canonical.data.requestId !== turn.requestId ||
    canonical.data.turn !== turn.expectedLastTurn + 1
  )
    throw new ChatAdmissionError('CHAT_NOT_READY', 'Invalid chat input identity');
  const publicInput = canonical.data.input;
  if (turn.input.kind === 'text' && stableStringify(publicInput) !== stableStringify(turn.input))
    throw new ChatAdmissionError('CHAT_REQUEST_CONFLICT', 'Canonical input changed');
  const scope = { ownerId: input.run.ownerId, audienceKey: turn.audienceKey };
  const [conversation] = await tx
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.id, turn.conversationId), scopeWhere(chatConversations, scope)),
    );
  const [binding] = await tx
    .select()
    .from(chatBindings)
    .where(
      and(
        scopeWhere(chatBindings, scope),
        eq(chatBindings.loopId, input.run.loopId),
        eq(chatBindings.protocol, CHAT_PROTOCOL),
      ),
    );
  const [loop] = await tx
    .select()
    .from(loops)
    .where(and(eq(loops.id, input.run.loopId), eq(loops.ownerId, input.run.ownerId)));
  if (!conversation || !binding || !loop)
    throw new ChatAdmissionError('CHAT_NOT_FOUND', 'Conversation not found');
  if (turn.audienceKey.startsWith('device:')) {
    const [device] = await tx
      .select()
      .from(chatDevices)
      .where(
        and(
          eq(chatDevices.id, turn.audienceKey.slice(7)),
          eq(chatDevices.ownerId, input.run.ownerId),
          sql`${chatDevices.revokedAt} IS NULL`,
        ),
      );
    if (!device)
      throw new ChatAdmissionError('CHAT_DEVICE_REVOKED', 'Device access is unavailable');
  }
  if (conversation.lastTurn !== turn.expectedLastTurn)
    throw new ChatAdmissionError('CHAT_STALE_CONTEXT', 'Conversation changed; refresh its history');
  const [active] = await tx
    .select({ id: runs.id })
    .from(chatTurns)
    .innerJoin(runs, eq(runs.id, chatTurns.runId))
    .where(
      and(
        eq(chatTurns.conversationId, conversation.id),
        inArray(runs.status, ['queued', 'running', 'waiting', 'paused']),
      ),
    )
    .limit(1);
  if (active) throw new ChatAdmissionError('CHAT_BUSY', 'Wait for the current turn to finish');
  const [version] = await tx
    .select()
    .from(loopVersions)
    .where(eq(loopVersions.id, input.run.versionId));
  if (
    !version ||
    version.loopId !== loop.id ||
    version.status !== 'published' ||
    systemChatIssues(version.definition).length
  )
    throw new ChatAdmissionError('CHAT_NOT_READY', 'The pinned chat loop is unavailable');
  if (turn.audioId) {
    if (!systemChatCapabilities(version.definition).audio)
      throw new ChatAdmissionError('CHAT_NOT_READY', 'Audio is not configured for this chat loop');
    const [audio] = await tx
      .select()
      .from(chatAudio)
      .where(and(eq(chatAudio.id, turn.audioId), scopeWhere(chatAudio, scope)));
    if (!audio) throw new ChatAdmissionError('CHAT_NOT_FOUND', 'Audio upload not found');
    if (audio.state === 'consumed')
      throw new ChatAdmissionError('CHAT_AUDIO_CONSUMED', 'Audio was already used');
    if (
      audio.state !== 'ready' ||
      audio.expiresAt <= now ||
      !audio.path ||
      !audio.sha256 ||
      !audio.bytes ||
      !audio.mimeType
    )
      throw new ChatAdmissionError('CHAT_AUDIO_EXPIRED', 'Audio upload expired');
    if (publicInput.kind !== 'audio')
      throw new ChatAdmissionError('CHAT_NOT_READY', 'Invalid chat audio input');
    const details = publicInput.audio;
    if (
      details.id !== audio.id ||
      details.path !== audio.path ||
      details.bytes !== audio.bytes ||
      details.mimeType !== audio.mimeType
    )
      throw new ChatAdmissionError('CHAT_NOT_READY', 'Audio metadata changed');
  }
  return undefined;
}
export async function commitChatAdmission(tx: SqliteTransaction, input: RunAdmission) {
  const turn = input.conversationTurn;
  if (!turn) return;
  await tx.insert(chatTurns).values({
    id: turn.id,
    ownerId: input.run.ownerId,
    audienceKey: turn.audienceKey,
    conversationId: turn.conversationId,
    requestId: turn.requestId,
    requestHash: turn.requestHash,
    turn: turn.expectedLastTurn + 1,
    runId: input.run.id,
    input: turn.input,
    createdAt: input.run.createdAt,
  });
  await tx
    .update(chatConversations)
    .set({ lastTurn: turn.expectedLastTurn + 1, updatedAt: input.run.createdAt })
    .where(eq(chatConversations.id, turn.conversationId));
  if (turn.audioId)
    await tx
      .update(chatAudio)
      .set({ state: 'consumed', consumedTurnId: turn.id })
      .where(eq(chatAudio.id, turn.audioId));
}
