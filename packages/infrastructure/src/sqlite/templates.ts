import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import {
  TemplateInstanceSchema,
  type RunStatus,
  type JsonValue,
  type LoopDefinition,
  type RunRecord,
  type TemplateInstance,
} from '@graphgoblin/contracts';
import type { Database } from './db.js';
import { loopVersions, loops, runEvents, runs, templateInstances } from './schema.js';
import { runRecordFromRow } from './run-row.js';

export type SqliteTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export interface TemplateBundleRow {
  key: string;
  loopId: string;
  versionId: string;
  version: number;
  name: string;
  status: 'draft' | 'published';
  definition: LoopDefinition;
}
export interface StoredTemplateInstance {
  instance: TemplateInstance;
  binding: JsonValue;
}
export interface TemplateSubjectFilter {
  ownerId: string;
  repository?: string;
  issue?: number;
  pullRequest?: number;
  head?: string;
  mergeSha?: string;
  instanceId?: string;
  loopId?: string;
  status?: readonly RunStatus[];
  parentRunId?: string | null;
  before?: { createdAt: string; id: string };
  beforeTimestamp?: string;
  limit: number;
}

export interface TemplateEventHistory {
  runId: string;
  lastEventSeq: number | null;
  total: number;
  firstSeq: number | null;
  lastSeq: number | null;
  invalidSeqs: number;
  relevantCount: number;
  rows: (typeof runEvents.$inferSelect)[];
}

/** This facade stays inside the caller's transaction; API policies never acquire the outer DB lock. */
export class TemplateTransaction {
  constructor(private readonly db: Database | SqliteTransaction) {}
  async bindingForLoop(
    ownerId: string,
    loopId: string,
  ): Promise<StoredTemplateInstance | undefined> {
    const [row] = await this.db
      .select()
      .from(templateInstances)
      .where(
        and(
          eq(templateInstances.ownerId, ownerId),
          sql`EXISTS (SELECT 1 FROM json_each(${templateInstances.instance}, '$.loops') WHERE json_extract(value, '$.loopId') = ${loopId})`,
        ),
      )
      .limit(1);
    return row
      ? { instance: TemplateInstanceSchema.parse(row.instance), binding: row.binding }
      : undefined;
  }
  async version(versionId: string) {
    const [row] = await this.db
      .select()
      .from(loopVersions)
      .where(eq(loopVersions.id, versionId))
      .limit(1);
    return row;
  }
  async run(runId: string): Promise<{ run: RunRecord; subject: JsonValue | null } | undefined> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    return row ? { run: runRecordFromRow(row), subject: row.templateSubject } : undefined;
  }
  async events(runId: string): Promise<TemplateEventHistory> {
    const telemetry = ['node.progress', 'harness.usage', 'harness.session'];
    // The proof and bounded projection share one SQLite statement/snapshot, including when
    // called outside an admission transaction. No telemetry payloads cross this boundary.
    const integrity = this.db.$with('template_event_integrity').as(
      this.db
        .select({
          total: sql<number>`count(*)`.as('total'),
          firstSeq: sql<number | null>`min(${runEvents.seq})`.as('first_seq'),
          lastSeq: sql<number | null>`max(${runEvents.seq})`.as('last_seq'),
          invalidSeqs:
            sql<number>`coalesce(sum(case when typeof(${runEvents.seq}) != 'integer' or ${runEvents.seq} < 1 then 1 else 0 end), 0)`.as(
              'invalid_seqs',
            ),
          relevantCount:
            sql<number>`coalesce(sum(case when ${notInArray(runEvents.type, telemetry)} then 1 else 0 end), 0)`.as(
              'relevant_count',
            ),
        })
        .from(runEvents)
        .where(eq(runEvents.runId, runId)),
    );
    const projection = this.db.$with('template_authority_events').as(
      this.db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), notInArray(runEvents.type, telemetry)))
        .orderBy(asc(runEvents.seq))
        .limit(1001),
    );
    const result = await this.db
      .with(integrity, projection)
      .select({
        total: integrity.total,
        firstSeq: integrity.firstSeq,
        lastSeq: integrity.lastSeq,
        invalidSeqs: integrity.invalidSeqs,
        relevantCount: integrity.relevantCount,
        lastEventSeq: runs.lastEventSeq,
        event: {
          runId: projection.runId,
          seq: projection.seq,
          ts: projection.ts,
          type: projection.type,
          nodeId: projection.nodeId,
          payload: projection.payload,
        },
      })
      .from(integrity)
      .leftJoin(runs, eq(runs.id, runId))
      .leftJoin(projection, sql`true`)
      .orderBy(asc(projection.seq));
    const proof = result[0]!;
    return {
      runId,
      lastEventSeq: proof.lastEventSeq,
      total: proof.total,
      firstSeq: proof.firstSeq,
      lastSeq: proof.lastSeq,
      invalidSeqs: proof.invalidSeqs,
      relevantCount: proof.relevantCount,
      rows: result.flatMap((row) => (row.event ? [row.event] : [])),
    };
  }
  async setSubject(runId: string, subject: JsonValue): Promise<void> {
    await this.db.update(runs).set({ templateSubject: subject }).where(eq(runs.id, runId));
  }
  async subjectRuns(filter: TemplateSubjectFilter) {
    return this.filteredRuns(filter, true);
  }
  async runPage(filter: TemplateSubjectFilter) {
    return this.filteredRuns(filter, false);
  }
  private async filteredRuns(filter: TemplateSubjectFilter, subjectsOnly: boolean) {
    const scope = [eq(runs.ownerId, filter.ownerId)];
    if (subjectsOnly) scope.push(sql`${runs.templateSubject} IS NOT NULL`);
    if (filter.loopId) scope.push(eq(runs.loopId, filter.loopId));
    if (filter.status)
      scope.push(
        sql`${runs.status} IN (${sql.join(
          filter.status.map((status) => sql`${status}`),
          sql`, `,
        )})`,
      );
    if (filter.parentRunId !== undefined)
      scope.push(
        filter.parentRunId === null
          ? sql`${runs.parentRunId} IS NULL`
          : eq(runs.parentRunId, filter.parentRunId),
      );
    if (filter.beforeTimestamp) scope.push(sql`${runs.createdAt} < ${filter.beforeTimestamp}`);
    for (const [key, value] of Object.entries(filter)) {
      if (
        ['repository', 'issue', 'pullRequest', 'head', 'mergeSha', 'instanceId'].includes(key) &&
        value !== undefined
      )
        scope.push(sql`json_extract(${runs.templateSubject}, ${'$.' + key}) = ${value}`);
    }
    if (filter.before)
      scope.push(
        sql`(${runs.createdAt}, ${runs.id}) < (${filter.before.createdAt}, ${filter.before.id})`,
      );
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...scope))
      .orderBy(sql`${runs.createdAt} DESC`, sql`${runs.id} DESC`)
      .limit(filter.limit);
    return rows.map((row) => ({ run: runRecordFromRow(row), subject: row.templateSubject }));
  }
  /** Narrow candidate lookup; only API validation of paired mapped outputs confers authority. */
  async prFactCandidates(ownerId: string, repository: string, pullRequest: number, limit: number) {
    const rows = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.ownerId, ownerId),
          sql`
      EXISTS (SELECT 1 FROM run_events event, json_each(event.payload, '$.patch') operation
        WHERE event.run_id = ${runs.id} AND event.type = 'node.finished'
          AND json_extract(operation.value, '$.value.value.type') = 'PrCreated'
          AND json_extract(operation.value, '$.value.value.repository') = ${repository}
          AND json_extract(operation.value, '$.value.value.pullRequest') = ${pullRequest})`,
        ),
      )
      .limit(limit);
    return rows.map((row) => ({ run: runRecordFromRow(row), subject: row.templateSubject }));
  }
  async originalChild(parentRunId: string, nodeId: string, visit: number) {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(
        sql`
      json_extract(${runs.templateSubject}, '$.role') = 'worker'
      AND json_extract(${runs.templateSubject}, '$.parentRunId') = ${parentRunId}
      AND json_extract(${runs.templateSubject}, '$.nodeId') = ${nodeId}
      AND json_extract(${runs.templateSubject}, '$.visit') = ${visit}`,
      )
      .limit(1);
    return row ? runRecordFromRow(row) : undefined;
  }
}

