import { DeletionApprovalSchema, TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import {
  originalResource,
  quarantinedKey,
  type OwnedRunResource,
  type ResourceCleanupPort,
} from '../fs/owned-resources.js';
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

// promises.realpath uses realpath.native: resolve junctions/short names as well as symlinks.
// Missing descendants still inherit the physical identity of their deepest existing ancestor.
async function physicalPath(path: string, budget: { remaining: number }): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      if (budget.remaining-- <= 0) throw new Error('Workspace resolution budget exceeded');
      const actual = await realpath(ancestor);
      if (budget.remaining-- <= 0) throw new Error('Workspace resolution budget exceeded');
      if (!(await stat(actual)).isDirectory())
        throw new Error('Workspace reference ancestor is not a directory');
      return normalized(join(actual, ...missing));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  throw new Error('Workspace reference resolution exceeds its ancestor budget');
}

const overlaps = (a: string, b: string) =>
  a === b ||
  a.startsWith(b.endsWith(sep) ? b : b + sep) ||
  b.startsWith(a.endsWith(sep) ? a : a + sep);

/** Only background polling calls this storage boundary. No event/write-path hooks. */
export class SqliteHistoryCleanup {
  private runCursor = '';
  private resourceCursor = '';
  constructor(
    private readonly db: Database,
    private readonly resources: ResourceCleanupPort,
  ) {}

