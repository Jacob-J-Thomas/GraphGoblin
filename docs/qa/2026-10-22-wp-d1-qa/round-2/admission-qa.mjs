import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const parent = new URL('../../../../apps/api/package.json', import.meta.url);
const load = (name) => import(import.meta.resolve(name, parent));
const { admissionContractCases, FakeClock, FakeIds } = await load('@graphgoblin/engine/testing');
const {
  openDatabase,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteLoopRepository,
  SqliteTriggerAdmission,
  SqliteInboundEvents,
} = await load('@graphgoblin/infrastructure/sqlite');
const directories = [],
  calls = [],
  outcomes = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'gg-qa-320-'));
  directories.push(directory);
  const h = openDatabase({
    url: `file:${join(directory, 'graphgoblin.db').replaceAll('\\', '/')}`,
  });
  await h.migrate();
  const events = new SqliteEventStore(h.db, new FakeClock());
  const runs = new SqliteRunRepository(h.db);
  const loops = new SqliteLoopRepository(h.db, new FakeClock(), new FakeIds());
  const inbound = new SqliteInboundEvents(h.db);
  const admission = new SqliteTriggerAdmission(h.db, events);
  const faults = {
    'claim.inbound': 'BEFORE INSERT ON inbound_events',
    'claim.receipt': 'BEFORE INSERT ON webhook_receipts',
    'create.snapshot': 'BEFORE INSERT ON loop_versions',
    'create.run': 'BEFORE INSERT ON runs',
    'create.event': 'BEFORE INSERT ON run_events',
    'create.receipt': 'BEFORE UPDATE ON webhook_receipts',
    'create.link': 'BEFORE UPDATE ON inbound_events',
    'create.parent': "BEFORE INSERT ON run_events WHEN NEW.type = 'child_run.started'",
  };
  return {
    admission: {
      create: async (input, receipt) => {
        const record = {
          ts: new Date().toISOString(),
          runId: input.run.id,
          parentRunId: input.run.parentRunId,
          parentNodeId: input.parentNodeId,
        };
        try {
          const result = await admission.create(input, receipt);
          record.result = 'admitted';
          return result;
        } catch (error) {
          record.result = 'refused';
          record.code = error.code;
          throw error;
        } finally {
          calls.push(record);
        }
      },
      createPollItem: (...a) => admission.createPollItem(...a),
      claim: (...a) => admission.claim(...a),
      get: (...a) => admission.get(...a),
      due: (...a) => admission.due(...a),
      failed: (...a) => admission.failed(...a),
      hasPendingPin: (...a) => admission.hasPendingPin(...a),
    },
    run: (id) => runs.get(id),
    thread: (id) => runs.getInitialThread(id),
    events: (id) => events.read(id),
    version: (id) => loops.getVersion(id),
    inbound: (id) => inbound.get(id),
    subscribe: (id, cb) => events.subscribe(id, cb),
    async failAt(write) {
      await h.client.execute('DROP TRIGGER IF EXISTS fail_admission');
      if (write)
        await h.client.execute(
          `CREATE TRIGGER fail_admission ${faults[write]} BEGIN SELECT RAISE(ABORT,'QA deliberate admission failure'); END`,
        );
    },
    async preserveInbound(input) {
      await h.client.execute({
        sql: "INSERT INTO webhook_endpoints (id,owner_id,loop_id,version_id,trigger_node_id,token,auth_type,enabled,created_at) VALUES (?,?,?,'historical',?,'synthetic', 'none',0,?)",
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
    close: () => h.close(),
  };
}
try {
  for (const c of admissionContractCases(fixture)) {
    const offset = calls.length;
    try {
      await c.run();
      outcomes.push({ name: c.name, pass: true, calls: calls.slice(offset) });
      console.log(`${new Date().toISOString()} PASS ${c.name}`);
    } catch (error) {
      outcomes.push({
        name: c.name,
        pass: false,
        error: error.message,
        calls: calls.slice(offset),
      });
      process.exitCode = 1;
    }
  }
} finally {
  for (const directory of directories) {
    const absolute = resolve(directory);
    assert.ok(
      absolute.startsWith(resolve(tmpdir()) + sep) &&
        absolute.split(sep).at(-1).startsWith('gg-qa-320-'),
    );
    try {
      await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      outcomes.push({ cleanup: absolute.split(sep).at(-1), removed: false, code: error.code });
      process.exitCode = 1;
    }
  }
  await writeFile(
    fileURLToPath(new URL('admission-results.json', import.meta.url)),
    JSON.stringify(outcomes, null, 2) + '\n',
  );
}
