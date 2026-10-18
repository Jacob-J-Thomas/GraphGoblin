import type { ContextThread } from '@graphgoblin/contracts';
import { closeNode, expect, manualTriggerConfig, openNode, test } from './fixtures.js';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`copied output references drive scripts and expression routes at ${viewport.width}px`, async ({
    page,
    request,
    context,
  }) => {
    await page.setViewportSize(viewport);
    const definition = {
      schemaVersion: 4,
      name: `Output references ${viewport.width}`,
      nodes: [
        {
          id: 'start',
          label: 'Start',
          kind: 'trigger',
          config: manualTriggerConfig(),
          ui: { x: 0, y: 80 },
        },
        {
          id: 'producer-id',
          label: 'Produce 42',
          kind: 'script',
          config: { command: 'node', args: ['-e', 'console.log(42)'] },
          ui: { x: 260, y: 80 },
        },
        {
          id: 'consumer',
          label: 'Add one',
          kind: 'script',
          config: { command: 'node', args: ['-e', 'console.log(Number(process.argv[1]) + 1)', ''] },
          ui: { x: 520, y: 80 },
        },
        {
          id: 'check',
          label: 'Check 43',
          kind: 'decision',
          config: {
            kind: 'expression',
            jsonata: '"no"',
            routes: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
          ui: { x: 780, y: 80 },
        },
        {
          id: 'done',
          label: 'Done',
          kind: 'exit',
          config: { returns: 'outputs.consumer.value' },
          ui: { x: 1040, y: 80 },
        },
        {
          id: 'wrong',
          label: 'Wrong value',
          kind: 'exit',
          config: { outcome: 'failure' },
          ui: { x: 1040, y: 260 },
        },
      ],
      edges: [
        ['start', 'out', 'producer-id'],
        ['producer-id', 'out', 'consumer'],
        ['consumer', 'out', 'check'],
        ['check', 'yes', 'done'],
        ['check', 'no', 'wrong'],
      ].map(([from, port, to], i) => ({
        id: `e${i}`,
        from: { node: from, port },
        to: { node: to },
      })),
    };
    const created = await request.post('/loops', { data: { definition } });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.goto(`/app/loops/${loop.id}/edit`);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin,
    });
    let dialog = await openNode(page, 'consumer');
    const argument = dialog.locator('[data-field="args.2"]');
    const toggle = argument.getByRole('button', { name: 'Earlier node outputs (2)' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await argument
      .getByRole('button', { name: 'Copy reference for Produce 42 (producer-id)' })
      .click();
    await expect(argument.getByRole('status')).toHaveText('Copied');
    await dialog.getByLabel('Args 3', { exact: true }).click();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(dialog.getByLabel('Args 3', { exact: true })).toHaveText(
      '{{ outputs["producer-id"].value }}',
    );
    await closeNode(page);

    dialog = await openNode(page, 'check');
    const expression = dialog.locator('[data-field="jsonata"]');
    await expression.getByRole('button', { name: 'Earlier node outputs (3)' }).click();
    await expression.getByRole('button', { name: 'Copy reference for Add one (consumer)' }).click();
    const editor = expression.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+V');
    await page.keyboard.insertText(' = 43 ? "yes" : "no"');
    await expect(editor).toHaveText('outputs.consumer.value = 43 ? "yes" : "no"');
    // Wrapping the notes/reference must not introduce horizontal scrolling at phone width.
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await closeNode(page);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();
    await page.getByRole('link', { name: 'Open in Runs' }).first().click();
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
    const runId = new URL(page.url()).pathname.split('/').at(-1)!;
    const response = await request.get(`/runs/${runId}/thread`);
    expect(response.ok()).toBe(true);
    const thread = (await response.json()) as ContextThread;
    expect(thread.outputs['producer-id']?.value).toBe(42);
    expect(thread.outputs['consumer']?.value).toBe(43);
    expect(thread.outputs['check']?.value).toMatchObject({ portId: 'yes' });
    const run = await request.get(`/runs/${runId}`);
    expect(await run.json()).toMatchObject({ status: 'succeeded', result: 43 });
  });
}
