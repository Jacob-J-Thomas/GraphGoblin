// Real libSQL component supplement; actual F4 startup is tested separately.
import {
  openMemoryDatabase,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteEventStore,
  SqliteTriggerAdmission,
} from '../../../../packages/infrastructure/dist/sqlite/index.js';
import { LoopDefinitionSchema } from '../../../../packages/contracts/dist/index.js';
import {
  fakeUlid,
  minimalLoop,
  FIXTURE_TS,
} from '../../../../packages/contracts/dist/testing/index.js';
import { FakeClock, FakeIds } from '../../../../packages/engine/dist/testing/index.js';
import { createInitialThread } from '../../../../packages/engine/dist/index.js';
import { readFile } from 'node:fs/promises';
import { assert, report } from './qa-lib.mjs';
const r = report('migration-supplement'),
  h = await openMemoryDatabase(),
  clock = new FakeClock(),
  loops = new SqliteLoopRepository(h.db, clock, new FakeIds()),
  runs = new SqliteRunRepository(h.db),
  events = new SqliteEventStore(h.db, clock),
  admission = new SqliteTriggerAdmission(h.db, events);
const sql = await readFile(
  new URL(
    '../../../../packages/infrastructure/drizzle/0015_run_execution_limits.sql',
    import.meta.url,
  ),
  'utf8',
);
const apply = async () => {
  for (const s of sql.split('--> statement-breakpoint')) await h.client.execute(s);
};
try {
  for (const [label, value] of [
    ['omitted', undefined],
    ['finite', 4],
    ['unlimited', null],
  ])
    await r.check('SQL matrix ' + label, async () => {
      const def = LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'QA SQL ' + label });
      if (value !== undefined) def.settings.maxNodeVisits = value;
      const { draft } = await loops.create('local', def);
      const raw = structuredClone(def);
      delete raw.settings.runDeadlineSeconds;
      if (value === undefined) delete raw.settings.maxNodeVisits;
      await h.client.execute({
        sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
        args: [JSON.stringify(raw), draft.id],
      });
      const expected = {
          maxNodeVisits: value === undefined ? 10 : value,
          runDeadlineSeconds: null,
        },
        pin = {
          source: 'draft',
          version: draft.version,
          name: def.name,
          label: def.name + ' draft v1',
          defaults: { owner: { byHarness: {} }, process: { byHarness: {} } },
          classifiers: {},
          limits: expected,
        };
      const snapshot = {
        ...draft,
        id: fakeUlid('r3-snapshot-' + label),
        status: 'snapshot',
        definition: raw,
      };
      const run = {
        id: fakeUlid('r3-' + label),
        ownerId: 'local',
        loopId: draft.loopId,
        versionId: snapshot.id,
        pinned: pin,
        invocationId: fakeUlid('r3-inv-' + label),
        status: 'queued',
        iteration: 1,
        createdAt: FIXTURE_TS,
        lastEventSeq: 0,
      };
      const thread = createInitialThread({
        runId: run.id,
        loopId: run.loopId,
        versionId: run.versionId,
        invocation: {
          id: run.invocationId,
          source: 'manual.api',
          trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
        },
      });
      await admission.create({
        snapshot,
        run,
        initialThread: thread,
        pinnedLoopIds: [run.loopId],
        queued: {
          type: 'run.queued',
          versionId: run.versionId,
          pinned: pin,
          initialThread: thread,
        },
      });
      const oldPin = structuredClone(pin);
      delete oldPin.limits;
      const savedIntent = {
        run: { ...run, pinned: oldPin },
        initialThread: thread,
        pinnedLoopIds: [run.loopId],
        queued: {
          type: 'run.queued',
          versionId: run.versionId,
          pinned: oldPin,
          initialThread: thread,
        },
        snapshot,
      };
      const receiptId = fakeUlid('r3-receipt-' + label);
      await h.client.execute({
        sql: "INSERT INTO webhook_receipts (id,owner_id,loop_id,trigger_node_id,content_hash,inbound_id,status,intent,attempts) VALUES (?,'local',?,'start',?,?,'pending',?,0)",
        args: [
          receiptId,
          run.loopId,
          label.padEnd(64, '0'),
          fakeUlid('r3-inbound-' + label),
          JSON.stringify(savedIntent),
        ],
      });
      await h.client.execute({
        sql: "UPDATE runs SET pinned=json_remove(pinned,'$.limits') WHERE id=?",
        args: [run.id],
      });
      await h.client.execute({
        sql: "UPDATE run_events SET payload=json_remove(payload,'$.pinned.limits') WHERE run_id=?",
        args: [run.id],
      });
      await apply();
      await apply();
      assert.deepEqual((await runs.get(run.id)).pinned.limits, expected);
      assert.deepEqual((await events.read(run.id))[0].pinned.limits, expected);
      const readIntent = async () =>
        JSON.parse(
          (
            await h.client.execute({
              sql: 'SELECT intent FROM webhook_receipts WHERE id=?',
              args: [receiptId],
            })
          ).rows[0].intent,
        );
      const migrated = await readIntent();
      assert.deepEqual(migrated.run.pinned.limits, expected);
      assert.deepEqual(migrated.queued.pinned.limits, expected);
      await h.client.execute({
        sql: 'UPDATE runs SET pinned=? WHERE id=?',
        args: ['{broken', run.id],
      });
      await h.client.execute({
        sql: 'UPDATE webhook_receipts SET intent=? WHERE id=?',
        args: ['{broken', receiptId],
      });
      await h.client.execute({
        sql: 'UPDATE run_events SET payload=? WHERE run_id=?',
        args: ['{broken', run.id],
      });
      await apply();
      assert.equal(
        (await h.client.execute({ sql: 'SELECT pinned FROM runs WHERE id=?', args: [run.id] }))
          .rows[0].pinned,
        '{broken',
      );
      assert.equal(
        (
          await h.client.execute({
            sql: 'SELECT intent FROM webhook_receipts WHERE id=?',
            args: [receiptId],
          })
        ).rows[0].intent,
        '{broken',
      );
      assert.equal(
        (
          await h.client.execute({
            sql: 'SELECT payload FROM run_events WHERE run_id=?',
            args: [run.id],
          })
        ).rows[0].payload,
        '{broken',
      );
      return {
        expected,
        savedRun: migrated.run.pinned.limits,
        savedQueued: migrated.queued.pinned.limits,
        idempotent: true,
        damagedRunEventAndIntentBytes: '{broken',
      };
    });
} finally {
  h.close();
  await r.finish();
}
