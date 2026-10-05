import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  approvalLoop,
  closeNode,
  expect,
  openAdvanced,
  openItem,
  openNode,
  showLoopPanel,
  test,
} from './fixtures.js';

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
      definition: {
        nodes: {
          id: string;
          config: {
            args?: string[];
            env?: Record<string, string>;
            until?: string;
            criteria?: { jsonSchema?: unknown }[];
          };
        }[];
        variables?: unknown;
      };
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

test('collection focus and collision refusal preserve the saved values', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, {
    command: 'node',
    args: ['one', 'two', 'three'],
    env: { A: 'one', C: 'three' },
  });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const args = dialog.getByRole('group', { name: 'Args', exact: true });
  await args.getByRole('button', { name: 'Remove args 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(args.getByRole('button', { name: 'Add args', exact: true })).toBeFocused();
  await expect(args.getByRole('status')).toHaveText('Removed args 2');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Args 3', { exact: true })).toBeFocused();
  await expect(args.getByRole('status')).toHaveText('Added args 3');
  await code(page, 'Args 3', 'new');
  await openAdvanced(dialog);
  await page.getByLabel('Env key 2').fill('A');
  await expect(page.getByLabel('Env key 2')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Env key 2')).toHaveAccessibleDescription(/already exists/);
  await expect(page.getByLabel('Env value 1')).toHaveValue('one');
  await expect(page.getByLabel('Env value 2')).toHaveValue('three');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config,
    )
    .toMatchObject({ args: ['one', 'three', 'new'], env: { A: 'one', C: 'three' } });
  await page.getByLabel('Env key 2').fill('B');
  await expect(page.getByLabel('Env key 2')).not.toHaveAttribute('aria-invalid', 'true');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config
          .env,
    )
    .toEqual({ A: 'one', B: 'three' });
});

test('unparsed collection rows follow removal and rename, and stop blocking Publish when removed', async ({
  page,
  request,
}) => {
  const definition = approvalLoop('structural JSON');
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        variables: { first: { type: 'string' }, second: { type: 'number' } },
        nodes: definition.nodes.map((node) =>
          node.id === 'done'
            ? {
                ...node,
                config: {
                  criteria: [
                    { when: 'last-output-matches', jsonSchema: { type: 'string' } },
                    { when: 'last-output-matches', jsonSchema: { type: 'number' } },
                  ],
                },
              }
            : node,
        ),
      },
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { loop: { id: string } }).loop.id;
  await page.goto(`/app/loops/${id}/edit`);
  await openNode(page, 'done');
  const criteria = page.getByRole('group', { name: 'Criteria', exact: true });
  const first = criteria.getByRole('group', { name: 'Criteria 1', exact: true });
  await first.locator('.cm-content').fill('{broken');
  await expect(first.getByText(/Invalid JSON/)).toBeVisible();
  await criteria.getByRole('button', { name: 'Remove criteria 1' }).click();
  await expect(criteria.getByText(/Invalid JSON/)).toHaveCount(0);
  await expect(page.getByLabel('Json schema', { exact: true })).toContainText('number');
  await closeNode(page);
  await showLoopPanel(page);
  const variables = page.getByRole('group', { name: 'Variables', exact: true });
  await code(page, 'Variables value 2', '{keep');
  await page.getByLabel('Variables key 2').fill('renamed');
  await expect(page.getByLabel('Variables value 2')).toHaveText('{keep');
  await variables.getByRole('button', { name: 'Remove variables first' }).click();
  await expect(page.getByLabel('Variables value 1')).toHaveText('{keep');
  await expect(variables.getByRole('button', { name: 'Add entry' })).toBeFocused();
  await variables.getByRole('button', { name: 'Remove variables renamed' }).click();
  await expect(page.getByText(/invalid JSON/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version/)).toBeVisible();
  const saved = await request.get(`/loops/${id}`);
  expect(await saved.json()).toMatchObject({
    current: {
      definition: {
        variables: {},
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'done',
            config: expect.objectContaining({
              criteria: [expect.objectContaining({ jsonSchema: { type: 'number' } })],
            }),
          }),
        ]),
      },
    },
  });
});

