import {
  ContextThreadSchema,
  RunRecordSchema,
  type ContextThread,
  type RunRecord,
} from '@graphgoblin/contracts';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { getTableColumns, sql } from 'drizzle-orm';
import { runs } from './schema.js';

/** Bypass Drizzle's eager JSON decoder so corruption is attributed to a single run. */
export const rawRunColumns = {
  ...getTableColumns(runs),
  waiting: sql<string | null>`${runs.waiting}`,
  failure: sql<string | null>`${runs.failure}`,
  result: sql<string | null>`${runs.result}`,
  initialThread: sql<string>`${runs.initialThread}`,
  threadSnapshot: sql<string | null>`${runs.threadSnapshot}`,
};
type RawRun = {
  id: string;
  waiting: string | null;
  failure: string | null;
  result: string | null;
  initialThread: string;
  threadSnapshot: string | null;
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
  decodeStoredThread(row.id, 'initial_thread', row.initialThread);
  if (row.threadSnapshot !== null)
    decodeStoredThread(row.id, 'thread_snapshot', row.threadSnapshot);
  const { initialThread: _initial, threadSnapshot: _snapshot, ...columns } = row;
  const candidate: Record<string, unknown> = Object.fromEntries(
    Object.entries(columns).filter(
      ([key, value]) => value !== null && key !== 'threadSnapshotSeq' && key !== 'finalizedAt',
    ),
  );
  for (const field of ['waiting', 'failure', 'result'] as const) {
    if (row[field] !== null) candidate[field] = decode(row.id, field, row[field]);
  }
  const parsed = RunRecordSchema.safeParse(candidate);
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
