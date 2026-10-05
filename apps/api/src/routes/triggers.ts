import {
  CronPreviewRequestSchema,
  CronPreviewResponseSchema,
  JsonValueSchema,
  UlidSchema,
} from '@graphgoblin/contracts';
import { EngineRequestError } from '@graphgoblin/engine';
import { CronScheduler } from '@graphgoblin/infrastructure/scheduler';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../container.js';
import { problem } from '../plugins/errors.js';
import { WEBHOOK_BODY_LIMIT } from '../triggers/trigger-service.js';
import type { ApiInstance } from '../types.js';

export const InboundEventSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: z.string(),
  payload: JsonValueSchema,
  dedupeKey: z.string().optional(),
  source: z.string(),
  receivedAt: z.string(),
  runIds: z.array(z.string()),
});

const ScheduleSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  loopId: z.string(),
  versionId: z.string(),
  triggerNodeId: z.string(),
  expression: z.string(),
  timezone: z.string(),
  missedFirePolicy: z.enum(['skip', 'run-once', 'run-each']),
  enabled: z.boolean(),
  nextFireAt: z.string().optional(),
  lastFiredAt: z.string().optional(),
  createdAt: z.string(),
});

const WebhookEndpointSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  loopId: z.string(),
  versionId: z.string(),
  triggerNodeId: z.string(),
  /** `/hooks/<token>`; the token is the credential-free address, the secret never leaves the store. */
  path: z.string(),
  secretRef: z.string(),
  signatureHeader: z.string(),
  replayWindowSeconds: z.number().int(),
  enabled: z.boolean(),
  createdAt: z.string(),
});

const PollTargetSchema = z.object({
  ownerId: z.string(),
  loopId: z.string(),
  versionId: z.string(),
  triggerNodeId: z.string(),
  intervalSeconds: z.number().int(),
  nextPollAt: z.string(),
});

export function registerTriggerRoutes(app: ApiInstance, container: Container): void {
  const { repos, triggers } = container;

  app.post(
    '/triggers/cron/preview',
    {
      schema: {
        tags: ['triggers'],
        summary: 'Preview upcoming cron slots without arming a schedule (loops:read)',
        body: CronPreviewRequestSchema,
        response: { 200: CronPreviewResponseSchema },
      },
    },
    async (request, reply) => {
      const { expression, timezone, count, from } = request.body;
      const invalid = CronScheduler.validate(expression, timezone);
      if (invalid)
        return problem(reply, 400, 'CRON_INVALID', invalid.message, [
          { path: `config.${invalid.field}`, message: invalid.message },
        ]);
      const next: string[] = [];
      let after = from === undefined ? container.ports.clock.now() : new Date(from);
      for (let i = 0; i < count; i++) {
        const slot = CronScheduler.nextFire(expression, timezone, after);
        if (slot === undefined) break;
        next.push(slot.toISOString());
        after = slot;
      }
      return { next };
    },
  );

  // Signed webhook receiver. Public (see plugins/auth.ts); the HMAC signature is the credential.
  // The body is read raw, because the signature covers the exact bytes the sender produced.
  void app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, next) => {
      next(null, body);
    });
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/hooks/:token',
      {
        bodyLimit: WEBHOOK_BODY_LIMIT,
        schema: {
          tags: ['triggers'],
          summary: 'Signed webhook receiver (public; HMAC, timestamp window, dedupe, rate limit)',
          security: [],
          params: z.object({ token: z.string().min(1).max(256) }),
          response: {
            202: z.object({
              event: InboundEventSchema,
              runId: z.string().optional(),
              filtered: z.boolean(),
            }),
          },
        },
      },
      async (request, reply) => {
        const raw = typeof request.body === 'string' ? request.body : '';
        const outcome = await triggers.handleWebhook(request.params.token, raw, request.headers);
        if (outcome.kind === 'error') {
          if (outcome.retryAfterSeconds !== undefined) {
            void reply.header('retry-after', String(outcome.retryAfterSeconds));
          }
          return problem(reply, outcome.status, outcome.code, outcome.detail);
        }
        reply.status(202);
        return {
          event: outcome.event,
          ...(outcome.runId ? { runId: outcome.runId } : {}),
          filtered: outcome.filtered,
        };
      },
    );
    done();
  });

  app.post(
    '/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Publish an inbound event; fires matching event triggers',
        body: z.object({
          type: z.string().min(1).max(128),
          payload: JsonValueSchema.default(null),
          dedupeKey: z.string().max(512).optional(),
        }),
        response: { 202: InboundEventSchema.extend({ duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const result = await triggers.ingestEvent({
        ownerId: request.auth.ownerId,
        type: request.body.type,
        payload: request.body.payload,
        ...(request.body.dedupeKey ? { dedupeKey: request.body.dedupeKey } : {}),
        source: 'api',
      });
      reply.status(202);
      return { ...result.event, duplicate: result.duplicate };
    },
  );

  app.get(
    '/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Stored inbound events, newest first',
        querystring: z.object({
          type: z.string().max(128).optional(),
          before: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        response: { 200: z.object({ items: z.array(InboundEventSchema) }) },
      },
    },
    async (request) => ({
      items: await repos.inbound.list(request.auth.ownerId, {
        limit: request.query.limit ?? 100,
        ...(request.query.type ? { type: request.query.type } : {}),
        ...(request.query.before ? { before: request.query.before } : {}),
      }),
    }),
  );

  app.get(
    '/loops/:id/triggers',
    {
      schema: {
        tags: ['triggers'],
        summary: 'Schedules, webhook endpoints, and armed poll triggers of a loop',
        params: z.object({ id: UlidSchema }),
        response: {
          200: z.object({
            schedules: z.array(ScheduleSchema),
            webhooks: z.array(WebhookEndpointSchema),
            polls: z.array(PollTargetSchema),
          }),
        },
      },
    },
    async (request) => {
      const loop = await repos.loops.getLoop(request.params.id);
      if (!loop || loop.ownerId !== request.auth.ownerId) {
        throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${request.params.id} not found`);
      }
      return triggers.listForLoop(loop.id);
    },
  );
}
