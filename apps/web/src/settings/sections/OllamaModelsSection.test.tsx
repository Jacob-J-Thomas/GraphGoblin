import type { ModelCatalogEntry, OllamaConnectionView } from '@graphgoblin/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { ollamaConnectionKey } from '../../api/ollama.js';
import { ModelCatalogSection } from './ModelCatalogSection.js';
import { discoveryRelativeTime, OllamaModelsSection } from './OllamaModelsSection.js';

const timestamp = '2026-11-07T12:00:00.000Z';
const model: ModelCatalogEntry = {
  harness: 'ollama',
  model: 'namespace/qwen:4b',
  source: 'harness',
  displayName: 'namespace/qwen:4b',
  enabled: true,
  efforts: ['none'],
  defaultEffort: 'none',
  availability: { state: 'available', checkedAt: timestamp },
};
const initial: OllamaConnectionView = {
  connection: { enabled: true, baseUrl: 'http://127.0.0.1:11434', revision: 1 },
  discovery: { state: 'idle' },
};
function setup(
  view: OllamaConnectionView = initial,
  entries: ModelCatalogEntry[] = [model],
  full = false,
) {
  const api = new FakeApi();
  api.ollamaConnection = view;
  api.catalog = entries;
  const rendered = renderWith(full ? <ModelCatalogSection /> : <OllamaModelsSection />, '/', api);
  return { ...rendered, user: userEvent.setup() };
}
const section = () => screen.getByRole('region', { name: 'Ollama' });
const announcement = () => within(section()).getAllByRole('status')[0]!;
const refresh = () => screen.getByRole('button', { name: 'Refresh Ollama models' });
async function openConnection() {
  const disclosure = await screen.findByRole('button', { name: /^Connection$/ });
  if (disclosure.getAttribute('aria-expanded') !== 'true') fireEvent.click(disclosure);
  return screen.getByRole('textbox', { name: 'Server address' });
}