test('blank optional source is absent in the form and raw blank source cannot publish through the API', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, { intervalSeconds: 5, maxBeats: 2 }, 'heartbeat');
  await page.goto(`/app/loops/${id}/edit`);
  await openNode(page, 'approve');
  await code(page, 'Until', '\u00a0');
  await expect(page.locator('[data-field="until"]').getByTestId('preview')).toHaveCount(0);
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version/)).toBeVisible();
  const saved = await request.get(`/loops/${id}`);
  const body = (await saved.json()) as {
    current: { definition: { nodes: { id: string; config: Record<string, unknown> }[] } };
  };
  expect(
    body.current.definition.nodes.find((node) => node.id === 'approve')?.config,
  ).not.toHaveProperty('until');
  for (const source of [' ', '\u00a0']) {
    const rawId = await createLoop(request, { intervalSeconds: 5, until: source }, 'heartbeat');
    const refused = await request.post(`/loops/${rawId}/publish`);
    expect(refused.status()).toBe(422);
    expect(await refused.json()).toMatchObject({
      code: 'LOOP_INVALID',
      errors: expect.arrayContaining([
        expect.objectContaining({ code: 'EXPRESSION_INVALID', nodeId: 'approve' }),
      ]),
    });
  }
});

test('empty and whitespace templates survive editing, API validation, publishing, and import', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, { command: 'cut', args: ['-d', 'before', '-f1', 'before'] });
  await page.goto(`/app/loops/${id}/edit`);
  await openNode(page, 'approve');
  await code(page, 'Args 2', ' ');
  await code(page, 'Args 4', '');
  await expect(page.getByLabel('Args 2', { exact: true })).toHaveText(' ');
  await expect
    .poll(
      async () =>
        (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config
          .args,
    )
    .toEqual(['-d', ' ', '-f1', '']);
  const validated = await request.post(`/loops/${id}/validate`, {
    data: { definition: (await draft(request, id)).draft.definition },
  });
  expect(await validated.json()).toMatchObject({ publishable: true, issues: [] });
  expect((await request.post(`/loops/${id}/publish`)).status()).toBe(200);
  const exported = await request.get(`/loops/${id}/export`);
  const imported = await request.post('/loops/import', { data: await exported.json() });
  expect(imported.status()).toBe(201);
  expect(await imported.json()).toMatchObject({ issues: [] });
});

test('required whitespace expressions are reported by the form and API validation, import, and publish', async ({
  page,
  request,
}) => {
  const id = await createLoop(
    request,
    {
      operations: [
        { op: 'set', path: '/vars/value', value: { kind: 'expression', jsonata: 'true' } },
      ],
    },
    'mutate',
  );
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await openItem(dialog, 'Operations 1');
  await code(page, 'Jsonata', ' ');
  const row = dialog.locator('[data-field="operations.0.value.jsonata"]');
  await expect(row.getByTestId('preview')).toHaveCount(0);
  await expect(row.getByRole('alert')).toHaveCount(1);
  await expect(dialog.getByLabel('Jsonata', { exact: true })).toHaveText(' ');
  await expect(row.getByRole('alert')).toContainText('Too small');
  const definition = approvalLoop('raw blank expression');
  const raw = {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === 'approve'
        ? {
            ...node,
            kind: 'mutate',
            config: {
              operations: [
                { op: 'set', path: '/vars/value', value: { kind: 'expression', jsonata: ' ' } },
              ],
            },
          }
        : node,
    ),
  };
  const imported = await request.post('/loops/import', { data: raw });
  expect(imported.status()).toBe(201);
  const result = (await imported.json()) as {
    loop: { id: string };
    issues: { code: string; message: string }[];
  };
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      code: 'EXPRESSION_INVALID',
      message: expect.stringContaining('expression is required; a blank expression is not valid'),
    }),
  );
  const validated = await request.post(`/loops/${result.loop.id}/validate`, {
    data: { definition: raw },
  });
  expect(await validated.json()).toMatchObject({
    publishable: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: 'EXPRESSION_INVALID' })]),
  });
  expect((await request.post(`/loops/${result.loop.id}/publish`)).status()).toBe(422);
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
    await showLoopPanel(page);
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
    await openAdvanced(page.getByRole('dialog'));
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

