import {
  ContextThreadSchema,
  SlugSchema,
  JsonValueSchema,
  ReturnChannelSchema,
  RunEventSchema,
  RunRecordSchema,
  RunStatusSchema,
  TimestampSchema,
  UlidSchema,
  type InvocationSource,
  type RunRecord,
} from '@graphgoblin/contracts';
import { isTerminal } from '@graphgoblin/domain';
import { EngineRequestError } from '@graphgoblin/engine';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { problem } from '../plugins/errors.js';
import { readinessOperation } from '../readiness-operation.js';
import { assertRunReadiness, RunReadinessError } from '../run-readiness.js';
import { streamRunEvents } from '../sse.js';
import type { ApiInstance } from '../types.js';
import { decodeRunCursor, encodeRunCursor } from '../run-cursor.js';
import { openApiRegistry, WaitConflictSchema } from '../openapi-registry.js';
import { historicalThread, historyCursor, readHistoryCursor } from '../run-history.js';

const IdParams = z.object({ id: UlidSchema });

const SessionSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int(),
  harness: z.string(),
  sessionId: z.string().optional(),
  status: z.string(),
  model: z.string().optional(),
  effort: z.string().optional(),
  scopeKey: z.string().optional(),
  updatedAt: z.string(),
});

function sourceFor(request: FastifyRequest): InvocationSource {
  const client = String(request.headers['x-graphgoblin-client'] ?? '').toLowerCase();
  if (client === 'ui') return 'manual.ui';
  if (client === 'mcp' || request.auth.actor.kind === 'mcp-client') return 'manual.mcp';
  return 'manual.api';
}

