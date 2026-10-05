import type { LoopDefinitionInput, LoopIssue, NodeInput } from '@graphgoblin/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { isValidationKey, keys, refreshCatalogState } from '../api/queries.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const SAVE_WAIT = { timeout: 4000 };
const store = () => useEditorStore.getState();
const nodeBadge = (id: string) =>
  screen
    .getByTestId(`node-${id}`)
    .querySelector<HTMLButtonElement>(`button[aria-label$=" on ${id}"]`);
const validations = (api: FakeApi) => api.callsTo('POST', /\/validate$/).length;

const ALPHA: FakeApi['catalog'][number] = {
  harness: 'codex',
  model: 'alpha',
  source: 'harness',
  displayName: 'Alpha',
  efforts: ['low', 'high'],
  defaultEffort: 'low',
  enabled: true,
};

/**
 * The API's checks with two the fake leaves out, as the real API makes them: cron syntax (here, an
 * expression of `never` is refused) and the model catalog's (`MODEL_DISABLED`, `MODEL_NOT_IN_CATALOG`).
 * `beforeAnswer` runs before each answer is computed, as a slow request would meet a later state.
 */
function withServerChecks(api: FakeApi, beforeAnswer?: () => Promise<void> | void) {
  api.override('POST /loops/:id/validate', async (call) => {
    await beforeAnswer?.();
    const answer = (await (await api.builtIn(call)).json()) as { issues: LoopIssue[] };
    const definition = (call.body as { definition: LoopDefinitionInput }).definition;
    const issues = [...answer.issues];
    for (const node of definition.nodes) {
      const config = node.config as Record<string, unknown>;
      if (
        node.kind === 'trigger' &&
        config['subtype'] === 'cron' &&
        config['expression'] === 'never'
      )
        issues.push({
          code: 'CRON_INVALID',
          severity: 'error',
          nodeId: node.id,
          path: 'config.expression',
          message: `cron trigger "${node.id}": "never" is not a cron expression`,
        });
      const model = config['model'];
      if (node.kind === 'inference' && typeof model === 'string') {
        const entry = api.catalog.find((m) => m.harness === 'codex' && m.model === model);
        if (!entry?.enabled)
          issues.push({
            code: entry ? 'MODEL_DISABLED' : 'MODEL_NOT_IN_CATALOG',
            severity: 'warning',
            nodeId: node.id,
            path: 'config.model',
            message: `model ${model} is ${entry ? 'disabled' : 'not in the catalog'} for codex`,
          });
      }
    }
    return new Response(
      JSON.stringify({ issues, publishable: !issues.some((i) => i.severity === 'error') }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
}

/** Start, an inference node using catalog model `alpha`, and done, in a line. */
function inferenceLoop(): LoopDefinitionInput {
  const definition = newLoopDefinition('models');
  const infer = {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: { model: 'alpha', prompt: { template: 'hi' } },
  } as NodeInput;
  return {
    ...definition,
    nodes: [...definition.nodes, infer],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/** The API checks that answered, by the draft key they were issued for. */
const cachedDraftKeys = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .findAll({ predicate: ({ queryKey }) => isValidationKey(queryKey) })
    .filter((query) => query.state.data !== undefined)
    .map((query) => query.queryKey[3]);

describe('freshness of the API checks (phase review F3)', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('checks a reloaded server draft instead of reusing the clean answer of the loaded one', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    withServerChecks(api);
    const loop = api.addLoop(newLoopDefinition('mine'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'mine' });
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    const before = validations(api);

    // Another tab saves a draft whose cron expression the API refuses; an edit here then conflicts.
    const theirs = newLoopDefinition('theirs');
    api.saveDraftElsewhere(loop.id, {
      ...theirs,
      nodes: theirs.nodes.map((node): NodeInput =>
        node.id === 'start'
          ? { ...node, kind: 'trigger', config: { subtype: 'cron', expression: 'never' } }
          : node,
      ),
    });
    act(() => store().updateMeta({ description: 'mine' }));
    await screen.findByText('The draft changed on the server', undefined, SAVE_WAIT);
    // Unsaved edits are not checked: nothing ran for them.
    expect(validations(api)).toBe(before);

    await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
    await screen.findByRole('heading', { name: 'theirs' });
    // The revision counter starts again at 0, as it did for the clean draft first checked.
    expect(store().revision).toBe(0);
    await waitFor(() =>
      expect(nodeBadge('start')).toHaveAttribute('aria-label', '1 issue on start'),
    );
    expect(screen.queryByText('Ready to publish')).toBeNull();
    expect(screen.getByRole('button', { name: '1 error' })).toBeInTheDocument();
    expect(validations(api)).toBe(before + 1);
  });

  it('checks again when another tab disables the selected model, once per catalog change', async () => {
    const api = new FakeApi();
    withServerChecks(api);
    api.catalog = [ALPHA];
    const loop = api.addLoop(inferenceLoop());
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'models' });
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    expect(nodeBadge('infer')).toBeNull();
    const before = validations(api);

    // A refetch that finds the same catalog (on focus, say) runs nothing.
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    expect(validations(api)).toBe(before);

    // Another tab disables the model; this tab's refetch of the catalog sees it.
    api.catalog = [{ ...ALPHA, enabled: false }];
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await waitFor(() =>
      expect(nodeBadge('infer')).toHaveAttribute('aria-label', '1 issue on infer'),
    );
    expect(validations(api)).toBe(before + 1);
    // Further refetches of the same state: no request storm.
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    expect(validations(api)).toBe(before + 1);

    // Enabled again by a write in Settings (one refresh for both catalogs): checked again.
    api.catalog = [ALPHA];
    await act(() => refreshCatalogState(queryClient));
    await waitFor(() => expect(nodeBadge('infer')).toBeNull());
    expect(validations(api)).toBe(before + 2);
    expect(api.callsTo('PUT', /\/draft$/)).toHaveLength(0);
  });

  it('drops a check whose answer arrives after the model catalog changed', async () => {
    const api = new FakeApi();
    const app: { queryClient?: QueryClient } = {};
    let first = true;
    withServerChecks(api, () => {
      if (!first) return;
      first = false;
      // The catalog changes in the cache just before the first answer is computed.
      api.catalog = [{ ...ALPHA, enabled: false }];
      app.queryClient!.setQueryData(keys.catalog, api.catalog);
    });
    api.catalog = [ALPHA];
    const loop = api.addLoop(inferenceLoop());
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    app.queryClient = queryClient;
    await screen.findByRole('heading', { name: 'models' });
    await waitFor(() =>
      expect(nodeBadge('infer')).toHaveAttribute('aria-label', '1 issue on infer'),
    );
    // The first answer (issued for the enabled catalog) was not stored under its key.
    const enabled = queryClient
      .getQueryCache()
      .findAll({ predicate: ({ queryKey }) => isValidationKey(queryKey) })
      .find((query) => String(query.queryKey[4]).includes('"alpha",true'));
    expect(enabled?.state.data).toBeUndefined();
  });

  it('names a draft without a server token by its content, and by the token once saved', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('untokened'));
    api.override('GET /loops/:id', async (call) => {
      const { draftToken: _token, ...rest } = (await (await api.builtIn(call)).json()) as Record<
        string,
        unknown
      >;
      return new Response(JSON.stringify(rest), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'untokened' });
    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    expect(cachedDraftKeys(queryClient)).toEqual([expect.stringMatching(/^content:/)]);
    act(() => store().updateMeta({ description: 'saved' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    await waitFor(() => expect(cachedDraftKeys(queryClient)).toContain(api.draftToken(loop.id)));
    expect(validations(api)).toBe(2);
  });
});
