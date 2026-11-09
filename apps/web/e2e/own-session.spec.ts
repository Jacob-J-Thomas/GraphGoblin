import { minimalLoop } from '@graphgoblin/contracts/testing';
import { chooseOptionByKeyboard, expect, openDraftTab, openNode, test } from './fixtures.js';

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
  // Session is on Context, after Prompt, outside Advanced (#441).
  await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toBeHidden();
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  const session = dialog.getByRole('group', { name: 'Session', exact: true });
  const policy = session.getByRole('combobox', { name: 'Conversation', exact: true });
  await expect(policy).toHaveValue('fresh');
  await expect(policy.locator('option:checked')).toHaveText('Start fresh');
  await expect(policy).toHaveAccessibleDescription(
    /^Choose whether each visit starts a new conversation .+ Starts a new provider conversation on each visit\./,
  );
  await policy.focus();
  await chooseOptionByKeyboard(page, policy, "Resume this node's conversation");
  await page.keyboard.press('Tab');
  await expect(policy).toHaveValue('resume-own');
  await expect(policy.locator('option:checked')).toHaveText("Resume this node's conversation");
  await expect(policy).toHaveAccessibleDescription(
    /Resumes this node's conversation from its earlier visits .+ instead of silently starting fresh\.$/,
  );
  const reset = session.getByLabel('Reset after visits');
  await expect(reset).toBeFocused();
  await expect(reset).toHaveValue('');
  await expect(reset).toHaveAccessibleDescription(/^Leave blank for no automatic reset\./);
  const savedSession = async () => {
    const response = await request.get(`/loops/${loop.id}`);
    const body = (await response.json()) as {
      draft: { definition: { nodes: { id: string; config: { session?: unknown } }[] } };
    };
    return body.draft.definition.nodes.find((x) => x.id === 'worker')?.config.session;
  };
  await reset.fill('2');
  // Autosave reaches the server while the dialog is open, without moving focus or the tab.
  await expect.poll(savedSession).toEqual({ policy: 'resume-own', resetAfterVisits: 2 });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect(reset).toBeFocused();
  await expect(dialog.getByRole('tab', { name: /^Context\b/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect.poll(savedSession).toEqual({ policy: 'resume-own', resetAfterVisits: 2 });
  await page.reload();
  const reopened = await openNode(page, 'worker');
  // Reopening starts on Settings, as before.
  await expect(reopened.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await reopened.getByRole('tab', { name: /^Context\b/ }).click();
  await expect(
    reopened.getByRole('group', { name: 'Session' }).getByLabel('Conversation', { exact: true }),
  ).toHaveValue('resume-own');
  await expect(reopened.getByLabel('Reset after visits')).toHaveValue('2');
  await reopened.getByLabel('Reset after visits').fill('');
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(savedSession).toEqual({ policy: 'resume-own' });
});