export function registerRunRoutes(app: ApiInstance, container: Container): void {
  const { manager, repos, ports } = container;

  async function ownedRun(request: FastifyRequest, id: string): Promise<RunRecord> {
    const run = await repos.runs.get(id);
    if (!run || run.ownerId !== request.auth.ownerId)
      throw new EngineRequestError('RUN_NOT_FOUND', `run ${id} not found`);
    return run;
  }

  app.post(
    '/loops/:id/runs',
    {
      schema: {
        tags: ['runs'],
        summary: 'Start a run from a manual trigger',
        params: IdParams,
        body: z
          .object({
            triggerNodeId: z.string().optional(),
            input: JsonValueSchema.optional(),
            return: z.array(ReturnChannelSchema).optional(),
            versionId: z.string().optional(),
            allowDraft: z.boolean().optional(),
          })
          .default({}),
        response: { 202: z.object({ run: RunRecordSchema }) },
      },
    },
    async (request, reply) => {
      const loop = await repos.loops.getLoop(request.params.id);
      if (!loop || loop.ownerId !== request.auth.ownerId)
        throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${request.params.id} not found`);
      const body = request.body;
      const versionId = body.versionId || loop.currentVersionId;
      const readiness = readinessOperation(ports.harnesses);
      try {
        const run = await manager.startRun(
          {
            ownerId: request.auth.ownerId,
            loopId: loop.id,
            source: sourceFor(request),
            caller: { kind: request.auth.actor.kind, id: request.auth.actor.id },
            ...(body.triggerNodeId ? { triggerNodeId: body.triggerNodeId } : {}),
            ...(body.input !== undefined ? { payload: body.input } : {}),
            ...(body.return ? { returnDefaults: body.return } : {}),
            ...(versionId ? { versionId } : {}),
            ...(body.allowDraft ? { allowDraft: true } : {}),
          },
          async (plan) => assertRunReadiness(plan, readiness, await ports.modelCatalog.list()),
        );
        reply.status(202);
        return { run };
      } catch (error) {
        if (error instanceof RunReadinessError)
          return problem(reply, 422, 'HARNESS_NOT_READY', error.message, error.issues);
        throw error;
      }
    },
  );

  app.get(
    '/runs',
    {
      schema: {
        tags: ['runs'],
        summary: 'List runs with filters and stable newest-first paging',
        querystring: z.strictObject({
          loopId: UlidSchema.optional(),
          status: z
            .string()
            .refine(
              (value) => value.split(',').every((s) => RunStatusSchema.safeParse(s.trim()).success),
              'Use comma-separated run statuses.',
            )
            .optional(),
          parent: z.union([UlidSchema, z.literal('none')]).optional(),
          before: TimestampSchema.optional(),
          cursor: z.string().optional().register(openApiRegistry, {
            description: 'Opaque run cursor, at most 256 base64url characters.',
            // The decoder enforces this bound so invalid cursors keep INVALID_CURSOR.
            maxLength: 256,
          }),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        response: {
          200: z.object({ items: z.array(RunRecordSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      const statuses = q.status
        ? q.status.split(',').map((s) => RunStatusSchema.parse(s.trim()))
        : undefined;
      const page = await repos.runs.page({
        ownerId: request.auth.ownerId,
        ...(q.loopId ? { loopId: q.loopId } : {}),
        ...(statuses ? { status: statuses } : {}),
        ...(q.parent === 'none'
          ? { parentRunId: null }
          : q.parent
            ? { parentRunId: q.parent }
            : {}),
        ...(q.before ? { before: new Date(q.before).toISOString() } : {}),
        ...(q.cursor !== undefined ? { cursor: decodeRunCursor(q.cursor) } : {}),
        limit: q.limit ?? 100,
      });
      return {
        items: page.items,
        nextCursor: page.next ? encodeRunCursor(page.next) : null,
      };
    },
  );

  app.get(
    '/runs/:id',
    {
      schema: {
        tags: ['runs'],
        summary: 'Run snapshot: status, current node, iteration, waiting spec, result, failure',
        params: IdParams,
        response: { 200: RunRecordSchema },
      },
    },
    async (request) => {
      return ownedRun(request, request.params.id);
    },
  );

  app.get(
    '/runs/:id/thread',
    {
      schema: {
        tags: ['runs'],
        summary: 'The current context thread',
        params: IdParams,
        querystring: z.strictObject({
          at: z.coerce.number().int().nonnegative().safe().optional(),
        }),
        response: { 200: ContextThreadSchema },
      },
    },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const thread =
        request.query.at === undefined
          ? await manager.getThread(request.params.id)
          : await historicalThread(container, request.params.id, request.query.at);
      if (!thread) return problem(reply, 404, 'THREAD_NOT_FOUND', 'the run has no thread');
      return thread;
    },
  );

  app.get(
    '/runs/:id/events',
    {
      schema: {
        tags: ['runs'],
        summary: 'A page of events; with Accept: text/event-stream, a live SSE tail',
        params: IdParams,
        querystring: z
          .object({
            after: z.coerce.number().int().min(0).optional(),
            limit: z.coerce.number().int().min(1).max(1000).optional(),
            cursor: z.string().optional(),
            around: z.coerce
              .number()
              .int()
              .nonnegative()
              .max(Number.MAX_SAFE_INTEGER - 1)
              .optional(),
          })
          .refine(
            (query) =>
              [query.after, query.around, query.cursor].filter((value) => value !== undefined)
                .length <= 1,
            { message: 'Choose one of after, around or cursor.' },
          ),
        response: {
          200: z.object({
            items: z.array(RunEventSchema),
            nextAfter: z.number().int(),
            hasMore: z.boolean(),
            olderCursor: z.string().nullable().optional(),
            newerCursor: z.string().nullable().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const lastEventId = Number(request.headers['last-event-id'] ?? NaN);
      const after = request.query.after ?? (Number.isFinite(lastEventId) ? lastEventId : 0);
      if ((request.headers.accept ?? '').includes('text/event-stream')) {
        await streamRunEvents(request, reply, repos.events, request.params.id, after, {
          closeSignal: container.shutdown.closing.signal,
          isTerminal: async () => {
            const run = await repos.runs.get(request.params.id);
            return run !== undefined && isTerminal(run.status);
          },
          lastLifecycleEvent: () => repos.events.lastLifecycleEvent(request.params.id),
        });
        return reply;
      }
      const limit = request.query.limit ?? 500;
      if (request.query.cursor !== undefined || request.query.around !== undefined) {
        const position =
          request.query.cursor !== undefined
            ? readHistoryCursor(request.query.cursor, request.params.id)
            : { seq: request.query.around! + 1, direction: 'older' as const };
        const page = await repos.events.window(
          request.params.id,
          position.seq,
          position.direction,
          limit,
        );
        return {
          items: page.items,
          nextAfter: page.newerThan,
          hasMore: page.hasNewer,
          olderCursor: page.hasOlder
            ? historyCursor({ runId: request.params.id, seq: page.olderThan, direction: 'older' })
            : null,
          newerCursor: page.hasNewer
            ? historyCursor({ runId: request.params.id, seq: page.newerThan, direction: 'newer' })
            : null,
        };
      }
      return repos.events.page(request.params.id, after, limit);
    },
  );

  app.get(
    '/runs/:id/observation',
    {
      schema: {
        tags: ['runs'],
        summary: 'Latest durable inspector evidence, independent of the retained history window',
        params: IdParams,
        response: {
          200: z.object({
            lifecycle: RunEventSchema.optional(),
            exit: RunEventSchema.optional(),
            gate: RunEventSchema.optional(),
            finished: RunEventSchema.optional(),
          }),
        },
      },
    },
    async (request) => {
      const runId = request.params.id;
      await ownedRun(request, runId);
      const gate = await repos.events.latestGate(runId);
      return {
        lifecycle: await repos.events.lastLifecycleEvent(runId),
        exit: await repos.events.latest(runId, 'exit.evaluated'),
        gate,
        finished: await repos.events.latest(runId, 'run.finished'),
      };
    },
  );

  for (const action of ['cancel', 'pause', 'resume'] as const) {
    app.post(
      `/runs/:id/${action}`,
      {
        schema: {
          tags: ['runs'],
          summary: `${action === 'cancel' ? 'Cancel' : action === 'pause' ? 'Pause' : 'Resume'} a run`,
          params: IdParams,
          response: { 200: RunRecordSchema },
        },
      },
      async (request) => {
        await ownedRun(request, request.params.id);
        return manager[action](request.params.id, request.auth.actor);
      },
    );
  }

  app.post(
    '/runs/:id/input',
    {
      schema: {
        tags: ['runs'],
        summary: 'Answer a wait node in input mode',
        params: IdParams,
        body: z.strictObject({ waitId: z.string().min(1).max(64), input: JsonValueSchema }),
        response: { 200: RunRecordSchema, 409: WaitConflictSchema },
      },
    },
    async (request) => {
      await ownedRun(request, request.params.id);
      return manager.provideInput(
        request.params.id,
        request.body.waitId,
        request.body.input,
        request.auth.actor,
      );
    },
  );

  app.post(
    '/runs/:id/signals/:name',
    {
      schema: {
        tags: ['runs'],
        summary: 'Deliver a named signal',
        params: z.object({ id: UlidSchema, name: SlugSchema }),
        body: z.strictObject({
          waitId: z.string().min(1).max(64),
          payload: JsonValueSchema.optional(),
        }),
        response: {
          200: z.object({ run: RunRecordSchema, woke: z.boolean() }),
          409: WaitConflictSchema,
        },
      },
    },
    async (request) => {
      await ownedRun(request, request.params.id);
      return manager.signal(
        request.params.id,
        request.params.name,
        request.body.waitId,
        request.body.payload ?? null,
      );
    },
  );

  app.post(
    '/runs/:id/replay',
    {
      schema: {
        tags: ['runs'],
        summary: 'Fork a new run at a node, with the thread as it was just before that node',
        params: IdParams,
        body: z.object({
          nodeId: z.string().min(1).describe('A node the source run has started at least once'),
        }),
        response: { 202: z.object({ run: RunRecordSchema }) },
      },
    },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const run = await manager.replay({
        runId: request.params.id,
        nodeId: request.body.nodeId,
        source: sourceFor(request),
        caller: { kind: request.auth.actor.kind, id: request.auth.actor.id },
      });
      reply.status(202);
      return { run };
    },
  );

  app.get(
    '/runs/:id/sessions',
    {
      schema: {
        tags: ['runs'],
        summary: 'Harness sessions the run started or resumed',
        params: IdParams,
        response: { 200: z.object({ items: z.array(SessionSchema) }) },
      },
    },
    async (request) => {
      await ownedRun(request, request.params.id);
      return { items: await repos.sessions.listForRun(request.params.id) };
    },
  );

  app.get(
    '/runs/:id/artifacts/:artifactId',
    {
      schema: {
        tags: ['runs'],
        summary: "Download an artifact from the run's thread",
        params: z.object({ id: UlidSchema, artifactId: z.string() }),
      },
    },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const thread = await manager.getThread(request.params.id);
      const artifact = thread?.artifacts.find((a) => a.id === request.params.artifactId);
      if (!artifact)
        return problem(
          reply,
          404,
          'ARTIFACT_NOT_FOUND',
          `artifact ${request.params.artifactId} not found`,
        );
      const content = await ports.artifacts.get(artifact.ref);
      if (content === undefined)
        return problem(reply, 404, 'ARTIFACT_NOT_FOUND', 'the artifact content is missing');
      return reply
        .type(
          artifact.kind === 'json' || artifact.kind === 'transcript'
            ? 'application/json; charset=utf-8'
            : 'text/plain; charset=utf-8',
        )
        .send(content);
    },
  );
}
