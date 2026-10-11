import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { approvalLoop, closeNode, expect, openAdvanced, openNode, test } from './fixtures.js';

const choice = {
  type: 'choice' as const,
  options: [
    { id: 'out', label: 'Continue', criteria: 'Continue' },
    { id: 'no', label: 'Stop', criteria: 'Stop' },
  ],
};
const noul = {
  type: 'noul' as const,
  true: { id: 'out', label: 'True', criteria: 'True' },
  false: { id: 'no', label: 'False', criteria: 'False' },
};
const score = {
  type: 'score' as const,
  anchors: ['Low', 'High'],
  bands: [{ id: 'out', label: 'All', min: 0, max: 1 }],
};

async function create(request: APIRequestContext, kind: string, config: unknown) {
  const loop = approvalLoop(`JSON ${kind}`);
  const response = await request.post('/loops', {
    data: {
      definition: {
        ...loop,
        variables: { topic: { type: 'string' } },
        nodes: loop.nodes.map((node) => (node.id === 'approve' ? { ...node, kind, config } : node)),
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { loop: { id: string } }).loop.id;
}
async function saved(request: APIRequestContext, id: string) {
  const body = (await (await request.get(`/loops/${id}`)).json()) as {
    draft: {
      definition: {
        nodes: { id: string; config: Record<string, unknown> }[];
        edges: { id: string; from: { port: string } }[];
      };
    };
  };
  return body.draft.definition;
}
async function config(request: APIRequestContext, id: string) {
  return (await saved(request, id)).nodes.find((node) => node.id === 'approve')!.config;
}
async function replace(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

for (const [kind, answer] of [
  ['expression', choice],
  ['expression', noul],
  ['classifier', choice],
  ['classifier', noul],
  ['classifier', score],
  ['llm', choice],
  ['llm', noul],
] as const) {
  test(`${kind} ${answer.type}: JSON round trip, validation, multiline text, route removal confirmation and reload`, async ({
    page,
    request,
  }) => {
    const evaluation =
      kind === 'expression'
        ? { kind, jsonata: answer.type === 'noul' ? 'true' : '"out"' }
        : kind === 'classifier'
          ? { kind, model: 'jev', question: 'Evaluate' }
          : {
              kind,
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'Evaluate',
            };
    const id = await create(request, 'decision', { answer, evaluation });
    await page.goto(`/app/loops/${id}/edit`);
    let dialog = await openNode(page, 'approve');
    const text =
      answer.type === 'score'
        ? dialog.getByLabel('Anchors 1', { exact: true })
        : dialog.locator('textarea').first();
    await expect(text).toHaveJSProperty('tagName', 'TEXTAREA');
    await text.fill('First line\nSecond line');
    await expect
      .poll(() => config(request, id))
      .toMatchObject({
        answer:
          answer.type === 'choice'
            ? {
                options: [
                  { ...answer.options[0], criteria: 'First line\nSecond line' },
                  answer.options[1],
                ],
              }
            : answer.type === 'noul'
              ? { true: { criteria: 'First line\nSecond line' } }
              : { anchors: ['First line\nSecond line', 'High'] },
      });
    const original = (await config(request, id))['answer'];
    await dialog.getByRole('button', { name: 'Edit as JSON: Answer' }).click();
    const json = dialog.getByRole('textbox', { name: 'Answer JSON', exact: true });
    expect(JSON.parse(await json.innerText())).toEqual(original);
    await replace(page, json, '{held');
    await expect(dialog.getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
    expect((await config(request, id))['answer']).toEqual(original);
    await dialog.getByRole('button', { name: 'Use structured editor for Answer' }).click();
    await expect(dialog.getByText(/before switching editors/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel JSON' }).click();
    expect(JSON.parse(await json.innerText())).toEqual(original);
    const renamed = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
    if (answer.type === 'choice') (renamed['options'] as { id: string }[])[0]!.id = 'next';
    else if (answer.type === 'noul') (renamed['true'] as { id: string }).id = 'next';
    else (renamed['bands'] as { id: string }[])[0]!.id = 'next';
    await replace(page, json, JSON.stringify(renamed, null, 2));
    // Valid text is still pending until the complete section is applied.
    expect((await config(request, id))['answer']).toEqual(original);
    await dialog.getByRole('button', { name: 'Apply JSON' }).click();
    const review = dialog.getByRole('group', { name: 'Confirm connection removal' });
    await expect(review).toContainText('out');
    await expect(review).toContainText('done');
    expect((await config(request, id))['answer']).toEqual(original);
    expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')!.from.port).toBe(
      'out',
    );
    await review.getByRole('button', { name: 'Confirm Apply JSON' }).click();
    await expect.poll(() => config(request, id)).toMatchObject({ answer: renamed });
    expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')).toBeUndefined();
    await dialog.getByRole('button', { name: 'Use structured editor for Answer' }).click();
    await expect(dialog.locator('textarea').first()).toHaveValue('First line\nSecond line');
    await page.reload();
    dialog = await openNode(page, 'approve');
    await expect(dialog.locator('textarea').first()).toHaveValue('First line\nSecond line');
    expect((await config(request, id))['answer']).toEqual(renamed);
  });
}

test('inference section JSON validates before autosave, cancels, and round trips optional objects', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  await dialog.getByRole('button', { name: 'Edit as JSON: Input' }).click();
  let json = dialog.getByRole('textbox', { name: 'Input JSON', exact: true });
  const input = [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'hello' } }];
  await replace(page, json, '[{"op":"not-an-operation"}]');
  await expect(dialog.getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
  expect((await config(request, id))['input']).toEqual([]);
  await replace(page, json, JSON.stringify(input));
  await dialog.getByRole('button', { name: 'Apply JSON' }).click();
  await expect.poll(() => config(request, id)).toMatchObject({ input });
  await dialog.getByRole('button', { name: 'Use structured editor for Input' }).click();
  const mutation = dialog.getByRole('button', { name: /^Input 1/ });
  if ((await mutation.getAttribute('aria-expanded')) === 'false') await mutation.click();
  const path = dialog.getByLabel('Path', { exact: true });
  await expect(path).toHaveValue('/vars/topic');
  const list = await path.getAttribute('list');
  await expect(dialog.locator(`datalist[id="${list}"] option`)).toHaveAttribute(
    'value',
    '/vars/topic',
  );
  await openAdvanced(dialog);
  await dialog.getByRole('button', { name: 'Edit as JSON: Context files' }).click();
  json = dialog.getByRole('textbox', { name: 'Context files JSON', exact: true });
  await expect(json).toHaveText('');
  await replace(page, json, '[]');
  await dialog.getByRole('button', { name: 'Apply JSON' }).last().click();
  await expect.poll(() => config(request, id)).toMatchObject({ contextFiles: [] });
  await dialog.getByRole('tab', { name: 'Settings' }).click();
  await openAdvanced(dialog);
  const timeout = dialog.getByRole('spinbutton', { name: 'Timeout seconds' });
  await expect(timeout).toHaveAttribute('step', '1');
  await timeout.fill('1.5');
  await expect(timeout).toHaveAttribute('aria-invalid', 'true');
  expect(await config(request, id)).not.toHaveProperty('timeoutSeconds');
  await timeout.fill('30');
  await expect.poll(() => config(request, id)).toMatchObject({ timeoutSeconds: 30 });
  for (const [label, value] of [
    ['Config overrides', { nested: [1, true] }],
    ['Capabilities', { mcpServers: ['server'], plugins: [], skills: [] }],
    ['Transforms', []],
  ] as const) {
    await dialog.getByRole('button', { name: `Edit as JSON: ${label}` }).click();
    const section = dialog.getByRole('textbox', { name: `${label} JSON`, exact: true });
    await replace(page, section, JSON.stringify(value));
    await section
      .locator('xpath=ancestor::*[@data-json-section][1]')
      .getByRole('button', { name: 'Apply JSON' })
      .click();
    await dialog.getByRole('button', { name: `Use structured editor for ${label}` }).click();
  }
  await expect
    .poll(() => config(request, id))
    .toMatchObject({
      harnessOptions: { configOverrides: { nested: [1, true] } },
      capabilities: { mcpServers: ['server'], plugins: [], skills: [] },
      output: { transforms: [] },
    });
  await expect(dialog.getByText(/No resolved capability identifiers/).first()).toBeVisible();
  await page.reload();
  expect((await config(request, id))['input']).toEqual(input);
});

test('held Context JSON blocks Publish, survives reopening, opens from a badge and undoes across tabs', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, contextFiles: [] });
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  await openAdvanced(dialog);
  await dialog.getByRole('button', { name: 'Edit as JSON: Context files' }).click();
  await replace(
    page,
    dialog.getByRole('textbox', { name: 'Context files JSON', exact: true }),
    '{held',
  );
  await dialog.getByRole('tab', { name: /^Settings/ }).click();
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/not a valid value yet; complete or discard it first/)).toBeVisible();
  const badge = page
    .getByTestId('node-approve')
    .getByRole('button', { name: '1 issue on approve' });
  await badge.click();
  await page.getByRole('button', { name: /FIELD_INPUT_INVALID/ }).click();
  dialog = page.getByRole('dialog', { name: 'Edit inference approve' });
  await expect(dialog.getByRole('tab', { name: /^Context 1 error/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const json = dialog.getByRole('textbox', { name: 'Context files JSON', exact: true });
  await expect(json).toBeFocused();
  await expect(json).toHaveText('{held');
  await dialog.getByRole('button', { name: 'Cancel JSON' }).click();
  await dialog.getByRole('tab', { name: 'Settings' }).click();
  await dialog.getByRole('tab', { name: 'Settings' }).focus();
  await page.keyboard.press('Control+z');
  await expect(dialog.locator('.cm-content[aria-label="Context files JSON"]')).toHaveText('{held');
  await dialog.getByRole('tab', { name: /^Context/ }).click();
  await dialog.getByRole('tab', { name: /^Context/ }).focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(dialog.getByRole('textbox', { name: 'Context files JSON', exact: true })).toHaveText(
    '[]',
  );
  expect((await config(request, id))['contextFiles']).toEqual([]);
});

test('number constraints hold invalid input while provider variables remain suggestions', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', {
    answer: noul,
    evaluation: {
      kind: 'classifier',
      model: 'jev',
      question: 'Evaluate',
      minConfidence: 0.2,
      context: { vars: ['topic'] },
    },
  });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await openAdvanced(dialog.locator('[data-field="evaluation"]'));
  const number = dialog.getByRole('spinbutton', { name: 'Min confidence' });
  await expect(number).toHaveAttribute('min', '0');
  await expect(number).toHaveAttribute('max', '1');
  await expect(number).toHaveAttribute('step', 'any');
  await number.fill('1.1');
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  expect((await config(request, id))['evaluation']).toMatchObject({ minConfidence: 0.2 });
  await number.fill('0.75');
  await expect
    .poll(() => config(request, id))
    .toMatchObject({ evaluation: { minConfidence: 0.75 } });
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  await openAdvanced(dialog);
  const variable = dialog.getByLabel('Vars 1', { exact: true });
  const list = await variable.getAttribute('list');
  await expect(dialog.locator(`datalist[id="${list}"] option`)).toHaveAttribute('value', 'topic');
  await variable.fill('undeclared');
  await expect
    .poll(() => config(request, id))
    .toMatchObject({ evaluation: { context: { vars: ['undeclared'] } } });
  await dialog.getByRole('button', { name: 'Edit as JSON: Context', exact: true }).click();
  const json = dialog.getByRole('textbox', { name: 'Context JSON', exact: true });
  await replace(page, json, '{"messages":"all","vars":[],"includeLastOutput":false}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click();
  await expect
    .poll(() => config(request, id))
    .toMatchObject({
      evaluation: { context: { messages: 'all', vars: [], includeLastOutput: false } },
    });
});

