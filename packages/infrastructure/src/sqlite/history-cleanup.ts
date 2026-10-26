import { DeletionApprovalSchema, TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { resolve, sep } from 'node:path';
import type { OwnedRunResource, OwnedRunResources } from '../fs/owned-resources.js';
import type { Database, SqliteTransaction } from './db.js';
import { deleteRuns } from './delete-runs.js';
import { runResources, runs } from './schema.js';

type Member = {
  id: string;
  owner: string | null;
  status: string;
  finalized: string | null;
  approval: string | null;
};
const normalized = (path: string) =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

/** Only background polling calls this storage boundary. No event/write-path hooks. */
export class SqliteHistoryCleanup {
  private runCursor = '';
  private resourceCursor = '';
  constructor(
    private readonly db: Database,
    private readonly resources: OwnedRunResources,
  ) {}

  /** Complete dependency components, at most 20 roots / 500 records per pass. */
  async prepareBatch(ownerId: string): Promise<number> {
    return this.resources.exclusive(() =>
      this.db.transaction(async (tx) => {
        const roots = await tx.all<{ id: string }>(sql`SELECT id FROM runs
        WHERE owner_id = ${ownerId} AND deletion_approval IS NOT NULL AND id > ${this.runCursor}
        ORDER BY id LIMIT 20`);
        this.runCursor = roots.at(-1)?.id ?? '';
        const selected = new Set<string>();
        for (const root of roots) {
          const members = await tx.all<Member>(sql`WITH RECURSIVE related(id) AS (
          SELECT ${root.id}
          UNION SELECT r.parent_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.parent_run_id IS NOT NULL
          UNION SELECT r.id FROM runs r JOIN related ON r.parent_run_id = related.id
          UNION SELECT r.replay_source_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.replay_source_run_id IS NOT NULL
          UNION SELECT r.id FROM runs r JOIN related ON r.replay_source_run_id = related.id
          LIMIT 501
        ) SELECT related.id, r.owner_id AS owner, r.status, r.finalized_at AS finalized, r.deletion_approval AS approval
          FROM related LEFT JOIN runs r ON r.id = related.id`);
          const valid =
            members.length <= 500 &&
            members.every((member) => {
              if (
                member.owner !== ownerId ||
                !member.finalized ||
                !TERMINAL_RUN_STATUSES.some((status) => status === member.status) ||
                !member.approval
              )
                return false;
              try {
                return DeletionApprovalSchema.safeParse(JSON.parse(member.approval)).success;
              } catch {
                return false;
              }
            });
          if (valid && new Set([...selected, ...members.map((member) => member.id)]).size <= 500)
            for (const member of members) selected.add(member.id);
        }
        if (!selected.size) return 0;
        const ids = [...selected];
        // This durable journal and history disappear together or neither commits.
        await tx
          .update(runResources)
          .set({
            pending: true,
            approval: sql`(SELECT deletion_approval FROM runs WHERE runs.id = run_resources.owner_run_id)`,
          })
          .where(inArray(runResources.ownerRunId, ids));
        return deleteRuns(tx, inArray(runs.id, ids), false);
      }),
    );
  }

  private async referenced(tx: SqliteTransaction, resource: OwnedRunResource): Promise<boolean> {
    const use = await tx.all(
      sql`SELECT 1 FROM run_resource_uses u JOIN runs r ON r.id = u.run_id WHERE u.key = ${resource.key} LIMIT 1`,
    );
    if (use.length) return true;
    if (resource.kind === 'workspace') {
      const unresolved =
        await tx.all(sql`SELECT 1 FROM runs r JOIN loop_versions v ON v.id = r.version_id
        WHERE json_valid(v.definition) AND json_extract(v.definition, '$.settings.workingDirectory.kind') = 'template'
        AND NOT EXISTS (SELECT 1 FROM run_resource_uses u WHERE u.run_id = r.id AND u.key LIKE 'workspace:%') LIMIT 1`);
      if (unresolved.length) return true;
      const paths = await tx.all<{
        path: string;
      }>(sql`SELECT u.path FROM run_resource_uses u JOIN runs r ON r.id = u.run_id WHERE u.key LIKE 'workspace:%'
        UNION SELECT json_extract(definition, '$.settings.workingDirectory.path') FROM loop_versions
          WHERE json_valid(definition) AND json_extract(definition, '$.settings.workingDirectory.kind') = 'fixed'`);
      return paths.some(({ path }) => {
        const a = normalized(resource.path),
          b = normalized(path);
        return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
      });
    }
    // Retained history includes initial/checkpoint threads, definition pins and event tails.
    // Decode JSON strings so escaped references are protected too. Damaged JSON fails closed.
    const documents = sql`documents(body) AS (
      SELECT initial_thread FROM runs UNION ALL SELECT thread_snapshot FROM runs WHERE thread_snapshot IS NOT NULL
      UNION ALL SELECT pinned FROM runs WHERE pinned IS NOT NULL
      UNION ALL SELECT v.definition FROM loop_versions v JOIN runs r ON r.version_id = v.id
      UNION ALL SELECT e.payload FROM run_events e JOIN runs r ON r.id = e.run_id
      UNION ALL SELECT payload FROM inbound_events
      UNION ALL SELECT intent FROM event_receipts WHERE intent IS NOT NULL
      UNION ALL SELECT intent FROM webhook_receipts WHERE intent IS NOT NULL
    )`;
    // No per-event reference index: cap background proof work instead. Unknown is protected.
    const [size] = await tx.all<{
      count: number;
      bytes: number;
    }>(sql`WITH ${documents}, sampled AS (
      SELECT body FROM documents LIMIT 2001
    ) SELECT count(*) AS count, coalesce(sum(length(CAST(body AS BLOB))), 0) AS bytes FROM sampled`);
    if (Number(size!.count) > 2000 || Number(size!.bytes) > 2 * 1024 ** 2) return true;
    const references =
      await tx.all(sql`WITH ${documents} SELECT 1 FROM documents WHERE CASE WHEN json_valid(body) THEN
      EXISTS (SELECT 1 FROM json_tree(body) WHERE type = 'text' AND instr(value, ${resource.key}) > 0)
      ELSE 1 END LIMIT 1`);
    return references.length > 0;
  }

  /** One resource transaction at a time; missing files finish a previously interrupted job. */
  async reapBatch(): Promise<{ bytes: number; preserved: number; pending: number }> {
    const jobs = await this.db
      .select()
      .from(runResources)
      .where(and(eq(runResources.pending, true), gt(runResources.key, this.resourceCursor)))
      .orderBy(runResources.key)
      .limit(32);
    this.resourceCursor = jobs.at(-1)?.key ?? '';
    let bytes = 0,
      preserved = 0;
    for (const job of jobs) {
      try {
        if (!DeletionApprovalSchema.safeParse(job.approval).success) {
          preserved++;
          continue;
        }
        const removed = await this.resources.exclusive(() =>
          this.db.transaction(async (tx) => {
            // A publication/new run since prepareBatch can retain the same resource.
            if (await this.referenced(tx, job)) return { removed: false, bytes: 0 };
            const result = await this.resources.remove(job);
            if (result.removed) await tx.delete(runResources).where(eq(runResources.key, job.key));
            return result;
          }),
        );
        bytes += removed.bytes;
        if (!removed.removed) preserved++;
      } catch {
        preserved++;
      } // Journal remains for the next pass; never broaden scope.
    }
    const [count] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(runResources)
      .where(eq(runResources.pending, true));
    return { bytes, preserved, pending: Number(count!.count) };
  }

  async reusableBytes(): Promise<number> {
    const [free] = await this.db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`);
    const [page] = await this.db.all<{ page_size: number }>(sql`PRAGMA page_size`);
    return Number(free!.freelist_count) * Number(page!.page_size);
  }
}
