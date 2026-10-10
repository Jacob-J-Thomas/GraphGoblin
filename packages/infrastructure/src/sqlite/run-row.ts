import type { RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { runs } from './schema.js';
type Row = typeof runs.$inferSelect;

export function runRecordFromRow(row: Row): RunRecord {
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
    ...(row.waiting ? { waiting: row.waiting } : {}),
    ...(row.cancelRequestedAt ? { cancelRequestedAt: row.cancelRequestedAt } : {}),
    ...(row.pausedAt ? { pausedAt: row.pausedAt } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    ...(row.outcome ? { outcome: row.outcome as RunRecord['outcome'] } : {}),
    ...(row.result !== null && row.result !== undefined ? { result: row.result } : {}),
    createdAt: row.createdAt,
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
    lastEventSeq: row.lastEventSeq,
  };
}
