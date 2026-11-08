import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SqliteTransaction } from './db.js';
import {
  chatTurns,
  chatAudio,
  harnessSessions,
  inboundEvents,
  loopVersions,
  runEvents,
  runs,
  runResourceUses,
  timers,
  webhookReceipts,
} from './schema.js';

/** Delete only the selected runs, never their ancestors or descendants in other loops. */
export async function deleteRuns(
  tx: SqliteTransaction,
  where: SQL,
  pruneAllSnapshots = true,
): Promise<number> {
  const selectedVersions = pruneAllSnapshots
    ? []
    : await tx.select({ id: runs.versionId }).from(runs).where(where);
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
  // Replays/subloops can still reference the immutable binary path after its chat turn is gone.
  // Keep such files conservatively until the final native history reference is deleted.
  // Match a complete JSON string: Windows backslashes are escaped in both stored threads.
  await tx
    .update(chatAudio)
    .set({ state: 'pending-delete' })
    .where(
      and(
        eq(chatAudio.state, 'consumed'),
        sql`NOT EXISTS (SELECT 1 FROM ${runs} WHERE ${runs.id} NOT IN (${selected}) AND (instr(${runs.initialThread}, json_quote(${chatAudio.path})) > 0 OR instr(${runs.threadSnapshot}, json_quote(${chatAudio.path})) > 0))`,
      ),
    );
  await tx
    .update(chatTurns)
    .set({ historyDeleted: true, input: null })
    .where(inArray(chatTurns.runId, selected));
  await tx.delete(runEvents).where(inArray(runEvents.runId, selected));
  await tx.delete(harnessSessions).where(inArray(harnessSessions.runId, selected));
  await tx.delete(timers).where(inArray(timers.runId, selected));
  await tx.delete(runResourceUses).where(inArray(runResourceUses.runId, selected));
  // A surviving child keeps its thread and event history, but no live parent-row association.
  await tx.update(runs).set({ parentRunId: null }).where(inArray(runs.parentRunId, selected));
  const deleted = await tx.delete(runs).where(where).returning({ id: runs.id });
  // A draft snapshot is run history: it goes with the last run that pins it (ADR-0041).
  await tx.delete(loopVersions).where(
    and(
      eq(loopVersions.status, 'snapshot'),
      pruneAllSnapshots
        ? undefined
        : inArray(
            loopVersions.id,
            selectedVersions.map((row) => row.id),
          ),
      sql`NOT EXISTS (SELECT 1 FROM ${runs} WHERE ${runs.versionId} = ${loopVersions.id})`,
    ),
  );
  return deleted.length;
}