test('Answer JSON preserves surviving IDs through reorder and swap; equal-count delete/add removes only confirmed connections', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', {
    answer: choice,
    evaluation: { kind: 'expression', jsonata: '"out"' },
  });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await dialog.getByRole('button', { name: 'Edit as JSON: Answer' }).click();
  const json = dialog.getByRole('textbox', { name: 'Answer JSON', exact: true });
  for (const options of [
    [choice.options[1], choice.options[0]],
    [
      { ...choice.options[0], id: 'no' },
      { ...choice.options[1], id: 'out' },
    ],
  ]) {
    const answer = { ...choice, options };
    await replace(page, json, JSON.stringify(answer));
    await dialog.getByRole('button', { name: 'Apply JSON', exact: true }).click();
    await expect(dialog.getByRole('group', { name: 'Confirm connection removal' })).toHaveCount(0);
    await expect.poll(() => config(request, id)).toMatchObject({ answer });
    expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')!.from.port).toBe(
      'out',
    );
  }
  const answer = { ...choice, options: [choice.options[1], { ...choice.options[0], id: 'fresh' }] };
  await replace(page, json, JSON.stringify(answer));
  await dialog.getByRole('button', { name: 'Apply JSON', exact: true }).click();
  const review = dialog.getByRole('group', { name: 'Confirm connection removal' });
  await expect(review).toContainText('out');
  await expect(review).toContainText('done');
  await expect(review).toBeFocused();
  await expect(review).toHaveAccessibleName('Confirm connection removal');
  await expect(review).toHaveAccessibleDescription('out → done');
  await page.keyboard.press('Tab');
  await expect(review.getByRole('button', { name: 'Confirm Apply JSON' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(review.getByRole('button', { name: 'Keep editing JSON' })).toBeFocused();
  expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')!.from.port).toBe('out');
  await review.getByRole('button', { name: 'Keep editing JSON' }).click();
  await expect(dialog.getByRole('button', { name: 'Apply JSON', exact: true })).toBeFocused();
  expect((await config(request, id))['answer']).not.toEqual(answer);
  await dialog.getByRole('button', { name: 'Apply JSON', exact: true }).click();
  await review.getByRole('button', { name: 'Confirm Apply JSON' }).click();
  await expect.poll(() => config(request, id)).toMatchObject({ answer });
  expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')).toBeUndefined();
});

test('semantic JSON no-ops permit Publish; valid changed JSON is described as unapplied', async ({
  page,
  request,
}) => {
  const input = [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'hello' } }];
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, input });
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await dialog.getByRole('tab', { name: 'Context 1 set', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit as JSON: Input' }).click();
  await replace(
    page,
    dialog.getByRole('textbox', { name: 'Input JSON', exact: true }),
    ' [ { "value": { "value": "hello", "kind": "literal" }, "path": "/vars/topic", "op": "set" } ] ',
  );
  await expect(dialog.getByText(/Choose Apply JSON/)).toHaveCount(0);
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version/)).toBeVisible();
  dialog = await openNode(page, 'approve');
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  // The section editor preference is kept for this dialog session; reopen if needed.
  if (await dialog.getByRole('button', { name: 'Edit as JSON: Input' }).count())
    await dialog.getByRole('button', { name: 'Edit as JSON: Input' }).click();
  await replace(
    page,
    dialog.getByRole('textbox', { name: 'Input JSON', exact: true }),
    JSON.stringify([{ ...input[0], value: { kind: 'literal', value: 'changed' } }]),
  );
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/JSON not applied yet; apply or cancel it first/)).toBeVisible();
  await page
    .getByTestId('node-approve')
    .getByRole('button', { name: '1 issue on approve' })
    .click();
  await expect(page.getByText(/This field holds JSON not applied yet/)).toBeVisible();
});

