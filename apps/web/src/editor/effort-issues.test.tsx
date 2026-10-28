import { minimalLoop } from '@graphgoblin/contracts/testing';
import {
  LoopDefinitionSchema,
  type Effort,
  type HarnessDefaults,
  type LoopDefinitionInput,
  type ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { unsupportedEffortIssues } from './effort-issues.js';

const codex = (model: string, displayName: string, efforts: Effort[]): ModelCatalogEntry => ({
  harness: 'codex',
  model,
  displayName,
  efforts,
  defaultEffort: 'low',
  enabled: true,
  source: 'harness',
});
const luna = codex('gpt-6-luna', 'GPT-6 Luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const gpt55 = codex('gpt-5.5', 'GPT-5.5', ['low', 'medium', 'high', 'xhigh']);
const unsupported = (effort: string) =>
  `Effort ${effort} is not supported by GPT-5.5. Choose a supported effort or Default.`;
const message = unsupported('max');

function definition(kind: 'inference' | 'llm', model?: string, effort?: string) {
  const source = minimalLoop();
  const config =
    kind === 'inference'
      ? {
          prompt: { template: 'Choose' },
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        }
      : {
          kind: 'llm',
          harness: 'codex',
          instructions: 'Choose',
          model: model ? { mode: 'explicit', value: model } : { mode: 'inherit' },
          effort: effort ? { mode: 'explicit', value: effort } : { mode: 'inherit' },
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        };
  // Wired start -> work -> done, so the node has no issue other than the one under test.
  return LoopDefinitionSchema.parse({
    ...source,
    nodes: [
      source.nodes[0],
      { id: 'work', label: 'Work', kind: kind === 'llm' ? 'decision' : 'inference', config },
      source.nodes[1],
    ],
    edges: [
      { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      ...(kind === 'inference' ? ['out'] : ['yes', 'no']).map((port) => ({
        id: port,
        from: { node: 'work', port },
        to: { node: 'done' },
      })),
    ],
  });
}

describe.each(['inference', 'llm'] as const)('a %s node', (kind) => {
  it.each(['max', 'none'] as const)(
    'keeps a chosen %s after a switch to GPT-5.5, names it on the field and the node, and clears when changed',
    async (kept) => {
      const message = unsupported(kept);
      const api = new FakeApi();
      api.catalog = [luna, gpt55];
      const loop = api.addLoop(definition(kind, 'gpt-6-luna', kept));
      renderApp(`/loops/${loop.id}/edit`, api);
      fireEvent.click(await screen.findByTestId('node-work'));
      const dialog = screen.getByRole('dialog');
      const model = within(dialog).getByLabelText('Model', { exact: true });
      const effort = within(dialog).getByLabelText('Effort', { exact: true });
      await waitFor(() => expect(effort).toHaveValue(kept));
      expect(within(dialog).queryByRole('button', { name: /issues? on work/ })).toBeNull();

      fireEvent.change(model, { target: { value: 'gpt-5.5' } });
      // The choice is kept, and the field says why it cannot be used and what to do.
      await waitFor(() => expect(effort).toHaveAccessibleDescription(new RegExp(message)));
      expect(effort).toHaveValue(kept);
      const badge = within(dialog).getByRole('button', { name: '1 issue on work' });
      fireEvent.click(badge);
      const popover = await screen.findByRole('dialog', { name: 'Issues on work' });
      expect(within(popover).getByText(message)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 error' })).toBeInTheDocument();

      fireEvent.change(effort, { target: { value: 'xhigh' } });
      await waitFor(() =>
        expect(within(dialog).queryByRole('button', { name: /issues? on work/ })).toBeNull(),
      );
      expect(effort).not.toHaveAccessibleDescription(/not supported/);

      fireEvent.change(model, { target: { value: 'gpt-6-luna' } });
      fireEvent.change(effort, { target: { value: kept } });
      fireEvent.change(model, { target: { value: 'gpt-5.5' } });
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: '1 issue on work' })).toBeInTheDocument(),
      );
      fireEvent.change(effort, { target: { value: '' } });
      await waitFor(() =>
        expect(within(dialog).queryByRole('button', { name: /issues? on work/ })).toBeNull(),
      );
      expect(effort).not.toHaveAccessibleDescription(new RegExp(message));
    },
  );
});

describe('unsupportedEffortIssues', () => {
  const process: HarnessDefaults = { byHarness: { codex: { model: 'gpt-5.5' } } };
  const owner: HarnessDefaults = { byHarness: {} };

  it('names an inherited model only once both defaults levels are known', () => {
    const inherited = definition('inference', undefined, 'max');
    expect(unsupportedEffortIssues(inherited, [luna, gpt55], undefined)).toEqual([]);
    expect(unsupportedEffortIssues(inherited, [luna, gpt55], { owner, process })).toEqual([
      {
        code: 'EFFORT_UNSUPPORTED',
        severity: 'error',
        nodeId: 'work',
        path: 'config.effort',
        message,
      },
    ]);
  });

  it('reports nothing without a catalog, a parsable draft, an explicit effort or a catalog entry', () => {
    const chosen = definition('llm', 'gpt-5.5', 'max');
    expect(unsupportedEffortIssues(chosen, undefined, undefined)).toEqual([]);
    // A draft that does not parse yet has its schema issues instead.
    const unparsed = { ...chosen, schemaVersion: 0 } as unknown as LoopDefinitionInput;
    expect(unsupportedEffortIssues(unparsed, [gpt55], undefined)).toEqual([]);
    expect(unsupportedEffortIssues(definition('llm', 'gpt-5.5'), [gpt55], undefined)).toEqual([]);
    expect(unsupportedEffortIssues(chosen, [luna], undefined)).toEqual([]);
    expect(
      unsupportedEffortIssues(definition('inference', 'gpt-6-luna', 'max'), [luna], undefined),
    ).toEqual([]);
  });
});
