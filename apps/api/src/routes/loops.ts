import { blocksPublication, rejectsDraftAdmission } from '../model-issues.js';
import {
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopRecordSchema,
  RunRecordSchema,
  LoopVersionRecordSchema,
  LoopIssueSchema,
  type LoopIssue,
  UlidSchema,
  type LoopDefinition,
  type LoopRecord,
  type LoopVersionRecord,
} from '@graphgoblin/contracts';
import {
  exportLoop,
  importLoop,
  stableHash,
  upgradeExportCurrent,
  upgradeLoopCurrent,
  type UpgradeIssue,
} from '@graphgoblin/domain';
import { EngineRequestError, assertCurrentDefinition } from '@graphgoblin/engine';
import { LoopInUseError } from '@graphgoblin/infrastructure/sqlite';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container.js';
import { loopPublicationIssues } from '../loop-issues.js';
import { problem } from '../plugins/errors.js';
import type { ApiInstance } from '../types.js';

export const IssueSchema = LoopIssueSchema;

/**
 * A stored definition leaves the server only when the current contract accepts it: one that
 * predates ADR-0044 (an exit publishing an Event) is refused with 409 `LOOP_UPGRADE_REQUIRED`
 * naming the loop, the version and the destination, rather than failing response validation.
 */
function served<T extends LoopVersionRecord | undefined>(version: T): T {
  if (version) assertCurrentDefinition(version);
  return version;
}

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
const IdParams = z.object({ id: UlidSchema });
const ACTIVE_STATUSES = ['queued', 'running', 'waiting', 'paused'] as const;

