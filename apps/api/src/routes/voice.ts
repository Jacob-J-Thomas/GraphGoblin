import { z } from 'zod';
import {
  VoiceSetupSchema,
  VoiceConfigUpdateSchema,
  VoiceProbeRequestSchema,
  VoicePreviewRequestSchema,
  VoicePreviewSchema,
  VoiceLoopPreviewSchema,
  VoiceStageRequestSchema,
  VoiceStageSchema,
  VoiceOperationSchema,
  VoiceInstallRequestSchema,
} from '@graphgoblin/contracts';
import type { ApiInstance } from '../types.js';
import type { Container } from '../container.js';
import { ChatError } from '../chat/errors.js';
export function registerVoiceRoutes(app: ApiInstance, container: Container): void {
  const voice = container.voice;
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith('/chat/voice/'))
      reply.header('cache-control', 'no-store');
    return payload;
  });
  app.get(
    '/chat/voice/config',
    {
      schema: {
        tags: ['settings'],
        summary: 'Voice routing, connection and measured capability',
        response: { 200: VoiceSetupSchema },
      },
    },
    (request) => voice.setup(request.auth.ownerId),
  );
  app.put(
    '/chat/voice/config',
    {
      schema: {
        tags: ['settings'],
        summary: 'Save explicit owner voice routing',
        body: VoiceConfigUpdateSchema,
        response: { 200: VoiceSetupSchema },
      },
    },
    (request) => voice.update(request.auth.ownerId, request.body),
  );
  app.post(
    '/chat/voice/install',
    {
      schema: {
        tags: ['settings'],
        summary: 'Start one guided local model installation',
        body: VoiceInstallRequestSchema,
        response: { 202: VoiceOperationSchema },
      },
    },
    async (request, reply) => {
      reply.status(202);
      return voice.startInstall(request.auth.ownerId, request.body);
    },
  );
  app.post(
    '/chat/voice/probe',
    {
      schema: {
        tags: ['settings'],
        summary: 'Test a route once with the included public sample',
        body: VoiceProbeRequestSchema,
        response: { 202: VoiceOperationSchema },
      },
    },
    async (request, reply) => {
      reply.status(202);
      return voice.startProbe(request.auth.ownerId, request.body);
    },
  );
  app.get(
    '/chat/voice/probes/:operationId',
    {
      schema: {
        tags: ['settings'],
        summary: 'Read an existing voice test without repeating it',
        params: z.strictObject({ operationId: z.uuid() }),
        response: { 200: VoiceOperationSchema },
      },
    },
    (request) => voice.operation(request.auth.ownerId, request.params.operationId, 'probe'),
  );
  app.get(
    '/chat/voice/installs/:operationId',
    {
      schema: {
        tags: ['settings'],
        summary: 'Read an existing model download without restarting it',
        params: z.strictObject({ operationId: z.uuid() }),
        response: { 200: VoiceOperationSchema },
      },
    },
    (request) => voice.operation(request.auth.ownerId, request.params.operationId, 'install'),
  );
  app.get(
    '/chat/voice/loops',
    {
      schema: {
        tags: ['settings'],
        summary: 'Inspect each independent chat loop before changing it',
        response: { 200: z.strictObject({ items: z.array(VoiceLoopPreviewSchema) }) },
      },
    },
    async (request) => ({ items: await voice.loops(request.auth.ownerId) }),
  );
  app.post(
    '/chat/voice/preview',
    {
      schema: {
        tags: ['settings'],
        summary: 'Preview a precise voice preset edit without saving or publishing',
        body: VoicePreviewRequestSchema,
        response: { 200: VoicePreviewSchema },
      },
    },
    (request) =>
      voice.preview(
        request.auth.ownerId,
        request.body.loopId,
        request.body.expectedDraftHash,
        request.body.expectedConfigRevision,
      ),
  );
  app.post(
    '/chat/voice/stage',
    {
      schema: {
        tags: ['settings'],
        summary: 'Stage the reviewed voice edit as a guarded draft only',
        body: VoiceStageRequestSchema,
        response: { 200: VoiceStageSchema },
      },
    },
    async (request) => {
      const body = request.body;
      const preview = await voice.preview(
        request.auth.ownerId,
        body.loopId,
        body.expectedDraftHash,
        body.expectedConfigRevision,
      );
      if (preview.previewHash !== body.expectedPreviewHash)
        throw new ChatError(
          'VOICE_PREVIEW_STALE',
          409,
          'The preview changed. Refresh and review it again.',
        );
      await container.repos.loops.saveDraft(body.loopId, preview.definition, {
        ownerId: request.auth.ownerId,
        definitionHash: body.expectedDraftHash,
        voiceConfigRevision: body.expectedConfigRevision,
      });
      return {
        loopId: body.loopId,
        draftHash: preview.previewHash,
        editorUrl: `/app/loops/${body.loopId}/edit`,
      };
    },
  );
}
