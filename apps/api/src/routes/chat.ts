import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CHAT_MAX_AUDIO_BYTES,
  ChatAudioUploadSchema,
  ChatConversationSchema,
  ChatDeviceSchema,
  ChatPairClaimRequestSchema,
  ChatPairClaimResponseSchema,
  ChatPairingCreatedSchema,
  ChatSendRequestSchema,
  ChatSessionSchema,
  ChatTurnSchema,
  UlidSchema,
} from '@graphgoblin/contracts';
import { ChatAudioStoreError } from '@graphgoblin/infrastructure/fs';
import { systemChatIssues } from '@graphgoblin/domain';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';
import type { FastifyRequest } from 'fastify';
import { ChatError } from '../chat/errors.js';
import { normalizeChatMediaType } from '../chat/media.js';
import { ChatService, chatScope } from '../chat/service.js';
import { problem } from '../plugins/errors.js';
import { FixedWindowRateLimiter } from '../triggers/rate-limit.js';

const IdParams = z.strictObject({ id: UlidSchema });
const EmptyBody = z.strictObject({}).default({});
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Enrollment links use configured authority only, never Host or forwarded headers. */
export function pairingBaseUrl(publicUrl: string | undefined): URL | undefined {
  if (!publicUrl) return undefined;
  try {
    const url = new URL(publicUrl);
    if (url.username || url.password || url.search || url.hash) return undefined;
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
    return new URL('/goblin/', url);
  } catch {
    return undefined;
  }
}

