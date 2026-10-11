import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { approvalLoop, closeNode, expect, openAdvanced, openNode, test } from './fixtures.js';

const choice = {
  type: 'choice',
  options: [
    { id: 'out', label: 'Continue', criteria: 'Continue' },
    { id: 'no', label: 'Stop', criteria: 'Stop' },
  ],
};
const noul = {
  type: 'noul',
  true: { id: 'out', label: 'True', criteria: 'True' },
  false: { id: 'no', label: 'False', criteria: 'False' },
};
const score = {
  type: 'score',
  anchors: ['Low', 'High'],
  bands: [{ id: 'out', label: 'All', min: 0, max: 1 }],
};

async function create(request: APIRequestContext, kind: string, config: unknown) {
  const loop = approvalLoop(`Placement ${kind}`);
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

async function savedConfig(request: APIRequestContext, id: string) {
  const response = await request.get(`/loops/${id}`);
  const result = (await response.json()) as {
    draft: { definition: { nodes: { id: string; config: unknown }[] } };
  };
  return result.draft.definition.nodes.find((node) => node.id === 'approve')!.config;
}

const codeField = (dialog: Locator, path: string) =>
  dialog.locator(`[data-field="${path}"] .cm-content`);
async function replaceCode(page: Page, field: Locator, text: string) {
  await field.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

test('inference placement, tab keyboard order, and single-panel kinds', async ({
  page,
  request,
}) => {
  const id = await create(request, 'inference', { prompt: { template: 'Hi' } });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  const main = dialog.getByRole('tab', { name: 'Settings' });
  const context = dialog.getByRole('tab', { name: 'Context' });
  await expect(dialog.getByRole('tablist', { name: 'Node configuration' })).toBeVisible();
  await expect(main).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Model', { exact: true })).toBeHidden();
  await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add input', exact: true })).toBeHidden();
  await main.focus();
  for (const [key, selected] of [
    ['ArrowRight', context],
    ['ArrowRight', main],
    ['ArrowLeft', context],
    ['Home', main],
    ['End', context],
  ] as const) {
    await page.keyboard.press(key);
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    const panel = page.locator(`[id="${await selected.getAttribute('aria-controls')}"]`);
    await expect(panel).toHaveAttribute('aria-labelledby', (await selected.getAttribute('id'))!);
  }
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Add input', exact: true })).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Prompt', exact: true })).toBeHidden();
  await closeNode(page);
  const reopened = await openNode(page, 'approve');
  await expect(reopened.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await closeNode(page);
  const trigger = await openNode(page, 'start');
  await expect(trigger.getByRole('tablist')).toHaveCount(0);
});