/** One chain of draft saves and publishes per loop, so a check and its write never interleave. */
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

  async function publishIssues(
    ownerId: string,
    def: LoopDefinition,
    selfId?: string,
  ): Promise<LoopIssue[]> {
    return loopPublicationIssues(container, ownerId, def, selfId);
  }

  app.get(
    '/loops',
    {
      schema: {
        tags: ['loops'],
        summary: 'List loops',
        response: {
          200: z.object({
            items: z.array(
              LoopRecordSchema.extend({
                latestRun: RunRecordSchema.pick({
                  id: true,
                  status: true,
                  createdAt: true,
                }).nullable(),
                runCount: z.number().int().nonnegative(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      items: await loops.listWithRunSummaries(request.auth.ownerId),
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
      const admission = await publishIssues(request.auth.ownerId, request.body.definition);
      if (admission.some((issue) => rejectsDraftAdmission(request.body.definition, issue)))
        return problem(
          reply,
          400,
          'EVALUATION_INVALID_CONFIGURATION',
          'invalid evaluator or model configuration',
          admission,
        );
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
            notices: z.array(z.object({ code: z.string(), path: z.string(), message: z.string() })),
          }),
        },
      },
    },
    async (request, reply) => {
      let input: unknown = request.body;
      let notices: UpgradeIssue[] = [];
      if (
        typeof input === 'object' &&
        input !== null &&
        (('formatVersion' in input && [1, 2, 3].includes(Number(input.formatVersion))) ||
          ('schemaVersion' in input && [1, 2, 3].includes(Number(input.schemaVersion))))
      ) {
        const result =
          'formatVersion' in input
            ? await upgradeExportCurrent(input)
            : await upgradeLoopCurrent(input);
        if (!result.ok) {
          const pending = result.issues.some((issue) => issue.kind === 'pending');
          const invalid = result.issues.some((issue) => issue.kind === 'invalid');
          return problem(
            reply,
            400,
            pending ? 'LOOP_FORMAT_UPGRADE_REQUIRED' : 'LOOP_IMPORT_SOURCE_INVALID',
            [
              ...(invalid
                ? [
                    'The source, export envelope or conversion has invalid issues. Correct the listed invalid issues; graphgoblin-upgrade export cannot convert invalid source.',
                  ]
                : []),
              ...(pending
                ? [
                    'Review is required. Run graphgoblin-upgrade export --input old.json --out review.json. For v3 items, create resolutions.json with {"v3":{"<id>":{"hash":"<reported hash>","action":"approve","reason":"Reviewed this exact proposal"}}}, using each reported id/hash. Some items require action "replace" with a value, or allow "remove". Earlier-stage items use the v1/v2 namespaces in the guide. Retry export with --resolutions resolutions.json and a new output path.',
                  ]
                : []),
              'See docs/guide/08-offline-upgrade.md#convert-a-portable-export.',
            ].join(' '),
            { issues: result.issues, reviewItems: result.reviewItems },
          );
        }
        input = result.value;
        notices = result.notices;
      }
      const imported = importLoop(input);
      const admission = await publishIssues(request.auth.ownerId, imported.definition);
      if (admission.some((issue) => rejectsDraftAdmission(imported.definition, issue)))
        return problem(
          reply,
          400,
          'EVALUATION_INVALID_CONFIGURATION',
          'invalid evaluator or model configuration',
          admission,
        );
      const created = await loops.create(request.auth.ownerId, imported.definition);
      reply.status(201);
      // The same list as create, validate, draft saves, and publish (importLoop's own issues are
      // the validateLoop part of it).
      const issues = await publishIssues(
        request.auth.ownerId,
        imported.definition,
        created.loop.id,
      );
      return { ...created, issues, notices };
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
      const current = served(
        loop.currentVersionId ? await loops.getVersion(loop.currentVersionId) : undefined,
      );
      const draft = served(
        loop.draftVersionId ? await loops.getVersion(loop.draftVersionId) : undefined,
      );
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
      const loopId = request.params.id;
      const admission = await publishIssues(request.auth.ownerId, request.body.definition, loopId);
      if (admission.some((issue) => rejectsDraftAdmission(request.body.definition, issue)))
        return problem(
          reply,
          400,
          'EVALUATION_INVALID_CONFIGURATION',
          'invalid evaluator or model configuration',
          admission,
        );
      const ifMatch = request.headers['if-match'];
      const saved = await serializeDraftSave(loopId, async () => {
        const loop = await ownedLoop(request, loopId);
        if (ifMatch !== undefined) {
          const baseId = loop.draftVersionId ?? loop.currentVersionId;
          const base = baseId ? await loops.getVersion(baseId) : undefined;
          const serverToken = draftTokenOf(base?.definition);
          if (!ifMatchHolds(ifMatch, serverToken)) {
            // A stale copy that saves exactly what the server draft already holds (two editors
            // making the same change) is not a conflict: answer with the draft, unchanged.
            if (base?.status === 'draft' && draftTokenOf(request.body.definition) === serverToken) {
              return { draft: base };
            }
            return { conflict: serverToken };
          }
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
      return { issues, publishable: !issues.some(blocksPublication) };
    },
  );

  app.post(
    '/loops/:id/publish',
    {
      schema: {
        tags: ['loops'],
        summary: 'Validate the draft and freeze it as a new version',
        params: IdParams,
        response: {
          200: z.object({ version: LoopVersionRecordSchema, issues: z.array(IssueSchema) }),
        },
      },
    },
    async (request, reply) => {
      // Queued with the loop's draft saves, so a save never lands between the checks and the
      // freeze (the storage also refuses to modify a row that is no longer a draft).
      const outcome = await serializeDraftSave(request.params.id, async () => {
        const loop = await ownedLoop(request, request.params.id);
        if (!loop.draftVersionId) return { kind: 'no-draft' as const };
        const draft = served(await loops.getVersion(loop.draftVersionId));
        const issues = draft
          ? await publishIssues(request.auth.ownerId, draft.definition, loop.id)
          : [];
        if (issues.some(blocksPublication)) return { kind: 'invalid' as const, issues };
        const version = await loops.publish(loop.id);
        if (!version) return { kind: 'no-draft' as const };
        // Schedules and webhook endpoints follow the published version (ADR-0008).
        await container.triggers.armVersion(loop, version);
        return { kind: 'published' as const, version, issues };
      });
      if (outcome.kind === 'invalid') {
        return problem(
          reply,
          422,
          'LOOP_INVALID',
          'the draft has structural errors',
          outcome.issues,
        );
      }
      if (outcome.kind === 'no-draft') {
        return problem(reply, 409, 'NO_DRAFT', 'the loop has no draft to publish');
      }
      return { version: outcome.version, issues: outcome.issues };
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
      return { items: (await loops.listVersions(request.params.id)).map(served) };
    },
  );

  app.get(
    '/loops/:id/versions/:versionId',
    {
      schema: {
        tags: ['loops'],
        summary: 'One version with its definition',
        params: z.object({ id: UlidSchema, versionId: UlidSchema }),
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
      return served(version);
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
      return exportLoop(served(version).definition, container.ports.clock.now().toISOString());
    },
  );

  app.delete(
    '/loops/:id',
    {
      schema: {
        tags: ['loops'],
        summary: 'Delete a loop and its run history, unless it has active runs',
        description:
          'Deletes all versions, drafts, runs and run-owned rows in one transaction. Returns 204 on success, 404 LOOP_NOT_FOUND, or 409 LOOP_IN_USE when a run is active or a pending admission or active parent can still start this loop. Cancel the runs first.',
        params: IdParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await ownedLoop(request, request.params.id);
      const active = await runs.list({
        loopId: request.params.id,
        status: [...ACTIVE_STATUSES],
        limit: 1,
      });
      if (active.length > 0)
        return problem(reply, 409, 'LOOP_IN_USE', 'the loop has active runs; cancel them first');
      // An active run of another loop may still start this one as a subloop (pinned at its start).
      // The check and the deletion are one critical section with run creation in the engine.
      let deleted: boolean;
      try {
        deleted = await container.manager.deleteLoopUnlessInUse(request.params.id, async () => {
          await loops.delete(request.params.id);
          // Persistent triggers were removed in the deletion transaction. Disarm memory only
          // after commit, so a refusal or rollback leaves all triggers as they were.
          container.polls.disarm(request.params.id);
        });
      } catch (error) {
        if (error instanceof LoopInUseError)
          return problem(reply, 409, 'LOOP_IN_USE', error.message);
        throw error;
      }
      if (!deleted)
        return problem(
          reply,
          409,
          'LOOP_IN_USE',
          'an active run or pending webhook admission can still start this loop; cancel the run or resolve the pending admission first',
        );
      return reply.status(204).send(null);
    },
  );
}