export function registerChatRoutes(app: ApiInstance, container: Container): void {
  const { chat } = container.repos;
  const service = new ChatService(container);
  const claims = new FixedWindowRateLimiter(container.ports.clock, 10);
  const globalClaims = new FixedWindowRateLimiter(container.ports.clock, 100);
  const sends = new FixedWindowRateLimiter(container.ports.clock, 30);
  const uploads = new FixedWindowRateLimiter(container.ports.clock, 6);
  const reservations = new WeakMap<
    FastifyRequest,
    {
      id: string;
      mimeType: string;
      scope: ReturnType<typeof chatScope>;
    }
  >();
  const releaseReservation = async (request: FastifyRequest): Promise<void> => {
    const reservation = reservations.get(request);
    if (!reservation) return;
    reservations.delete(request);
    await chat.discardAudio(reservation.scope, reservation.id);
    await container.chatAudio.remove(reservation.id);
    await chat.audioDeleted(reservation.id);
  };

  // Preserve a bounded stream: quota is reserved by the handler before consuming any bytes.
  app.addContentTypeParser(/^(?:audio|video)\//i, (_request, payload, done) => done(null, payload));
  app.addHook('onRequest', async (request, reply) => {
    const route = `${request.method} ${request.routeOptions.url ?? ''}`;
    let decisions: { allowed: boolean; retryAfterSeconds: number }[] = [];
    if (route === 'POST /chat/pairings/claim') {
      const global = globalClaims.hit('all');
      decisions = global.allowed ? [global, claims.hit(request.ip)] : [global];
    } else if (route === 'POST /chat/conversations/:id/turns')
      decisions = [sends.hit(`${request.auth.ownerId}:${chatScope(request.auth).audienceKey}`)];
    else if (route === 'POST /chat/audio') {
      normalizeChatMediaType(request.headers['content-type']);
      const contentLength = Number(request.headers['content-length']);
      if (contentLength > CHAT_MAX_AUDIO_BYTES)
        throw new ChatError('CHAT_AUDIO_TOO_LARGE', 413, 'audio must be at most 10 MiB');
      decisions = [uploads.hit(`${request.auth.ownerId}:${chatScope(request.auth).audienceKey}`)];
    }
    const denied = decisions.find((decision) => !decision.allowed);
    if (denied) {
      reply.header('retry-after', denied.retryAfterSeconds);
      return problem(
        reply,
        429,
        'RATE_LIMITED',
        'too many chat requests; retry after the indicated delay',
      );
    }
    if (route === 'POST /chat/audio') {
      const { readiness } = await service.readiness(request.auth);
      if (!readiness.audio.ready)
        throw new ChatError(
          'CHAT_AUDIO_UNAVAILABLE',
          409,
          readiness.audio.message ?? 'audio is unavailable',
        );
      const scope = chatScope(request.auth);
      const id = await chat.reserveAudio(scope);
      reservations.set(request, {
        id,
        scope,
        mimeType: normalizeChatMediaType(request.headers['content-type']),
      });
    }
  });
  app.addHook('onResponse', async (request) => {
    await releaseReservation(request);
  });

  app.get(
    '/chat/session',
    {
      schema: {
        tags: ['chat'],
        summary: 'Current chat audience and published workflow capabilities',
        response: { 200: ChatSessionSchema },
      },
    },
    (request) => service.session(request.auth),
  );

  app.post(
    '/chat/conversations',
    {
      schema: {
        tags: ['chat'],
        summary: 'Create a conversation for the current audience',
        body: EmptyBody,
        response: { 201: ChatConversationSchema },
      },
    },
    async (request, reply) => {
      const conversation = await chat.createConversation(chatScope(request.auth));
      reply.status(201);
      return conversation;
    },
  );

  app.get(
    '/chat/conversations',
    {
      schema: {
        tags: ['chat'],
        summary: 'List conversations for the current audience',
        querystring: z.strictObject({
          before: UlidSchema.optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        }),
        response: { 200: z.strictObject({ items: z.array(ChatConversationSchema) }) },
      },
    },
    async (request) => ({
      items: await chat.listConversations(chatScope(request.auth), {
        ...(request.query.before ? { before: request.query.before } : {}),
        ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
      }),
    }),
  );

  app.get(
    '/chat/conversations/:id/turns',
    {
      schema: {
        tags: ['chat'],
        summary: 'Read native-run turns in an audience conversation',
        params: IdParams,
        querystring: z.strictObject({
          after: z.coerce.number().int().nonnegative().safe().optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        }),
        response: { 200: z.strictObject({ items: z.array(ChatTurnSchema) }) },
      },
    },
    async (request) => {
      const scope = chatScope(request.auth);
      if (!(await chat.getConversation(scope, request.params.id)))
        throw new ChatError('CHAT_NOT_FOUND', 404, 'conversation not found');
      const turns = await chat.listTurns(scope, request.params.id, {
        ...(request.query.after !== undefined ? { after: request.query.after } : {}),
        ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
      });
      const items = [];
      for (const turn of turns) {
        try {
          items.push(await service.project(turn));
        } catch (error) {
          if (!(error instanceof ChatError && error.code === 'CHAT_HISTORY_DELETED')) throw error;
        }
      }
      return { items };
    },
  );

  app.post(
    '/chat/conversations/:id/turns',
    {
      schema: {
        tags: ['chat'],
        summary: 'Admit one idempotent native workflow turn',
        params: IdParams,
        body: ChatSendRequestSchema,
        response: { 202: ChatTurnSchema },
      },
    },
    async (request, reply) => {
      const turn = await service.send(request.auth, request.params.id, request.body);
      reply.status(202);
      return turn;
    },
  );

  app.get(
    '/chat/conversations/:id/requests/:requestId',
    {
      schema: {
        tags: ['chat'],
        summary: 'Recover an admission acknowledgement without replay',
        params: IdParams.extend({ requestId: z.uuid() }),
        response: { 200: ChatTurnSchema },
      },
    },
    async (request) => {
      const turn = await chat.findRequest(
        chatScope(request.auth),
        request.params.id,
        request.params.requestId,
      );
      if (!turn) throw new ChatError('CHAT_NOT_FOUND', 404, 'request not found');
      return service.project(turn);
    },
  );

  app.get(
    '/chat/turns/:id',
    {
      schema: {
        tags: ['chat'],
        summary: 'Read one current chat turn',
        params: IdParams,
        response: { 200: ChatTurnSchema },
      },
    },
    async (request) => {
      const turn = await chat.getTurn(chatScope(request.auth), request.params.id);
      if (!turn) throw new ChatError('CHAT_NOT_FOUND', 404, 'turn not found');
      return service.project(turn);
    },
  );

  app.post(
    '/chat/turns/:id/cancel',
    {
      schema: {
        tags: ['chat'],
        summary: 'Cancel a turn through the native run manager',
        params: IdParams,
        body: EmptyBody,
        response: { 200: ChatTurnSchema },
      },
    },
    async (request) => {
      const turn = await chat.getTurn(chatScope(request.auth), request.params.id);
      if (!turn) throw new ChatError('CHAT_NOT_FOUND', 404, 'turn not found');
      await service.project(turn); // Tombstones never reach a native command.
      await container.manager.cancel(turn.runId, request.auth.actor);
      return service.project(turn);
    },
  );

  app.post(
    '/chat/audio',
    {
      bodyLimit: CHAT_MAX_AUDIO_BYTES,
      schema: {
        tags: ['chat'],
        summary: 'Upload raw audio for the configured workflow normalizer',
        response: { 201: ChatAudioUploadSchema },
      },
    },
    async (request, reply) => {
      const { id, mimeType, scope } = reservations.get(request)!;
      try {
        if (!(request.body instanceof Readable))
          throw new ChatError('CHAT_MEDIA_UNSUPPORTED', 415, 'upload raw audio bytes');
        const stored = await container.chatAudio.write(id, request.body);
        const upload = await chat.completeAudio(scope, id, {
          mimeType,
          bytes: stored.byteLength,
          sha256: stored.sha256,
          path: stored.path,
        });
        reservations.delete(request);
        reply.status(201);
        return upload;
      } catch (error) {
        await releaseReservation(request);
        if (error instanceof ChatAudioStoreError) {
          if (error.code === 'too_large')
            throw new ChatError('CHAT_AUDIO_TOO_LARGE', 413, 'audio must be at most 10 MiB');
          if (error.code === 'empty')
            throw new ChatError('CHAT_AUDIO_EMPTY', 400, 'audio must contain at least one byte');
          throw new ChatError(
            'CHAT_AUDIO_STORAGE_UNAVAILABLE',
            507,
            'audio storage is unavailable; try again after the owner checks storage',
          );
        }
        throw error;
      }
    },
  );

  app.delete(
    '/chat/audio/:id',
    {
      schema: {
        tags: ['chat'],
        summary: 'Discard an unused audio upload',
        params: IdParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const scope = chatScope(request.auth);
      // Unknown and foreign IDs are indistinguishable; never delete a path without scoped metadata.
      const audio = await chat.getAudio(scope, request.params.id);
      if (audio) {
        await chat.discardAudio(scope, audio.id);
        await container.chatAudio.remove(audio.id);
        await chat.audioDeleted(audio.id);
      }
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/chat/pairings',
    {
      schema: {
        tags: ['chat'],
        summary: 'Create a ten-minute device enrollment',
        body: EmptyBody,
        response: { 201: ChatPairingCreatedSchema },
      },
    },
    async (request, reply) => {
      const url = pairingBaseUrl(container.config.publicUrl);
      if (!container.config.requireApiKey || !url)
        throw new ChatError(
          'CHAT_PAIRING_UNAVAILABLE',
          409,
          'enable GG_REQUIRE_API_KEY and configure GG_PUBLIC_URL with HTTPS (or loopback HTTP) before pairing',
        );
      try {
        const { version } = await service.published(request.auth);
        if (systemChatIssues(version.definition).length)
          throw new ChatError('CHAT_NOT_READY', 409, 'publish a contract-valid gateway chat loop');
      } catch (error) {
        if (error instanceof ChatError)
          throw new ChatError('CHAT_PAIRING_UNAVAILABLE', 409, error.message);
        throw error;
      }
      const code = randomBytes(32).toString('base64url');
      const expiresAt = new Date(container.ports.clock.now().getTime() + 10 * 60_000).toISOString();
      const pairing = await chat.createPairing(request.auth.ownerId, hash(code), expiresAt);
      url.hash = `pair=${encodeURIComponent(code)}`;
      reply.status(201);
      return { ...pairing, code, url: url.toString() };
    },
  );

  app.post(
    '/chat/pairings/claim',
    {
      schema: {
        tags: ['chat'],
        summary: 'Claim an enrollment idempotently with a client-generated credential',
        security: [],
        body: ChatPairClaimRequestSchema,
        response: { 200: ChatPairClaimResponseSchema },
      },
    },
    async (request) => {
      if (!container.config.requireApiKey)
        throw new ChatError('CHAT_PAIRING_UNAVAILABLE', 409, 'peripheral onboarding is disabled');
      const device = await chat.claimPairing({
        codeHash: hash(request.body.code),
        claimId: request.body.claimId,
        tokenHash: hash(request.body.deviceToken),
        label: request.body.label,
      });
      return { deviceId: device.id, label: device.label };
    },
  );

  app.get(
    '/chat/devices',
    {
      schema: {
        tags: ['chat'],
        summary: 'List paired devices and their editable system loops',
        response: { 200: z.strictObject({ items: z.array(ChatDeviceSchema) }) },
      },
    },
    async (request) => ({ items: await chat.listDevices(request.auth.ownerId) }),
  );

  app.patch(
    '/chat/devices/:id',
    {
      schema: {
        tags: ['chat'],
        summary: 'Rename a device',
        params: IdParams,
        body: ChatDeviceSchema.pick({ label: true }),
        response: { 200: ChatDeviceSchema },
      },
    },
    (request) => chat.updateDevice(request.auth.ownerId, request.params.id, request.body.label),
  );

  app.post(
    '/chat/devices/:id/revoke',
    {
      schema: {
        tags: ['chat'],
        summary: 'Revoke future device access while retaining its loop and history',
        params: IdParams,
        body: EmptyBody,
        response: { 200: ChatDeviceSchema },
      },
    },
    (request) => chat.revokeDevice(request.auth.ownerId, request.params.id),
  );
}
