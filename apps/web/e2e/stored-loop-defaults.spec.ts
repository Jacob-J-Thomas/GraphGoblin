import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createTestApp, storeLoopBefore } from '@graphgoblin/api/testing';
import { approvalLoop, expect, showLoopPanel, test } from './fixtures.js';

for (const status of ['draft', 'published'] as const) {
  test(`editor reopens stored ${status} with omitted additive deadline defaults`, async ({
    page,
  }) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-editor-'));
    // A genuine store from before 0019; the gateway's startup applies 0019 and every later one.
    const stored = await storeLoopBefore({
      dataDir,
      tag: '0019_completion_deadline_defaults',
      definition: approvalLoop(`Stored ${status}`),
      publish: status === 'published',
      remove: ['$.settings.structuredTimeoutMs', '$.settings.runDeadlineSeconds'],
    });
    const t = await createTestApp({
      env: { GG_DATA_DIR: dataDir, GG_DB_URL: stored.url, GG_WEB_DIST: resolve('dist') },
    });
    try {
      expect(await t.container.handle.pendingMigrations()).toBe(0);
      const url = await t.app.listen({ host: '127.0.0.1', port: 0 });
      const loop = { id: stored.loopId };
      await page.goto(`${url}/app/loops/${loop.id}/edit`);
      await expect(
        page.getByRole('heading', { name: `Stored ${status}`, exact: true }),
      ).toBeVisible();
      await showLoopPanel(page);
      await expect(
        page.getByRole('combobox', { name: 'Structured completion milliseconds mode' }),
      ).toHaveValue('unlimited');
      await expect(page.getByRole('combobox', { name: 'Run deadline seconds mode' })).toHaveValue(
        'unlimited',
      );
      await expect(page.getByText('Could not load loop', { exact: true })).toBeHidden();
      process.stdout.write(
        JSON.stringify({
          status,
          opened: true,
          structuredTimeoutMs: null,
          runDeadlineSeconds: null,
        }) + '\n',
      );
    } finally {
      await t.close();
      await rm(dataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
    }
  });
}
