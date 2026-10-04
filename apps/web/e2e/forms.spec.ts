import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { approvalLoop, expect, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, config: unknown, kind = 'script') {
  const definition = approvalLoop(`forms ${kind}`);
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === 'approve' ? { ...node, kind, label: 'Form node', config } : node,
        ),
      },
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

async function draft(request: APIRequestContext, id: string) {
  const response = await request.get(`/loops/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    draft: {
      definition: { nodes: { id: string; config: { args?: string[] } }[]; variables?: unknown };
    };
  };
}

async function code(page: Page, label: string, text: string) {
  // CodeMirror exposes its contenteditable by accessible label, without a textbox role.
  const content = page.locator('.cm-content').and(page.getByLabel(label, { exact: true }));
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  if (text !== '') await page.keyboard.insertText(text);
}

async function screenshot(locator: Locator, name: string) {
  const phase = process.env['GG_FORMS_QA_PHASE'];
  if (phase !== 'before' && phase !== 'after') return;
  const directory = resolve('../../docs/qa/2026-10-04-forms-bugs');
  await mkdir(directory, { recursive: true });
  await locator.screenshot({ path: resolve(directory, `${phase}-${name}.png`) });
}

test('edited script args survive add, autosave, remove, and reload', async ({ page, request }) => {
  const id = await createLoop(request, { command: 'node', args: ['--version'] });
  await page.goto(`/app/loops/${id}/edit`);
  await page.getByTestId('node-approve').click();
  await code(page, 'Args 1', '{{ vars.value }}');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config
          .args,
    )
    .toEqual(['{{ vars.value }}']);
  await page.getByRole('button', { name: 'Add args', exact: true }).click();
  await code(page, 'Args 2', 'second');
  await expect(page.getByLabel('Args 1', { exact: true })).toHaveText('{{ vars.value }}');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config
          .args,
    )
    .toEqual(['{{ vars.value }}', 'second']);
  await page.getByRole('button', { name: 'Remove args 1', exact: true }).click();
  await expect(page.getByLabel('Args 1', { exact: true })).toHaveText('second');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config
          .args,
    )
    .toEqual(['second']);
  await page.reload();
  await page.getByTestId('node-approve').click();
  await expect(page.getByLabel('Args 1', { exact: true })).toHaveText('second');
});

for (const theme of ['dark', 'light']) {
  test(`record JSON editor accepts pointer and keyboard at panel widths (${theme})`, async ({
    page,
    request,
  }) => {
    const id = await createLoop(request, { command: 'node', env: { FIRST: 'initial' } });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/app/loops/${id}/edit`);
    await page.evaluate((theme) => {
      document.documentElement.dataset['theme'] = theme;
    }, theme);
    await page.getByRole('tab', { name: 'Loop', exact: true }).click();
    const variables = page.getByRole('group', { name: 'Variables', exact: true });
    await variables.getByRole('button', { name: 'Add entry', exact: true }).click();
    await page.getByLabel('Variables key 1').fill('value');
    const value = page.getByLabel('Variables value 1');
    await screenshot(variables, `record-${theme}`);
    const bounds = await value.boundingBox();
    expect(bounds?.width).toBeGreaterThan(200);
    await code(page, 'Variables value 1', '{"type":"string"}');
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect
      .poll(async () => (await draft(request, id)).draft.definition.variables)
      .toEqual({ value: { type: 'string' } });
    // Follow the visual order: key and Remove on the first row, then the value below.
    await page.getByLabel('Variables key 1').focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Remove variables value', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(value).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('{"type":"number"}');
    await expect
      .poll(async () => (await draft(request, id)).draft.definition.variables)
      .toEqual({ value: { type: 'number' } });
    // Exercise a narrower containing panel without changing the shared editor layout.
    await page
      .locator('aside')
      .last()
      .evaluate((aside) => {
        aside.style.width = '280px';
      });
    await expect(value).toBeVisible();
    const narrowBounds = await value.boundingBox();
    expect(narrowBounds?.width).toBeGreaterThan(150);
    console.log(
      `${theme}: record content width ${bounds?.width}px at 380px, ${narrowBounds?.width}px at 280px`,
    );
    const clipped = await variables.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);
    await screenshot(variables, `record-narrow-${theme}`);
    await code(page, 'Variables value 1', '{"type":"boolean"}');
    await expect
      .poll(async () => (await draft(request, id)).draft.definition.variables)
      .toEqual({ value: { type: 'boolean' } });
    // String record sibling in the node properties uses the same row layout.
    await page.getByTestId('node-approve').click();
    await page.getByRole('tab', { name: 'Node', exact: true }).click();
    await page.getByLabel('Env key 1').fill('RENAMED');
    await page.getByLabel('Env value 1').fill('edited');
    await page
      .getByRole('group', { name: 'Env', exact: true })
      .getByRole('button', { name: 'Add entry' })
      .click();
    await expect(page.getByLabel('Env value 1')).toHaveValue('edited');
  });

  test(`empty optional heartbeat preview is absent and malformed preview remains (${theme})`, async ({
    page,
    request,
  }) => {
    const id = await createLoop(request, { intervalSeconds: 5, maxBeats: 2 }, 'heartbeat');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/app/loops/${id}/edit`);
    await page.evaluate((theme) => {
      document.documentElement.dataset['theme'] = theme;
    }, theme);
    await page.getByTestId('node-approve').click();
    const until = page.locator('[data-field="until"]');
    // Wait for the original asynchronous failure preview before capturing the baseline.
    if (process.env['GG_FORMS_QA_PHASE'] === 'before') {
      await expect(until.getByTestId('preview')).toContainText('failed to compile');
    }
    await screenshot(until, `heartbeat-${theme}`);
    await expect(until.getByTestId('preview')).toHaveCount(0);
    await code(page, 'Until', 'vars.');
    await expect(until.getByTestId('preview')).toContainText('failed to compile');
    await code(page, 'Until', '');
    await expect(until.getByTestId('preview')).toHaveCount(0);
  });
}
