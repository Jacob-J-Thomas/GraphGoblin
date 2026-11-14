/**
 * #8: the shared form controls in Edge. Switches, segmented controls, and selects work by keyboard
 * and save what they show; Tab leaves a code field; required fields carry their marker and
 * `aria-required`; an error describes its control; the file picker is a labelled native input.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  approvalLoop,
  chooseOptionByKeyboard,
  expect,
  openAdvanced,
  openNode,
  publishLoop,
  test,
} from './fixtures.js';

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
  await openAdvanced(dialog);

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
  await openAdvanced(dialog);
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
  // A select (more than four options) by native keyboard typeahead: choose no reasoning explicitly.
  const effort = dialog.getByLabel('Effort', { exact: true });
  await expect(effort).toHaveValue('');
  await effort.focus();
  await chooseOptionByKeyboard(page, effort, 'none (no reasoning)');
  await expect(effort).toHaveValue('none');
  await expect.poll(async () => (await savedConfig(request, id))?.['effort']).toBe('none');

  const decisionId = await createLoop(request, 'decision', {
    kind: 'classifier',
    model: 'jev',
    question: 'Choose whether to continue.',
    answer: {
      type: 'choice',
      options: [
        { id: 'out', label: 'Continue', criteria: 'The work is complete' },
        { id: 'no', label: 'Stop', criteria: 'The work is incomplete' },
      ],
    },
  });
  await page.goto(`/app/loops/${decisionId}/edit`);
  const decision = await openNode(page, 'approve');
  await openAdvanced(decision);
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
  const outputs = dialog.getByRole('button', { name: 'Earlier node outputs (1)', exact: true });
  // The outputs disclosure follows CodeMirror before the array item's Remove button (#341).
  await page.keyboard.press('Tab');
  await expect(outputs).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await focusedName(page)).toBe('Remove args 1');
  await page.keyboard.press('Shift+Tab');
  await expect(outputs).toBeFocused();
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
  // The refusal describes the picker too, after the chosen file's name.
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveAccessibleDescription(
    'not-a-loop.json not-a-loop.json is not a JSON document.',
  );
});

test('the run form keeps a long choice inside its field and puts each problem beside its field', async ({
  page,
  request,
}) => {
  const long = 'Escalate to the on-call reviewer and wait for their decision';
  expect(long).toHaveLength(60);
  const definition = approvalLoop('controls run form');
  const id = await publishLoop(request, {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.id === 'start'
        ? {
            ...node,
            config: {
              type: 'manual',
              inputSchema: {
                type: 'object',
                required: ['approved', 'next'],
                properties: {
                  approved: { type: 'boolean', title: 'Approval' },
                  next: { enum: [long, 'Stop here'], title: 'Next step' },
                  reason: { type: 'string', title: 'Reason', minLength: 3 },
                },
              },
            },
          }
        : node,
    ),
  });
  await page.goto(`/app/runs/new?loop=${id}`);
  const next = page.getByRole('radiogroup', { name: 'Next step', exact: true });
  const option = next.getByRole('radio', { name: long, exact: true });
  const text = next.getByText(long, { exact: true });
  await expect(option).toHaveCount(1);
  // The 60-character segment stays inside its field (440 px at most): whole when it fits, cut
  // short with an ellipsis when the window is narrow, and never widening the field or the page.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const field = await next.boundingBox();
    const segment = await next.locator('label').filter({ hasText: long }).boundingBox();
    expect(field?.width).toBeLessThanOrEqual(440);
    expect((segment?.x ?? 0) + (segment?.width ?? 0)).toBeLessThanOrEqual(
      (field?.x ?? 0) + (field?.width ?? 0) + 0.5,
    );
    expect(await next.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(width === 390);
  }
  await expect(text.locator('xpath=..')).toHaveAttribute('title', long);
  await text.click();
  await expect(option).toBeChecked();
  await page.setViewportSize({ width: 1280, height: 900 });

  // Problems sit beside their fields: the unchosen required boolean and a short reason.
  await page.getByLabel('Reason', { exact: true }).fill('ab');
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const approval = page.getByRole('radiogroup', { name: 'Approval', exact: true });
  await expect(approval).toHaveAttribute('aria-invalid', 'true');
  await expect(approval).toHaveAccessibleDescription('Approval is required');
  const reason = page.getByLabel('Reason', { exact: true });
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(reason).toHaveAccessibleDescription(/Reason must NOT have fewer than 3 characters/);
  await expect(page).toHaveURL(/\/app\/runs\/new/);
});

test('New run and Wait send the supplied input and omit untouched or reset fields (#235)', async ({
  page,
  request,
}) => {
  const inputSchema = {
    type: 'object',
    required: ['reason'],
    properties: {
      untouched: { type: 'string' },
      comment: { type: 'string' },
      message: { type: 'string' },
      title: { type: 'string', minLength: 1 },
      reason: { type: 'string' },
      number: { type: 'number' },
      metadata: { type: 'null' },
      approved: { type: 'boolean' },
    },
  };
  const definition = approvalLoop('explicit input presence');
  const loopId = await publishLoop(request, {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (node.id === 'start') return { ...node, config: { ...node.config, inputSchema } };
      if (node.id === 'approve') return { ...node, config: { ...node.config, inputSchema } };
      return {
        ...node,
        config: { returns: '{"started": trigger.payload, "answered": lastOutput.value}' },
      };
    }),
  });
  const input = {
    message: '',
    title: 'ok',
    reason: '',
    number: 0,
    metadata: null,
    approved: false,
  };

  async function enterInput(submitLabel: string, omitBy: 'keyboard' | 'click') {
    const form = page.getByRole('form', { name: submitLabel });
    const message = form.getByLabel('message', { exact: true });
    await message.fill('clear this');
    await message.clear();
    // Cleared text is the empty string, and its placeholder says so.
    await expect(message).toHaveAttribute('placeholder', '""');
    const title = form.getByLabel('title', { exact: true });
    const reason = form.getByLabel('reason', { exact: true });
    const number = form.getByLabel('number', { exact: true });
    const metadata = form.getByLabel('metadata', { exact: true });
    await title.fill('1');
    await title.clear();
    await reason.fill('r');
    await reason.clear();
    // The native number input holds "-", which it reports as an empty value.
    await number.press('-');
    expect(await number.evaluate((el: HTMLInputElement) => el.validity.badInput)).toBe(true);
    await metadata.fill(' ');
    const submit = form.getByRole('button', { name: submitLabel });
    await submit.click();
    await expect(title).toHaveAccessibleDescription(/must NOT have fewer than 1/);
    await expect(number).toHaveAccessibleDescription('number: enter a number');
    await expect(metadata).toHaveAccessibleDescription(/metadata: invalid JSON/);
    // Required text cleared to "" is valid here, and has no way back to absent.
    await expect(reason).not.toHaveAttribute('aria-invalid');
    await expect(form.getByRole('button', { name: 'Omit reason', exact: true })).toHaveCount(0);

    await number.fill('1');
    await number.clear();
    await submit.click();
    await expect(number).toHaveAccessibleDescription('number: enter a number');

    // Omit appears in the label's line without moving the field, and takes the field back to
    // absent with focus on it.
    const comment = form.getByLabel('comment', { exact: true });
    const omit = form.getByRole('button', { name: 'Omit comment', exact: true });
    const offset = () =>
      comment.evaluate(
        (el) => el.getBoundingClientRect().top - el.closest('form')!.getBoundingClientRect().top,
      );
    const resting = await offset();
    await comment.fill('drop this');
    await expect(omit).toBeVisible();
    expect(await offset()).toBe(resting);
    const [field, button] = await Promise.all([comment.boundingBox(), omit.boundingBox()]);
    expect(button!.y + button!.height).toBeLessThanOrEqual(field!.y);
    if (omitBy === 'keyboard') {
      await comment.press('Shift+Tab');
      await expect(omit).toBeFocused();
      await page.keyboard.press('Enter');
    } else {
      await omit.click();
    }
    await expect(comment).toBeFocused();
    await expect(comment).toHaveValue('');
    await expect(omit).toHaveCount(0);
    expect(await offset()).toBe(resting);

    await title.fill('ok');
    await number.fill('0');
    await metadata.fill('null');
    // The radio is visually hidden: a click on its visible label chooses it.
    const approved = form.getByRole('radiogroup', { name: 'approved' });
    await approved.getByText('No', { exact: true }).click();
    await expect(approved.getByRole('radio', { name: 'No', exact: true })).toBeChecked();
    return submit;
  }

  await page.goto(`/app/runs/new?loop=${loopId}`);
  const start = await enterInput('Start run', 'keyboard');
  const started = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname === `/loops/${loopId}/runs`,
  );
  await start.click();
  expect((await started).postDataJSON().input).toEqual(input);
  await expect(page.getByText('Input requested')).toBeVisible();
  const runId = new URL(page.url()).pathname.split('/').at(-1);

  const respond = await enterInput('Submit input', 'click');
  const observed = await (await request.get(`/runs/${runId}`)).json();
  const answered = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).pathname === `/runs/${runId}/input`,
  );
  await respond.click();
  expect((await answered).postDataJSON()).toEqual({ waitId: observed.waiting.waitId, input });
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const completed = await (await request.get(`/runs/${runId}`)).json();
  expect(completed.result).toEqual({ started: input, answered: input });
});

test.describe('with a coarse pointer (#235)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  // The browser moves a touch that lands near a button onto it, even over a text field. A tap on
  // the top of an edited field must keep its text, and Omit must still take a tap of its own.
  test('a tap on an edited field never omits it, and a tap on Omit does', async ({
    page,
    request,
  }) => {
    const definition = approvalLoop('coarse omit');
    const loopId = await publishLoop(request, {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === 'start'
          ? {
              ...node,
              config: {
                ...node.config,
                inputSchema: {
                  type: 'object',
                  properties: {
                    first: { type: 'string' },
                    comment: { type: 'string' },
                    details: { type: 'object' },
                  },
                },
              },
            }
          : node,
      ),
    });
    await page.goto(`/app/runs/new?loop=${loopId}`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const form = page.getByRole('form', { name: 'Start run' });

    for (const name of ['comment', 'details']) {
      const field = form.getByLabel(name, { exact: true });
      const omit = form.getByRole('button', { name: `Omit ${name}`, exact: true });
      const offset = () =>
        field.evaluate(
          (el) => el.getBoundingClientRect().top - el.closest('form')!.getBoundingClientRect().top,
        );
      const resting = await offset();
      await field.fill('typed');
      await expect(omit).toBeVisible();
      expect(await offset()).toBe(resting);
      await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const button = (await omit.boundingBox())!;
      const top = (await field.boundingBox())!.y;
      // The button stands clear of the field, beyond where the browser would move a tap onto it.
      expect(top - (button.y + button.height)).toBeGreaterThanOrEqual(8);

      // Real touches over the top of the field, across and beyond the button's width.
      const wrong: string[] = [];
      for (
        let x = Math.floor(button.x) - 24;
        x <= Math.ceil(button.x + button.width) + 24;
        x += 6
      ) {
        for (let depth = 0; depth <= 14; depth += 2) {
          await page.touchscreen.tap(x, top + depth);
          if ((await omit.count()) === 0) {
            wrong.push(`x ${x}, ${depth} px into the field`);
            await field.fill('typed');
            await expect(omit).toBeVisible();
          }
        }
      }
      expect(wrong).toEqual([]);
      await expect(field).toHaveValue('typed');

      // A tap on the button itself omits the field.
      await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
      await expect(omit).toHaveCount(0);
      await expect(field).toHaveValue('');
    }
  });
});
