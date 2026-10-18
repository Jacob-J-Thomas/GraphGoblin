import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { FakeApi, qaTemplateEntry } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

it('opens a QA starting point without an instance lookup or configured-parent warning', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  api.templates = [qaTemplateEntry()];
  renderApp('/loops', api);
  await user.click(await screen.findByRole('button', { name: 'New from template' }));
  await user.click(screen.getByRole('button', { name: 'Use QA assessment' }));
  expect(await screen.findByText('Ready to publish')).toBeVisible();
  expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
  expect(screen.queryByText('QA execution is blocked')).toBeNull();
  expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
});
it('does not infer template authority from a loop name', async () => {
  const api = new FakeApi();
  const loop = api.addLoop({ ...minimalLoop(), name: 'Post-merge QA' });
  renderApp('/loops/' + loop.id + '/edit', api);
  expect(await screen.findByText('Ready to publish')).toBeVisible();
  expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
});