export class SqliteTemplateInstances extends TemplateTransaction {
  constructor(private readonly database: Database) {
    super(database);
  }
  async get(ownerId: string, id: string): Promise<StoredTemplateInstance | undefined> {
    const [row] = await this.database
      .select()
      .from(templateInstances)
      .where(and(eq(templateInstances.id, id), eq(templateInstances.ownerId, ownerId)))
      .limit(1);
    return row
      ? { instance: TemplateInstanceSchema.parse(row.instance), binding: row.binding }
      : undefined;
  }
  /** Complete bundle and immutable binding become visible together, or none of them do. */
  async create(
    instanceInput: TemplateInstance,
    binding: JsonValue,
    prepared: readonly TemplateBundleRow[],
  ): Promise<void> {
    const instance = TemplateInstanceSchema.parse(instanceInput);
    if (
      prepared.length !== instance.loops.length ||
      prepared.some((row, index) => {
        const expected = instance.loops[index];
        return (
          !expected ||
          expected.key !== row.key ||
          expected.loopId !== row.loopId ||
          expected.versionId !== row.versionId ||
          expected.version !== row.version ||
          expected.status !== row.status
        );
      })
    )
      throw new Error('template allocations disagree with the instance');
    await this.database.transaction(async (tx) => {
      for (const row of prepared) {
        await tx.insert(loops).values({
          id: row.loopId,
          ownerId: instance.ownerId,
          name: row.name,
          description: row.definition.description ?? null,
          currentVersionId: row.status === 'published' ? row.versionId : null,
          draftVersionId: row.status === 'draft' ? row.versionId : null,
          createdAt: instance.createdAt,
          updatedAt: instance.createdAt,
        });
        await tx.insert(loopVersions).values({
          id: row.versionId,
          loopId: row.loopId,
          version: row.version,
          status: row.status,
          definition: row.definition,
          createdAt: instance.createdAt,
          publishedAt: row.status === 'published' ? instance.createdAt : null,
        });
      }
      await tx
        .insert(templateInstances)
        .values({ id: instance.id, ownerId: instance.ownerId, instance, binding });
    });
  }
}
