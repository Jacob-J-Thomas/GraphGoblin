import { and, eq, lt, sql } from 'drizzle-orm';
import { dirname, sep } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { directoryKey, physicalDirectory } from '../fs/physical-path.js';
import type { Database, SqliteTransaction } from './db.js';
import { workspaceReferences, workspaceReferenceState } from './schema.js';

/** Resolution is done before the transaction that records a use or definition. */
export async function recordWorkspacePhysical(
  tx: SqliteTransaction,
  id: string,
  path: string,
  physical: string | null,
): Promise<void> {
  await tx
    .update(workspaceReferences)
    .set({
      physicalPath: physical,
      checkedEpoch: sql`(SELECT epoch FROM workspace_reference_state WHERE id = 1)`,
    })
    .where(and(eq(workspaceReferences.id, id), eq(workspaceReferences.path, path)));
}

/** One bounded, restartable refresh sweep. No filesystem call holds the SQLite statement lock. */
export class SqliteWorkspaceReferences {
  private started = false;
  constructor(private readonly db: Database) {}

  async refreshBatch(signal?: AbortSignal): Promise<void> {
    const [state] = await this.db.select().from(workspaceReferenceState);
    // A restart never trusts an old, partly completed filesystem observation.
    if (!this.started || !state!.sweeping) {
      await this.db.update(workspaceReferenceState).set({ epoch: sql`epoch + 1`, sweeping: true });
      this.started = true;
    }
    const [current] = await this.db.select().from(workspaceReferenceState);
    const epoch = current!.epoch;
    const rows = await this.db
      .select()
      .from(workspaceReferences)
      .where(lt(workspaceReferences.checkedEpoch, epoch))
      .orderBy(workspaceReferences.checkedEpoch, workspaceReferences.id)
      .limit(2048);
    const resolved = new Map<string, string | null>();
    // One bounded indexed update per 32 observations avoids a durable commit per path.
    for (let offset = 0; offset < rows.length; offset += 32) {
      const observed: {
        id: string;
        path: string | null;
        priorEpoch: number;
        physical: string | null;
      }[] = [];
      for (const row of rows.slice(offset, offset + 32)) {
        if (signal?.aborted) return;
        let physical: string | null = null;
        if (row.path !== null) {
          if (!resolved.has(row.path)) resolved.set(row.path, await physicalDirectory(row.path));
          physical = resolved.get(row.path)!;
        }
        observed.push({ id: row.id, path: row.path, priorEpoch: row.checkedEpoch, physical });
      }
      if (signal?.aborted) return;
      await this.db.run(sql`WITH observed(id, path, prior_epoch, physical) AS (VALUES
        ${sql.join(
          observed.map((row) => sql`(${row.id}, ${row.path}, ${row.priorEpoch}, ${row.physical})`),
          sql`, `,
        )})
        UPDATE workspace_references AS current SET physical_path = observed.physical, checked_epoch = ${epoch}
        FROM observed WHERE current.id = observed.id AND current.path IS observed.path
          AND current.checked_epoch = observed.prior_epoch`);
      await yieldTurn();
    }
    const [older] = await this.db
      .select({ id: workspaceReferences.id })
      .from(workspaceReferences)
      .where(lt(workspaceReferences.checkedEpoch, epoch))
      .limit(1);
    if (!older) await this.db.update(workspaceReferenceState).set({ sweeping: false });
  }
}

/** Indexed null, ancestor equality and descendant range probes; no history-size scan or I/O. */
export async function workspaceReferenced(
  tx: Database | SqliteTransaction,
  physical: string | null | undefined,
): Promise<boolean> {
  if (!physical) return true;
  const [sweep] = await tx.all(
    sql`SELECT 1 FROM workspace_reference_state WHERE id = 1 AND sweeping = 1`,
  );
  if (sweep) return true;
  const [unknown] = await tx.all(
    sql`SELECT 1 FROM workspace_references WHERE physical_path IS NULL LIMIT 1`,
  );
  if (unknown) return true;
  const ancestors = [physical];
  let parent = dirname(physical.slice(0, -1));
  while (!ancestors.includes(directoryKey(parent))) {
    ancestors.push(directoryKey(parent));
    parent = dirname(parent);
  }
  const [enclosing] = await tx.all(sql`SELECT 1 FROM workspace_references
    WHERE physical_path IN (${sql.join(
      ancestors.map((path) => sql`${path}`),
      sql`, `,
    )}) LIMIT 1`);
  if (enclosing) return true;
  const upper = physical.slice(0, -1) + String.fromCharCode(sep.charCodeAt(0) + 1);
  const [enclosed] = await tx.all(sql`SELECT 1 FROM workspace_references
    WHERE physical_path >= ${physical} AND physical_path < ${upper} LIMIT 1`);
  return Boolean(enclosed);
}
