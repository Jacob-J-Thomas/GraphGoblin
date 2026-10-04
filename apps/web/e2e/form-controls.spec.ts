/**
 * #8: the shared form controls in Edge. Switches, segmented controls, and selects work by keyboard
 * and save what they show; Tab leaves a code field; required fields carry their marker and
 * `aria-required`; an error describes its control; the file picker is a labelled native input.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, expect, openNode, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, kind: string, config: unknown) {
  const definition = approvalLoop(`controls ${kind}`);
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

async function savedConfig(request: APIRequestContext, id: string) {
  const response = await request.get(`/loops/${id}`);
  const body = (await response.json()) as {
    draft: { definition: { nodes: { id: string; config: Record<string, unknown> }[] } };
  };
  return body.draft.definition.nodes.find((node) => node.id === 'approve')?.config;
}

/** The element that has keyboard focus, by its accessible name or text. */
async function focusedName(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '';
  });
}

test('switches and segmented controls work by keyboard and save what they show', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, 'script', { command: 'node' });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');

  // A segmented control: Tab lands on the chosen segment, the arrow keys move the choice.
  const stdin = dialog.getByRole('radiogroup', { name: 'Stdin', exact: true });
  await expect(stdin.getByRole('radio', { name: 'thread' })).toBeChecked();
  await stdin.getByRole('radio', { name: 'thread' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(stdin.getByRole('radio', { name: 'last-output' })).toBeChecked();
  await expect(stdin.getByRole('radio', { name: 'last-output' })).toBeFocused();
  await expect.poll(async () => (await savedConfig(request, id))?.['stdin']).toBe('last-output');
  // Tab leaves the group for the next field.
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('radiogroup', { name: 'Stdout' }).getByRole('radio', { name: 'last-output' }),
  ).toBeFocused();
});

test('a switch toggles with Space and Enter, and an optional boolean can go back to unset', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, 'inference', { prompt: { template: 'hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const network = dialog.getByRole('radiogroup', { name: 'Network access', exact: true });
  await expect(network.getByRole('radio', { name: 'Not set' })).toBeChecked();
  await network.getByRole('radio', { name: 'Not set' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(network.getByRole('radio', { name: 'Yes' })).toBeChecked();
  await expect
    .poll(async () => (await savedConfig(request, id))?.['harnessOptions'])
    .toMatchObject({ networkAccess: true });
  await page.keyboard.press('ArrowLeft');
  await expect(network.getByRole('radio', { name: 'Not set' })).toBeChecked();
  await expect
    .poll(async () => (await savedConfig(request, id))?.['harnessOptions'])
    .not.toHaveProperty('networkAccess');
  // A select (more than four options) by keyboard: "Not set", then the first effort.
  const effort = dialog.getByLabel('Effort', { exact: true });
  await expect(effort).toHaveValue('');
  await effort.focus();
  await page.keyboard.press('ArrowDown');
  await expect(effort).toHaveValue('minimal');
  await expect.poll(async () => (await savedConfig(request, id))?.['effort']).toBe('minimal');

  const decisionId = await createLoop(request, 'decision', {
    routes: [
      { label: 'yes', description: '' },
      { label: 'no', description: '' },
    ],
    question: 'q',
    strategy: ['jev'],
  });
  await page.goto(`/app/loops/${decisionId}/edit`);
  const decision = await openNode(page, 'approve');
  const record = decision.getByRole('switch', { name: 'Record alternatives', exact: true });
  await expect(record).toBeChecked();
  const box = await record.boundingBox();
  expect(box?.width).toBe(44);
  expect(box?.height).toBeGreaterThanOrEqual(24);
  await record.focus();
  await page.keyboard.press('Space');
  await expect(record).not.toBeChecked();
  await expect
    .poll(async () => (await savedConfig(request, decisionId))?.['recordAlternatives'])
    .toBe(false);
  await page.keyboard.press('Enter');
  await expect(record).toBeChecked();
  await expect
    .poll(async () => (await savedConfig(request, decisionId))?.['recordAlternatives'])
    .toBe(true);
  // A click on its label toggles it too.
  await decision.getByText('Record alternatives', { exact: true }).click();
  await expect(record).not.toBeChecked();
});

test('Tab and Shift+Tab leave a code field', async ({ page, request }) => {
  const id = await createLoop(request, 'script', { command: 'node', args: ['--version'] });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const args = dialog.locator('.cm-content').and(dialog.getByLabel('Args 1', { exact: true }));
  await args.click();
  await expect(args).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await focusedName(page)).toBe('Remove args 1');
  await page.keyboard.press('Shift+Tab');
  await expect(args).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByLabel('Command', { exact: true })).toBeFocused();
  // The code field keeps its text: Tab inserted nothing.
  await expect(args).toHaveText('--version');
});

test('required fields are marked, and an error describes its control', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, 'script', { command: 'node' });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await expect(dialog.getByText('Required fields are marked')).toBeVisible();
  const command = dialog.getByLabel('Command', { exact: true });
  await expect(command).toHaveAttribute('aria-required', 'true');
  await expect(dialog.getByLabel('Cwd', { exact: true })).not.toHaveAttribute('aria-required');
  await command.fill('');
  await expect(command).toHaveAttribute('aria-invalid', 'true');
  await expect(command).toHaveAccessibleDescription(/expected string to have >=1 characters/);
  await expect(dialog.locator('[data-field="command"]').getByRole('alert')).toContainText(
    'Too small',
  );
  await command.fill('node');
  await expect(command).not.toHaveAttribute('aria-invalid', 'true');
});

test('the import file picker is a labelled native input that names the chosen file', async ({
  page,
}) => {
  await page.goto('/app/loops');
  const input = page.getByLabel('Import an exported loop (JSON)');
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAccessibleDescription('No file chosen');
  // Keyboard: it follows the Create form in the Tab order and shows the focus ring on its button.
  await page.getByRole('textbox', { name: 'New loop name' }).fill('x');
  await page.getByRole('button', { name: 'Create', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.setInputFiles({
    name: 'not-a-loop.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  await expect(page.getByText('not-a-loop.json is not a JSON document.')).toBeVisible();
  await expect(input).toHaveAccessibleDescription('not-a-loop.json');
});
