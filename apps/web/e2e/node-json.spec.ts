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
  test(`${kind} ${answer.type}: JSON round trip, validation, multiline text, route rename and reload`, async ({
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
    await expect.poll(() => config(request, id)).toMatchObject({ answer: renamed });
    expect((await saved(request, id)).edges.find((edge) => edge.id === 'e2')!.from.port).toBe(
      'next',
    );
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
  await dialog.getByRole('tab', { name: 'Context' }).click();
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
  await dialog.getByRole('tab', { name: 'Context' }).click();
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
  await dialog.getByRole('tab', { name: 'Context' }).click();
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
