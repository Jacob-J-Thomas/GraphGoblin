import type { RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { runs } from './schema.js';
type Row = typeof runs.$inferSelect;

/** A stored run without a definition pin is corrupt: nothing writes one, and 0014 pinned them all. */
export class RunPinMissingError extends Error {
  constructor(runId: string) {
    super(`run ${runId} has no definition pin; the store needs repair`);
    this.name = 'RunPinMissingError';
  }
}

export function runRecordFromRow(row: Row): RunRecord {
  if (!row.pinned) throw new RunPinMissingError(row.id);
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
