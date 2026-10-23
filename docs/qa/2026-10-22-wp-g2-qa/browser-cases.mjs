import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { expect } = createRequire(resolve('apps/web/package.json'))('@playwright/test');
export async function run(h) {
  const {
    page,
    check,
    api,
    tool,
    sql,
    update,
    seed,
    inbound,
    runs,
    base,
    count,
    snap,
    start,
    stop,
  } = h;
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await check(
        'recipe-runs-' + theme + '-' + width,
        'Runs active loop/status/parent filters; keyboard Load more; filter reset and reload',
        '100 to105 unique; active filters retained; exhaustion focused without scroll jump; older loop1 and no initial exhaustion; no viewport overflow',
        async () => {
          await page.goto(base + '/app/runs?loop=' + seed.paging + '&status=succeeded&parent=none');
          await count(page, 100);
          const beforeIds = await page.locator('tbody tr td:first-child a').allTextContents(),
            more = page.getByRole('button', { name: 'Load more', exact: true });
          await more.scrollIntoViewIfNeeded();
          await more.focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          await expect(more).toBeFocused();
          const ring = await more.evaluate((e) => ({
              outline: getComputedStyle(e).outlineStyle,
              width: getComputedStyle(e).outlineWidth,
              shadow: getComputedStyle(e).boxShadow,
            })),
            y = await page.evaluate(() => scrollY);
          await page.keyboard.press('Enter');
          await count(page, 105);
          await expect(page.getByText('All runs loaded.', { exact: true })).toBeFocused();
          const delta = (await page.evaluate(() => scrollY)) - y;
          assert.ok(Math.abs(delta) <= 1, 'scroll delta ' + delta);
          const ids = await page.locator('tbody tr td:first-child a').allTextContents();
          assert.equal(new Set(ids).size, 105);
          assert.deepEqual(ids.slice(0, 100), beforeIds);
          await expect(page.getByLabel('Loop', { exact: true })).toHaveValue(seed.paging);
          await expect(page.getByLabel('Status', { exact: true })).toHaveValue('succeeded');
          await expect(page.getByLabel('Parent', { exact: true })).toHaveValue('none');
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            theme: document.documentElement.getAttribute('data-theme'),
          }));
          assert.ok(layout.scrollWidth <= width);
          await snap(page, 'runs-' + theme + '-' + width);
          await page.getByLabel('Loop', { exact: true }).selectOption(seed.old);
          await count(page, 1);
          await expect(page.getByText('All runs loaded.', { exact: true })).toHaveCount(0);
          await page.getByLabel('Loop', { exact: true }).selectOption(seed.paging);
          await expect(page.locator('tbody tr')).not.toHaveCount(1);
          await page.reload();
          await count(page, 100);
          return {
            rows: [100, 105],
            unique: 105,
            scrollDelta: delta,
            ring,
            layout,
            filterReset: 'older1; paging reload100',
          };
        },
      );
      await check(
        'recipe-events-' + theme + '-' + width,
        'Events long index5 preformatted payload; keyboard Load more',
        '100 to105; retain rows/payload/reading position; focus exhaustion; no page overflow',
        async () => {
          await page.goto(base + '/app/events');
          await count(page, 100);
          const payload = page.locator('pre').filter({ hasText: 'Long payload remains visible' });
          await expect(payload).toHaveCount(1);
          const text = await payload.innerText();
          assert.ok(text.length > 2000);
          const first = await page.locator('tbody tr').first().innerText(),
            more = page.getByRole('button', { name: 'Load more', exact: true });
          await more.scrollIntoViewIfNeeded();
          await more.focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          await expect(more).toBeFocused();
          const y = await page.evaluate(() => scrollY),
            position = await payload.evaluate((e) => e.getBoundingClientRect().top);
          await page.keyboard.press('Enter');
          await count(page, 105);
          await expect(page.getByText('All events loaded.', { exact: true })).toBeFocused();
          assert.equal(await payload.innerText(), text);
          assert.equal(await page.locator('tbody tr').first().innerText(), first);
          const delta = (await page.evaluate(() => scrollY)) - y,
            payloadDelta =
              (await payload.evaluate((e) => e.getBoundingClientRect().top)) - position;
          assert.ok(Math.abs(delta) <= 1);
          assert.ok(Math.abs(payloadDelta) <= 1);
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            theme: document.documentElement.getAttribute('data-theme'),
          }));
          assert.ok(layout.scrollWidth <= width);
          await snap(page, 'events-' + theme + '-' + width);
          return {
            rows: [100, 105],
            payloadCharacters: text.length,
            scrollDelta: delta,
            payloadDelta,
            layout,
          };
        },
      );
    }
  }
  await check(
    'recipe-loop-summaries-delete',
    'Loops older succeeded link beyond606 newer runs; no-history control; Delete busy history and Keep',
    'Correct older run link; only empty loop never-run; warning501; Keep preserves loops',
    async () => {
      await page.goto(base + '/app/loops');
      const row = page
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: 'older history', exact: true }) });
      await expect(row.getByRole('link', { name: 'succeeded', exact: true })).toHaveAttribute(
        'href',
        '/app/runs/' + seed.oldRun,
      );
      await expect(
        page
          .getByRole('row')
          .filter({ has: page.getByRole('link', { name: 'no history', exact: true }) }),
      ).toContainText('never run');
      assert.equal(await page.getByText('never run', { exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Delete busy history', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText('all its runs (501)');
      const warning = await page.getByRole('alertdialog').innerText();
      await page.getByRole('button', { name: 'Keep', exact: true }).click();
      assert.equal((await api('/loops')).body.items.length, 4);
      await snap(page, 'loop-summaries');
      return { olderRun: seed.oldRun, neverRunControls: 1, warning, preservedLoops: 4 };
    },
  );
  await check(
    'recipe-native-outage-retry',
    'Reload Events100; stop only QA API; Load more; restart same store; retry',
    '100 rows and long payload retained with failure; retry after restart reaches105 once',
    async () => {
      await page.goto(base + '/app/events');
      await count(page, 100);
      const payload = page.locator('pre').filter({ hasText: 'Long payload remains visible' }),
        text = await payload.innerText();
      await stop();
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      try {
        await expect(page.getByText(/Offline|failed|could not|fetch/i).first()).toBeVisible({
          timeout: 20000,
        });
        await count(page, 100);
        assert.equal(await payload.innerText(), text);
        await snap(page, 'outage');
      } finally {
        await start();
      }
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      await count(page, 105);
      await snap(page, 'outage-recovered');
      return {
        retainedRows: 100,
        retainedPayloadCharacters: text.length,
        recoveredRows: 105,
        nativeRestart: true,
      };
    },
  );
  await check(
    'runs-native-unreadable-page',
    'Damage newest100 of501 busy run rows; real API and Runs Load more; restore',
    'Empty readable page with real cursor; browser continues to100 older readable rows',
    async () => {
      const rows = (
        await sql.execute({
          sql: 'SELECT id,pinned FROM runs WHERE loop_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
          args: [seed.busy],
        })
      ).rows;
      try {
        await sql.batch(
          rows.map((r) => ({
            sql: 'UPDATE runs SET pinned=? WHERE id=?',
            args: ['{invalid', r.id],
          })),
          'write',
        );
        const first = await api('/runs?loopId=' + seed.busy + '&limit=100');
        assert.deepEqual(first.body.items, []);
        assert.ok(first.body.nextCursor);
        await page.goto(base + '/app/runs?loop=' + seed.busy);
        await expect(
          page.getByText('Load more to continue through history.', { exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Load more', exact: true }).click();
        await count(page, 100);
        await snap(page, 'runs-unreadable-continued');
        return { first, continuedReadableRows: 100 };
      } finally {
        await sql.batch(
          rows.map((r) => ({ sql: 'UPDATE runs SET pinned=? WHERE id=?', args: [r.pinned, r.id] })),
          'write',
        );
      }
    },
  );
  await check(
    'events-empty-page-controlled',
    'Intercept only first real Events response and remove items, retaining real cursor; Load more',
    'Empty readable page retains continuation; last5 load; controlled-response evidence',
    async () => {
      let first = true;
      await page.route(base + '/events*', async (route) => {
        const r = await route.fetch(),
          body = await r.json();
        if (first) {
          first = false;
          body.items = [];
        }
        await route.fulfill({ response: r, json: body });
      });
      try {
        await page.goto(base + '/app/events');
        await expect(
          page.getByText('Load more to continue through history.', { exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Load more', exact: true }).click();
        await count(page, 5);
        await expect(page.getByText('All events loaded.', { exact: true })).toBeVisible();
        return { tier: 'controlled HTTP response; real cursor and second page', finalRows: 5 };
      } finally {
        await page.unroute(base + '/events*');
      }
    },
  );
  await check(
    'events-corrupt-page-repair',
    'Damage inbound row101 payload; real Events Load more; repair and retry',
    'First100 stay readable; requested corruption fails500 without skipping; repair retry reaches105',
    async () => {
      await update('inbound_events', 'payload', '{invalid', inbound[100].id);
      try {
        await page.goto(base + '/app/events');
        await count(page, 100);
        await page.getByRole('button', { name: 'Load more', exact: true }).click();
        await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
        await count(page, 100);
        await snap(page, 'events-corrupt-page');
      } finally {
        await update('inbound_events', 'payload', inbound[100].payload, inbound[100].id);
      }
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      await count(page, 105);
      return {
        requestedCorruption: '500 INTERNAL_ERROR; retained100; no skip',
        repairRetryRows: 105,
      };
    },
  );
  await check(
    'invalid-query-problems',
    'Invalid run status; malformed/empty cursors; bad limits, unknown filters, invalid before',
    'Typed400 application/problem+json errors',
    async () => {
      const paths = [
          '/runs?status=unknown',
          '/runs?cursor=!',
          '/runs?cursor=',
          '/runs?limit=0',
          '/runs?unknown=1',
          '/events?cursor=!',
          '/events?cursor=',
          '/events?limit=501',
          '/events?before=bad',
        ],
        results = [];
      for (const path of paths) {
        const r = await api(path);
        assert.equal(r.status, 400, path);
        assert.match(r.contentType, /problem\+json/);
        assert.ok(['INVALID_CURSOR', 'VALIDATION_FAILED'].includes(r.body.code));
        results.push({ path, ...r });
      }
      return results;
    },
  );
  await check(
    'tied-runs-filtered-continuation',
    'Give105 paging runs tied createdAt; limit-one loop/status/parent/before paging; compare MCP; summary tie break; restore',
    '105 unique descending IDs; no duplicates/skips; null exhaustion; MCP cursor and loop latest agree',
    async () => {
      await sql.execute({
        sql: 'UPDATE runs SET created_at=? WHERE loop_id=?',
        args: ['2026-10-01T12:00:00.000Z', seed.paging],
      });
      try {
        const seen = [];
        let cursor, firstCursor;
        do {
          const r = await api(
            '/runs?loopId=' +
              seed.paging +
              '&status=succeeded&parent=none&before=2099-01-01T00:00:00.000Z&limit=1' +
              (cursor ? '&cursor=' + cursor : ''),
          );
          assert.equal(r.status, 200);
          seen.push(...r.body.items.map((x) => x.id));
          cursor = r.body.nextCursor;
          if (!firstCursor) firstCursor = cursor;
          assert.ok(seen.length <= 105);
        } while (cursor);
        assert.deepEqual(
          seen,
          runs
            .map((r) => r.id)
            .sort()
            .reverse(),
        );
        assert.equal(new Set(seen).size, 105);
        const m = await tool('list_runs', {
          loopId: seed.paging,
          status: ['succeeded'],
          parentRunId: 'none',
          limit: 1,
        });
        assert.equal(m.body.nextCursor, firstCursor);
        const summary = (await api('/loops')).body.items.find((x) => x.id === seed.paging);
        assert.equal(summary.latestRun.id, seen[0]);
        return {
          seen,
          count: seen.length,
          unique: new Set(seen).size,
          exhaustedCursor: cursor,
          mcpCursor: m.body.nextCursor,
          summaryLatest: summary.latestRun,
        };
      } finally {
        await sql.batch(
          runs.map((r) => ({
            sql: 'UPDATE runs SET created_at=? WHERE id=?',
            args: [r.created_at, r.id],
          })),
          'write',
        );
      }
    },
  );
  await check(
    'tied-events-filtered-continuation',
    'Give105 inbound events tied timestamp; limit-one type/before paging; restore',
    '105 unique descending IDs, opaque continuation, null exhaustion',
    async () => {
      await sql.execute("UPDATE inbound_events SET received_at='2026-10-01T12:00:00.000Z'");
      try {
        const seen = [];
        let cursor;
        do {
          const r = await api(
            '/events?type=paging-events&before=2099-01-01T00:00:00.000Z&limit=1' +
              (cursor ? '&cursor=' + cursor : ''),
          );
          assert.equal(r.status, 200);
          seen.push(...r.body.items.map((x) => x.id));
          cursor = r.body.nextCursor;
          assert.ok(seen.length <= 105);
        } while (cursor);
        assert.deepEqual(
          seen,
          inbound
            .map((r) => r.id)
            .sort()
            .reverse(),
        );
        return { seen, count: seen.length, unique: new Set(seen).size, exhaustedCursor: cursor };
      } finally {
        await sql.batch(
          inbound.map((r) => ({
            sql: 'UPDATE inbound_events SET received_at=? WHERE id=?',
            args: [r.received_at, r.id],
          })),
          'write',
        );
      }
    },
  );
}