test('#14: inference shows its basic fields, the rest under Advanced, which says what it hides and opens for an issue', async ({
  page,
  request,
}) => {
  const id = await createLoop(request, { prompt: { template: 'Hi' } }, 'inference');
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const timeoutOf = async () =>
    (
      (await draft(request, id)).draft.definition.nodes.find((n) => n.id === 'approve')?.config as
        { timeoutSeconds?: number } | undefined
    )?.timeoutSeconds;

  // The basic set: harness, model, effort, session, prompt, and the sandbox.
  await expect(dialog.getByLabel('Harness', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Model', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Effort', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Prompt', exact: true })).toBeVisible();
  const sandbox = dialog.getByRole('radiogroup', { name: 'Sandbox', exact: true });
  await expect(sandbox).toBeVisible();
  // Help from the schema's description sits under a field.
  await expect(sandbox).toHaveAccessibleDescription(/What the session may change/);
  // The rest is under Advanced, collapsed.
  const advanced = dialog.getByRole('button', { name: /^Advanced\b/ });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByRole('radiogroup', { name: 'Approval', exact: true })).toBeHidden();
  await expect(dialog.getByLabel('Timeout seconds', { exact: true })).toBeHidden();

  // By keyboard: Tab from the last basic field reaches the toggle, with the focus ring; Enter opens.
  await sandbox.getByRole('radio', { name: 'workspace-write' }).focus();
  await page.keyboard.press('Tab');
  await expect(advanced).toBeFocused();
  await expect(advanced).toHaveCSS('outline-style', 'solid');
  await expect(advanced).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator(`[id="${await advanced.getAttribute('aria-controls')}"]`);
  for (const group of ['Context', 'Harness options', 'Output', 'Limits']) {
    await expect(panel.getByRole('group', { name: group, exact: true })).toBeVisible();
  }

  // A value set inside, then collapsed: the toggle says so.
  await dialog.getByLabel('Timeout seconds', { exact: true }).fill('120');
  await expect.poll(timeoutOf).toBe(120);
  await advanced.click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(advanced).toContainText('1 set');
  await expect(advanced).toHaveAccessibleName('Advanced 1 set');

  // An issue inside, collapsed: flagged, and following it from the node's badge opens the group.
  await advanced.click();
  await dialog.getByLabel('Timeout seconds', { exact: true }).fill('0');
  await advanced.click();
  await expect(advanced).toContainText('1 error');
  await closeNode(page);
  const badge = page
    .locator('.react-flow__node[data-id="approve"]')
    .getByRole('button', { name: /issues? on approve$/ });
  await badge.click();
  await page
    .getByRole('dialog', { name: 'Issues on approve' })
    .getByRole('button', { name: /timeoutSeconds/ })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit inference approve' });
  await expect(editor.getByRole('button', { name: /^Advanced\b/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(editor.getByLabel('Timeout seconds', { exact: true })).toBeFocused();
});

test('#14: a collapsed group or operation flags an expression that does not compile, and its issue opens both', async ({
  page,
  request,
}) => {
  const id = await createLoop(
    request,
    {
      prompt: { template: 'Hi' },
      input: [{ op: 'drop', target: 'messages', where: 'vars.' }],
      output: { schema: { jsonSchema: {} } },
    },
    'inference',
  );
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  // The domain's syntax check, not the schema, finds it; the empty JSON Schema counts as set.
  const advanced = dialog.getByRole('button', { name: /^Advanced\b/ });
  await expect(advanced).toHaveAccessibleName('Advanced 2 set 1 error');
  await advanced.click();
  const operation = dialog.getByRole('button', { name: /^Input 1 drop messages/ });
  await expect(operation).toHaveAttribute('aria-expanded', 'false');
  await expect(operation).toHaveAccessibleName('Input 1 drop messages 1 error');
  // Collapse again, then follow the issue from the editor's badge: both open at the field.
  await advanced.click();
  await dialog.getByRole('button', { name: /issues? on approve$/ }).click();
  await page
    .getByRole('dialog', { name: 'Issues on approve' })
    .getByRole('button', { name: /EXPRESSION_INVALID/ })
    .click();
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await expect(operation).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.locator('[data-field="input.0.where"] .cm-content')).toBeFocused();
});
