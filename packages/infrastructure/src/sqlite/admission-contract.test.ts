import { describe, it } from 'vitest';
import {
  admissionContractCases,
  FakeClock,
  type AdmissionContractFixture,
  type AdmissionWrite,
} from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openMemoryDatabase } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteInboundEvents } from './triggers.js';

/** SQLite supplies only storage/fault injection; all conformance assertions live in engine/testing. */
export async function createSqliteAdmissionFixture(): Promise<AdmissionContractFixture> {
  const handle = await openMemoryDatabase();
  const events = new SqliteEventStore(handle.db, new FakeClock());
  const runs = new SqliteRunRepository(handle.db);
  const inbound = new SqliteInboundEvents(handle.db);
  const faults: Record<AdmissionWrite, string> = {
    'claim.inbound': 'BEFORE INSERT ON inbound_events',
    'claim.receipt': 'BEFORE INSERT ON webhook_receipts',
    'create.run': 'BEFORE INSERT ON runs',
    'create.event': 'BEFORE INSERT ON run_events',
    'create.receipt': 'BEFORE UPDATE ON webhook_receipts',
    'create.link': 'BEFORE UPDATE ON inbound_events',
  };
  return {
    admission: new SqliteTriggerAdmission(handle.db, events),
    run: (id) => runs.get(id),
    thread: (id) => runs.getInitialThread(id),
    events: (id) => events.read(id),
    inbound: (id) => inbound.get(id),
    subscribe: (id, listener) => events.subscribe(id, listener),
    async failAt(write) {
      await handle.client.execute('DROP TRIGGER IF EXISTS fail_admission');
      if (write)
        await handle.client.execute(
          `CREATE TRIGGER fail_admission ${faults[write]} BEGIN SELECT RAISE(ABORT,'injected admission write failure'); END`,
        );
    },
    close: () => handle.close(),
  };
}

describe('SQLite admission contract', () => {
  it.each(admissionContractCases(createSqliteAdmissionFixture))('$name', async (test) => {
    await test.run();
  });
});