test('section JSON refuses hidden held input and focuses the first field without losing it', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', {
    prompt: { template: 'Hi' },
    input: [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 1 } }],
  });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  const row = dialog.getByRole('button', { name: /^Input 1/ });
  if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
  const value = dialog.getByRole('textbox', { name: 'Value', exact: true });
  await replace(page, value, '{held');
  await row.click();
  await dialog.getByRole('button', { name: 'Edit as JSON: Input' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Input JSON', exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText(/Finish or discard held input before editing this section as JSON/),
  ).toContainText('input.0.value.value');
  await dialog.getByRole('button', { name: 'Focus first held field' }).click();
  await expect(value).toBeFocused();
  await expect(value).toHaveText('{held');
  expect((await config(request, id))['input']).toEqual([
    { op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 1 } },
  ]);
});

test('incomplete numeric input survives tabs, session reopen and history; correction and deliberate clear apply', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' }, timeoutSeconds: 30 });
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'approve');
  await openAdvanced(dialog);
  const field = dialog.getByRole('spinbutton', { name: 'Timeout seconds' });
  await field.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await field.pressSequentially('-');
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'Enter a complete number' }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Advanced/ })).toContainText('1 error');
  await dialog.getByRole('tab', { name: /^Context/ }).click();
  await expect(dialog.getByRole('tab', { name: /^Settings.*1 error$/ })).toBeVisible();
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Publish failed')).toBeVisible();
  expect((await config(request, id))['timeoutSeconds']).toBe(30);
  dialog = await openNode(page, 'approve');
  await openAdvanced(dialog);
  await expect(field).toHaveValue('30');
  await expect(dialog.getByText('Enter a complete number', { exact: true })).toBeVisible();
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await dialog.getByRole('tab', { name: /^Settings/ }).focus();
  await page.keyboard.press('Control+z');
  await expect(field).toHaveValue('30');
  await page.keyboard.press('Control+Shift+z');
  await expect(field).toHaveValue('30');
  await expect(dialog.getByText('Enter a complete number', { exact: true })).toBeVisible();
  await field.fill('45');
  await expect(field).toHaveAttribute('type', 'number');
  await expect.poll(async () => (await config(request, id))['timeoutSeconds']).toBe(45);
  await field.fill('');
  await expect.poll(async () => (await config(request, id))['timeoutSeconds']).toBeUndefined();
  await expect(dialog.getByText('Enter a complete number')).toHaveCount(0);
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
});
