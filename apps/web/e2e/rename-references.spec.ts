/**
 * Renaming a node repairs the references the domain understands (#273, ADR-0075), against the built
 * app and the real API in Edge: the Starter's sibling Liquid and Exit, one undo step saved once with
 * its draft token and device copy, a reload, an immutable earlier version and pinned runs on both
 * versions; uncertain, optional and known-missing references with their notice rows, badges and
 * Publish; focus and unfinished input through repaired forms; a stale tab; and the protected
 * voice steps of a system Chat loop. Every loop name is unique on the shared gateway (#209).
 */
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { createSystemChatDefinition, enableChatAudio } from '@graphgoblin/domain';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  control,
  expect,
  openDraftTab,
  openNode,
  showLoopPanel,
  test,
  uniqueLoopName,
} from './fixtures.js';

interface NodeShape {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  ui?: { x: number; y: number };
}
interface EdgeShape {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}
interface Definition {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  nodes: NodeShape[];
  edges: EdgeShape[];
}
interface VersionRecord {
  id: string;
  version: number;
  status: string;
  definition: Definition;
}
interface LoopDetail {
  loop: { id: string; name: string; currentVersionId?: string; draftVersionId?: string };
  current?: VersionRecord;
  draft?: VersionRecord;
  draftToken?: string;
}

