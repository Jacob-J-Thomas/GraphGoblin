import {
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopRecordSchema,
  LoopVersionRecordSchema,
  type LoopRecord,
} from '@graphgoblin/contracts';
import { exportLoop, importLoop, isPublishable, validateLoop } from '@graphgoblin/domain';
import { EngineRequestError } from '@graphgoblin/engine';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { requireScope } from '../plugins/auth.js';
import { problem } from '../plugins/errors.js';
import type { ApiInstance } from '../types.js';

export const IssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
});

const LoopDetailSchema = z.object({
  loop: LoopRecordSchema,
  current: LoopVersionRecordSchema.optional(),
  draft: LoopVersionRecordSchema.optional(),
});

const DefinitionBody = z.object({ definition: LoopDefinitionSchema });
const IdParams = z.object({ id: z.string() });
const ACTIVE_STATUSES = ['queued', 'running', 'waiting', 'paused'] as const;

export function registerLoopRoutes(app: ApiInstance, container: Container): void {
  const { loops, runs } = container.repos;

  async function ownedLoop(request: FastifyRequest, id: string): Promise<LoopRecord> {
    const loop = await loops.getLoop(id);
    if (!loop || loop.ownerId !== request.auth.ownerId) {
      throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${id} not found`);
    }
    return loop;
  }

  app.get(
    '/loops',
    {
      schema: {
        tags: ['loops'],
        response: { 200: z.object({ items: z.array(LoopRecordSchema) }) },
      },
    },
    async (request) => ({
      items: await loops.listLoops(request.auth.ownerId),
    }),
  );

  app.post(
    '/loops',
    {
      schema: {
        tags: ['loops'],
        body: DefinitionBody,
        response: {
          201: z.object({
            loop: LoopRecordSchema,
            draft: LoopVersionRecordSchema,
            issues: z.array(IssueSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      const created = await loops.create(request.auth.ownerId, request.body.definition);
      reply.status(201);
      return { ...created, issues: validateLoop(request.body.definition) };
    },
  );

  app.post(
    '/loops/import',
    {
      schema: {
        tags: ['loops'],
        body: z.record(z.string(), z.unknown()),
        response: {
          201: z.object({
            loop: LoopRecordSchema,
            draft: LoopVersionRecordSchema,
            issues: z.array(IssueSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      const imported = importLoop(request.body);
      const created = await loops.create(request.auth.ownerId, imported.definition);
      reply.status(201);
      return { ...created, issues: imported.issues };
    },
  );

  app.get(
    '/loops/:id',
    { schema: { tags: ['loops'], params: IdParams, response: { 200: LoopDetailSchema } } },
    async (request) => {
      const loop = await ownedLoop(request, request.params.id);
      const current = loop.currentVersionId
        ? await loops.getVersion(loop.currentVersionId)
        : undefined;
      const draft = loop.draftVersionId ? await loops.getVersion(loop.draftVersionId) : undefined;
      return { loop, ...(current ? { current } : {}), ...(draft ? { draft } : {}) };
    },
  );

  app.put(
    '/loops/:id/draft',
    {
      schema: {
        tags: ['loops'],
        params: IdParams,
        body: DefinitionBody,
        response: {
          200: z.object({ draft: LoopVersionRecordSchema, issues: z.array(IssueSchema) }),
        },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      await ownedLoop(request, request.params.id);
      const draft = await loops.saveDraft(request.params.id, request.body.definition);
      return { draft, issues: validateLoop(request.body.definition) };
    },
  );

  app.post(
    '/loops/:id/validate',
    {
      schema: {
        tags: ['loops'],
        params: IdParams,
        body: DefinitionBody,
        response: { 200: z.object({ issues: z.array(IssueSchema), publishable: z.boolean() }) },
      },
    },
    async (request) => {
      await ownedLoop(request, request.params.id);
      return {
        issues: validateLoop(request.body.definition),
        publishable: isPublishable(request.body.definition),
      };
    },
  );

  app.post(
    '/loops/:id/publish',
    {
      schema: {
        tags: ['loops'],
        params: IdParams,
        response: { 200: z.object({ version: LoopVersionRecordSchema }) },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      const loop = await ownedLoop(request, request.params.id);
      if (!loop.draftVersionId)
        return problem(reply, 409, 'NO_DRAFT', 'the loop has no draft to publish');
      const draft = await loops.getVersion(loop.draftVersionId);
      const issues = draft
        ? [
            ...validateLoop(draft.definition),
            ...container.triggers.checkDefinition(draft.definition),
          ]
        : [];
      if (issues.some((i) => i.severity === 'error')) {
        return problem(reply, 422, 'LOOP_INVALID', 'the draft has structural errors', issues);
      }
      const version = await loops.publish(loop.id);
      if (!version) return problem(reply, 409, 'NO_DRAFT', 'the loop has no draft to publish');
      // Schedules and webhook endpoints follow the published version (ADR-0008).
      await container.triggers.armVersion(loop, version);
      return { version };
    },
  );

  app.get(
    '/loops/:id/versions',
    {
      schema: {
        tags: ['loops'],
        params: IdParams,
        response: { 200: z.object({ items: z.array(LoopVersionRecordSchema) }) },
      },
    },
    async (request) => {
      await ownedLoop(request, request.params.id);
      return { items: await loops.listVersions(request.params.id) };
    },
  );

  app.get(
    '/loops/:id/versions/:versionId',
    {
      schema: {
        tags: ['loops'],
        params: z.object({ id: z.string(), versionId: z.string() }),
        response: { 200: LoopVersionRecordSchema },
      },
    },
    async (request, reply) => {
      await ownedLoop(request, request.params.id);
      const version = await loops.getVersion(request.params.versionId);
      if (!version || version.loopId !== request.params.id)
        return problem(
          reply,
          404,
          'VERSION_NOT_FOUND',
          `version ${request.params.versionId} not found`,
        );
      return version;
    },
  );

  app.get(
    '/loops/:id/export',
    {
      schema: {
        tags: ['loops'],
        params: IdParams,
        querystring: z.object({ draft: z.enum(['true', 'false']).optional() }),
        response: { 200: LoopExportSchema },
      },
    },
    async (request, reply) => {
      const loop = await ownedLoop(request, request.params.id);
      const versionId =
        request.query.draft === 'true' ? loop.draftVersionId : loop.currentVersionId;
      const version = versionId ? await loops.getVersion(versionId) : undefined;
      if (!version)
        return problem(
          reply,
          404,
          'VERSION_NOT_FOUND',
          request.query.draft === 'true'
            ? 'the loop has no draft'
            : 'the loop has no published version',
        );
      return exportLoop(version.definition, container.ports.clock.now().toISOString());
    },
  );

  app.delete(
    '/loops/:id',
    { schema: { tags: ['loops'], params: IdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      await ownedLoop(request, request.params.id);
      const active = await runs.list({
        loopId: request.params.id,
        status: [...ACTIVE_STATUSES],
        limit: 1,
      });
      if (active.length > 0)
        return problem(reply, 409, 'LOOP_IN_USE', 'the loop has active runs; cancel them first');
      await container.triggers.disarmLoop(request.params.id);
      await loops.delete(request.params.id);
      return reply.status(204).send(null);
    },
  );
}