describe('Ollama model settings', () => {
  it.each(['Ollama is off in Settings', 'Not yet listed at the new address'])(
    'shows the current connection availability reason verbatim: %s',
    async (reason) => {
      setup({ ...initial, connection: { ...initial.connection, enabled: false } }, [
        { ...model, availability: { state: 'missing', checkedAt: timestamp, reason } },
      ]);
      const table = await screen.findByRole('table', { name: 'Ollama models' });
      expect(within(table).getByText(reason, { exact: true })).toBeInTheDocument();
      expect(within(table).getByRole('switch', { name: `Enable ${model.model}` })).toBeChecked();
      expect(
        screen.queryByText(
          'Ollama is off. Turn it on under Connection and save to list its models.',
        ),
      ).not.toBeInTheDocument();
    },
  );
  it('separates the discovered list, sorts exact names and keeps availability independent of enabled', async () => {
    const missing = {
      ...model,
      model: 'z/missing:tag',
      displayName: 'Missing model',
      enabled: false,
      availability: { state: 'missing' as const, checkedAt: timestamp },
    };
    const unsupported = {
      ...model,
      model: 'a/unsupported:tag',
      displayName: 'a/unsupported:tag',
      efforts: [],
      availability: {
        state: 'unsupported' as const,
        checkedAt: timestamp,
        reason: 'This model cannot disable thinking.',
      },
    };
    const { api, user } = setup(
      initial,
      [
        missing,
        model,
        unsupported,
        {
          ...model,
          harness: 'codex',
          model: 'static',
          displayName: 'Static',
          availability: undefined,
        },
      ],
      true,
    );
    const table = await screen.findByRole('table', { name: 'Ollama models' });
    expect(
      Array.from(table.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('code')?.textContent,
      ),
    ).toEqual(['a/unsupported:tag', model.model, 'z/missing:tag']);
    expect(within(table).getByText('Missing')).toBeInTheDocument();
    expect(within(table).getByText('Unsupported')).toBeInTheDocument();
    expect(within(table).getByText('Available')).toBeInTheDocument();
    expect(within(table).getByText('This model cannot disable thinking.')).toBeInTheDocument();
    expect(within(table).getByText('No supported thinking setting')).toHaveClass('sr-only');
    expect(within(table).getByRole('switch', { name: 'Enable Missing model' })).not.toBeChecked();
    expect(screen.getAllByText(model.model, { selector: 'code' })).toHaveLength(1);
    await user.click(within(table).getByRole('switch', { name: `Enable ${model.model}` }));
    await waitFor(() =>
      expect(api.catalog.find((entry) => entry.model === model.model)?.enabled).toBe(false),
    );
    expect(api.catalog.find((entry) => entry.model === model.model)?.availability?.state).toBe(
      'available',
    );
    expect(announcement()).toHaveTextContent('');
  });

  it.each([
    [
      { ...initial, connection: { ...initial.connection, enabled: false } },
      'Ollama is off. Turn it on under Connection and save to list its models.',
    ],
    [{ ...initial, discovery: { state: 'refreshing' as const } }, 'Looking for installed models…'],
    [
      { ...initial, discovery: { state: 'ready' as const, lastSuccessAt: timestamp } },
      'The server listed no installed models at the last refresh.',
    ],
    [initial, 'No Ollama models listed yet.'],
  ] as const)('shows the truthful empty state for %j', async (view, message) => {
    setup(view, []);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(announcement()).toHaveTextContent('');
    if (view.discovery.state === 'refreshing')
      expect(refresh()).toHaveAttribute('aria-busy', 'true');
    if (!view.connection.enabled) {
      expect(refresh()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(refresh());
      expect(refresh()).toHaveAccessibleDescription(/Turn Ollama on and save to refresh/);
    }
  });

  it('saves the canonical origin, preserves the disclosure and announces only the explicit result', async () => {
    const { api, user } = setup();
    const input = await openConnection();
    await user.clear(input);
    await user.type(input, 'http://models.test:11434/');
    expect(screen.getByText(/Saving checks every Ollama model/)).toBeInTheDocument();
    api.override('PUT /harness/ollama/connection', (call) => {
      expect(call.body).toEqual({ enabled: true, baseUrl: 'http://models.test:11434/' });
      api.ollamaConnection = {
        connection: { enabled: true, baseUrl: 'http://models.test:11434', revision: 2 },
        discovery: { state: 'ready', lastSuccessAt: timestamp },
      };
      return Response.json(api.ollamaConnection);
    });
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(announcement()).toHaveTextContent('Ollama connection saved. Models refreshed.'),
    );
    expect(input).toHaveValue('http://models.test:11434');
    expect(screen.getByRole('button', { name: /^Connection$/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('saves disabled and re-enables through the same connection form', async () => {
    const { api, user } = setup();
    await openConnection();
    await user.click(screen.getByRole('checkbox', { name: 'Use Ollama on this gateway' }));
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(announcement()).toHaveTextContent('Ollama connection saved. Ollama is off.'),
    );
    expect(refresh()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(refresh());
    expect(api.callsTo('POST', '/model-catalog/refresh')).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: 'Use Ollama on this gateway' }));
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(announcement()).toHaveTextContent('Ollama connection saved. Models refreshed.'),
    );
    expect(refresh()).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps a saved connection and the last complete model list when its discovery fails', async () => {
    const { api, user } = setup();
    await openConnection();
    api.override('PUT /harness/ollama/connection', () => {
      api.ollamaConnection = {
        ...initial,
        connection: { ...initial.connection, revision: 2 },
        discovery: {
          state: 'error',
          lastAttemptAt: timestamp,
          error: { code: 'OFFLINE', message: 'The service cannot be reached.' },
        },
      };
      return Response.json(api.ollamaConnection);
    });
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(announcement()).toHaveTextContent(
        'Ollama connection saved, but models couldn’t be listed: The service cannot be reached.',
      ),
    );
    expect(screen.getByRole('table', { name: 'Ollama models' })).toHaveTextContent(model.model);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.getElementById('ollama-status')).toHaveTextContent(
      'Couldn’t list models: The service cannot be reached.',
    );
  });

  it.each([
    ['http://models.test/api', 'Leave off /api.'],
    [
      'http://user:secret@models.test',
      'Enter an http:// or https:// address with only a host and port',
    ],
  ])('focuses an invalid address without saving %s', async (address, message) => {
    const { api, user } = setup();
    const input = await openConnection();
    await user.clear(input);
    await user.type(input, address);
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(new RegExp(message));
    expect(api.callsTo('PUT', '/harness/ollama/connection')).toHaveLength(0);
  });

  it.each([
    [400, 'INVALID_ORIGIN', 'Use a gateway reachable origin.'],
    [
      403,
      'FORBIDDEN',
      'This API key can’t change the Ollama connection. Use the gateway owner key.',
    ],
    [500, 'SAVE_FAILED', 'SAVE_FAILED'],
  ])('distinguishes an actual save failure %s', async (status, code, message) => {
    const { api, user } = setup();
    const input = await openConnection();
    api.override('PUT /harness/ollama/connection', () =>
      problem(status, code, status === 400 ? message : undefined),
    );
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    if (status === 400) expect(input).toHaveFocus();
    expect(announcement()).toHaveTextContent('');
  });

  it('coalesces explicit refresh, retains focus and refetches discovery and model facts', async () => {
    const { api, user } = setup();
    const button = await screen.findByRole('button', { name: 'Refresh Ollama models' });
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'));
    let finish!: (value: Response) => void;
    api.override(
      'POST /model-catalog/refresh',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(button);
    fireEvent.click(button);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(api.callsTo('POST', '/model-catalog/refresh')).toHaveLength(1);
    api.ollamaConnection = { ...initial, discovery: { state: 'ready', lastSuccessAt: timestamp } };
    api.catalog[0] = {
      ...model,
      enabled: false,
      availability: { state: 'missing', checkedAt: timestamp },
    };
    await act(() => Promise.resolve(finish(Response.json(api.ollamaConnection.discovery))));
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
    expect(button).toHaveFocus();
    expect(announcement()).toHaveTextContent('Ollama models refreshed.');
    expect(await screen.findByText('Missing')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: `Enable ${model.model}` })).not.toBeChecked();
  });

  it('reports an incomplete refresh and retains the last success time', async () => {
    const failed: OllamaConnectionView = {
      ...initial,
      discovery: {
        state: 'error',
        lastAttemptAt: timestamp,
        lastSuccessAt: '2026-11-07T11:00:00.000Z',
        error: { code: 'INCOMPLETE', message: 'One model could not be checked.' },
      },
    };
    const { api, user } = setup(failed);
    await screen.findByText(/Last refresh failed/);
    expect(screen.getByText(/Showing models from/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Connection$/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    api.override('POST /model-catalog/refresh', () => Response.json(failed.discovery));
    await user.click(refresh());
    await waitFor(() =>
      expect(announcement()).toHaveTextContent(
        'Couldn’t refresh Ollama models: One model could not be checked.',
      ),
    );
  });

  it.each([403, 503])('explains explicit refresh HTTP failure %s', async (status) => {
    const { api, user } = setup();
    await waitFor(() => expect(refresh()).toHaveAttribute('aria-disabled', 'false'));
    api.override('POST /model-catalog/refresh', () => problem(status, 'REFRESH_FAILED'));
    await user.click(refresh());
    await waitFor(() =>
      expect(announcement()).toHaveTextContent(
        status === 403
          ? 'This API key can’t refresh models. Use a key that can change Settings.'
          : 'Couldn’t refresh Ollama models: REFRESH_FAILED',
      ),
    );
  });

  it('recovers a failed connection observation without starting discovery', async () => {
    const api = new FakeApi();
    api.override('GET /harness/ollama/connection', () => problem(503, 'OFFLINE'));
    const { user } = { ...renderWith(<OllamaModelsSection />, '/', api), user: userEvent.setup() };
    const retry = await screen.findByRole('button', { name: 'Retry connection' });
    api.override('GET /harness/ollama/connection', () => Response.json(initial));
    await user.click(retry);
    await screen.findByText(/Not refreshed yet/);
    expect(api.callsTo('POST', '/model-catalog/refresh')).toHaveLength(0);
  });

  it('observes background discovery silently and keeps a closed connection disclosure closed', async () => {
    const { api, queryClient } = setup();
    await screen.findByRole('button', { name: /^Connection$/ });
    await act(async () => {
      api.ollamaConnection = {
        ...initial,
        discovery: { state: 'error', error: { code: 'OFFLINE', message: 'Service unavailable.' } },
      };
      await queryClient.refetchQueries({ queryKey: ollamaConnectionKey });
    });
    await waitFor(() =>
      expect(document.getElementById('ollama-status')).toHaveTextContent(
        'Couldn’t list models: Service unavailable.',
      ),
    );
    expect(screen.getByRole('button', { name: /^Connection$/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(announcement()).toHaveTextContent('');
  });

  it('moves focus to the Ollama heading only if a toggled model vanishes', async () => {
    const { api, user } = setup();
    const toggle = await screen.findByRole('switch', { name: `Enable ${model.model}` });
    api.override('PATCH /model-catalog/:harness/:model', () => {
      api.catalog = [];
      return problem(404, 'MODEL_NOT_FOUND');
    });
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Ollama$/ })).toHaveFocus());
    expect(announcement()).toHaveTextContent('This model is no longer in the catalog.');
  });

  it('keeps a failed toggle visible for retry', async () => {
    const { api, user } = setup(initial, [{ ...model, availability: undefined }]);
    const toggle = await screen.findByRole('switch', { name: `Enable ${model.model}` });
    api.override('PATCH /model-catalog/:harness/:model', () => problem(403, 'FORBIDDEN'));
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('FORBIDDEN');
    expect(toggle).toBeInTheDocument();
    expect(screen.getByText('Unsupported')).toBeInTheDocument();
  });

  it('formats discovery ages without a live countdown', () => {
    const now = Date.parse(timestamp);
    expect(discoveryRelativeTime(timestamp, now)).toBe('just now');
    expect(discoveryRelativeTime('2026-11-07T11:57:00.000Z', now)).toBe('3 min ago');
    expect(discoveryRelativeTime('2026-11-07T09:00:00.000Z', now)).toBe('3 hr ago');
    expect(discoveryRelativeTime('2026-11-05T12:00:00.000Z', now)).toBe('2 days ago');
  });
});
