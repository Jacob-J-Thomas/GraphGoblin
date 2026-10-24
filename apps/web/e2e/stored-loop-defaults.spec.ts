import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createTestApp } from '@graphgoblin/api/testing';
import { approvalLoop, expect, showLoopPanel, test } from './fixtures.js';

for (const status of ['draft', 'published'] as const) {
  test(`editor reopens stored ${status} with omitted additive deadline defaults`, async ({
    page,
  }) => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-editor-'));
    const t = await createTestApp({ env: { GG_DATA_DIR: dataDir, GG_WEB_DIST: resolve('dist') } });
    try {
      const url = await t.app.listen({ host: '127.0.0.1', port: 0 });
      const response = await t.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition: approvalLoop(`Stored ${status}`) },
      });
      const { loop, draft } = response.json<{ loop: { id: string }; draft: { id: string } }>();
      expect(response.statusCode).toBe(201);
      if (status === 'published')
        expect(
          (await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` })).statusCode,
        ).toBe(200);
      await t.container.handle.client.execute({
        sql: "UPDATE loop_versions SET definition = json_remove(definition, '$.settings.structuredTimeoutMs', '$.settings.runDeadlineSeconds') WHERE id = ?",
        args: [draft.id],
      });
      await t.container.handle.client.execute(
        'DELETE FROM __drizzle_migrations WHERE created_at = 1792818000000',
      );
      await t.container.handle.migrate();
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
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}
