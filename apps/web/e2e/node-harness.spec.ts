import { legacyHarnessLoop, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { expect, openNode, test } from './fixtures.js';

for (const envelope of [false, true]) {
  test(`imports a legacy ${envelope ? 'envelope' : 'definition'} and shows Harness only on inference`, async ({
    page,
    request,
  }) => {
    const source = legacyHarnessLoop();
    const legacy = {
      ...source,
      name: `legacy-harness-${envelope}`,
      nodes: source.nodes.map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    };
    await page.goto('/app/loops');
    await page.getByLabel('Import an exported loop (JSON)').setInputFiles({
      name: 'legacy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify(
          envelope
            ? {
                format: 'graphgoblin-loop',
                formatVersion: 1,
                exportedAt: FIXTURE_TS,
                loop: legacy,
              }
            : legacy,
        ),
      ),
    });
    await expect(page.getByText(`Imported "${legacy.name}".`)).toBeVisible();
    await page.getByRole('link', { name: `Edit ${legacy.name}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: legacy.name })).toBeVisible();
    await expect(page.getByLabel('Harness', { exact: true })).toHaveCount(0);
    const dialog = await openNode(page, 'infer');
    await expect(dialog.getByLabel('Harness', { exact: true })).toHaveValue('codex');
    const loopId = /\/loops\/([^/]+)\/edit/.exec(page.url())![1]!;
    const response = await request.get(`/loops/${loopId}/export?draft=true`);
    expect(response.status()).toBe(200);
    const exported = (await response.json()) as {
      loop: { settings: { defaults: object }; nodes: { config: object }[] };
    };
    expect(exported.loop.settings.defaults).not.toHaveProperty('harness');
    expect(exported.loop.nodes[1]?.config).toHaveProperty('harness', 'codex');
  });
}
