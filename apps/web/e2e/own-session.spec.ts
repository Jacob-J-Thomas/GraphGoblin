import { minimalLoop } from '@graphgoblin/contracts/testing';
import { expect, openDraftTab, openNode, test } from './fixtures.js';

test('the editor saves opt-in own continuity and a visible optional reset', async ({
  page,
  request,
}) => {
  const base = minimalLoop();
  const definition = {
    ...base,
    name: 'qa own continuity',
    nodes: [
      base.nodes[0]!,
      {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: { prompt: { template: 'Use selected loop feedback' } },
      },
      base.nodes[1]!,
    ].map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'worker' } },
      { id: 'e2', from: { node: 'worker', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await openDraftTab(page, loop.id, definition.name);
  const dialog = await openNode(page, 'worker');
  const session = dialog.getByRole('group', { name: 'Session' });
  const policy = session.getByLabel('Policy');
  await expect(policy).toHaveValue('0');
  await expect(session.getByText(/Supply current main-loop context deliberately/)).toBeVisible();
  await policy.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(policy).toHaveValue('3');
  const reset = session.getByLabel('Reset after visits');
  await expect(reset).toBeFocused();
  await expect(reset).toHaveValue('');
  await expect(session.getByText(/Blank means no automatic reset/)).toBeVisible();
  await reset.fill('2');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const savedSession = async () => {
    const response = await request.get(`/loops/${loop.id}`);
    const body = (await response.json()) as {
      draft: { definition: { nodes: { id: string; config: { session?: unknown } }[] } };
    };
    return body.draft.definition.nodes.find((x) => x.id === 'worker')?.config.session;
  };
  await expect.poll(savedSession).toEqual({ policy: 'resume-own', resetAfterVisits: 2 });
  await page.reload();
  const reopened = await openNode(page, 'worker');
  await expect(reopened.getByRole('group', { name: 'Session' }).getByLabel('Policy')).toHaveValue(
    '3',
  );
  await expect(reopened.getByLabel('Reset after visits')).toHaveValue('2');
  await reopened.getByLabel('Reset after visits').fill('');
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(savedSession).toEqual({ policy: 'resume-own' });
});
