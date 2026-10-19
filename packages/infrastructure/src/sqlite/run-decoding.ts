import {
  ContextThreadSchema,
  RunRecordSchema,
  type ContextThread,
  type RunRecord,
} from '@graphgoblin/contracts';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { sql } from 'drizzle-orm';
import { runs } from './schema.js';
import { runRecordFromRow, type RunRecordRow } from './run-row.js';

/** Bypass Drizzle's eager JSON decoder so corruption is attributed to a single run. */
export const rawRunColumns = {
  id: runs.id,
  ownerId: runs.ownerId,
  loopId: runs.loopId,
  versionId: runs.versionId,
  parentRunId: runs.parentRunId,
  invocationId: runs.invocationId,
  status: runs.status,
  currentNodeId: runs.currentNodeId,
  iteration: runs.iteration,
  waiting: sql<string | null>`${runs.waiting}`,
  failure: sql<string | null>`${runs.failure}`,
  result: sql<string | null>`${runs.result}`,
  cancelRequestedAt: runs.cancelRequestedAt,
  pausedAt: runs.pausedAt,
  outcome: runs.outcome,
  createdAt: runs.createdAt,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  lastEventSeq: runs.lastEventSeq,
};
type RawRun = Omit<RunRecordRow, 'waiting' | 'failure' | 'result'> & {
  waiting: string | null;
  failure: string | null;
  result: string | null;
};

function decode(runId: string, field: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new UnreadableRunHistoryError(
      runId,
      `Stored run ${runId} has malformed JSON in ${field}`,
    );
  }
}

export function decodeRunRecord(row: RawRun): RunRecord {
  // Decode raw JSON before the one named-field mapper. Internal columns never become
  // contract fields, and mapper invariants (including definition pins) stay authoritative.
  const decoded = {
    ...row,
    waiting: row.waiting === null ? null : decode(row.id, 'waiting', row.waiting),
    failure: row.failure === null ? null : decode(row.id, 'failure', row.failure),
    result: row.result === null ? null : decode(row.id, 'result', row.result),
  } as RunRecordRow;
  const parsed = RunRecordSchema.safeParse(runRecordFromRow(decoded));
  if (!parsed.success)
    throw new UnreadableRunHistoryError(
      row.id,
      `Stored run ${row.id} does not conform to the run record contract`,
    );
  return parsed.data;
}

export function decodeStoredThread(runId: string, field: string, text: string): ContextThread {
  const parsed = ContextThreadSchema.safeParse(decode(runId, field, text));
  if (!parsed.success)
    throw new UnreadableRunHistoryError(runId, `Stored run ${runId} has an invalid ${field}`);
  return parsed.data;
}
