import {
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopRecordSchema,
  LoopVersionRecordSchema,
  type LoopDefinition,
  type LoopRecord,
} from '@graphgoblin/contracts';
import {
  exportLoop,
  importLoop,
  nodesOfKind,
  validateLoop,
  type ValidationIssue,
} from '@graphgoblin/domain';
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

  /** A published subloop reference must resolve for this owner (docs/03); a self-reference may. */
  async function subloopIssues(
    ownerId: string,
    def: LoopDefinition,
    selfId?: string,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const node of nodesOfKind(def, 'subloop')) {
      const { loopId, version } = node.config.loopRef;
      if (loopId === selfId) continue;
      const target = await loops.getLoop(loopId);
      if (!target || target.ownerId !== ownerId) {
        issues.push({
          code: 'SUBLOOP_NOT_FOUND',
          severity: 'error',
          message: `subloop "${node.id}" references loop ${loopId}, which does not exist`,
          nodeId: node.id,
        });
        continue;
      }
      const published =
        version === 'latest'
          ? await loops.getLatestPublished(loopId)
          : await loops.getPublished(loopId, version);
      if (!published) {
        issues.push({
          code: 'SUBLOOP_NOT_PUBLISHED',
          severity: 'error',
          message: `subloop "${node.id}" references "${target.name}", which has no published ${
            version === 'latest' ? 'version' : `version ${version}`
          }`,
          nodeId: node.id,
        });
      }
    }
    return issues;
  }

  /**
   * Every check publishing applies: the shared domain rules, trigger checks such as cron syntax,
   * and subloop references. Validate, draft saves, create, and import report the same list, so
   * the editor and `POST /loops/{id}/validate` never disagree with publish.
   */
  async function publishIssues(
    ownerId: string,
    def: LoopDefinition,
    selfId?: string,
  ): Promise<ValidationIssue[]> {
    return [
      ...validateLoop(def),
      ...container.triggers.checkDefinition(def),
      ...(await subloopIssues(ownerId, def, selfId)),
    ];
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
      return {
        ...created,
        issues: await publishIssues(request.auth.ownerId, request.body.definition, created.loop.id),
      };
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
      const references = await subloopIssues(
        request.auth.ownerId,
        imported.definition,
        created.loop.id,
      );
      return { ...created, issues: [...imported.issues, ...references] };
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
      return {
        draft,
        issues: await publishIssues(
          request.auth.ownerId,
          request.body.definition,
          request.params.id,
        ),
      };
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
      const issues = await publishIssues(
        request.auth.ownerId,
        request.body.definition,
        request.params.id,
      );
      return { issues, publishable: !issues.some((i) => i.severity === 'error') };
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
        ? await publishIssues(request.auth.ownerId, draft.definition, loop.id)
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
