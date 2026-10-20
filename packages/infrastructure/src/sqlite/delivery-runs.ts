import type { RunRecord, RunStatus } from '@graphgoblin/contracts';
import { RunEventSchema } from '@graphgoblin/contracts';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { asc, eq, like, and, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { SqliteRunRepository, type RunListFilter, type RunPageFilter } from './runs.js';
import { runEvents } from './schema.js';

/** Derive delivery snapshots from their journal; there is no second, fallible status write. */
export class SqliteDeliveryRunRepository extends SqliteRunRepository {
  constructor(private readonly deliveryDb: Database) {
    super(deliveryDb);
  }

  private async project(run: RunRecord): Promise<RunRecord> {
    const rows = await this.deliveryDb
      .select({
        payload: sql<string>`${runEvents.payload}`,
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
      })
      .from(runEvents)
      .where(and(eq(runEvents.runId, run.id), like(runEvents.type, 'delivery.%')))
      .orderBy(asc(runEvents.seq));
    if (!rows.length) return run;
    const deliveries = new Map<string, NonNullable<RunRecord['deliveries']>[number]>();
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        throw new UnreadableRunHistoryError(
          run.id,
          `Invalid delivery journal JSON at sequence ${row.seq}`,
        );
      }
      const parsed = RunEventSchema.safeParse({
        ...(typeof payload === 'object' && payload !== null ? payload : {}),
        runId: row.runId,
        seq: row.seq,
        ts: row.ts,
        type: row.type,
      });
      if (!parsed.success || !('delivery' in parsed.data))
        throw new UnreadableRunHistoryError(
          run.id,
          `Invalid delivery journal at sequence ${row.seq}`,
        );
      deliveries.set(parsed.data.delivery.id, parsed.data.delivery);
    }
    return { ...run, deliveries: [...deliveries.values()] };
  }
  override async get(id: string): Promise<RunRecord | undefined> {
    const run = await super.get(id);
    return run ? this.project(run) : undefined;
  }
  override async list(filter: RunListFilter = {}): Promise<RunRecord[]> {
    return this.projectReadable(await super.list(filter));
  }
  override async page(filter: RunPageFilter) {
    const page = await super.page(filter);
    return { ...page, items: await this.projectReadable(page.items) };
  }
  private async projectReadable(records: RunRecord[]): Promise<RunRecord[]> {
    const readable: RunRecord[] = [];
    for (const run of records) {
      try {
        readable.push(await this.project(run));
      } catch (error) {
        if (!(error instanceof UnreadableRunHistoryError)) throw error;
      }
    }
    return readable;
  }
  override async listChildren(id: string): Promise<RunRecord[]> {
    return Promise.all((await super.listChildren(id)).map((run) => this.project(run)));
  }
  override async listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]> {
    return Promise.all((await super.listByStatus(statuses)).map((run) => this.project(run)));
  }
}