for (const [kind, answer] of [
  ['expression', choice],
  ['expression', noul],
  ['classifier', choice],
  ['classifier', noul],
  ['classifier', score],
  ['llm', choice],
  ['llm', noul],
] as const) {
  test(`${kind} ${answer.type}: placement and save/reload preserve the evaluator and routes`, async ({
    page,
    request,
  }) => {
    const evaluation =
      kind === 'expression'
        ? { kind, jsonata: answer.type === 'noul' ? 'true' : '"out"' }
        : kind === 'classifier'
          ? {
              kind,
              model: 'jev',
              question: 'Evaluate',
              minConfidence: 0.2,
              ...(answer.type === 'noul' ? { truthThreshold: 0.5 } : {}),
              context: { messages: 'last', vars: ['topic'], includeLastOutput: true },
            }
          : {
              kind,
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'Evaluate',
              context: { messages: 'last', vars: ['topic'], includeLastOutput: true },
            };
    const id = await create(request, 'decision', { answer, evaluation });
    const original = await savedConfig(request, id);
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'approve');
    await expect(dialog.getByRole('radiogroup', { name: 'Answer type' })).toBeVisible();
    await expect(dialog.getByRole('radiogroup', { name: 'Evaluation method' })).toBeVisible();
    if (kind === 'expression') await expect(dialog.getByRole('tablist')).toHaveCount(0);
    else {
      await expect(codeField(dialog, 'evaluation.question')).toBeVisible();
      if (kind === 'classifier') {
        await expect(dialog.getByRole('spinbutton', { name: 'Min confidence' })).toBeHidden();
        await openAdvanced(dialog.locator('[data-field="evaluation"]'));
        await expect(dialog.getByRole('spinbutton', { name: 'Min confidence' })).toBeVisible();
      }
      await dialog.getByRole('tab', { name: 'Context' }).click();
      await expect(dialog.getByRole('switch', { name: 'Include last output' })).toBeVisible();
      await expect(dialog.getByLabel('Vars 1', { exact: true })).toBeHidden();
      await openAdvanced(dialog);
      await expect(dialog.getByLabel('Vars 1', { exact: true })).toHaveValue('topic');
      await dialog.getByRole('tab', { name: 'Settings' }).click();
    }
    expect(await savedConfig(request, id)).toEqual(original);
    const path = kind === 'expression' ? 'evaluation.jsonata' : 'evaluation.question';
    const text =
      kind === 'expression' ? (answer.type === 'noul' ? 'false' : '"no"') : 'Updated question';
    await replaceCode(page, codeField(dialog, path), text);
    await expect
      .poll(() => savedConfig(request, id))
      .toMatchObject({
        answer,
        evaluation: { ...evaluation, [kind === 'expression' ? 'jsonata' : 'question']: text },
      });
    await page.reload();
    const reopened = await openNode(page, 'approve');
    await expect(codeField(reopened, path)).toHaveText(text);
    await expect(reopened.getByRole('radiogroup', { name: 'Answer type' })).toBeVisible();
  });
}

