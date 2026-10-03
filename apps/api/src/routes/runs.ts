import {
  ContextThreadSchema,
  JsonValueSchema,
  ReturnChannelSchema,
  RunEventSchema,
  RunRecordSchema,
  RunStatusSchema,
  type InvocationSource,
  type RunRecord,
} from '@graphgoblin/contracts';
import { EngineRequestError } from '@graphgoblin/engine';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { requireScope } from '../plugins/auth.js';
import { problem } from '../plugins/errors.js';
import { streamRunEvents } from '../sse.js';
import type { ApiInstance } from '../types.js';

const IdParams = z.object({ id: z.string() });

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
      if (!requireScope(request, reply, 'runs:write')) return reply;
      const loop = await repos.loops.getLoop(request.params.id);
      if (!loop || loop.ownerId !== request.auth.ownerId)
        throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${request.params.id} not found`);
      const body = request.body;
      const run = await manager.startRun({
        ownerId: request.auth.ownerId,
        loopId: loop.id,
        source: sourceFor(request),
        caller: { kind: request.auth.actor.kind, id: request.auth.actor.id },
        ...(body.triggerNodeId ? { triggerNodeId: body.triggerNodeId } : {}),
        ...(body.input !== undefined ? { payload: body.input } : {}),
        ...(body.return ? { returnDefaults: body.return } : {}),
        ...(body.versionId ? { versionId: body.versionId } : {}),
        ...(body.allowDraft ? { allowDraft: true } : {}),
      });
      reply.status(202);
      return { run };
    },
  );

  app.get(
    '/runs',
    {
      schema: {
        tags: ['runs'],
        querystring: z.object({
          loopId: z.string().optional(),
          status: z.string().optional(),
          parent: z.string().optional(),
          before: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        response: { 200: z.object({ items: z.array(RunRecordSchema) }) },
      },
    },
    async (request) => {
      const q = request.query;
      const statuses = q.status
        ? q.status.split(',').map((s) => RunStatusSchema.parse(s.trim()))
        : undefined;
      const items = await repos.runs.list({
        ownerId: request.auth.ownerId,
        ...(q.loopId ? { loopId: q.loopId } : {}),
        ...(statuses ? { status: statuses } : {}),
        ...(q.parent === 'none'
          ? { parentRunId: null }
          : q.parent
            ? { parentRunId: q.parent }
            : {}),
        ...(q.before ? { before: q.before } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return { items };
    },
  );

  app.get(
    '/runs/:id',
    { schema: { tags: ['runs'], params: IdParams, response: { 200: RunRecordSchema } } },
    (request) => ownedRun(request, request.params.id),
  );

  app.get(
    '/runs/:id/thread',
    { schema: { tags: ['runs'], params: IdParams, response: { 200: ContextThreadSchema } } },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const thread = await manager.getThread(request.params.id);
      if (!thread) return problem(reply, 404, 'THREAD_NOT_FOUND', 'the run has no thread');
      return thread;
    },
  );

  app.get(
    '/runs/:id/events',
    {
      schema: {
        tags: ['runs'],
        params: IdParams,
        querystring: z.object({
          after: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(1000).optional(),
        }),
        response: {
          200: z.object({ items: z.array(RunEventSchema), nextAfter: z.number().int() }),
        },
      },
    },
    async (request, reply) => {
      await ownedRun(request, request.params.id);
      const lastEventId = Number(request.headers['last-event-id'] ?? NaN);
      const after = request.query.after ?? (Number.isFinite(lastEventId) ? lastEventId : 0);
      if ((request.headers.accept ?? '').includes('text/event-stream')) {
        await streamRunEvents(request, reply, repos.events, request.params.id, after);
        return reply;
      }
      const items = await repos.events.read(request.params.id, after, request.query.limit ?? 500);
      return { items, nextAfter: items.length ? (items[items.length - 1]?.seq ?? after) : after };
    },
  );

  for (const action of ['cancel', 'pause', 'resume'] as const) {
    app.post(
      `/runs/:id/${action}`,
      { schema: { tags: ['runs'], params: IdParams, response: { 200: RunRecordSchema } } },
      async (request, reply) => {
        if (!requireScope(request, reply, 'runs:write')) return reply;
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
        params: IdParams,
        body: z.object({ input: JsonValueSchema }),
        response: { 200: RunRecordSchema },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'runs:write')) return reply;
      await ownedRun(request, request.params.id);
      return manager.provideInput(request.params.id, request.body.input, request.auth.actor);
    },
  );

  app.post(
    '/runs/:id/signals/:name',
    {
      schema: {
        tags: ['runs'],
        params: z.object({ id: z.string(), name: z.string() }),
        body: z.object({ payload: JsonValueSchema.optional() }).default({}),
        response: { 200: z.object({ run: RunRecordSchema, woke: z.boolean() }) },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'runs:write')) return reply;
      await ownedRun(request, request.params.id);
      return manager.signal(request.params.id, request.params.name, request.body.payload ?? null);
    },
  );

  app.get(
    '/runs/:id/sessions',
    {
      schema: {
        tags: ['runs'],
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
    { schema: { tags: ['runs'], params: z.object({ id: z.string(), artifactId: z.string() }) } },
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
