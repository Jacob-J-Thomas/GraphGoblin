import { createHash } from 'node:crypto';
import {
  DeletionApprovalSchema,
  DeletionConfirmationSchema,
  DeletionSelectionSchema,
  TERMINAL_RUN_STATUSES,
  type DeletionApproval,
  type DeletionPreview,
  type DeletionConfirmation,
} from '@graphgoblin/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Database, SqliteTransaction } from './db.js';
import { runs } from './schema.js';

type Connection = Database | SqliteTransaction;
type HistoryRow = {
  id: string;
  ownerId: string;
  status: string;
  parent: string | null;
  replay: string | null;
  finalizedAt: string | null;
  seq: number;
  approval: string | null;
  revision: number;
};

/** Indexed traversal visits only the selected dependency components, never all threads. */
const relatedSteps = sql`
  UNION SELECT r.parent_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.parent_run_id IS NOT NULL
  UNION SELECT r.id FROM runs r JOIN related ON r.parent_run_id = related.id
  UNION SELECT r.replay_source_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.replay_source_run_id IS NOT NULL
  UNION SELECT r.id FROM runs r JOIN related ON r.replay_source_run_id = related.id
`;

async function inspect(
  db: Connection,
  ownerId: string,
  runIds: string[],
): Promise<DeletionPreview> {
  const ids = sql.join(
    runIds.map((id) => sql`${id}`),
    sql`, `,
  );
  // Traverse only relationship identities. Do not load event logs, threads or artifact bytes.
  const rows = await db.all<HistoryRow>(sql`WITH RECURSIVE related(id) AS (
    SELECT id FROM runs WHERE owner_id = ${ownerId} AND id IN (${ids})
    ${relatedSteps}
  ) SELECT id, owner_id AS ownerId, status, parent_run_id AS parent,
    replay_source_run_id AS replay,
    finalized_at AS finalizedAt, last_event_seq AS seq, deletion_approval AS approval, deletion_revision AS revision
    FROM runs WHERE id IN (SELECT id FROM related) ORDER BY id`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = new Set(runIds);
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = neighbours.get(a) ?? new Set<string>();
    set.add(b);
    neighbours.set(a, set);
  };
  for (const row of rows) {
    for (const ref of [row.parent, row.replay]) {
      if (ref) {
        link(row.id, ref);
        link(ref, row.id);
      }
    }
  }
  const components = new Map<string, Set<string>>();
  for (const row of rows) {
    if (components.has(row.id)) continue;
    const component = new Set([row.id]);
    for (const id of component) for (const next of neighbours.get(id) ?? []) component.add(next);
    for (const id of component) components.set(id, component);
  }
  return {
    // Includes approvals and the relationship component, so a competing withdrawal, resume,
    // replay, child admission, event or finalization makes the displayed selection stale.
    token: createHash('sha256')
      .update(JSON.stringify([ownerId, [...runIds].sort(), rows]))
      .digest('hex'),
    items: runIds.map((runId) => {
      const row = byId.get(runId);
      if (!row || row.ownerId !== ownerId) return { runId, reasons: ['Run not found.'] };
      const reasons: string[] = [];
      if (!TERMINAL_RUN_STATUSES.some((status) => status === row.status))
        reasons.push(`Run is ${row.status}; active and paused history is protected.`);
      if (!row.finalizedAt) reasons.push('Run finalization is incomplete.');
      for (const id of components.get(runId)!) {
        const dependency = byId.get(id);
        if (
          id !== runId &&
          (!dependency ||
            dependency.ownerId !== ownerId ||
            (!selected.has(id) && !dependency.approval))
        ) {
          reasons.push(`Required retained history ${id} must be selected together.`);
        }
      }
      return {
        runId,
        reasons,
        ...(row.approval
          ? { approval: DeletionApprovalSchema.parse(JSON.parse(row.approval)) }
          : {}),
      };
    }),
  };
}

/** Atomic, owner-scoped consent. This service never deletes history or filesystem resources. */
export class SqliteDeletionEligibility {
  constructor(private readonly db: Database) {}

  preview(ownerId: string, runIds: string[]): Promise<DeletionPreview> {
    DeletionSelectionSchema.parse({ runIds });
    return inspect(this.db, ownerId, runIds);
  }

  async confirm(ownerId: string, input: DeletionConfirmation, approval: DeletionApproval) {
    DeletionConfirmationSchema.parse(input);
    DeletionApprovalSchema.parse(approval);
    return this.db.transaction(async (tx) => {
      const preview = await inspect(tx, ownerId, input.runIds);
      if (preview.token !== input.token) return { conflict: 'stale' as const, ...preview };
      if (preview.items.some((item) => item.reasons.includes('Run not found.')))
        return { conflict: 'missing' as const, ...preview };
      if (input.action === 'mark' && preview.items.some((item) => item.reasons.length))
        return { conflict: 'protected' as const, ...preview };
      if (input.action === 'withdraw') {
        const ids = sql.join(
          input.runIds.map((id) => sql`${id}`),
          sql`, `,
        );
        await tx.run(sql`WITH RECURSIVE related(id) AS (
          SELECT id FROM runs WHERE id IN (${ids})
          ${relatedSteps}
        ) UPDATE runs SET deletion_approval = NULL WHERE owner_id = ${ownerId} AND id IN (SELECT id FROM related)`);
      } else
        for (const id of input.runIds) {
          await tx.update(runs).set({ deletionApproval: approval }).where(eq(runs.id, id));
        }
      return { conflict: null, ...(await inspect(tx, ownerId, input.runIds)) };
    });
  }
}
