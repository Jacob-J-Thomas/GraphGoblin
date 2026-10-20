import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  LoopVersionRecordSchema,
  RunRecordSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext } from '@playwright/test';
import { closeNode, expect, openNode, test } from './fixtures.js';

/** start -> ask (input) -> done, returning `returns`. */
function askThenReturn(returns: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'E2E pinned draft',
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'ask',
        kind: 'wait',
        label: 'Ask',
        config: { mode: 'input', prompt: 'Continue?' },
        ui: { x: 260, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns }, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function startDraftRun(request: APIRequestContext, loopId: string, draftId: string) {
  const started = await request.post(`/loops/${loopId}/runs`, {
    data: { versionId: draftId, allowDraft: true },
  });
  expect(started.status(), await started.text()).toBe(202);
  return RunRecordSchema.parse(((await started.json()) as { run: unknown }).run);
}

// ADR-0041: a draft (test) run keeps the snapshot of the draft it started with.
test('a waiting draft run keeps its definition after the draft is edited in the editor', async ({
  page,
  request,
}) => {
  const created = await request.post('/loops', { data: { definition: askThenReturn('"old"') } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop, draft } = (await created.json()) as { loop: { id: string }; draft: { id: string } };
  const run = await startDraftRun(request, loop.id, draft.id);
  expect(run.versionId).not.toBe(draft.id);
  expect(run.pinned).toMatchObject({ source: 'draft', label: 'E2E pinned draft draft v1' });

  // The inspector shows the run waiting for input.
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByText('Input requested')).toBeVisible();

  // Edit the draft in the editor: the exit now returns "new", and autosave stores it.
  await page.goto(`/app/loops/${loop.id}/edit`);
  const exit = await openNode(page, 'done');
  await exit.getByLabel('Return expression').fill('"new"');
  await closeNode(page);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const saved = (await (await request.get(`/loops/${loop.id}`)).json()) as {
    draft: { definition: unknown };
  };
  expect(
    LoopDefinitionSchema.parse(saved.draft.definition).nodes.find((node) => node.id === 'done'),
  ).toMatchObject({ config: { returns: '"new"' } });

  // The waiting run still runs the definition it started with.
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByText('Input requested')).toBeVisible();
  await page.getByLabel('Input (JSON)').fill('true');
  await page.getByRole('button', { name: 'Submit input' }).click();
  await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
  await expect(page.getByTestId('run-result')).toHaveText('"old"');
  const snapshot = LoopVersionRecordSchema.parse(
    await (await request.get(`/loops/${loop.id}/versions/${run.versionId}`)).json(),
  );
  expect(snapshot.status).toBe('snapshot');
  expect(snapshot.definition.nodes.find((node) => node.id === 'done')).toMatchObject({
    config: { returns: '"old"' },
  });

  // A new draft run starts from the edited draft.
  const next = await startDraftRun(request, loop.id, draft.id);
  expect(next.versionId).not.toBe(run.versionId);
  await page.goto(`/app/runs/${next.id}`);
  await expect(page.getByText('Input requested')).toBeVisible();
  await page.getByLabel('Input (JSON)').fill('true');
  await page.getByRole('button', { name: 'Submit input' }).click();
  await expect(page.getByTestId('run-result')).toHaveText('"new"');
});