test('a Context issue opens its collapsed Advanced group; undo crosses tabs and retains held JSON', async ({
  page,
  request,
}) => {
  const id = await create(request, 'decision', {
    answer: choice,
    evaluation: {
      kind: 'llm',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      question: 'q',
      context: { vars: ['topic'] },
    },
  });
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'approve');
  await replaceCode(page, codeField(dialog, 'evaluation.question'), 'updated');
  await dialog.getByRole('tab', { name: 'Context' }).click();
  const last = dialog.getByRole('switch', { name: 'Include last output' });
  await last.click();
  await page.keyboard.press('Control+z');
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('tab', { name: 'Context' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Control+z');
  await expect(codeField(dialog, 'evaluation.question')).toHaveText('q');
  await expect(dialog.getByRole('tab', { name: 'Context' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Control+Shift+z');
  await expect(codeField(dialog, 'evaluation.question')).toHaveText('updated');
  const advanced = await openAdvanced(dialog);
  await dialog.getByLabel('Vars 1', { exact: true }).fill('bad value');
  await advanced.click();
  await dialog.getByRole('tab', { name: /^Settings/ }).click();
  await expect(dialog.getByRole('tab', { name: 'Context 1 error' })).toBeVisible();
  await dialog.getByRole('button', { name: /issues? on approve$/ }).click();
  await page
    .getByRole('dialog', { name: 'Issues on approve' })
    .getByRole('button', { name: /config.evaluation.context.vars.0/ })
    .click();
  await expect(dialog.getByRole('tab', { name: 'Context 1 error' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('button', { name: /^Advanced/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(dialog.getByLabel('Vars 1', { exact: true })).toBeFocused();
  await closeNode(page);

  const inferId = await create(request, 'inference', {
    prompt: { template: 'hi' },
    input: [{ op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'topic' } }],
  });
  await page.goto(`/app/loops/${inferId}/edit`);
  const infer = await openNode(page, 'approve');
  await infer.getByRole('tab', { name: 'Context' }).click();
  await infer.getByRole('button', { name: /^Input 1 set/ }).click();
  await replaceCode(page, codeField(infer, 'input.0.value.value'), '{held');
  await infer.getByRole('tab', { name: /^Settings/ }).click();
  await infer.getByRole('tab', { name: /^Context/ }).click();
  await expect(codeField(infer, 'input.0.value.value')).toHaveText('{held');
  await expect
    .poll(() => savedConfig(request, inferId))
    .toMatchObject({ input: [{ value: { value: 'topic' } }] });
});

for (const theme of ['dark', 'light']) {
  test(`${theme}: node widths and both mounted panels fit at 360, 768, 1024, 1440 and 1920 px`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
    const inferId = await create(request, 'inference', {
      prompt: { template: 'A longer authored prompt' },
      contextFiles: [{ path: 'context.txt', template: 'Topic {{ vars.topic }}' }],
      input: [{ op: 'delete', path: '/vars/topic' }],
    });
    const decisionId = await create(request, 'decision', {
      answer: noul,
      evaluation: {
        kind: 'classifier',
        model: 'jev',
        question: 'Evaluate the current state',
        minConfidence: 0.4,
        truthThreshold: 0.5,
        context: { vars: ['topic'] },
      },
    });
    for (const [nodeName, id] of [
      ['inference', inferId],
      ['decision', decisionId],
    ] as const) {
      for (const width of [360, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/loops/${id}/edit`);
        const dialog = await openNode(page, 'approve');
        const expectedWidth = width < 768 ? width : width < 1024 ? 640 : width < 1280 ? 832 : 1024;
        expect((await dialog.boundingBox())!.width).toBe(expectedWidth);
        if (width < 768)
          expect((await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height).toBe(900);
        for (const tab of ['Settings', 'Context']) {
          await dialog.getByRole('tab', { name: tab }).click();
          await dialog.locator(':scope > div').evaluate((body) => (body.scrollTop = 0));
          if (width === 1440)
            await dialog.screenshot({
              path: info.outputPath(`${theme}-${nodeName}-${width}-${tab}-collapsed.png`),
            });
          for (const toggle of await dialog.getByRole('button', { name: /^Advanced/ }).all()) {
            if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
          }
          const failures = await dialog.evaluate((root) => {
            const failures: string[] = [];
            for (const element of root.querySelectorAll<HTMLElement>(
              'button, input:not([type=hidden]), select, textarea, .cm-editor',
            )) {
              if (element.closest('[hidden]')) continue;
              const control =
                element instanceof HTMLInputElement && element.type === 'radio'
                  ? element.closest('label')!
                  : element;
              const box = control.getBoundingClientRect();
              if (box.width <= 1 || box.height <= 1) continue;
              for (let parent = control.parentElement; parent; parent = parent.parentElement) {
                if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX)) {
                  const clip = parent.getBoundingClientRect();
                  if (
                    box.left < clip.left + parent.clientLeft - 1 ||
                    box.right > clip.left + parent.clientLeft + parent.clientWidth + 1
                  )
                    failures.push(
                      element.getAttribute('aria-label') ?? element.textContent ?? element.tagName,
                    );
                }
              }
            }
            const body = root.querySelector(':scope > div')!;
            if (body.scrollWidth > body.clientWidth) failures.push('horizontal scroll');
            return failures;
          });
          expect(failures, `${theme} ${width} ${tab}`).toEqual([]);
          await dialog.locator(':scope > div').evaluate((body) => (body.scrollTop = 0));
          await dialog.screenshot({
            path: info.outputPath(`${theme}-${nodeName}-${width}-${tab}.png`),
          });
        }
        await closeNode(page);
      }
    }
    // The unrelated confirmation keeps its existing 520px maximum.
    await page.goto('/app/loops');
    await page
      .locator('tr')
      .filter({ has: page.locator(`a[href="/app/loops/${inferId}/edit"]`) })
      .getByRole('button', { name: /^Delete Placement inference$/ })
      .click();
    expect((await page.getByRole('alertdialog').boundingBox())!.width).toBe(520);
  });
}
