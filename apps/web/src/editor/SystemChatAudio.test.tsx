import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import {
  createSystemChatDefinition,
  enableChatAudio,
  systemChatCapabilities,
} from '@graphgoblin/domain';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { SystemChatAudio } from './SystemChatAudio.js';
import { useEditorStore } from './store.js';
import { NodeEditorDialog } from './NodeEditorDialog.js';
const seed = () => createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' });
const normalizer = {
  id: 'chat-normalize',
  label: 'Normalize',
  kind: 'script' as const,
  config: {
    command: 'normalizer',
    args: [],
    cwd: 'workspace',
    stdin: 'thread' as const,
    stdout: 'last-output' as const,
  },
  ui: { x: 260, y: 160 },
};
function mount(
  definition: LoopDefinitionInput = seed(),
  published: LoopDefinitionInput | undefined = seed(),
) {
  useEditorStore.getState().load('gateway-loop', definition);
  useEditorStore.setState({ systemChat: true });
  const api = new FakeApi();
  function Surface() {
    const current = useEditorStore((state) => state.definition)!;
    return (
      <SystemChatAudio
        definition={current}
        published={published}
        loopId="gateway-loop"
        version={published ? 3 : undefined}
      />
    );
  }
  return { ...renderWith(<Surface />, '/chat', api), api };
}
afterEach(() => {
  cleanup();
  useEditorStore.getState().reset();
});
describe('owner voice configuration', () => {
  it('stages a real script, applies once, selects its editor, and removes the full chain through undo', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText('Voice messages: off.')).toBeVisible();
    expect(screen.getByText('Not in published v3.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Set up voice messages' }));
    const dialog = screen.getByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add voice steps' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByText('Choose Script or Subloop.')).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole('radio')
        .every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Script' }));
    expect(
      within(dialog).getByText('Enter the command that produces the transcript.'),
    ).toBeVisible();
    expect(useEditorStore.getState().definition!.nodes).toHaveLength(3);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Command' }),
      '/usr/local/bin/transcribe',
    );
    expect(add).toHaveAttribute('aria-disabled', 'false');
    await user.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useEditorStore.getState()).toMatchObject({
      selectedNodeId: 'chat-normalize',
      nodeDialogOpen: true,
    });
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(
      systemChatCapabilities(LoopDefinitionSchema.parse(useEditorStore.getState().definition))
        .audio,
    ).toBe(true);
    expect(screen.getByText('Voice steps added. Undo removes them.')).toBeInTheDocument();
    act(() => useEditorStore.getState().undo());
    expect(useEditorStore.getState().definition).toEqual(seed());
  });
  it('keeps staged values on helper refusal and never mutates until Add', async () => {
    const user = userEvent.setup();
    const definition = seed();
    definition.edges = [];
    mount(definition);
    await user.click(screen.getByRole('button', { name: 'Set up voice messages' }));
    await user.click(screen.getByRole('radio', { name: 'Script' }));
    await user.type(screen.getByRole('textbox', { name: 'Command' }), 'normalizer');
    await user.click(screen.getByRole('button', { name: 'Add voice steps' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t add voice steps.');
    expect(screen.getByRole('textbox', { name: 'Command' })).toHaveValue('normalizer');
    expect(useEditorStore.getState().definition).toEqual(definition);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });
  it('chooses an ordinary published subloop and preserves its editable input mapping', async () => {
    const user = userEvent.setup();
    const mounted = mount();
    const child = mounted.api.addLoop(seed(), { published: true });
    const system = mounted.api.addLoop(seed(), { published: true });
    const stored = mounted.api.loops.get(system.id)!;
    mounted.api.loops.set(system.id, {
      ...stored,
      loop: {
        ...system,
        system: { kind: 'chat', protocol: 'graphgoblin.chat.v1', audience: { kind: 'gateway' } },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Set up voice messages' }));
    await user.click(screen.getByRole('radio', { name: 'Subloop' }));
    expect(screen.getByText('Choose the loop that produces the transcript.')).toBeVisible();
    const select = await screen.findByRole('combobox', { name: 'Subloop' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    await user.selectOptions(select, child.id);
    for (const button of screen.queryAllByRole('button', { name: /^Advanced/ }))
      fireEvent.click(button);
    expect(
      screen.getByText('Result only, to last output (fixed for voice messages).'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add voice steps' }));
    expect(
      useEditorStore.getState().definition!.nodes.find((node) => node.id === 'chat-normalize'),
    ).toMatchObject({
      kind: 'subloop',
      config: {
        loopRef: { loopId: child.id },
        input: { trigger: { payload: 'trigger.payload' } },
        output: { mode: 'result-only', resultTo: { lastOutput: true } },
      },
    });
  });
  it('turns off complete voice configuration in one draft edit and leaves custom prompts untouched', async () => {
    const user = userEvent.setup();
    const definition = enableChatAudio(seed(), normalizer);
    const respond = definition.nodes.find((node) => node.id === 'respond')!;
    if (respond.kind !== 'inference') throw new Error('fixture');
    respond.config.prompt.template = 'My custom prompt';
    mount(definition, definition);
    expect(screen.getByText('Configured by loop in published v3.')).toBeVisible();
    expect(
      screen.getByText(/Custom prompts were left unchanged. Check that your workflow reads/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit normalizer' }));
    expect(useEditorStore.getState().selectedNodeId).toBe('chat-normalize');
    await user.click(screen.getByRole('button', { name: 'Turn off voice messages' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Voice steps removed. Undo restores them.')).toBeInTheDocument();
    expect(useEditorStore.getState().past).toHaveLength(1);
    expect(
      useEditorStore.getState().definition!.nodes.find((node) => node.id === 'respond'),
    ).toMatchObject({ config: { prompt: { template: 'My custom prompt' } } });
  });
  it('recovers a partial chain through an explicit continuation choice', async () => {
    const user = userEvent.setup();
    const definition = enableChatAudio(seed(), normalizer);
    definition.edges = definition.edges.filter(
      (edge) => !(edge.from.node === 'chat-normalize-check' && edge.from.port === 'valid'),
    );
    mount(definition);
    expect(screen.getByText('Voice setup needs attention.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Turn off voice messages' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Turn off voice messages' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Continue with' }),
      'respond',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Turn off voice messages' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      useEditorStore.getState().definition!.edges.find((edge) => edge.from.node === 'chat-input')
        ?.to.node,
    ).toBe('respond');
  });
  it('does not overwrite a newer draft while configuration is open', async () => {
    const user = userEvent.setup();
    mount(seed(), undefined);
    await user.click(screen.getByRole('button', { name: 'Set up voice messages' }));
    await user.click(screen.getByRole('radio', { name: 'Script' }));
    await user.type(screen.getByRole('textbox', { name: 'Command' }), 'normalizer');
    act(() => useEditorStore.getState().updateMeta({ description: 'newer' }));
    await user.click(screen.getByRole('button', { name: 'Add voice steps' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The draft changed.');
    expect(useEditorStore.getState().definition!.description).toBe('newer');
  });
  it('keeps protected validation nodes read-only in the ordinary node editor', async () => {
    const definition = enableChatAudio(seed(), normalizer);
    useEditorStore.getState().load('gateway-loop', definition);
    useEditorStore.setState({ systemChat: true });
    const check = definition.nodes.find((node) => node.id === 'chat-normalize-check')!;
    renderWith(
      <NodeEditorDialog
        node={check}
        definition={definition}
        issues={[]}
        loopId="gateway-loop"
        system
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText('Protected voice check. Turn off voice messages removes it.'),
      ).toBeVisible(),
    );
    expect(screen.getByRole('textbox', { name: 'Node id' })).toHaveAttribute('readonly');
    expect(document.getElementById('node-label')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Delete node' })).toBeDisabled();
  });
});

describe('voice setup draft and recovery limits', () => {
  it('holds unfinished normalizer fields until valid and preserves them locally', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Set up voice messages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add voice steps' }));
    expect(useEditorStore.getState().past).toHaveLength(0);
    await user.click(screen.getByRole('radio', { name: 'Script' }));
    await user.type(screen.getByRole('textbox', { name: 'Command' }), 'normalizer');
    for (const button of screen.queryAllByRole('button', { name: /^Advanced/ }))
      fireEvent.click(button);
    const timeout = screen.getByRole('spinbutton', { name: 'Timeout seconds' });
    let badInput = true;
    Object.defineProperty(timeout, 'validity', { configurable: true, get: () => ({ badInput }) });
    fireEvent.input(timeout, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Add voice steps' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('Complete the normalizer configuration.')).toBeVisible();
    badInput = false;
    fireEvent.input(timeout, { target: { value: '30' } });
    expect(screen.getByRole('button', { name: 'Add voice steps' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
  it('allows cancelling continuation recovery without mutating and refuses a stale continuation choice', async () => {
    const user = userEvent.setup();
    const definition = enableChatAudio(seed(), normalizer);
    definition.edges = definition.edges.filter((edge) => edge.from.port !== 'valid');
    mount(definition);
    await user.click(screen.getByRole('button', { name: 'Turn off voice messages' }));
    const first = screen.getByRole('dialog');
    fireEvent.click(within(first).getByRole('button', { name: 'Turn off voice messages' }));
    expect(useEditorStore.getState().past).toHaveLength(0);
    await user.click(within(first).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off voice messages' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Continue with' }), 'respond');
    act(() => useEditorStore.getState().updateMeta({ description: 'newer' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off voice messages' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The draft changed.');
  });
  it('reports locked trigger damage honestly instead of claiming a broken setup works', async () => {
    const user = userEvent.setup();
    const definition = enableChatAudio(seed(), normalizer);
    definition.variables['chatResponse'] = { type: 'number' };
    mount(definition);
    await user.click(screen.getByRole('button', { name: 'Turn off voice messages' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Repair the chat trigger before turning off voice messages.',
    );
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});
