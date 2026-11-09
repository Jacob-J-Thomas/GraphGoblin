import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  CHAT_MAX_AUDIO_BYTES,
  VOICE_NORMALIZER_COMMAND,
  ChatAudioUploadSchema,
  ChatAudioUploadStatusSchema,
  ChatConversationSchema,
  ChatSendRequestSchema,
  ChatSessionSchema,
  ChatTurnSchema,
  UlidSchema,
} from '@graphgoblin/contracts';
import { ChatAudioStoreError } from '@graphgoblin/infrastructure/fs';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';
import type { FastifyRequest } from 'fastify';
import { ChatError } from '../chat/errors.js';
import { normalizeChatMediaType, validateCanonicalChatWav } from '../chat/media.js';
import { ChatService, chatScope } from '../chat/service.js';
import { problem } from '../plugins/errors.js';
import { FixedWindowRateLimiter } from '../triggers/rate-limit.js';
import { registerChatPairingRoutes } from './chat-pairing.js';
export { pairingBaseUrl } from './chat-pairing.js';

const IdParams = z.strictObject({ id: UlidSchema });
const EmptyBody = z.strictObject({}).default({});
export function registerChatRoutes(app: ApiInstance, container: Container): void {
  const { chat } = container.repos;
  const service = new ChatService(container);
  registerChatPairingRoutes(app, container);
  const sends = new FixedWindowRateLimiter(container.ports.clock, 30);
  const uploads = new FixedWindowRateLimiter(container.ports.clock, 6);
  const reservations = new WeakMap<
    FastifyRequest,
    {
      id: string;
      mimeType: string;
      uploadId: string;
      digest: string;
      canonicalWav: boolean;
      scope: ReturnType<typeof chatScope>;
    }
  >();
  const releaseReservation = async (request: FastifyRequest): Promise<void> => {
    const reservation = reservations.get(request);
    if (!reservation) return;
    reservations.delete(request);
    await chat.failUpload(reservation.scope, reservation.uploadId, 'CHAT_AUDIO_UPLOAD_FAILED');
    await chat.discardAudio(reservation.scope, reservation.id);
    await container.chatAudio.remove(reservation.id);
    await chat.audioDeleted(reservation.id);
  };

  // Preserve a bounded stream: quota is reserved by the handler before consuming any bytes.
  app.addContentTypeParser(/^(?:audio|video)\//i, (_request, payload, done) => done(null, payload));
  app.addHook('onRequest', async (request, reply) => {
    const route = `${request.method} ${request.routeOptions.url ?? ''}`;
    let decisions: { allowed: boolean; retryAfterSeconds: number }[] = [];
    if (route === 'POST /chat/conversations/:id/turns')
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
      const published = await service.published(request.auth);
      const normalizer = published.version.definition.nodes.find(
        (node) => node.id === 'chat-normalize',
      );
      if (
        normalizer?.kind === 'script' &&
        normalizer.config.command === VOICE_NORMALIZER_COMMAND &&
        normalizeChatMediaType(request.headers['content-type']) !== 'audio/wav'
      )
        throw new ChatError(
          'CHAT_MEDIA_UNSUPPORTED',
          415,
          'the guided voice preset requires canonical WAV audio',
        );
      const scope = chatScope(request.auth);
      const uploadId = z.uuid().safeParse(request.headers['idempotency-key']);
      const digest = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .safeParse(request.headers['x-content-sha256']);
      if (!uploadId.success || !digest.success)
        throw new ChatError(
          'CHAT_AUDIO_UPLOAD_IDENTITY_REQUIRED',
          400,
          'persist an upload UUID and SHA-256 digest before uploading',
        );
      const existing = await chat.beginUpload(scope, uploadId.data, digest.data);
      if (existing) {
        if (existing.state === 'ready') return reply.status(201).send(existing.audio);
        if (existing.state === 'receiving')
          throw new ChatError(
            'CHAT_AUDIO_UPLOAD_IN_PROGRESS',
            409,
            'check the existing upload identity before retrying',
          );
        throw new ChatError(
          'CHAT_AUDIO_UPLOAD_RETIRED',
          410,
          'this upload attempt is terminal; keep the draft and start a new upload explicitly',
        );
      }
      try {
        const id = await chat.reserveAudio(scope);
        reservations.set(request, {
          id,
          scope,
          uploadId: uploadId.data,
          digest: digest.data,
          canonicalWav:
            normalizer?.kind === 'script' && normalizer.config.command === VOICE_NORMALIZER_COMMAND,
          mimeType: normalizeChatMediaType(request.headers['content-type']),
        });
      } catch (error) {
        await chat.failUpload(scope, uploadId.data, 'CHAT_AUDIO_UPLOAD_FAILED');
        throw error;
      }
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
      items: await Promise.all(
        (
          await chat.listConversations(chatScope(request.auth), {
            ...(request.query.before ? { before: request.query.before } : {}),
            ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
          })
        ).map((conversation) => service.conversation(request.auth, conversation)),
      ),
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
      const { id, mimeType, scope, uploadId, digest, canonicalWav } = reservations.get(request)!;
      try {
        if (!(request.body instanceof Readable))
          throw new ChatError('CHAT_MEDIA_UNSUPPORTED', 415, 'upload raw audio bytes');
        const stored = await container.chatAudio.write(id, request.body);
        if (stored.sha256 !== digest)
          throw new ChatError(
            'CHAT_AUDIO_DIGEST_MISMATCH',
            400,
            'uploaded audio does not match its frozen digest',
          );
        if (canonicalWav) validateCanonicalChatWav(await readFile(stored.path));
        const upload = await chat.completeAudio(scope, id, {
          mimeType,
          bytes: stored.byteLength,
          sha256: stored.sha256,
          path: stored.path,
        });
        await chat.finishUpload(scope, uploadId, id);
        reservations.delete(request);
        reply.status(201);
        return upload;
      } catch (error) {
        await chat.failUpload(
          scope,
          uploadId,
          error instanceof ChatError ? error.code : 'CHAT_AUDIO_UPLOAD_FAILED',
        );
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

  app.get(
    '/chat/audio/requests/:uploadId',
    {
      schema: {
        tags: ['chat'],
        summary: 'Recover an audio upload acknowledgement without replay',
        params: z.strictObject({ uploadId: z.uuid() }),
        response: { 200: ChatAudioUploadStatusSchema },
      },
    },
    async (request) => {
      const status = await chat.uploadStatus(chatScope(request.auth), request.params.uploadId);
      if (!status) throw new ChatError('CHAT_NOT_FOUND', 404, 'upload request not found');
      if (status.state === 'retired')
        throw new ChatError(
          'CHAT_AUDIO_UPLOAD_RETIRED',
          410,
          'this upload is no longer available; keep the draft and start a new upload explicitly',
        );
      return status;
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
}
