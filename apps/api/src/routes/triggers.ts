import { exceedsStoredJsonDepth, isJsonValue } from '@graphgoblin/domain';
import { openApiRegistry } from '../openapi-registry.js';
import { decodeEventCursor, encodeEventCursor } from '../event-cursor.js';
import {
  WebhookAuthenticationSchema,
  WebhookBodySchema,
  WebhookEventTypeSchema,
  CronPreviewRequestSchema,
  CronPreviewResponseSchema,
  JsonValueSchema,
  UlidSchema,
  TimestampSchema,
} from '@graphgoblin/contracts';
import { EngineRequestError } from '@graphgoblin/engine';
import { CronScheduler } from '@graphgoblin/infrastructure/scheduler';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Container } from '../container.js';
import { problem } from '../plugins/errors.js';
import {
  EventIntakeError,
  eventKeyIsWellFormed,
  EVENT_PAYLOAD_MAX_DEPTH,
  WEBHOOK_BODY_LIMIT,
} from '../triggers/trigger-service.js';
import type { ApiInstance } from '../types.js';

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
  authentication: WebhookAuthenticationSchema,
  configurationAvailable: z.boolean(),
  body: WebhookBodySchema.optional(),
  eventType: WebhookEventTypeSchema.optional(),
  dedupeKey: z.string().optional(),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const InboundEventSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: z.string(),
  payload: JsonValueSchema,
  dedupeKey: z.string().optional(),
  source: z.string(),
  receivedAt: z.string(),
  runIds: z.array(z.string()),
  webhook: WebhookEndpointSchema.optional(),
  admissionId: z.string().optional(),
  target: z
    .object({ loopId: z.string(), versionId: z.string(), triggerNodeId: z.string() })
    .optional(),
  delivery: z
    .object({
      state: z.enum(['filtered', 'deduplicated', 'pending', 'admitted', 'failed']),
      attempts: z.number().int(),
      nextAttemptAt: z.string().optional(),
      failureCode: z.string().optional(),
    })
    .optional(),
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
          { path: `/${invalid.field}`, message: invalid.message },
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

  // Public receiver (see plugins/auth.ts), with optional HMAC authentication of exact raw bytes.
  void app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, next) => {
      next(null, body);
    });
    scope.withTypeProvider<ZodTypeProvider>().post(
      '/hooks/:token',
      {
        bodyLimit: WEBHOOK_BODY_LIMIT,
        schema: {
          tags: ['triggers'],
          summary:
            'Webhook receiver (public; saved-input acknowledgement, optional HMAC, JSON/text/bytes, 1 MiB, rate limit)',
          security: [],
          params: z.object({ token: z.string().min(1).max(256) }),
          response: {
            202: z.object({ accepted: z.literal(true) }),
          },
        },
      },
      async (request, reply) => {
        const raw = request.body instanceof Uint8Array ? request.body : Buffer.alloc(0);
        const outcome = await triggers.handleWebhook(
          request.params.token,
          raw,
          request.headers,
          request.raw.rawHeaders,
        );
        if (outcome.kind === 'error') {
          if (outcome.retryAfterSeconds !== undefined) {
            void reply.header('retry-after', String(outcome.retryAfterSeconds));
          }
          return problem(reply, outcome.status, outcome.code, outcome.detail);
        }
        reply.status(202);
        return { accepted: true as const };
      },
    );
    done();
  });

  app.post(
    '/events',
    {
      preValidation: async (request, reply) => {
        const body: unknown = request.body;
        const payload: unknown =
          body && typeof body === 'object' && 'payload' in body ? body.payload : null;
        if (!isJsonValue(payload))
          return problem(reply, 400, 'VALIDATION_FAILED', 'payload must be a finite JSON value');
        if (exceedsStoredJsonDepth(payload, EVENT_PAYLOAD_MAX_DEPTH)) {
          container.ports.logger.warn({ code: 'EVENT_PAYLOAD_TOO_DEEP' }, 'event payload refused');
          return problem(
            reply,
            422,
            'EVENT_PAYLOAD_TOO_DEEP',
            'payload exceeds the stored JSON nesting bound (994)',
          );
        }
      },
      schema: {
        tags: ['events'],
        summary: 'Accept an external Event for one explicit published loop and event trigger',
        body: z.strictObject({
          loopId: UlidSchema,
          triggerNodeId: z.string().min(1).max(128).optional(),
          type: z.string().min(1).max(128),
          payload: JsonValueSchema.default(null),
          dedupeKey: z
            .string()
            .min(1)
            .max(512)
            .refine(eventKeyIsWellFormed, 'dedupeKey must contain valid Unicode')
            .refine((key) => !key.includes('\u0000'), 'dedupeKey must not contain U+0000')
            .register(openApiRegistry, {
              description:
                'Optional literal request key: 1 to 512 characters of well-formed Unicode, excluding U+0000 (NUL). Whitespace is significant.',
            })
            .optional(),
        }),
        response: { 202: InboundEventSchema.extend({ duplicate: z.boolean() }) },
      },
    },
    async (request, reply) => {
      let result;
      try {
        result = await triggers.ingestEvent({
          loopId: request.body.loopId,
          ...(request.body.triggerNodeId ? { triggerNodeId: request.body.triggerNodeId } : {}),
          ownerId: request.auth.ownerId,
          type: request.body.type,
          payload: request.body.payload,
          ...(request.body.dedupeKey !== undefined ? { dedupeKey: request.body.dedupeKey } : {}),
          source: 'api',
        });
      } catch (error) {
        if (error instanceof EventIntakeError)
          return problem(reply, error.status, error.code, error.message);
        throw error;
      }
      reply.status(202);
      return { ...result.event, duplicate: result.duplicate };
    },
  );

  app.get(
    '/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Stored inbound events, newest first with stable paging',
        querystring: z.strictObject({
          type: z.string().max(128).optional(),
          before: TimestampSchema.optional(),
          cursor: z.string().optional().register(openApiRegistry, {
            description: 'Opaque inbound-event cursor, at most 256 base64url characters.',
            maxLength: 256,
          }),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        response: {
          200: z.object({ items: z.array(InboundEventSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const page = await repos.inbound.page(request.auth.ownerId, {
        limit: request.query.limit ?? 100,
        ...(request.query.type ? { type: request.query.type } : {}),
        ...(request.query.before ? { before: new Date(request.query.before).toISOString() } : {}),
        ...(request.query.cursor !== undefined
          ? { cursor: decodeEventCursor(request.query.cursor) }
          : {}),
      });
      return {
        items: await triggers.describeInbound(page.items),
        nextCursor: page.next ? encodeEventCursor(page.next) : null,
      };
    },
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
