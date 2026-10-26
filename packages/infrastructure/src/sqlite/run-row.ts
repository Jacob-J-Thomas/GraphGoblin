import type { JsonValue, RunPin, RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { runs } from './schema.js';
/** A decoded run row. Its definition pin is present: the decoder refuses rows without one. */
export type RunRecordRow = Omit<
  typeof runs.$inferSelect,
  | 'initialThread'
  | 'threadSnapshot'
  | 'threadSnapshotSeq'
  | 'threadSnapshotReplayState'
  | 'result'
  | 'pinned'
  | 'replayIntentSourceRunId'
  | 'replayIntentNodeId'
  | 'replayIntentObservedSeq'
> & { result: JsonValue | undefined; pinned: RunPin };

export function runRecordFromRow(row: RunRecordRow): RunRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    loopId: row.loopId,
    versionId: row.versionId,
    pinned: row.pinned,
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    invocationId: row.invocationId,
    status: row.status as RunStatus,
    ...(row.currentNodeId ? { currentNodeId: row.currentNodeId } : {}),
    iteration: row.iteration,
    ...(row.waiting !== null ? { waiting: row.waiting } : {}),
    ...(row.cancelRequestedAt ? { cancelRequestedAt: row.cancelRequestedAt } : {}),
    ...(row.pausedAt ? { pausedAt: row.pausedAt } : {}),
    ...(row.failure !== null ? { failure: row.failure } : {}),
    ...(row.outcome ? { outcome: row.outcome as RunRecord['outcome'] } : {}),
    ...(row.result !== undefined ? { result: row.result } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
    ...(row.finalizedAt !== null ? { finalizedAt: row.finalizedAt } : {}),
    lastEventSeq: row.lastEventSeq,
  };
}
