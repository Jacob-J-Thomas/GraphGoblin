import { InferenceConfigSchema, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { renderNodeEditor } from '../__fixtures__/node-editor.js';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';
import { INFERENCE_FIELD_OVERRIDES } from './HarnessField.js';
import { ollamaPolicyProblems, withOllamaLimits } from './ollama-policy.js';
import { useEditorStore } from './store.js';
import { UNSET } from '../forms/unset.js';

const incompatible = {
  harness: 'ollama',
  model: 'kept-model',
  effort: 'high',
  prompt: { template: 'Keep this prompt.' },
  session: { policy: 'resume-own', resetAfterVisits: 5 },
  harnessOptions: {
    sandbox: 'workspace-write',
    approval: 'on-request',
    networkAccess: true,
    webSearch: true,
    configOverrides: { region: 'kept' },
  },
  capabilities: { mcpServers: ['files'], plugins: ['custom'] },
  contextFiles: [{ path: 'context.txt', template: 'Keep in undo.' }],
  output: {
    toMessages: 'final',
    transforms: [],
    schema: { jsonSchema: { type: 'object' }, repair: { enabled: true, maxAttempts: 2 } },
  },
};

function form(value: Record<string, unknown>) {
  const api = new FakeApi();
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={InferenceConfigSchema}
      value={value}
      label="Inference"
      controls={NODE_FIELD_CONTROLS}
      fieldOverrides={INFERENCE_FIELD_OVERRIDES}
      onChange={change}
    />,
    '/',
    api,
  );
  return { change, user: userEvent.setup() };
}

describe('Ollama inference capability presentation', () => {
  it('keeps invalid authored controls visible and fixes all policy settings in one edit', async () => {
    const { change, user } = form(incompatible);
    openAdvanced();
    expect(screen.getByText('9 settings here don’t work with Ollama.')).toBeInTheDocument();
    expect(
      screen.getByText('Ollama can’t resume a session. Choose Fresh, or switch harness.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Turn off same-session repair for Ollama.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit as JSON: Capabilities' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Context/ }));
    expect(
      screen.getByText('Ollama can’t use context files. Remove it, or switch harness.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Settings/ }));
    change.mockClear();
    await user.click(screen.getByRole('button', { name: 'Use Ollama limits' }));
    expect(change).toHaveBeenCalledTimes(1);
    const [values, edit] = change.mock.calls[0]!;
    expect(values).toMatchObject({
      model: 'kept-model',
      effort: 'high',
      prompt: incompatible.prompt,
      session: { policy: 'fresh' },
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      output: { schema: { repair: { enabled: false, maxAttempts: 2 } } },
    });
    expect(values).not.toHaveProperty('contextFiles');
    expect(values).not.toHaveProperty('capabilities');
    expect(edit).toMatchObject({ path: 'harness', kind: 'commit' });
    expect(
      screen.getByText('Changed 9 settings for Ollama. Undo restores them.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use Ollama limits' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit as JSON: Capabilities' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Session: fresh (required for Ollama)')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ollama doesn’t repair invalid structured output in the same session; an invalid result fails this step.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ollama' })).toHaveFocus();
  });

  it('suppresses unsupported valid controls and keeps Context mutations available', async () => {
    const { change, user } = form(withOllamaLimits(incompatible));
    openAdvanced();
    expect(screen.queryByLabelText('Network access')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit as JSON: Capabilities' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Ollama starts every run fresh/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Context/ }));
    expect(screen.getByRole('button', { name: 'Edit as JSON: Input' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit as JSON: Context files' }),
    ).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it('switches to Ollama without choosing a discovered or configured model', async () => {
    const { change, user } = form({ ...incompatible, harness: 'codex' });
    await user.click(screen.getByRole('radio', { name: 'Ollama' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Ollama' })).toBeChecked());
    expect(change.mock.calls.at(-1)?.[0]).toMatchObject({
      harness: 'ollama',
      model: 'kept-model',
      effort: 'high',
    });
    expect(screen.getByRole('button', { name: 'Use Ollama limits' })).toBeInTheDocument();
  });

  it('leaves other providers’ structured and JSON controls available', () => {
    form({ ...incompatible, harness: 'codex' });
    openAdvanced();
    expect(screen.getByRole('button', { name: 'Edit as JSON: Capabilities' })).toBeInTheDocument();
    expect(screen.getByText('Config overrides')).toBeInTheDocument();
    expect(screen.queryByText(/Ollama starts every run fresh/)).not.toBeInTheDocument();
  });

  it('restores all policy settings with one native undo while retaining the selected provider', async () => {
    const api = new FakeApi();
    const base = minimalLoop();
    const definition = LoopDefinitionSchema.parse({
      ...base,
      nodes: [
        base.nodes[0],
        {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { ...incompatible, harness: 'codex' },
        },
        base.nodes[1],
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
        { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
      ],
    });
    const loop = api.addLoop(definition);
    renderNodeEditor(loop.id, definition, 'infer', api);
    fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }));
    await screen.findByRole('button', { name: 'Use Ollama limits' });
    const before = useEditorStore.getState().definition?.nodes.find((node) => node.id === 'infer');
    fireEvent.click(screen.getByRole('button', { name: 'Use Ollama limits' }));
    expect(
      useEditorStore.getState().definition?.nodes.find((node) => node.id === 'infer'),
    ).not.toEqual(before);
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().definition?.nodes.find((node) => node.id === 'infer')).toEqual(
      before,
    );
  });
});

describe('Ollama policy correction', () => {
  it('handles absent, empty and irrelevant values without changing model or effort', () => {
    expect(ollamaPolicyProblems({})).toEqual(['harnessOptions.sandbox']);
    expect(
      ollamaPolicyProblems({ session: UNSET, harnessOptions: { sandbox: 'read-only' } }),
    ).toEqual([]);
    expect(
      ollamaPolicyProblems({
        session: null,
        harnessOptions: [],
        capabilities: { wrong: false },
        contextFiles: false,
        output: { schema: null },
      }),
    ).toEqual(['session', 'harnessOptions.sandbox']);
    expect(
      ollamaPolicyProblems({
        session: { policy: 'fresh' },
        harnessOptions: {
          sandbox: 'read-only',
          approval: 'never',
          configOverrides: {},
          webSearch: false,
          networkAccess: false,
        },
        capabilities: { plugins: [] },
        contextFiles: [],
        output: { schema: { jsonSchema: {}, repair: { enabled: false } } },
      }),
    ).toEqual([]);
    expect(
      ollamaPolicyProblems({
        harnessOptions: { sandbox: 'read-only' },
        output: { schema: { jsonSchema: {} } },
      }),
    ).toEqual(['output.schema.repair']);
    expect(
      withOllamaLimits({ model: 'exact:model', effort: 'none', prompt: { template: 'Keep' } }),
    ).toEqual({
      model: 'exact:model',
      effort: 'none',
      prompt: { template: 'Keep' },
      session: { policy: 'fresh' },
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
    });
    expect(ollamaPolicyProblems(withOllamaLimits(incompatible))).toEqual([]);
    expect(incompatible.contextFiles).toHaveLength(1);
  });
});
