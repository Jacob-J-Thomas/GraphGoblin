import { describe, it } from 'vitest';
import {
  admissionContractCases,
  FakeClock,
  FakeIds,
  type AdmissionContractFixture,
  type AdmissionWrite,
} from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openMemoryDatabase } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteInboundEvents } from './triggers.js';

/** SQLite supplies only storage/fault injection; all conformance assertions live in engine/testing. */
export async function createSqliteAdmissionFixture(): Promise<AdmissionContractFixture> {
  const handle = await openMemoryDatabase();
  const events = new SqliteEventStore(handle.db, new FakeClock());
  const runs = new SqliteRunRepository(handle.db);
  const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  const inbound = new SqliteInboundEvents(handle.db);
  const faults: Record<AdmissionWrite, string> = {
    'claim.inbound': 'BEFORE INSERT ON inbound_events',
    'claim.receipt': 'BEFORE INSERT ON webhook_receipts',
    'create.snapshot': 'BEFORE INSERT ON loop_versions',
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
    version: (id) => loops.getVersion(id),
    inbound: (id) => inbound.get(id),
    subscribe: (id, listener) => events.subscribe(id, listener),
    async failAt(write) {
      await handle.client.execute('DROP TRIGGER IF EXISTS fail_admission');
      if (write)
        await handle.client.execute(
          `CREATE TRIGGER fail_admission ${faults[write]} BEGIN SELECT RAISE(ABORT,'injected admission write failure'); END`,
        );
    },
    async preserveInbound(input) {
      await handle.client.execute({
        sql: "INSERT INTO webhook_endpoints (id,owner_id,loop_id,version_id,trigger_node_id,token,auth_type,enabled,created_at) VALUES (?,?,?,'historical',?,'old-token','none',0,?)",
        args: [
          input.inbound.source.slice('webhook:'.length),
          input.ownerId,
          input.loopId,
          input.triggerNodeId,
          input.inbound.receivedAt,
        ],
      });
      await inbound.insert(input.inbound);
    },
    close: () => handle.close(),
  };
}

describe('SQLite admission contract', () => {
  it.each(admissionContractCases(createSqliteAdmissionFixture))('$name', async (test) => {
    await test.run();
  });
});
