import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { expect } = createRequire(resolve('apps/web/package.json'))('@playwright/test');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Independent external-storage fault construction. No implementer fixture is imported.
export async function run({ page, check, api, sql, base, snap, start, stop }) {
  const post = (path, body) =>
    api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const schema = (await api('/openapi.json')).body.components.schemas.LoopDefinitionInput.properties
    .schemaVersion.const;
  async function loop(name) {
    const response = await post('/loops', {
      definition: {
        schemaVersion: schema,
        name,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [{ id: 'edge', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      },
    });
    assert.equal(response.status, 201);
    const id = response.body.loop.id;
    assert.equal((await post('/loops/' + id + '/publish', {})).status, 200);
    return id;
  }
  async function run(loopId, terminal = true) {
    const response = await post('/loops/' + loopId + '/runs', {});
    assert.equal(response.status, 202);
    const id = response.body.run.id;
    if (terminal) {
      for (let n = 0; n < 120; n++) {
        const r = await api('/runs/' + id);
        if (r.status === 200 && r.body.status === 'succeeded') return id;
        await delay(250);
      }
      throw Error('Healthy run did not finish');
    }
    return id;
  }
  async function summary(loopId, count, latest) {
    const result = await api('/loops');
    assert.equal(result.status, 200);
    const row = result.body.items.find((r) => r.id === loopId);
    assert.equal(row.runCount, count);
    if (latest === null) assert.equal(row.latestRun, null);
    else {
      assert.equal(row.latestRun.id, latest);
      assert.equal(row.latestRun.status, 'succeeded');
    }
    const rawCount = (
      await sql.execute({ sql: 'SELECT count(*) AS n FROM runs WHERE loop_id=?', args: [loopId] })
    ).rows[0].n;
    assert.equal(rawCount, count);
    return { id: row.id, runCount: row.runCount, rawCount, latestRun: row.latestRun };
  }
  const rowFor = (name) =>
    page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  async function badge(name, latest) {
    const row = rowFor(name);
    await expect(row.getByRole('link', { name: 'succeeded', exact: true })).toHaveAttribute(
      'href',
      '/app/runs/' + latest,
    );
    await expect(row).not.toContainText('latest run unavailable');
    await expect(row).not.toContainText('running');
    return row.innerText();
  }
  async function diagnostic(id) {
    let cursor;
    do {
      const result = await api(
        '/runs/diagnostics' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      );
      assert.equal(result.status, 200);
      const found = result.body.items.find((r) => r.runId === id);
      if (found) return found;
      cursor = result.body.nextCursor;
    } while (cursor);
    throw Error('Damaged row missing from diagnostics: ' + id);
  }

  const healthyName = 'QA round2 healthy latest';
  const healthyLoop = await loop(healthyName);
  const healthyOlder = await run(healthyLoop);
  const healthyLatest = await run(healthyLoop);
  await check(
    'r5-healthy-latest',
    'Create two healthy completed runs via built API; query summary and Edge Loops row',
    'Exact count2; latest succeeded badge links to newest run',
    async () => {
      const result = await summary(healthyLoop, 2, healthyLatest);
      await page.goto(base + '/app/loops');
      const text = await badge(healthyName, healthyLatest);
      await snap(page, 'r5-healthy-latest');
      return { ...result, olderId: healthyOlder, rowText: text };
    },
  );
  await check(
    'r5-damaged-older',
    'Damage only older pinned JSON; restart built API on same SQLite; inspect summary, inspector, diagnostics and Edge',
    'Newest succeeded badge unchanged; count2 exact; older inspector500 STORED_RUN_INVALID and diagnostics identity',
    async () => {
      await sql.execute({ sql: 'UPDATE runs SET pinned=? WHERE id=?', args: ['{}', healthyOlder] });
      await stop();
      await start();
      const result = await summary(healthyLoop, 2, healthyLatest);
      const inspector = await api('/runs/' + healthyOlder);
      assert.equal(inspector.status, 500);
      assert.equal(inspector.body.code, 'STORED_RUN_INVALID');
      const damaged = await diagnostic(healthyOlder);
      await page.goto(base + '/app/loops');
      const text = await badge(healthyName, healthyLatest);
      await snap(page, 'r5-damaged-older');
      return { ...result, inspector, diagnostic: damaged, rowText: text };
    },
  );

  for (const [label, bad] of [
    ['schema', '{}'],
    ['json', '{invalid'],
  ]) {
    const name = 'QA round2 stale latest ' + label;
    const loopId = await loop(name);
    const older = await run(loopId);
    const trigger = 'qa_block_terminal_' + label;
    await check(
      'r5-stale-latest-' + label,
      'Create older succeeded run; install BEFORE terminal-status UPDATE trigger that damages pinned and RAISE(IGNORE); start newest run; observe durable succeeded run.finished and stale running; stop/start native API; inspect API/Edge/diagnostics',
      'Durable success remains; newest unreadable row is not summarized as running or replaced by older run; latestRun null; exact count2; inspector typed500; UI unavailable plus diagnostic guidance',
      async () => {
        // Trigger is restricted to this independently created loop. The event append precedes
        // the snapshot transition; ignoring that transition leaves a real stale status column.
        await sql.execute(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF status ON runs
          WHEN NEW.loop_id='${loopId}' AND NEW.status='succeeded'
          BEGIN UPDATE runs SET pinned='${bad}' WHERE id=NEW.id; SELECT RAISE(IGNORE); END`);
        let latest;
        try {
          latest = await run(loopId, false);
          let raw, terminal;
          for (let n = 0; n < 120; n++) {
            raw = (
              await sql.execute({
                sql: 'SELECT id,status,pinned FROM runs WHERE id=?',
                args: [latest],
              })
            ).rows[0];
            terminal = (
              await sql.execute({
                sql: "SELECT seq,payload FROM run_events WHERE run_id=? AND type='run.finished'",
                args: [latest],
              })
            ).rows[0];
            if (terminal && raw.status === 'running' && raw.pinned === bad) break;
            await delay(250);
          }
          assert.equal(raw.status, 'running');
          assert.equal(raw.pinned, bad);
          assert.equal(JSON.parse(terminal.payload).status, 'succeeded');
          const before = await summary(loopId, 2, null);
          await stop();
          await start();
          const after = await summary(loopId, 2, null);
          const postRestartRaw = (
            await sql.execute({
              sql: 'SELECT id,status,pinned FROM runs WHERE id=?',
              args: [latest],
            })
          ).rows[0];
          assert.deepEqual(postRestartRaw, raw);
          const postTerminal = (
            await sql.execute({
              sql: "SELECT seq,payload FROM run_events WHERE run_id=? AND type='run.finished'",
              args: [latest],
            })
          ).rows[0];
          assert.deepEqual(postTerminal, terminal);
          const inspector = await api('/runs/' + latest);
          assert.equal(inspector.status, 500);
          assert.equal(inspector.body.code, 'STORED_RUN_INVALID');
          const damaged = await diagnostic(latest);
          await page.goto(base + '/app/loops');
          const row = rowFor(name);
          await expect(row).toContainText('latest run unavailable');
          await expect(row).toContainText('Check run history diagnostics.');
          await expect(row).not.toContainText('running');
          await expect(row).not.toContainText('never run');
          assert.equal(await row.locator(`a[href='/app/runs/${older}']`).count(), 0);
          assert.equal(await row.locator(`a[href='/app/runs/${latest}']`).count(), 0);
          await badge(healthyName, healthyLatest);
          const rowText = await row.innerText();
          await snap(page, 'r5-stale-latest-' + label);
          await page.goto(base + '/app/runs/' + latest);
          await expect(page.getByText(/STORED_RUN_INVALID/).first()).toBeVisible();
          await snap(page, 'r5-inspector-' + label);
          return {
            loopId,
            older,
            latest,
            trigger,
            raw,
            terminal: { seq: terminal.seq, payload: JSON.parse(terminal.payload) },
            before,
            after,
            postRestartRaw,
            inspector,
            diagnostic: damaged,
            rowText,
            olderFallbackLinks: 0,
          };
        } finally {
          await sql.execute('DROP TRIGGER IF EXISTS ' + trigger);
        }
      },
    );
  }
}
