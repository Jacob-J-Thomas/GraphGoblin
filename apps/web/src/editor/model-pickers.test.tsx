import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';

it('registers the node and loop pickers and forwards exact server validation warnings', async () => {
  localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded');
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'alpha',
      displayName: 'Alpha',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
      source: 'harness',
    },
  ];
  api.serverOnlyIssues = [
    {
      severity: 'warning',
      code: 'MODEL_DISABLED',
      nodeId: 'infer',
      path: 'config.model',
      message: 'Node catalog warning',
    },
    {
      severity: 'warning',
      code: 'MODEL_NOT_IN_CATALOG',
      path: 'settings.defaults.byHarness.codex.model',
      message: 'Loop catalog warning',
    },
  ];
  const definition = kitchenSinkLoop();
  definition.settings = {
    ...definition.settings,
    defaults: { byHarness: { codex: { model: 'alpha' } } },
  };
  const inference = definition.nodes.find((node) => node.kind === 'inference')!;
  api.serverOnlyIssues[0] = { ...api.serverOnlyIssues[0]!, nodeId: inference.id };
  const loop = api.addLoop(definition);
  renderApp(`/loops/${loop.id}/edit`, api);
  const settings = await screen.findByRole('form', { name: 'Loop settings form' });
  await waitFor(() => expect(within(settings).getByLabelText('Model').tagName).toBe('SELECT'));
  await waitFor(() =>
    expect(within(settings).getByLabelText('Model')).toHaveAccessibleDescription(
      /MODEL_NOT_IN_CATALOG: Loop catalog warning/,
    ),
  );
  fireEvent.click(screen.getByTestId(`node-${inference.id}`));
  const dialog = screen.getByRole('dialog');
  await waitFor(() =>
    expect(within(dialog).getByLabelText('Model')).toHaveAccessibleDescription(
      /MODEL_DISABLED: Node catalog warning/,
    ),
  );
  expect(within(dialog).getByLabelText('Effort').tagName).toBe('SELECT');
});
