import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SqliteTransaction } from './db.js';
import {
  harnessSessions,
  inboundEvents,
  loopVersions,
  runEvents,
  runs,
  timers,
  webhookReceipts,
} from './schema.js';

/** Delete only the selected runs, never their ancestors or descendants in other loops. */
export async function deleteRuns(tx: SqliteTransaction, where: SQL): Promise<number> {
  const selected = tx.select({ id: runs.id }).from(runs).where(where);
  // Inbound events can start runs in several loops. Keep the delivery and its surviving links.
  await tx
    .update(inboundEvents)
    .set({
      runIds: sql`(SELECT json_group_array(value) FROM json_each(${inboundEvents.runIds}) WHERE value NOT IN (${selected}))`,
    })
    .where(
      sql`EXISTS (SELECT 1 FROM json_each(${inboundEvents.runIds}) WHERE value IN (${selected}))`,
    );
  await tx
    .delete(webhookReceipts)
    .where(inArray(sql`json_extract(${webhookReceipts.intent}, '$.run.id')`, selected));
  await tx.delete(runEvents).where(inArray(runEvents.runId, selected));
  await tx.delete(harnessSessions).where(inArray(harnessSessions.runId, selected));
  await tx.delete(timers).where(inArray(timers.runId, selected));
  // A surviving child keeps its thread and event history, but no live parent-row association.
  await tx.update(runs).set({ parentRunId: null }).where(inArray(runs.parentRunId, selected));
  const deleted = await tx.delete(runs).where(where).returning({ id: runs.id });
  // A draft snapshot is run history: it goes with the last run that pins it (ADR-0041).
  await tx
    .delete(loopVersions)
    .where(
      and(
        eq(loopVersions.status, 'snapshot'),
        sql`NOT EXISTS (SELECT 1 FROM ${runs} WHERE ${runs.versionId} = ${loopVersions.id})`,
      ),
    );
  return deleted.length;
}
