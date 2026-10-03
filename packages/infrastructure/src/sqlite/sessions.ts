import type { HarnessId } from '@graphgoblin/contracts';
import type { HarnessSessionRecord, HarnessSessionRepository } from '@graphgoblin/engine';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { harnessSessions } from './schema.js';

type Row = typeof harnessSessions.$inferSelect;

function toRecord(row: Row): HarnessSessionRecord {
  return {
    runId: row.runId,
    nodeId: row.nodeId,
    attempt: row.attempt,
    harness: row.harness as HarnessId,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    status: row.status as HarnessSessionRecord['status'],
    ...(row.model ? { model: row.model } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    ...(row.scopeKey ? { scopeKey: row.scopeKey } : {}),
    updatedAt: row.updatedAt,
  };
}

export class SqliteSessionRepository implements HarnessSessionRepository {
  constructor(private readonly db: Database) {}

  async upsert(row: HarnessSessionRecord): Promise<void> {
    const values = {
      runId: row.runId,
      nodeId: row.nodeId,
      attempt: row.attempt,
      harness: row.harness,
      sessionId: row.sessionId ?? null,
      status: row.status,
      model: row.model ?? null,
      effort: row.effort ?? null,
      scopeKey: row.scopeKey ?? null,
      updatedAt: row.updatedAt,
    };
    await this.db
      .insert(harnessSessions)
      .values(values)
      .onConflictDoUpdate({
        target: [harnessSessions.runId, harnessSessions.nodeId, harnessSessions.attempt],
        set: values,
      });
  }

  async forNode(runId: string, nodeId: string): Promise<HarnessSessionRecord | undefined> {
    const row = await this.db.query.harnessSessions.findFirst({
      where: and(eq(harnessSessions.runId, runId), eq(harnessSessions.nodeId, nodeId)),
      orderBy: desc(harnessSessions.attempt),
    });
    return row ? toRecord(row) : undefined;
  }

  async latestWithSession(runId: string): Promise<HarnessSessionRecord | undefined> {
    const row = await this.db.query.harnessSessions.findFirst({
      where: and(eq(harnessSessions.runId, runId), isNotNull(harnessSessions.sessionId)),
      orderBy: desc(harnessSessions.updatedAt),
    });
    return row ? toRecord(row) : undefined;
  }

  async byScopeKey(scopeKey: string): Promise<HarnessSessionRecord | undefined> {
    const row = await this.db.query.harnessSessions.findFirst({
      where: and(eq(harnessSessions.scopeKey, scopeKey), isNotNull(harnessSessions.sessionId)),
      orderBy: desc(harnessSessions.updatedAt),
    });
    return row ? toRecord(row) : undefined;
  }

  async listForRun(runId: string): Promise<HarnessSessionRecord[]> {
    const rows = await this.db
      .select()
      .from(harnessSessions)
      .where(eq(harnessSessions.runId, runId))
      .orderBy(harnessSessions.updatedAt);
    return rows.map(toRecord);
  }
}
