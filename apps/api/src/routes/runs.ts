import {
  ContextThreadSchema,
  JsonValueSchema,
  ReturnChannelSchema,
  RunEventSchema,
  RunRecordSchema,
  RunStatusSchema,
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
import { streamRunEvents } from '../sse.js';
import type { ApiInstance } from '../types.js';
import {
  TemplateRunSchema,
  decodeRunCursor,
  encodeRunCursor,
  templateRunView,
} from '../templates/run-view.js';

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
        summary: 'List runs with template subjects, filters, and stable newest-first paging',
        querystring: z
          .object({
            loopId: z.string().optional(),
            status: z.string().optional(),
            parent: z.string().optional(),
            before: z.string().optional(),
            cursor: z.string().min(1).max(256).optional(),
            repository: z
              .string()
              .regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/)
              .optional(),
            issue: z.coerce.number().int().positive().optional(),
            pullRequest: z.coerce.number().int().positive().optional(),
            head: z
              .string()
              .regex(/^[a-f0-9]{40}$/)
              .optional(),
            mergeSha: z
              .string()
              .regex(/^[a-f0-9]{40}$/)
              .optional(),
            templateInstanceId: UlidSchema.optional(),
            limit: z.coerce.number().int().min(1).max(500).optional(),
          })
          .superRefine((query, ctx) => {
            if (query.cursor && query.before)
              ctx.addIssue({ code: 'custom', message: 'Use either cursor or before.' });
          }),
        response: {
          200: z.object({ items: z.array(TemplateRunSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const q = request.query;
      const statuses = q.status
        ? q.status.split(',').map((s) => RunStatusSchema.parse(s.trim()))
        : undefined;
      const limit = q.limit ?? 100;
      const rows = await container.templates.store.runPage({
        ownerId: request.auth.ownerId,
        ...(q.loopId ? { loopId: q.loopId } : {}),
        ...(statuses ? { status: statuses } : {}),
        ...(q.parent === 'none'
          ? { parentRunId: null }
          : q.parent
            ? { parentRunId: q.parent }
            : {}),
        ...(q.before ? { beforeTimestamp: q.before } : {}),
        ...(q.cursor ? { before: decodeRunCursor(q.cursor) } : {}),
        ...(q.repository ? { repository: q.repository } : {}),
        ...(q.issue ? { issue: q.issue } : {}),
        ...(q.pullRequest ? { pullRequest: q.pullRequest } : {}),
        ...(q.head ? { head: q.head } : {}),
        ...(q.mergeSha ? { mergeSha: q.mergeSha } : {}),
        ...(q.templateInstanceId ? { instanceId: q.templateInstanceId } : {}),
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(({ run, subject }) => templateRunView(run, subject)),
        nextCursor: rows.length > limit ? encodeRunCursor(page.at(-1)!.run) : null,
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
        response: { 200: TemplateRunSchema },
      },
    },
    async (request) => {
      const run = await ownedRun(request, request.params.id);
      const stored = await container.templates.store.run(run.id);
      return templateRunView(run, stored?.subject);
    },
  );

  app.get(
    '/runs/:id/thread',
    {
      schema: {
        tags: ['runs'],
        summary: 'The current context thread',
        params: IdParams,
        response: { 200: ContextThreadSchema },
      },
    },
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
        summary: 'A page of events; with Accept: text/event-stream, a live SSE tail',
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
        await streamRunEvents(request, reply, repos.events, request.params.id, after, {
          isTerminal: async () => {
            const run = await repos.runs.get(request.params.id);
            return run !== undefined && isTerminal(run.status);
          },
        });
        return reply;
      }
      const items = await repos.events.read(request.params.id, after, request.query.limit ?? 500);
      return { items, nextAfter: items.length ? (items[items.length - 1]?.seq ?? after) : after };
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
        body: z.object({ input: JsonValueSchema }),
        response: { 200: RunRecordSchema },
      },
    },
    async (request) => {
      await ownedRun(request, request.params.id);
      return manager.provideInput(request.params.id, request.body.input, request.auth.actor);
    },
  );

  app.post(
    '/runs/:id/signals/:name',
    {
      schema: {
        tags: ['runs'],
        summary: 'Deliver a named signal',
        params: z.object({ id: UlidSchema, name: z.string() }),
        body: z.object({ payload: JsonValueSchema.optional() }).default({}),
        response: { 200: z.object({ run: RunRecordSchema, woke: z.boolean() }) },
      },
    },
    async (request) => {
      await ownedRun(request, request.params.id);
      return manager.signal(request.params.id, request.params.name, request.body.payload ?? null);
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
