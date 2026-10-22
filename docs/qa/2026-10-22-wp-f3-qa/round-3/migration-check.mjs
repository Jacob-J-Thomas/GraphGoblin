import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { openDatabase } from '../../../../packages/infrastructure/dist/sqlite/index.js';
import {
  assert,
  api,
  raw,
  state,
  create,
  startRun,
  waitDefinition,
  newStore,
  launch,
  stop,
  removeStore,
  report,
} from './qa-lib.mjs';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url)),
  { chromium, expect } = require('@playwright/test');
const r = report('migration'),
  data = await newStore('migration'),
  copy = await newStore('damaged');
let server, before, ids, firstApplied;
function immediate(name, settings) {
  const d = waitDefinition(name, settings);
  d.nodes.splice(1, 1);
  d.edges = [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }];
  return d;
}
try {
  server = await launch(data, 'base');
  await r.check(
    'actual built F4 store: omitted/finite finished, paused input and pending admission',
    async () => {
      const omitted = await startRun(await create(immediate('QA F4 omitted'))),
        finite = await startRun(await create(immediate('QA F4 visits 4', { maxNodeVisits: 4 })));
      await state(omitted.id, 'succeeded');
      await state(finite.id, 'succeeded');
      const paused = await startRun(
        await create(waitDefinition('QA F4 paused', { maxNodeVisits: 4 })),
      );
      await state(paused.id, 'waiting');
      await api('POST', `/runs/${paused.id}/pause`, {});
      const seed = await api('POST', '/qa/seed-admission', { templateRunId: omitted.id });
      ids = { omitted: omitted.id, finite: finite.id, paused: paused.id, ...seed };
      before = await api('GET', '/qa/store');
      assert.equal(before.migrations.length, 15);
      assert(before.runs.every((x) => JSON.parse(x.pinned).limits === undefined));
      assert.equal(before.runs.find((x) => x.id === seed.queuedRunId).status, 'queued');
      assert.equal(before.receipts[0].status, 'pending');
      return { source: 'read-only built F4 31f485e3', ids, before };
    },
  );
  r.data.lifecycle.push(await stop(server));
  server = undefined;
  await cp(data, copy, { recursive: true });
  const db = openDatabase({ url: 'file:' + join(copy, 'graphgoblin.db').replaceAll('\\', '/') });
  try {
    await db.client.execute({
      sql: 'UPDATE runs SET pinned=? WHERE id=?',
      args: ['{damaged-qa', ids.finite],
    });
  } finally {
    db.close();
  }
  server = await launch(data);
  await r.check(
    '0015 migrates every old run, queued event, and both saved intent pins',
    async () => {
      const store = await api('GET', '/qa/store');
      assert.equal(store.migrations.length, 16);
      for (const old of before.runs) {
        const expected = {
          maxNodeVisits: [ids.finite, ids.paused].includes(old.id) ? 4 : 10,
          runDeadlineSeconds: null,
        };
        assert.deepEqual(
          JSON.parse(store.runs.find((x) => x.id === old.id).pinned).limits,
          expected,
        );
        assert.deepEqual(
          JSON.parse(store.queued.find((x) => x.run_id === old.id).payload).pinned.limits,
          expected,
        );
      }
      const intent = JSON.parse(store.receipts.find((x) => x.id === ids.receiptId).intent);
      assert.deepEqual(intent.run.pinned.limits, { maxNodeVisits: 10, runDeadlineSeconds: null });
      assert.deepEqual(intent.queued.pinned.limits, intent.run.pinned.limits);
      return {
        oldRunCount: before.runs.length,
        migrationCount: store.migrations.length,
        pins: store.runs.map((x) => ({ id: x.id, limits: JSON.parse(x.pinned).limits })),
        savedRun: intent.run.pinned.limits,
        savedQueued: intent.queued.pinned.limits,
      };
    },
  );
  await r.check('queued and saved inbound work recover once', async () => {
    await state(ids.queuedRunId, 'succeeded');
    await state(ids.savedRunId, 'succeeded');
    const store = await api('GET', '/qa/store');
    assert.equal(store.runs.length, before.runs.length + 1);
    assert.equal(store.receipts[0].status, 'admitted');
    return {
      runCount: store.runs.length,
      inbound: store.inbound,
      receiptStatus: store.receipts[0].status,
    };
  });
  await r.check('migrated paused input run resumes and finishes', async () => {
    await state(ids.paused, 'paused');
    await api('POST', `/runs/${ids.paused}/resume`, {});
    const w = await state(ids.paused, 'waiting');
    await api('POST', `/runs/${ids.paused}/input`, { waitId: w.waiting.waitId, input: true });
    const done = await state(ids.paused, 'succeeded');
    assert.deepEqual(done.pinned.limits, { maxNodeVisits: 4, runDeadlineSeconds: null });
    return { result: done.result, pin: done.pinned.limits };
  });
  await r.check('Edge shows actual migrated pins at 390px', async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true }),
      observed = [];
    try {
      for (const [id, n] of [
        [ids.omitted, 10],
        [ids.finite, 4],
      ]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto('http://127.0.0.1:5905/app/runs/' + id);
        const card = `Maximum node visits: ${n}. Run deadline: none.`;
        await expect(page.getByText(card)).toBeVisible();
        observed.push({ id, card });
        await page.close();
      }
    } finally {
      await browser.close();
    }
    return observed;
  });
  firstApplied = await api('GET', '/qa/store');
  r.data.lifecycle.push(await stop(server));
  server = undefined;
  server = await launch(data);
  await r.check('second candidate startup is idempotent', async () => {
    const second = await api('GET', '/qa/store');
    for (const key of ['migrations', 'runs', 'queued', 'receipts'])
      assert.deepEqual(second[key], firstApplied[key]);
    return { migrationCount: second.migrations.length, rowsUnchanged: true };
  });
  r.data.lifecycle.push(await stop(server));
  server = undefined;
  server = await launch(copy);
  await r.check(
    'damaged original pin is untouched and diagnosed; healthy pins migrate',
    async () => {
      const store = await api('GET', '/qa/store');
      assert.equal(store.runs.find((x) => x.id === ids.finite).pinned, '{damaged-qa');
      const healthy = JSON.parse(store.runs.find((x) => x.id === ids.omitted).pinned).limits;
      assert.deepEqual(healthy, { maxNodeVisits: 10, runDeadlineSeconds: null });
      const diagnostic = await raw('GET', '/runs/' + ids.finite);
      assert.equal(diagnostic.body.code, 'STORED_RUN_INVALID');
      return { damagedBytes: '{damaged-qa', healthy, diagnostic };
    },
  );
} finally {
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = [await removeStore(data, true), await removeStore(copy, true)];
  await r.finish();
}
