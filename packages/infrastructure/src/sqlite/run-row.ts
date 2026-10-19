import type { JsonValue, RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { runs } from './schema.js';
export type RunRecordRow = Omit<
  typeof runs.$inferSelect,
  'initialThread' | 'threadSnapshot' | 'threadSnapshotSeq' | 'finalizedAt' | 'result'
> & { result: JsonValue | undefined };

export function runRecordFromRow(row: RunRecordRow): RunRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    loopId: row.loopId,
    versionId: row.versionId,
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
    lastEventSeq: row.lastEventSeq,
  };
}