async function detail(request: APIRequestContext, loopId: string, base = ''): Promise<LoopDetail> {
  const response = await request.get(`${base}/loops/${loopId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as LoopDetail;
}

/** The definition the editor works on (the draft, else the published version) and its token. */
async function serverDraft(request: APIRequestContext, loopId: string, base = '') {
  const body = await detail(request, loopId, base);
  return { definition: (body.draft ?? body.current)!.definition, token: body.draftToken! };
}

async function createLoop(request: APIRequestContext, definition: unknown): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

async function putDraft(
  request: APIRequestContext,
  loopId: string,
  definition: Definition,
  token: string,
) {
  const saved = await request.put(`/loops/${loopId}/draft`, {
    data: { definition },
    headers: { 'if-match': `"${token}"` },
  });
  expect(saved.status()).toBe(200);
}

/** Every draft save the page sends, with the answer the API gave it. */
function draftSaves(page: Page, loopId: string) {
  const saves: { ifMatch: string | undefined; definition: Definition; status: number }[] = [];
  page.on('response', (response) => {
    const sent = response.request();
    if (sent.method() !== 'PUT' || !sent.url().endsWith(`/loops/${loopId}/draft`)) return;
    saves.push({
      ifMatch: sent.headers()['if-match'],
      definition: (sent.postDataJSON() as { definition: Definition }).definition,
      status: response.status(),
    });
  });
  return saves;
}

/** This device's IndexedDB copy of the loop, read without upgrading the editor's database. */
async function deviceCopy(page: Page, loopId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('graphgoblin', 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB open failed'));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const read = db.transaction('drafts', 'readonly').objectStore('drafts').get(id);
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error('IndexedDB read failed'));
      });
    } finally {
      db.close();
    }
  }, loopId) as Promise<{ definition: Definition; synced: boolean; baseToken?: string }>;
}

/**
 * Enter unfinished text in a CodeMirror field, found by its accessible label, by typing over the
 * selected text in one input. A live JSON field accepts an emptied editor as a valid, empty value
 * and saves it (the variable disappears from the draft), so deleting first would change the draft
 * before the unfinished text exists. Selecting and inserting never passes through that empty state.
 */
async function holdCode(scope: Page | Locator, page: Page, label: string, text: string) {
  const content = scope.locator('.cm-content').and(scope.getByLabel(label, { exact: true }));
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

/** Replace the text of the CodeMirror field at a config path (`data-field`). */
async function codeAt(scope: Locator, page: Page, path: string, text: string) {
  await scope.locator(`[data-field="${path}"] .cm-content`).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

const codeText = (scope: Page | Locator, label: string) =>
  scope.locator('.cm-content').and(scope.getByLabel(label, { exact: true }));
const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const badge = (page: Page, id: string) =>
  card(page, id).getByRole('button', { name: new RegExp(`^\\d+ issues? on ${id}$`) });
const popover = (page: Page, id: string) => page.getByRole('dialog', { name: `Issues on ${id}` });
const renameNotice = (scope: Page | Locator, from: string, to: string) =>
  scope.getByRole('status').filter({ hasText: `Renamed ${from} to ${to}` });
const saved = (page: Page) =>
  expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 30_000 });
/** The system Chat loop's response envelope expression. */
const envelope = (definition: Definition) =>
  (
    nodeOf(definition, 'chat-envelope').config['operations'] as { value: { jsonata?: string } }[]
  )[0]!.value.jsonata;

/**
 * Open a node's editor from the keyboard (its card, then Enter), for cards that another card's
 * pointer area overlaps in a generated layout.
 */
async function openByKeyboard(page: Page, nodeId: string) {
  await page.getByTestId(`rf__node-${nodeId}`).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Rename the open node with its Node id field and Enter. */
async function renameInDialog(dialog: Locator, next: string) {
  const id = dialog.getByLabel('Node id');
  await id.fill(next);
  await id.press('Enter');
}

/** A run pinned to one version, followed to its end through the public API. */
async function pinnedRun(request: APIRequestContext, loopId: string, versionId: string) {
  const started = await request.post(`/loops/${loopId}/runs`, { data: { versionId } });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string; versionId: string } };
  expect(run.versionId).toBe(versionId);
  let snapshot: { status: string; result?: unknown; versionId?: string } = { status: 'queued' };
  await expect
    .poll(
      async () => {
        snapshot = (await (await request.get(`/runs/${run.id}`)).json()) as typeof snapshot;
        return snapshot.status;
      },
      { timeout: 30_000 },
    )
    .toBe('succeeded');
  return snapshot;
}

const nodeOf = (definition: Definition, id: string) => definition.nodes.find((n) => n.id === id)!;

test('Starter assistant to writer: one saved step repairs the sibling Liquid and the Exit, and both versions run', async ({
  page,
  request,
}) => {
  // The Starter copied under a deliberate name, with a sibling that reads the assistant in Liquid,
  // prose and a JSON value that only mention it, and a script that reads the thread.
  const name = uniqueLoopName('Rename Starter writer');
  const copied = await request.post('/templates/starter/draft', { data: { name } });
  expect(copied.status()).toBe(201);
  const loopId = ((await copied.json()) as { loop: { id: string } }).loop.id;
  const fromTemplate = await serverDraft(request, loopId);
  const assistant = nodeOf(fromTemplate.definition, 'assistant');
  const instructions = nodeOf(fromTemplate.definition, 'instructions');
  const setup: Definition = {
    ...fromTemplate.definition,
    nodes: [
      ...fromTemplate.definition.nodes.map((node) =>
        node.id === 'instructions'
          ? {
              ...node,
              config: {
                ...node.config,
                operations: [
                  ...(instructions.config['operations'] as unknown[]),
                  {
                    op: 'set',
                    path: '/vars/source',
                    value: {
                      kind: 'literal',
                      value: { reads: 'outputs.assistant.value', step: 'assistant' },
                    },
                  },
                ],
              },
            }
          : node,
      ),
      {
        id: 'review',
        kind: 'inference',
        label: 'Review',
        ui: { x: 810, y: 160 },
        config: {
          ...assistant.config,
          prompt: {
            template: 'The assistant step wrote:\n{{ outputs.assistant.value }}\nReview it.',
          },
        },
      },
      {
        id: 'archive',
        kind: 'script',
        label: 'Archive',
        ui: { x: 1080, y: 160 },
        config: {
          command: process.execPath,
          args: ['-e', 'process.stdin.resume() // the thread holds outputs.assistant.value'],
          cwd: 'workspace',
          stdin: 'thread',
          stdout: 'ignore',
        },
      },
    ],
    edges: [
      ...fromTemplate.definition.edges.filter((edge) => edge.id !== 'assistant-out-done'),
      {
        id: 'assistant-out-review',
        from: { node: 'assistant', port: 'out' },
        to: { node: 'review', port: 'in' },
      },
      {
        id: 'review-out-archive',
        from: { node: 'review', port: 'out' },
        to: { node: 'archive', port: 'in' },
      },
      {
        id: 'archive-out-done',
        from: { node: 'archive', port: 'out' },
        to: { node: 'done', port: 'in' },
      },
    ],
  };
  await putDraft(request, loopId, setup, fromTemplate.token);
  const v1Published = await request.post(`/loops/${loopId}/publish`);
  expect(v1Published.status()).toBe(200);
  const v1 = ((await v1Published.json()) as { version: VersionRecord }).version;
  const before = await serverDraft(request, loopId);
  expect(nodeOf(before.definition, 'done').config['returns']).toBe('outputs.assistant.value');

  // What the rename must produce: the id, its two connection ends, and two references.
  const renamed: Definition = {
    ...before.definition,
    nodes: before.definition.nodes.map((node) => {
      if (node.id === 'assistant') return { ...node, id: 'writer' };
      if (node.id === 'review')
        return {
          ...node,
          config: {
            ...node.config,
            prompt: {
              ...(node.config['prompt'] as Record<string, unknown>),
              template: 'The assistant step wrote:\n{{ outputs.writer.value }}\nReview it.',
            },
          },
        };
      if (node.id === 'done')
        return { ...node, config: { ...node.config, returns: 'outputs.writer.value' } };
      return node;
    }),
    edges: before.definition.edges.map((edge) => ({
      ...edge,
      from: edge.from.node === 'assistant' ? { ...edge.from, node: 'writer' } : edge.from,
      to: edge.to.node === 'assistant' ? { ...edge.to, node: 'writer' } : edge.to,
    })),
  };

  const saves = draftSaves(page, loopId);
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await saved(page);
  expect(saves).toHaveLength(0);

  const dialog = await openNode(page, 'assistant');
  await expect(dialog).toHaveAccessibleName('Edit inference assistant');
  await renameInDialog(dialog, 'writer');
  await expect(dialog).toHaveAccessibleName('Edit inference writer');
  await expect(dialog.getByLabel('Node id')).toBeFocused();
  const inDialog = renameNotice(dialog, 'assistant', 'writer');
  await expect(inDialog).toContainText(
    'Updated 2 references in expressions, templates and mutation paths, and 2 connections. ' +
      'Plain text, JSON values and scripts are not changed.',
  );
  await expect(inDialog).toContainText('Review one place where assistant may remain:');
  await expect(inDialog).toContainText(
    'Check scripts and generated patches for references to the old ID.',
  );
  await expect(inDialog.getByRole('button', { name: /scripts and generated patches/ })).toHaveCount(
    0,
  );
  await expect(inDialog).toContainText('Undo reverses the whole rename.');

  // The whole rename is one save against the loaded token, and the device copy follows it.
  await saved(page);
  expect(saves).toHaveLength(1);
  expect(saves[0]!.ifMatch).toBe(`"${before.token}"`);
  expect(saves[0]!.status).toBe(200);
  expect(saves[0]!.definition).toEqual(renamed);
  const afterRename = await serverDraft(request, loopId);
  expect(afterRename.definition).toEqual(renamed);
  await expect
    .poll(async () => {
      const copy = await deviceCopy(page, loopId);
      return { definition: copy.definition, synced: copy.synced, baseToken: copy.baseToken };
    })
    .toEqual({ definition: renamed, synced: true, baseToken: afterRename.token });

  // Closing returns to the canvas; the page notice and one labelled undo step remain.
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(renameNotice(page, 'assistant', 'writer')).toBeVisible();
  const undo = page.getByRole('button', { name: /^Undo/ });
  await expect(undo).toHaveAccessibleName('Undo rename assistant to writer');

  // Undo restores every source and edge end, saved against the rename's token; redo returns.
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(renameNotice(page, 'assistant', 'writer')).toHaveCount(0);
  await expect(card(page, 'assistant')).toBeVisible();
  await saved(page);
  expect(saves).toHaveLength(2);
  expect(saves[1]!.ifMatch).toBe(`"${afterRename.token}"`);
  expect(saves[1]!.definition).toEqual(before.definition);
  const afterUndo = await serverDraft(request, loopId);
  expect(afterUndo.definition).toEqual(before.definition);
  await page.keyboard.press('Control+Shift+z');
  await expect(card(page, 'writer')).toBeVisible();
  await saved(page);
  expect(saves).toHaveLength(3);
  expect(saves[2]!.ifMatch).toBe(`"${afterUndo.token}"`);
  expect(saves[2]!.definition).toEqual(renamed);
  const afterRedo = await serverDraft(request, loopId);
  expect(afterRedo.definition).toEqual(renamed);

  // A reload shows the saved rename without a notice, and the sibling's repaired Liquid.
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(card(page, 'writer')).toBeVisible();
  await expect(renameNotice(page, 'assistant', 'writer')).toHaveCount(0);
  await saved(page);
  expect(saves).toHaveLength(3);
  const review = await openNode(page, 'review');
  await expect(review.locator('[data-field="prompt.template"] .cm-content')).toHaveText(
    'The assistant step wrote:{{ outputs.writer.value }}Review it.',
  );
  await review.getByRole('button', { name: 'Done', exact: true }).click();

  // Publish: the new version is the saved draft, and version 1 keeps its original ids.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 2.')).toBeVisible();
  const versions = (await (await request.get(`/loops/${loopId}/versions`)).json()) as {
    items: VersionRecord[];
  };
  const v2 = versions.items.find((v) => v.version === 2)!;
  expect(v2.definition).toEqual(renamed);
  const v1Now = (await (
    await request.get(`/loops/${loopId}/versions/${v1.id}`)
  ).json()) as VersionRecord;
  expect(v1Now.definition).toEqual(before.definition);
  expect(v1Now.definition).toEqual(v1.definition);

  // Provider-free pinned runs: each version reads its own inference node's output.
  await control(request, '/harness/script', {
    turns: [
      { matchPrompt: 'Instructions:', finalText: 'Summary from the renamed writer.' },
      { matchPrompt: 'The assistant step wrote:', finalText: 'Reviewed.' },
    ],
  });
  const second = await pinnedRun(request, loopId, v2.id);
  expect(second.result).toBe('Summary from the renamed writer.');
  await control(request, '/harness/script', {
    turns: [
      { matchPrompt: 'Instructions:', finalText: 'Summary from the original assistant.' },
      { matchPrompt: 'The assistant step wrote:', finalText: 'Reviewed.' },
    ],
  });
  const first = await pinnedRun(request, loopId, v1.id);
  expect(first.result).toBe('Summary from the original assistant.');
});

test('uncertain, optional and known-missing references: notice rows, badges and Publish', async ({
  page,
  request,
}) => {
  const name = uniqueLoopName('Rename uncertain references');
  const definition: Definition = {
    name,
    variables: { key: { type: 'string' } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'work',
        kind: 'mutate',
        label: 'Work',
        config: {
          operations: [
            { op: 'set', path: '/vars/key', value: { kind: 'literal', value: 'probe' } },
          ],
        },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'probe',
        kind: 'script',
        label: 'Probe',
        config: { command: process.execPath, args: ['-e', ''], cwd: 'workspace', stdin: 'thread' },
        ui: { x: 520, y: 80 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '$lookup(outputs, vars.key)' },
        ui: { x: 780, y: 80 },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'probe', port: 'in' } },
      { id: 'e3', from: { node: 'probe', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
  const loopId = await createLoop(request, {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    ...definition,
  });
  const v1Published = await request.post(`/loops/${loopId}/publish`);
  expect(v1Published.status()).toBe(200);
  const v1 = ((await v1Published.json()) as { version: VersionRecord }).version;

  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await saved(page);
  // The dynamic read is a persistent warning on the Exit before any rename.
  await badge(page, 'done').click();
  await expect(
    popover(page, 'done').getByRole('button', { name: /NODE_REFERENCE_UNCERTAIN/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const dialog = await openNode(page, 'work');
  await renameInDialog(dialog, 'task');
  await expect(dialog).toHaveAccessibleName('Edit mutate task');
  const inDialog = renameNotice(dialog, 'work', 'task');
  await expect(inDialog).toContainText(
    'Updated 2 connections. Plain text, JSON values and scripts are not changed.',
  );
  await expect(inDialog).toContainText('Review 2 places where work may remain:');
  const row = inDialog.getByRole('button', { name: /node done config\.returns/ });
  await expect(row).toContainText('Warning');
  await expect(row).toContainText('NODE_REFERENCE_UNCERTAIN');
  await expect(inDialog).toContainText(
    'Check scripts and generated patches for references to the old ID.',
  );
  await expect(inDialog.getByRole('button', { name: /scripts and generated patches/ })).toHaveCount(
    0,
  );
  // Dismiss inside the dialog returns focus to Node id; the page keeps its own notice.
  await inDialog.getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(renameNotice(dialog, 'work', 'task')).toHaveCount(0);
  await expect(dialog.getByLabel('Node id')).toBeFocused();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await saved(page);
  expect(
    (await serverDraft(request, loopId)).definition.edges.map((e) => [e.from.node, e.to.node]),
  ).toEqual([
    ['start', 'task'],
    ['task', 'probe'],
    ['probe', 'done'],
  ]);

  // Dismissing the dialog's copy ended the report, so the page shows no notice either. Rename
  // again and choose the row from the page with the keyboard.
  await expect(renameNotice(page, 'work', 'task')).toHaveCount(0);
  const again = await openNode(page, 'task');
  await renameInDialog(again, 'prepare');
  await again.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const onPage = renameNotice(page, 'task', 'prepare');
  const pageRow = onPage.getByRole('button', { name: /node done config\.returns/ });
  await pageRow.focus();
  await page.keyboard.press('Enter');
  const exit = page.getByRole('dialog', { name: 'Edit exit done' });
  await expect(exit).toBeVisible();
  // The Returns field's first value control is its mode (focus-field.ts, as the badge's rows do):
  // the checked "JSONata expression" choice, with the expression editor the next Tab stop.
  const mode = exit
    .locator('[data-field="returns"]')
    .getByRole('radio', { name: 'JSONata expression' });
  await expect(mode).toBeFocused();
  expect(await mode.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(exit.locator('[data-field="returns"] .cm-content')).toBeFocused();

  // A known missing gate is an error: the draft saves, Publish is refused with 422.
  await codeAt(exit, page, 'returns', 'gates.missing.passes');
  await exit.getByRole('button', { name: 'Done', exact: true }).click();
  await saved(page);
  expect(nodeOf((await serverDraft(request, loopId)).definition, 'done').config['returns']).toBe(
    'gates.missing.passes',
  );
  await expect(page.getByRole('button', { name: /^1 error/ })).toBeVisible();
  await badge(page, 'done').click();
  await expect(
    popover(page, 'done').getByRole('button', { name: /NODE_REFERENCE_MISSING/ }),
  ).toContainText('Error');
  await page.keyboard.press('Escape');
  const refused = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/loops/${loopId}/publish`),
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const refusal = await refused;
  expect(refusal.status()).toBe(422);
  const problem = (await refusal.json()) as { code: string; errors?: { code: string }[] };
  expect(problem.code).toBe('LOOP_INVALID');
  expect(problem.errors?.map((issue) => issue.code)).toContain('NODE_REFERENCE_MISSING');
  await expect(page.getByRole('alert').filter({ hasText: 'Publish failed' })).toBeVisible();
  expect((await detail(request, loopId)).loop.currentVersionId).toBe(v1.id);

  // A direct existence probe of the same gate is only a warning, and Publish accepts it.
  const optional = await openNode(page, 'done');
  await codeAt(optional, page, 'returns', '$exists(gates.missing) ? 1 : 0');
  await optional.getByRole('button', { name: 'Done', exact: true }).click();
  await saved(page);
  await expect(page.getByRole('button', { name: /error/ })).toHaveCount(0);
  await badge(page, 'done').click();
  await expect(
    popover(page, 'done').getByRole('button', { name: /NODE_REFERENCE_OPTIONAL_MISSING/ }),
  ).toContainText('Warning');
  await page.keyboard.press('Escape');
  const accepted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/loops/${loopId}/publish`),
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  expect((await accepted).status()).toBe(200);
  await expect(page.getByText('Published version 2.')).toBeVisible();
  const v1Now = (await (
    await request.get(`/loops/${loopId}/versions/${v1.id}`)
  ).json()) as VersionRecord;
  expect(v1Now.definition).toEqual(v1.definition);
  expect(nodeOf(v1Now.definition, 'work').id).toBe('work');
});

test('focus stays in the repaired form, and unfinished input elsewhere survives the rename', async ({
  page,
  request,
}) => {
  const name = uniqueLoopName('Rename focus and held text');
  const loopId = await createLoop(request, {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    settings: {
      workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.work.value }}' },
    },
    variables: { key: { type: 'string' } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'cron', expression: '30 7 * * 1', timezone: 'UTC' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Do the work.' } },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'counters.nodeVisits.gate > 2 ? "stop" : "again"',
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'stop', label: 'Stop' },
          ],
          maxPasses: 3,
        },
        ui: { x: 520, y: 80 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: 'outputs.work.value' },
        ui: { x: 800, y: 80 },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'gate', port: 'in' } },
      { id: 'e3', from: { node: 'gate', port: 'again' }, to: { node: 'work', port: 'in' } },
      { id: 'e4', from: { node: 'gate', port: 'stop' }, to: { node: 'done', port: 'in' } },
      { id: 'e5', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'done', port: 'in' } },
    ],
  });
  const saves = draftSaves(page, loopId);
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await saved(page);

  // Unfinished input in two other places: the variables JSON and the trigger's schedule. The
  // variables text replaces the selected value in one input (see holdCode).
  await showLoopPanel(page);
  await holdCode(page, page, 'Variables value 1', '[1, ');
  await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');
  const start = await openNode(page, 'start');
  await start.getByLabel('Monday').uncheck();
  await expect(start.getByRole('alert')).toHaveText('Choose at least one day.');
  await start.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Before any rename: unfinished input is not a draft change, so the accepted draft on the server
  // is still the loop as created, with its original variable value and node ids, and the page has
  // sent no save. This is the value the last line of the test checks again.
  await expect(page.getByTestId('draft-state')).toHaveText('Draft saved', { timeout: 30_000 });
  await expect(page.getByTestId('held-input-state')).toBeVisible();
  await expect(page.getByTestId('held-input-state')).toContainText(
    'Field input kept in this window only',
  );
  const accepted = (await serverDraft(request, loopId)).definition;
  expect(accepted.variables).toEqual({ key: { type: 'string' } });
  expect(accepted.nodes.map((n) => n.id)).toEqual(['start', 'work', 'gate', 'done']);
  expect(saves).toHaveLength(0);

  // Click: the id applies as focus leaves, and focus lands in the repaired form's field.
  let gate = await openNode(page, 'gate');
  const passes = () => gate.getByLabel('Maximum passes', { exact: true });
  await gate.getByLabel('Node id').fill('check');
  await passes().click();
  await expect(gate).toHaveAccessibleName('Edit decision check');
  await expect(codeText(gate, 'Jsonata')).toHaveText(
    'counters.nodeVisits.check > 2 ? "stop" : "again"',
  );
  await expect(passes()).toBeFocused();
  expect(await passes().evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('4');
  await gate.getByRole('button', { name: 'Done', exact: true }).click();
  await expect
    .poll(async () => nodeOf((await serverDraft(request, loopId)).definition, 'check')?.config, {
      timeout: 30_000,
    })
    .toMatchObject({ jsonata: 'counters.nodeVisits.check > 2 ? "stop" : "again"', maxPasses: 4 });

  // Tab: the id applies, focus moves on to Label, and Shift+Tab returns to Node id.
  gate = await openNode(page, 'check');
  await gate.getByLabel('Node id').fill('loop-gate');
  await page.keyboard.press('Tab');
  await expect(gate).toHaveAccessibleName('Edit decision loop-gate');
  await expect(gate.locator('#node-label')).toBeFocused();
  await expect(codeText(gate, 'Jsonata')).toHaveText(
    'counters.nodeVisits."loop-gate" > 2 ? "stop" : "again"',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(gate.getByLabel('Node id')).toBeFocused();
  await expect(gate.getByLabel('Node id')).toHaveValue('loop-gate');
  await gate.getByRole('button', { name: 'Done', exact: true }).click();

  // The settings form remounts with its repaired template; the variables text stays as typed.
  const work = await openNode(page, 'work');
  await renameInDialog(work, 'draft');
  await expect(work.getByLabel('Node id')).toBeFocused();
  await work.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(codeText(page, 'Template')).toHaveText('/tmp/{{ outputs.draft.value }}');
  await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');
  const visits = page.getByRole('spinbutton', { name: 'Maximum node visits' });
  await visits.fill('4');
  await expect
    .poll(async () => (await serverDraft(request, loopId)).definition.settings, { timeout: 30_000 })
    .toMatchObject({
      maxNodeVisits: 4,
      workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.draft.value }}' },
    });
  await expect(codeText(page, 'Variables value 1')).toHaveText('[1, ');

  // The trigger's incomplete schedule is still held, with its message.
  const startAgain = await openNode(page, 'start');
  await expect(startAgain.getByLabel('Monday')).not.toBeChecked();
  await expect(startAgain.getByRole('alert')).toHaveText('Choose at least one day.');
  await startAgain.getByRole('button', { name: 'Done', exact: true }).click();

  const stored = (await serverDraft(request, loopId)).definition;
  expect(stored.nodes.map((n) => n.id)).toEqual(['start', 'draft', 'loop-gate', 'done']);
  expect(nodeOf(stored, 'done').config['returns']).toBe('outputs.draft.value');
  expect(nodeOf(stored, 'loop-gate').config['jsonata']).toBe(
    'counters.nodeVisits."loop-gate" > 2 ? "stop" : "again"',
  );
  expect(nodeOf(stored, 'start').config['expression']).toBe('30 7 * * 1');
  expect(stored.variables).toEqual({ key: { type: 'string' } });
});

test('a rename in a stale tab waits for Overwrite or Reload, and nothing is lost unseen', async ({
  context,
  request,
}) => {
  const name = uniqueLoopName('Rename stale tab');
  const loopId = await createLoop(request, {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Do the work.' } },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: 'outputs.work.value' },
        ui: { x: 520, y: 80 },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  });
  const a = await context.newPage();
  await openDraftTab(a, loopId, name);
  const b = await context.newPage();
  await openDraftTab(b, loopId, name);
  const original = (await serverDraft(request, loopId)).definition;

  // Tab B saves first.
  await b.bringToFront();
  await showLoopPanel(b);
  await b.getByLabel('Description').fill('from tab B');
  await expect
    .poll(async () => (await serverDraft(request, loopId)).definition.description, {
      timeout: 30_000,
    })
    .toBe('from tab B');
  await saved(b);

  // Tab A renames against its stale copy: asked inside the dialog, nothing overwritten.
  await a.bringToFront();
  const dialog = await openNode(a, 'work');
  await renameInDialog(dialog, 'draft');
  await expect(dialog.getByText('The draft changed on the server')).toBeVisible({
    timeout: 30_000,
  });
  await expect(renameNotice(dialog, 'work', 'draft')).toBeVisible();
  let server = (await serverDraft(request, loopId)).definition;
  expect(server).toEqual({ ...original, description: 'from tab B' });
  await dialog.getByRole('button', { name: 'Overwrite with this copy' }).click();
  const renamed: Definition = {
    ...original,
    nodes: original.nodes.map((node) =>
      node.id === 'work'
        ? { ...node, id: 'draft' }
        : node.id === 'done'
          ? { ...node, config: { ...node.config, returns: 'outputs.draft.value' } }
          : node,
    ),
    edges: original.edges.map((edge) => ({
      ...edge,
      from: edge.from.node === 'work' ? { ...edge.from, node: 'draft' } : edge.from,
      to: edge.to.node === 'work' ? { ...edge.to, node: 'draft' } : edge.to,
    })),
  };
  await expect
    .poll(async () => (await serverDraft(request, loopId)).definition, { timeout: 30_000 })
    .toEqual(renamed);
  await expect(dialog.getByText('The draft changed on the server')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await saved(a);

  // B reloads and saves again; A renames again and this time reloads the server draft.
  await openDraftTab(b, loopId, name);
  await showLoopPanel(b);
  await b.getByLabel('Description').fill('from tab B again');
  await expect
    .poll(async () => (await serverDraft(request, loopId)).definition.description, {
      timeout: 30_000,
    })
    .toBe('from tab B again');
  await a.bringToFront();
  const second = await openNode(a, 'draft');
  await renameInDialog(second, 'final');
  await expect(second.getByText('The draft changed on the server')).toBeVisible({
    timeout: 30_000,
  });
  await second.getByRole('button', { name: 'Reload server draft' }).click();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(card(a, 'draft')).toBeVisible();
  await expect(card(a, 'final')).toHaveCount(0);
  await expect(renameNotice(a, 'draft', 'final')).toHaveCount(0);
  await expect(a.getByText('The draft changed on the server')).toHaveCount(0);
  server = (await serverDraft(request, loopId)).definition;
  expect(server).toEqual({ ...renamed, description: 'from tab B again' });
});

test('protected voice steps keep their ids, and renaming respond repairs the chat envelope', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', {});
  const url = String(instance['url']);
  const session = (await (await request.get(`${url}/chat/session`)).json()) as {
    systemLoopId: string;
  };
  const loopId = session.systemLoopId;
  const definition = enableChatAudio(
    createSystemChatDefinition({ name: uniqueLoopName('Rename voice chat'), harness: 'codex' }),
    {
      id: 'chat-normalize',
      kind: 'script',
      label: 'Fixture normalizer',
      ui: { x: 160, y: 0 },
      config: {
        command: process.execPath,
        args: ['-e', ''],
        cwd: 'workspace',
        stdin: 'thread',
        stdout: 'last-output',
      },
    },
  );
  expect(
    (await request.put(`${url}/loops/${loopId}/draft`, { data: { definition } })).status(),
  ).toBe(200);
  const before = (await serverDraft(request, loopId, url)).definition;
  expect(envelope(before)).toBe('{"protocol":"graphgoblin.chat.v1","reply":outputs.respond.value}');

  await page.goto(`${url}/app/loops/${loopId}/edit`);
  await expect(card(page, 'respond')).toBeVisible();
  await saved(page);
  for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid']) {
    const dialog = await openByKeyboard(page, id);
    const field = dialog.getByLabel('Node id');
    await expect(field).toHaveAttribute('readonly', '');
    await field.press('End');
    await page.keyboard.type('x');
    await field.press('Enter');
    await expect(field).toHaveValue(id);
    await expect(dialog.getByRole('button', { name: 'Delete node' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^Undo/ })).toHaveAccessibleName('Undo');

  const respond = await openByKeyboard(page, 'respond');
  await renameInDialog(respond, 'reply');
  await expect(respond.getByLabel('Node id')).toBeFocused();
  await expect(renameNotice(respond, 'respond', 'reply')).toContainText('Updated 1 reference');
  await respond.getByRole('button', { name: 'Done', exact: true }).click();
  await saved(page);
  const after = (await serverDraft(request, loopId, url)).definition;
  expect(envelope(after)).toBe('{"protocol":"graphgoblin.chat.v1","reply":outputs.reply.value}');
  expect(after.nodes.map((n) => n.id)).toEqual(
    before.nodes.map((n) => (n.id === 'respond' ? 'reply' : n.id)),
  );
  for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'])
    expect(nodeOf(after, id)).toEqual(nodeOf(before, id));
  await expect(page.getByText('Fix these to publish.')).toHaveCount(0);
});
