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
  stableHash,
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

const DraftTokenSchema = z.string().meta({
  description:
    'Version token of the definition the next draft save replaces: the draft, or the published version when there is no draft. Send it back in `If-Match` on `PUT /loops/{id}/draft`; it is also the `ETag` header.',
});

const LoopDetailSchema = z.object({
  loop: LoopRecordSchema,
  current: LoopVersionRecordSchema.optional(),
  draft: LoopVersionRecordSchema.optional(),
  draftToken: DraftTokenSchema.optional(),
});

/**
 * The draft version token (docs/07): a hash of the definition a draft save would replace. Equal
 * content gives an equal token, so publishing (which keeps the content) does not invalidate it.
 */
export function draftTokenOf(definition: LoopDefinition | undefined): string | undefined {
  return definition ? stableHash(definition) : undefined;
}

/** Whether an `If-Match` header value matches `token` (`*`, a list, weak or quoted forms). */
export function ifMatchHolds(header: string, token: string | undefined): boolean {
  return header
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^W\//, '')
        .replace(/^"(.*)"$/, '$1'),
    )
    .some((tag) => (tag === '*' ? token !== undefined : tag === token));
}

const DefinitionBody = z.object({ definition: LoopDefinitionSchema });
const IdParams = z.object({ id: z.string() });
const ACTIVE_STATUSES = ['queued', 'running', 'waiting', 'paused'] as const;

/** One chain of conditional draft saves per loop, so a check and its save never interleave. */
const draftSaves = new Map<string, Promise<unknown>>();

function serializeDraftSave<T>(loopId: string, job: () => Promise<T>): Promise<T> {
  const next = (draftSaves.get(loopId) ?? Promise.resolve()).then(job, job);
  const settled = next.catch(() => undefined);
  draftSaves.set(loopId, settled);
  void settled.then(() => {
    if (draftSaves.get(loopId) === settled) draftSaves.delete(loopId);
  });
  return next;
}

export function registerLoopRoutes(app: ApiInstance, container: Container): void {
  const { loops, runs } = container.repos;

  async function ownedLoop(request: FastifyRequest, id: string): Promise<LoopRecord> {
    const loop = await loops.getLoop(id);
    if (!loop || loop.ownerId !== request.auth.ownerId) {
      throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${id} not found`);
    }
    return loop;
  }

  /** The version number the loop's draft has, or would get: what publishing creates. */
  async function draftVersionNumber(loopId: string): Promise<number> {
    const versions = await loops.listVersions(loopId);
    const draft = versions.find((v) => v.status === 'draft');
    return draft?.version ?? Math.max(0, ...versions.map((v) => v.version)) + 1;
  }

  /**
   * A subloop reference must resolve to a published version of a loop of this owner (docs/03).
   * A loop may reference itself, through `latest` or the number its draft publishes as.
   */
  async function subloopIssues(
    ownerId: string,
    def: LoopDefinition,
    selfId?: string,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    let selfVersion: number | undefined;
    for (const node of nodesOfKind(def, 'subloop')) {
      const { loopId, version } = node.config.loopRef;
      if (loopId === selfId) {
        // A self-reference resolves to the version being published: `latest`, or the number the
        // draft will publish as. Any other number must be a version that is already published.
        if (version === 'latest') continue;
        selfVersion ??= await draftVersionNumber(loopId);
        if (version === selfVersion) continue;
      }
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
        summary: 'List loops',
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
        summary: 'Create a loop with an initial draft version',
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
        summary: 'Create or update a loop from exported JSON',
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
      // The same list as create, validate, draft saves, and publish (importLoop's own issues are
      // the validateLoop part of it).
      const issues = await publishIssues(
        request.auth.ownerId,
        imported.definition,
        created.loop.id,
      );
      return { ...created, issues };
    },
  );

  app.get(
    '/loops/:id',
    {
      schema: {
        tags: ['loops'],
        summary: 'A loop with its current published version and draft',
        params: IdParams,
        response: { 200: LoopDetailSchema },
      },
    },
    async (request, reply) => {
      const loop = await ownedLoop(request, request.params.id);
      const current = loop.currentVersionId
        ? await loops.getVersion(loop.currentVersionId)
        : undefined;
      const draft = loop.draftVersionId ? await loops.getVersion(loop.draftVersionId) : undefined;
      const draftToken = draftTokenOf((draft ?? current)?.definition);
      if (draftToken) void reply.header('etag', `"${draftToken}"`);
      return {
        loop,
        ...(current ? { current } : {}),
        ...(draft ? { draft } : {}),
        ...(draftToken ? { draftToken } : {}),
      };
    },
  );

  app.put(
    '/loops/:id/draft',
    {
      schema: {
        tags: ['loops'],
        summary: 'Save the draft definition (validated, may be unpublishable)',
        description:
          'Send `If-Match` with the `draftToken` (or `ETag`) of the copy the edit is based on; a stale token answers 409 `DRAFT_CONFLICT` with the server’s `draftToken`. Without `If-Match` the save is unconditional (last write wins).',
        params: IdParams,
        headers: z.object({ 'if-match': z.string().optional() }),
        body: DefinitionBody,
        response: {
          200: z.object({
            draft: LoopVersionRecordSchema,
            draftToken: DraftTokenSchema,
            issues: z.array(IssueSchema),
          }),
        },
      },
    },
    async (request, reply) => {
      if (!requireScope(request, reply, 'loops:write')) return reply;
      const loopId = request.params.id;
      const ifMatch = request.headers['if-match'];
      const saved = await serializeDraftSave(loopId, async () => {
        const loop = await ownedLoop(request, loopId);
        if (ifMatch !== undefined) {
          const baseId = loop.draftVersionId ?? loop.currentVersionId;
          const base = baseId ? await loops.getVersion(baseId) : undefined;
          const serverToken = draftTokenOf(base?.definition);
          if (!ifMatchHolds(ifMatch, serverToken)) return { conflict: serverToken };
        }
        return { draft: await loops.saveDraft(loopId, request.body.definition) };
      });
      if (!saved.draft) {
        return problem(
          reply,
          409,
          'DRAFT_CONFLICT',
          'the draft changed on the server since this copy was loaded; reload it or overwrite it with the server draftToken',
          undefined,
          saved.conflict ? { draftToken: saved.conflict } : {},
        );
      }
      const draftToken = draftTokenOf(saved.draft.definition) as string;
      void reply.header('etag', `"${draftToken}"`);
      return {
        draft: saved.draft,
        draftToken,
        issues: await publishIssues(request.auth.ownerId, request.body.definition, loopId),
      };
    },
  );

  app.post(
    '/loops/:id/validate',
    {
      schema: {
        tags: ['loops'],
        summary: 'Validate a definition without saving it',
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
        summary: 'Validate the draft and freeze it as a new version',
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
        summary: 'Version history',
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
        summary: 'One version with its definition',
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
        summary: 'The definition as JSON for committing to a repository',
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
    {
      schema: {
        tags: ['loops'],
        summary: 'Delete a loop that has no active runs',
        params: IdParams,
        response: { 204: z.null() },
      },
    },
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