  /** Complete dependency components, at most 20 roots / 500 records per pass. */
  async prepareBatch(ownerId: string): Promise<number> {
    return this.resources.exclusive(() =>
      this.db.transaction(async (tx) => {
        const roots = await tx.all<{ id: string }>(sql`SELECT id FROM runs
        WHERE owner_id = ${ownerId} AND deletion_approval IS NOT NULL AND id > ${this.runCursor}
        ORDER BY id LIMIT 20`);
        // Fill the same bounded batch from the beginning; never spend an empty pass wrapping.
        // Newly confirmed older history is visible on the next pass, not one poll later.
        if (this.runCursor && roots.length < 20) {
          const wrapped = await tx.all<{ id: string }>(sql`SELECT id FROM runs
            WHERE owner_id = ${ownerId} AND deletion_approval IS NOT NULL AND id <= ${this.runCursor}
            ORDER BY id LIMIT ${20 - roots.length}`);
          roots.push(...wrapped);
        }
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

  /** Conservative final status probe: unexamined/protected approvals are not proof of absence. */
  async hasApprovedCandidates(ownerId: string): Promise<boolean> {
    const rows = await this.db.all(sql`SELECT 1 FROM runs
      WHERE owner_id = ${ownerId} AND deletion_approval IS NOT NULL LIMIT 1`);
    return rows.length > 0;
  }

  private async referenced(
    tx: SqliteTransaction | Database,
    resource: OwnedRunResource,
  ): Promise<boolean> {
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
          WHERE json_valid(definition) AND json_extract(definition, '$.settings.workingDirectory.kind') = 'fixed'
        LIMIT 33`);
      if (paths.length > 32) return true;
      try {
        const budget = { remaining: 64 };
        const actual = await physicalPath(resource.path, budget);
        for (const { path } of paths)
          if (overlaps(actual, await physicalPath(path, budget))) return true;
        return false;
      } catch {
        return true; // Any non-missing I/O error or exhausted proof budget means unknown/keep.
      }
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

  async pendingResources(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(runResources)
      .where(eq(runResources.pending, true));
    return Number(row!.count);
  }

  private async resourceSummary() {
    const [row] = await this.db.all<{
      pending: number;
      changes: number;
      version: number;
    }>(sql`SELECT
      (SELECT count(*) FROM run_resources WHERE pending = 1) AS pending,
      total_changes() AS changes, (SELECT data_version FROM pragma_data_version) AS version`);
    return row!;
  }

  /** At most 256 candidate reads and 32 inventories/removals; blocked keys cannot starve later work. */
  async reapBatch(
    signal?: AbortSignal,
  ): Promise<{ bytes: number; preserved: number; pending: number; remaining: boolean }> {
    const jobs = await this.db
      .select()
      .from(runResources)
      .where(and(eq(runResources.pending, true), gt(runResources.key, this.resourceCursor)))
      .orderBy(runResources.key)
      .limit(256);
    if (this.resourceCursor && jobs.length < 256)
      jobs.push(
        ...(await this.db
          .select()
          .from(runResources)
          .where(
            and(eq(runResources.pending, true), sql`${runResources.key} <= ${this.resourceCursor}`),
          )
          .orderBy(runResources.key)
          .limit(256 - jobs.length)),
      );
    const blocked = new Set<string>();
    let bytes = 0,
      inspected = 0;
    for (const job of jobs) {
      if (signal?.aborted || inspected >= 32) break;
      this.resourceCursor = job.key;
      let finalKey = job.key;
      try {
        if (!DeletionApprovalSchema.safeParse(job.approval).success) {
          blocked.add(job.key);
          continue;
        }
        const original = originalResource(job);
        const staged = job.key.startsWith('quarantine:');
        if (!staged && (await this.referenced(this.db, original))) continue;
        inspected++;
        // No transaction or process publication gate spans inventory or recursive deletion.
        const plan = await this.resources.inspect(job);
        if (signal?.aborted) break;
        if (!plan) {
          blocked.add(job.key);
          continue;
        }
        finalKey = staged ? job.key : quarantinedKey(original);
        const moved = await this.resources.exclusive(() =>
          this.db.transaction(async (tx) => {
            const [current] = await tx
              .select()
              .from(runResources)
              .where(
                and(
                  eq(runResources.key, job.key),
                  eq(runResources.identity, job.identity),
                  eq(runResources.pending, true),
                ),
              );
            if (
              !current ||
              current.path !== job.path ||
              current.ownerRunId !== job.ownerRunId ||
              current.kind !== job.kind ||
              !DeletionApprovalSchema.safeParse(current.approval).success
            )
              return false;
            if (!staged && (await this.referenced(tx, original))) return false;
            if (!(await this.resources.stage(job, plan))) return false;
            if (!staged)
              await tx
                .update(runResources)
                .set({ key: finalKey })
                .where(eq(runResources.key, job.key));
            return true;
          }),
        );
        if (!moved) {
          blocked.add(job.key);
          continue;
        }
        const result = await this.resources.remove({ ...job, key: finalKey }, plan, signal);
        if (result.removed)
          await this.db
            .delete(runResources)
            .where(and(eq(runResources.key, finalKey), eq(runResources.identity, job.identity)));
        // A stopped partial purge remains potentially removable on the next pass.
        bytes += result.bytes;
      } catch {
        blocked.add(finalKey);
      } // Keep the durable generation and its original consent.
      await yieldTurn();
    }
    if (!jobs.length) this.resourceCursor = '';
    // Whole-store count, not this cursor window. Unseen work keeps pressure rather than falsely
    // claiming absence. Recheck references at the conclusion, outside a write transaction.
    const before = await this.resourceSummary();
    const current = await this.db
      .select()
      .from(runResources)
      .where(eq(runResources.pending, true))
      .orderBy(runResources.key)
      .limit(257);
    let remaining = current.length > 256;
    for (const job of current.slice(0, 256)) {
      if (signal?.aborted) {
        remaining = current.length > 0;
        break;
      }
      if (blocked.has(job.key) && job.key.startsWith('quarantine:')) continue;
      if (!DeletionApprovalSchema.safeParse(job.approval).success) continue;
      if (
        job.key.startsWith('quarantine:') ||
        (!blocked.has(job.key) && !(await this.referenced(this.db, originalResource(job))))
      ) {
        remaining = true;
        break;
      }
    }
    const after = await this.resourceSummary();
    const pending = Number(after.pending);
    // No event hook: SQLite already maintains these counters. Concurrent writes make an
    // absence proof uncertain; do not publish no-eligible from a stale census.
    remaining =
      pending > 0 &&
      (remaining || before.changes !== after.changes || before.version !== after.version);
    return { bytes, preserved: pending, pending, remaining };
  }

  async reusableBytes(): Promise<number> {
    const [free] = await this.db.all<{ freelist_count: number }>(sql`PRAGMA freelist_count`);
    const [page] = await this.db.all<{ page_size: number }>(sql`PRAGMA page_size`);
    return Number(free!.freelist_count) * Number(page!.page_size);
  }
}
