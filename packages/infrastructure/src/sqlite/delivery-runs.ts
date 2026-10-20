import type { RunRecord, RunStatus } from '@graphgoblin/contracts';
import { RunEventSchema } from '@graphgoblin/contracts';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { asc, inArray, and, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { SqliteRunRepository, type RunListFilter, type RunPageFilter } from './runs.js';
import { runEvents } from './schema.js';

/** Derive delivery snapshots from their journal; there is no second, fallible status write. */
export class SqliteDeliveryRunRepository extends SqliteRunRepository {
  constructor(private readonly deliveryDb: Database) {
    super(deliveryDb);
  }

  private async project(records: RunRecord[], skipUnreadable = false): Promise<RunRecord[]> {
    if (!records.length) return [];
    const rows = await this.deliveryDb
      .select({
        payload: sql<string>`${runEvents.payload}`,
        runId: sql<string>`${runEvents.runId}`,
        seq: sql<number>`${runEvents.seq}`,
        ts: sql<string>`${runEvents.ts}`,
        type: sql<string>`${runEvents.type}`,
      })
      // Otherwise ORDER BY seq can make SQLite prefer a scan of the run's primary key.
      .from(sql`${runEvents} INDEXED BY run_events_delivery_idx`)
      .where(
        and(
          inArray(
            runEvents.runId,
            records.map((run) => run.id),
          ),
          inArray(runEvents.type, [
            'delivery.queued',
            'delivery.attempted',
            'delivery.attempt_finished',
            'delivery.finished',
          ]),
        ),
      )
      .orderBy(asc(runEvents.seq));
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = grouped.get(row.runId) ?? [];
      group.push(row);
      grouped.set(row.runId, group);
    }
    const projected: RunRecord[] = [];
    for (const run of records) {
      try {
        projected.push(this.decode(run, grouped.get(run.id) ?? []));
      } catch (error) {
        if (!skipUnreadable || !(error instanceof UnreadableRunHistoryError)) throw error;
      }
    }
    return projected;
  }

  private decode(
    run: RunRecord,
    rows: { payload: string; runId: string; seq: number; ts: string; type: string }[],
  ): RunRecord {
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
    return run ? (await this.project([run]))[0] : undefined;
  }
  override async list(filter: RunListFilter = {}): Promise<RunRecord[]> {
    return this.project(await super.list(filter), true);
  }
  override async page(filter: RunPageFilter) {
    const page = await super.page(filter);
    return { ...page, items: await this.project(page.items, true) };
  }
  override async listChildren(id: string): Promise<RunRecord[]> {
    return this.project(await super.listChildren(id));
  }
  override async listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]> {
    return this.project(await super.listByStatus(statuses));
  }
}
