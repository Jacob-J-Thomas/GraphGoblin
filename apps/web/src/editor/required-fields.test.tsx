import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition } from './model.js';

beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

it('links a refused loop name and node label to their messages, beside the fields', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('my loop'));
  renderApp(`/loops/${loop.id}/edit`, api);
  expect(await screen.findByRole('heading', { name: 'my loop' })).toBeInTheDocument();

  const panel = screen.getByRole('region', { name: 'Loop settings' });
  const name = within(panel).getByLabelText('Name');
  expect(name).toBeRequired();
  expect(name).not.toHaveAttribute('aria-invalid');
  await user.clear(name);
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription(/expected string to have >=1 characters/);
  expect(within(panel).getByRole('alert')).toHaveTextContent(/>=1 characters/);
  await user.type(name, 'renamed');
  expect(name).not.toHaveAttribute('aria-invalid');
  expect(name).not.toHaveAttribute('aria-describedby');

  fireEvent.click(screen.getByTestId('node-start'));
  const dialog = screen.getByRole('dialog');
  const label = within(dialog).getByLabelText('Label');
  expect(label).toBeRequired();
  await user.clear(label);
  expect(label).toHaveAttribute('aria-invalid', 'true');
  expect(label).toHaveAccessibleDescription(/expected string to have >=1 characters/);
  await user.type(label, 'Begin');
  expect(label).not.toHaveAttribute('aria-invalid');
  expect(label).not.toHaveAttribute('aria-describedby');
});
