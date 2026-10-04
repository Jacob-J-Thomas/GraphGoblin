import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import {
  loadLocalDraft,
  loadSetAsideDraft,
  saveLocalDraft,
  saveSetAsideDraft,
} from '../drafts/local-drafts.js';
import { useApiKeyStore } from '../api/api-key.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { KIND_MIME, newLoopDefinition } from './model.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { useEditorStore } from './store.js';

const SAVE_WAIT = { timeout: 4000 };

describe('EditorPage', () => {
  // jsdom's window is 1024 px wide, where the loop panel starts collapsed; most tests read the
  // validation list in it, so they start with it expanded (the setup clears storage after each).
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('collapses and expands the loop panel from the toolbar and remembers it', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    const first = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'minimal' });
    // Below 1280 px nothing stored means collapsed: a rail with Show and the issue count.
    const toggle = screen.getByRole('button', { name: 'Loop settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'loop-panel');
    expect(screen.getByRole('complementary', { name: 'Loop' })).toHaveAttribute('id', 'loop-panel');
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByText('Ready to publish')).toHaveClass('sr-only');

    // Expanding moves focus into the panel; the choice is remembered for the next visit.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Loop' })).toHaveFocus();
    expect(screen.getByLabelText('Name')).toHaveValue('minimal');
    expect(screen.getByRole('region', { name: 'Validation' })).toBeInTheDocument();
    expect(localStorage.getItem(LOOP_PANEL_STORAGE_KEY)).toBe('expanded');
    first.unmount();
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();

    // The panel's own Hide button collapses it too, leaving focus on Show.
    await user.click(screen.getByRole('button', { name: 'Hide loop' }));
    expect(screen.getByRole('button', { name: 'Show loop' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Loop settings' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem(LOOP_PANEL_STORAGE_KEY)).toBe('collapsed');
  });

  it('starts with the loop panel expanded on wide windows, and counts issues on its rail', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'minimal' });
    expect(screen.getByRole('button', { name: 'Loop settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    width.mockRestore();
    // Collapsed, the rail keeps the counts: an exit criterion above the ceiling is a warning,
    // and a new wait node brings two errors (unconnected port, unreachable node).
    await user.click(screen.getByRole('button', { name: 'Loop settings' }));
    const rail = screen.getByRole('complementary', { name: 'Loop' });
    act(() =>
      useEditorStore.getState().updateNode('done', {
        config: { criteria: [{ when: 'max-iterations', value: 99 }] },
      }),
    );
    expect(within(rail).getByTitle('1 warning')).toHaveTextContent('1 warning');
    expect(within(rail).queryByTitle(/error/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    expect(within(rail).getByTitle('2 errors')).toHaveTextContent('2 errors');
    // One error (text that does not parse) and two warnings (a second exit above the ceiling).
    act(() => useEditorStore.getState().removeNode('wait'));
    act(() =>
      useEditorStore.getState().setFieldError('settings', 'x', { message: 'bad', text: '{' }),
    );
    expect(within(rail).getByTitle('1 error')).toHaveTextContent('1 error');
    act(() => {
      useEditorStore.getState().addNode('exit', { x: 0, y: 0 });
      useEditorStore.getState().updateNode('exit', {
        config: { criteria: [{ when: 'max-iterations', value: 99 }] },
      });
    });
    expect(within(rail).getByTitle('2 warnings')).toHaveTextContent('2 warnings');
  });

  it('loads a draft, adds nodes from the palette, edits properties, and autosaves', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('my loop'));
    renderApp(`/loops/${loop.id}/edit`, api);

    expect(await screen.findByRole('heading', { name: 'my loop' })).toBeInTheDocument();
    expect(screen.getByText('draft only')).toBeInTheDocument();
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByTestId('node-start')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    // The new node is selected but its editor stays closed; its port is unconnected.
    expect(useEditorStore.getState().selectedNodeId).toBe('wait');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText(/PORT_UNCONNECTED|NODE_UNREACHABLE/).length).toBeGreaterThan(0);

    // A click on the node opens its editor with the generated form.
    fireEvent.click(screen.getByTestId('node-wait'));
    const dialog = screen.getByRole('dialog', { name: 'Edit wait wait' });
    expect(within(dialog).getByRole('form', { name: 'wait config' })).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Label'));
    await user.type(within(dialog).getByLabelText('Label'), 'Approval');
    expect(within(screen.getByTestId('node-wait')).getByText('Approval')).toBeInTheDocument();

    await waitFor(
      () => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`).length).toBeGreaterThan(0),
      SAVE_WAIT,
    );
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    const saved = api.callsTo('PUT', `/loops/${loop.id}/draft`).at(-1)!.body as {
      definition: { nodes: { label: string }[] };
    };
    expect(saved.definition.nodes.map((n) => n.label)).toContain('Approval');
    expect((await loadLocalDraft(loop.id))?.synced).toBe(true);
  });

  it('adds a node dropped from the palette and refuses bad connections', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('drop'));
    renderApp(`/loops/${loop.id}/edit`, api);
    const canvas = await screen.findByTestId('canvas');
    const data = new Map<string, string>([[KIND_MIME, 'script']]);
    const dataTransfer = {
      getData: (k: string) => data.get(k) ?? '',
      setData: () => undefined,
      dropEffect: 'none',
    };
    fireEvent.dragOver(canvas, { dataTransfer });
    fireEvent.drop(canvas, { dataTransfer, clientX: 100, clientY: 100 });
    expect(screen.getByTestId('node-script')).toBeInTheDocument();
    fireEvent.drop(canvas, { dataTransfer: { getData: () => 'nonsense' } });
    expect(useEditorStore.getState().definition!.nodes).toHaveLength(3);
    // Dropping selects the new node; it does not open its editor.
    expect(screen.queryByRole('dialog')).toBeNull();

    // A palette drag start carries the kind.
    const set: Record<string, string> = {};
    fireEvent.dragStart(screen.getByRole('button', { name: 'Add Exit node' }), {
      dataTransfer: { setData: (k: string, v: string) => (set[k] = v), effectAllowed: '' },
    });
    expect(set[KIND_MIME]).toBe('exit');

    useEditorStore
      .getState()
      .connect({ source: 'done', sourceHandle: 'loopBack', target: 'start' });
    expect(
      await screen.findByText(/Connection refused: triggers have no input/),
    ).toBeInTheDocument();
  });

  it('keeps schema-invalid drafts on the device and explains why', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('invalid'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await user.click(await screen.findByRole('button', { name: 'Add Subloop node' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('Saved on this device only'),
      SAVE_WAIT,
    );
    expect(screen.getByText(/Fix the schema errors/)).toBeInTheDocument();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    const local = await loadLocalDraft(loop.id);
    expect(local?.synced).toBe(false);
    expect(local?.definition.nodes.map((n) => n.id)).toContain('subloop');
    // Clicking a schema issue opens its node.
    act(() => useEditorStore.getState().select(undefined));
    await user.click(screen.getAllByRole('button', { name: /SCHEMA subloop/ })[0]!);
    expect(useEditorStore.getState().selectedNodeId).toBe('subloop');
    expect(screen.getByRole('dialog', { name: 'Edit subloop subloop' })).toBeInTheDocument();
  });

  it('keeps a newer server draft over an older unsynced local copy, and can switch', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    await saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
    expect(screen.getByText('The server has a newer draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
    expect(screen.queryByText('The server has a newer draft')).toBeNull();
    expect(screen.getByText('Restored unsaved changes from this device.')).toBeInTheDocument();
  });

  it('restores an unsynced local draft and reports offline saves', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const local = newLoopDefinition('local copy');
    await saveLocalDraft({ loopId: loop.id, definition: local, savedAt: 'now', synced: false });
    api.override('PUT /loops/:id/draft', () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'local copy' })).toBeInTheDocument();
    expect(screen.getByText('Restored unsaved changes from this device.')).toBeInTheDocument();
    await waitFor(
      () =>
        expect(screen.getByTestId('save-state')).toHaveTextContent('Offline: saved on this device'),
      SAVE_WAIT,
    );

    // Back online: the retry saves.
    api.override('PUT /loops/:id/draft', () => problem(500, 'INTERNAL_ERROR', 'disk full'));
    window.dispatchEvent(new Event('online'));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed'),
      SAVE_WAIT,
    );
    expect(screen.getByText(/disk full/)).toBeInTheDocument();
  });

  it('opens offline from the local draft, and shows offline or missing states without one', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('cached'));
    await saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('cached'),
      savedAt: 'now',
      synced: true,
    });
    api.offline = true;
    const first = renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'cached' })).toBeInTheDocument();
    first.unmount();

    renderApp('/loops/01UNKNOWN0000000000000000/edit', api);
    expect(await screen.findByText('Offline')).toBeInTheDocument();
  });

  it('shows a missing loop as an error', async () => {
    renderApp('/loops/01MISSING0000000000000000/edit');
    expect(await screen.findByText(/Could not load loop/)).toBeInTheDocument();
  });

  it('publishes, surfaces 422 issues, and links to the New run flow once published', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'minimal' });
    // Runs start only from Runs: before a publish the link is disabled and says why.
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    const disabled = screen.getByRole('link', { name: 'Open in Runs' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toHaveAttribute('href');
    expect(disabled).toHaveAccessibleDescription(/Publish the loop first/);
    await user.click(disabled);
    expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${loop.id}/edit`);

    // Structural error: the server refuses with 422 and the issues are listed.
    await user.click(screen.getByRole('button', { name: 'Add Mutate node' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Publish failed')).toBeInTheDocument();
    expect(screen.getAllByText(/mutate/).length).toBeGreaterThan(0);

    // Delete node, in the node's editor, removes it and closes the editor.
    fireEvent.click(screen.getByTestId('node-mutate'));
    await user.click(screen.getByRole('button', { name: 'Delete node' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('node-mutate')).toBeNull();
    expect(screen.getByTestId('canvas')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    // The toolbar link and the published notice's "run it" link both lead to New run.
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Open in Runs' })).toHaveLength(2),
    );
    for (const link of screen.getAllByRole('link', { name: 'Open in Runs' }))
      expect(link).toHaveAttribute('href', `/runs/new?loop=${loop.id}`);
    await user.click(screen.getAllByRole('link', { name: 'Open in Runs' })[1]!);
    expect(await screen.findByRole('heading', { name: 'New run' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Start run' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs\/[0-9A-Z]{26}$/),
    );
  });

  it('says there is nothing to publish when the loop has no changes, and hides it after an edit', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop(), { published: true });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'minimal' });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Nothing to publish/)).toBeInTheDocument();
    expect(screen.queryByText('Publish failed')).toBeNull();
    useEditorStore.getState().updateMeta({ description: 'changed' });
    await waitFor(() => expect(screen.queryByText(/Nothing to publish/)).toBeNull());
  });

  it('lists the issues only the API finds and blocks publishing on JSON that does not parse', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.serverOnlyIssues = [
      {
        code: 'CRON_INVALID',
        severity: 'error',
        message: 'cron trigger "start": bad',
        nodeId: 'start',
      },
    ];
    const loop = api.addLoop(minimalLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText(/cron trigger "start": bad/)).toBeInTheDocument();
    api.serverOnlyIssues = [];

    // The trigger's input schema editor holds text that is not JSON.
    act(() => useEditorStore.getState().openNode('start'));
    await screen.findByRole('form', { name: 'start config' });
    setCode('Input schema', '{"type": ');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/does not parse; fix them first/)).toBeInTheDocument();
    expect(api.callsTo('POST', `/loops/${loop.id}/publish`)).toHaveLength(0);

    // Fixing the text clears the issue.
    setCode('Input schema', '{"type": "object"}');
    await waitFor(() => expect(screen.queryByText(/FIELD_UNPARSED/)).toBeNull());

    // Closing the editor keeps the blocker and the text; opening it again shows the text again.
    setCode('Input schema', '{"broken": ');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/does not parse; fix them first/)).toBeInTheDocument();
    act(() => useEditorStore.getState().openNode('start'));
    await screen.findByRole('form', { name: 'start config' });
    expect(getCode('Input schema')).toBe('{"broken": ');

    // Discarding in the field restores the last valid value and clears the blocker.
    await user.click(screen.getByRole('button', { name: 'Discard text' }));
    await waitFor(() => expect(screen.queryByText(/FIELD_UNPARSED/)).toBeNull());
    expect(getCode('Input schema')).toContain('"object"');

    // Discarding from the validation panel with the field mounted resets the field too.
    setCode('Input schema', '{"mounted": ');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard unparsed text at inputSchema' }));
    await waitFor(() => expect(screen.queryByText(/FIELD_UNPARSED/)).toBeNull());
    expect(getCode('Input schema')).toContain('"object"');
    expect(screen.queryByText(/Invalid JSON/)).toBeNull();

    // Discarding from the validation panel works when the field is gone.
    setCode('Input schema', '[');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    act(() => useEditorStore.getState().closeNodeDialog());
    await user.click(
      await screen.findByRole('button', { name: 'Discard unparsed text at inputSchema' }),
    );
    await waitFor(() => expect(screen.queryByText(/FIELD_UNPARSED/)).toBeNull());
  });

  it('connects nodes from the keyboard and customizes a default list', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('keys'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'keys' });
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    // Enter on the focused node opens its editor, with focus on the dialog's heading.
    const card = screen.getByTestId('node-wait').closest<HTMLElement>('.react-flow__node')!;
    act(() => card.focus());
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Edit wait wait' });
    expect(within(dialog).getByRole('heading', { name: 'Edit wait wait' })).toHaveFocus();
    const form = within(dialog).getByRole('form', { name: 'Connect wait' });
    await user.selectOptions(within(form).getByLabelText('To'), 'done');
    await user.click(within(form).getByRole('button', { name: 'Connect' }));
    expect(useEditorStore.getState().definition?.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'wait', port: 'out' },
        to: { node: 'done', port: 'in' },
      }),
    );
    // Its only port is now used, so the form is gone.
    expect(screen.queryByRole('form', { name: 'Connect wait' })).toBeNull();
    // Delete or Backspace in the dialog edits nothing on the canvas (WP-D2 D19).
    await user.click(within(dialog).getByRole('button', { name: 'Remove edge e2' }));
    act(() => within(dialog).getByLabelText('Label').focus());
    await user.keyboard('{Delete}{Backspace}');
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard('{Delete}{Backspace}');
    expect(useEditorStore.getState().definition?.nodes.some((n) => n.id === 'wait')).toBe(true);
    // Esc closes it; focus returns to the node, which stays selected.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card).toHaveFocus();
    expect(useEditorStore.getState()).toMatchObject({
      selectedNodeId: 'wait',
      nodeDialogOpen: false,
    });

    // A new exit's default return channels are shown as a default until customized.
    await user.click(screen.getByRole('button', { name: 'Add Exit node' }));
    act(() => useEditorStore.getState().openNode('exit'));
    expect(await screen.findByText('[{"kind":"caller"}]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Customize channels' }));
    await waitFor(() =>
      expect(
        (
          useEditorStore.getState().definition?.nodes.find((n) => n.id === 'exit')?.config as {
            return?: { channels?: unknown };
          }
        ).return?.channels,
      ).toEqual([{ kind: 'caller' }]),
    );
    expect(screen.queryByText(/expected object, received undefined/)).toBeNull();
  });

  it('shows the right node when the open editor is switched to another node of the same kind', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(kitchenSinkLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'kitchen-sink' });
    act(() => useEditorStore.getState().openNode('start'));
    expect(await screen.findByRole('dialog', { name: 'Edit trigger start' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Expression')).toBeNull();
    act(() => useEditorStore.getState().openNode('nightly'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit trigger nightly' });
    expect(within(dialog).getByLabelText('Expression')).toHaveValue('0 2 * * *');
    expect(within(dialog).getByLabelText('Node id')).toHaveValue('nightly');
  });

  it('says in the dialog why a connection was refused', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('refused'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'refused' });
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    act(() => useEditorStore.getState().openNode('wait'));
    const form = await screen.findByRole('form', { name: 'Connect wait' });
    await user.selectOptions(within(form).getByLabelText('To'), 'done');
    // The chosen target disappears before Connect is pressed (as another edit could do).
    act(() => useEditorStore.getState().removeNode('done'));
    act(() => useEditorStore.getState().openNode('wait'));
    await user.click(within(form).getByRole('button', { name: 'Connect' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Connection refused: unknown node');
  });

  it('connects a chosen port, and keeps an exit’s loop-back config in step with its edge', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(kitchenSinkLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'kitchen-sink' });

    // A script with two free ports: pick the second.
    act(() => useEditorStore.getState().openNode('check'));
    let dialog = await screen.findByRole('dialog', { name: 'Edit script check' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove edge e5' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove edge e5b' }));
    const form = within(dialog).getByRole('form', { name: 'Connect check' });
    await user.selectOptions(within(form).getByLabelText('Output'), 'retry');
    await user.selectOptions(within(form).getByLabelText('To'), 'decide');
    await user.click(within(form).getByRole('button', { name: 'Connect' }));
    expect(useEditorStore.getState().definition!.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'check', port: 'retry' },
        to: { node: 'decide', port: 'in' },
      }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    // The exit's loop-back: removing the edge clears the field, connecting sets it again.
    act(() => useEditorStore.getState().openNode('done'));
    dialog = await screen.findByRole('dialog', { name: 'Edit exit done' });
    expect(within(dialog).getByLabelText('Target node id')).toHaveValue('prep');
    await user.click(within(dialog).getByRole('button', { name: 'Remove edge e11' }));
    expect(within(dialog).queryByLabelText('Target node id')).toBeNull();
    const loopBack = within(dialog).getByRole('form', { name: 'Connect done' });
    await user.selectOptions(within(loopBack).getByLabelText('To'), 'infer');
    await user.click(within(loopBack).getByRole('button', { name: 'Connect' }));
    expect(within(dialog).getByLabelText('Target node id')).toHaveValue('infer');
    // An edit elsewhere in the form keeps it.
    await user.clear(within(dialog).getByLabelText('Label'));
    await user.type(within(dialog).getByLabelText('Label'), 'Finish');
    expect(
      useEditorStore.getState().definition!.nodes.find((n) => n.id === 'done')!.config,
    ).toMatchObject({
      loopBack: { targetNodeId: 'infer' },
    });
  });

  it('never lets an older save land after a newer one', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('order'));
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const landed: (string | undefined)[] = [];
    api.override('PUT /loops/:id/draft', async (call) => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // The first request is slow: unserialized, the second would complete before it.
      await new Promise((resolve) => setTimeout(resolve, calls === 1 ? 900 : 20));
      inFlight -= 1;
      const definition = (call.body as { definition: { description?: string } }).definition;
      landed.push(definition.description);
      return new Response(JSON.stringify({ draft: {}, issues: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'order' });
    act(() => useEditorStore.getState().updateMeta({ description: 'first' }));
    await waitFor(() => expect(calls).toBe(1), SAVE_WAIT);
    act(() => useEditorStore.getState().updateMeta({ description: 'second' }));
    await waitFor(
      () => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
      SAVE_WAIT,
    );
    expect(maxInFlight).toBe(1);
    expect(landed.at(-1)).toBe('second');
    const local = await loadLocalDraft(loop.id);
    expect(local).toMatchObject({ synced: true, definition: { description: 'second' } });
  });

  it('keeps a set-aside device copy across edits and reloads until restored or discarded', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    await saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    const first = renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();
    // Editing the server copy overwrites the live mirror, not the set-aside copy.
    act(() => useEditorStore.getState().updateMeta({ description: 'edited server copy' }));
    await waitFor(async () =>
      expect((await loadLocalDraft(loop.id))?.definition.description).toBe('edited server copy'),
    );
    first.unmount();

    const second = renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
    second.unmount();

    // Restored: it is no longer offered. Discard works the same way.
    await saveSetAsideDraft({
      loopId: loop.id,
      definition: newLoopDefinition('another copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard it' }));
    expect(screen.queryByText('The server has a newer draft')).toBeNull();
    await waitFor(async () => expect(await loadSetAsideDraft(loop.id)).toBeUndefined());
  });

  it('keeps a restored device copy when leaving while an earlier save is in flight', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    await saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    let release: () => void = () => undefined;
    let puts = 0;
    api.override('PUT /loops/:id/draft', async () => {
      puts += 1;
      // The first save hangs until released; later ones fail, as on a dropped connection.
      if (puts === 1) await new Promise<void>((resolve) => (release = resolve));
      return problem(500, 'INTERNAL_ERROR', 'unavailable');
    });
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();
    act(() => useEditorStore.getState().updateMeta({ description: 'one edit' }));
    await waitFor(() => expect(puts).toBe(1), SAVE_WAIT);
    await user.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
    view.unmount();
    release();
    await waitFor(async () => expect(await loadSetAsideDraft(loop.id)).toBeUndefined());

    // Reopening finds the restored copy, not the server's.
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
    expect(screen.getByText('Restored unsaved changes from this device.')).toBeInTheDocument();
  });

  it('loads the editor once an API key is entered after a 401', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.requiredKey = 'gg_good';
    const loop = api.addLoop(newLoopDefinition('guarded'));
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText('API key required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key', { selector: 'input' }), 'gg_good');
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    expect(await screen.findByRole('heading', { name: 'guarded' })).toBeInTheDocument();
    useApiKeyStore.setState({ key: undefined, rejected: false });
  });

  it('keeps an edit made just before leaving the editor', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('leave'));
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'leave' });
    useEditorStore.getState().updateMeta({ description: 'typed then left' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.unmount();
    await waitFor(async () =>
      expect((await loadLocalDraft(loop.id))?.definition.description).toBe('typed then left'),
    );
    await waitFor(() => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1));
  });

  it('refuses to publish a draft that cannot be saved', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await user.click(await screen.findByRole('button', { name: 'Add Subloop node' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument();
  });

  it('edits loop settings, variables, node ids, and edges', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(kitchenSinkLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'kitchen-sink' });

    // The loop panel (expanded) holds the loop's own settings.
    const panel = screen.getByRole('complementary', { name: 'Loop' });
    const name = within(panel).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'sink');
    expect(screen.getByRole('heading', { name: 'sink' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Description'), 'x');
    await user.clear(screen.getByLabelText('Max iterations'));
    await user.type(screen.getByLabelText('Max iterations'), '4');
    expect(useEditorStore.getState().definition!.settings).toMatchObject({ maxIterations: 4 });
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(Object.keys(useEditorStore.getState().definition!.variables!)).toContain('key2');

    act(() => useEditorStore.getState().openNode('check'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit script check' });
    await screen.findByRole('form', { name: 'check config' });
    const idInput = within(dialog).getByLabelText('Node id');
    await user.clear(idInput);
    await user.type(idInput, '9bad{Enter}');
    expect(screen.getByText(/Use a letter first/)).toBeInTheDocument();
    expect(idInput).toHaveAttribute('aria-invalid', 'true');
    await user.clear(idInput);
    await user.type(idInput, 'infer{Enter}');
    expect(screen.getByText(/"infer" is already used/)).toBeInTheDocument();
    await user.clear(idInput);
    await user.type(idInput, 'verify');
    fireEvent.blur(idInput);
    expect(useEditorStore.getState().selectedNodeId).toBe('verify');
    // The dialog follows the rename and keeps focus where it was.
    expect(screen.getByRole('dialog', { name: 'Edit script verify' })).toBe(dialog);
    expect(screen.queryByText(/is already used/)).toBeNull();
    fireEvent.blur(screen.getByLabelText('Node id'));

    await user.click(screen.getByRole('button', { name: /Remove edge e5b/ }));
    expect(useEditorStore.getState().definition!.edges.some((e) => e.id === 'e5b')).toBe(false);

    act(() => useEditorStore.getState().removeEdge('e2'));
    act(() => useEditorStore.getState().openNode('nightly'));
    expect(await screen.findByText('No outgoing edges.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit trigger nightly' })).toBeInTheDocument();
    act(() => useEditorStore.getState().closeNodeDialog());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useEditorStore.getState().selectedNodeId).toBe('nightly');
  });

  it('applies an id typed in the dialog when it closes, and stops once for an id that cannot apply', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(kitchenSinkLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'kitchen-sink' });
    act(() => useEditorStore.getState().openNode('check'));
    const idInput = (await screen.findByRole('dialog')).querySelector<HTMLInputElement>(
      '#node-id',
    )!;
    // A valid id still being typed applies when the dialog closes.
    await user.clear(idInput);
    await user.type(idInput, 'verify');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useEditorStore.getState().definition!.nodes.some((n) => n.id === 'verify')).toBe(true);
    expect(useEditorStore.getState().selectedNodeId).toBe('verify');

    // An invalid one keeps the dialog open once, with the reason and focus on the field.
    act(() => useEditorStore.getState().openNode('verify'));
    const again = within(await screen.findByRole('dialog')).getByLabelText('Node id');
    await user.clear(again);
    await user.type(again, '1st');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Edit script verify' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Use a letter first/);
    expect(again).toHaveFocus();
    // Closing again drops it: the id is unchanged.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useEditorStore.getState().selectedNodeId).toBe('verify');

    // Closed by the browser itself (a repeated Esc): it follows at once, dropping the bad id.
    act(() => useEditorStore.getState().openNode('verify'));
    const third = within(await screen.findByRole('dialog')).getByLabelText('Node id');
    await user.clear(third);
    await user.type(third, 'infer');
    act(() => screen.getByRole<HTMLDialogElement>('dialog').close());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useEditorStore.getState().definition!.nodes.some((n) => n.id === 'verify')).toBe(true);
  });

  it('picks a published subloop and shows its signature', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const child = api.addLoop(
      {
        ...minimalLoop(),
        name: 'child',
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Start',
            config: { subtype: 'manual', inputSchema: { type: 'object' } },
          },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: { return: { mapping: 'vars', channels: [{ kind: 'caller' }] } },
          },
        ],
      },
      { published: true },
    );
    api.addLoop({ ...minimalLoop(), name: 'unpublished' });
    const loop = api.addLoop(newLoopDefinition('parent'));
    renderApp(`/loops/${loop.id}/edit`, api);
    await user.click(await screen.findByRole('button', { name: 'Add Subloop node' }));
    fireEvent.click(screen.getByTestId('node-subloop'));
    await user.type(await screen.findByLabelText('Find a published loop'), 'chi');
    const pick = screen.getByLabelText('Subloop');
    expect(within(pick).queryByText('unpublished')).not.toBeInTheDocument();
    await user.selectOptions(pick, child.id);
    const signature = await screen.findByLabelText('Subloop signature');
    expect(signature).toHaveTextContent('"type": "object"');
    expect(signature).toHaveTextContent('done: vars');
    const node = useEditorStore.getState().definition!.nodes.find((n) => n.id === 'subloop')!;
    expect(node.config).toMatchObject({ loopRef: { loopId: child.id } });
  });

  it('shows when the picked subloop has no published version', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const draftOnly = api.addLoop({ ...minimalLoop(), name: 'draft-only' });
    const loop = api.addLoop({
      ...newLoopDefinition('p'),
      nodes: [
        ...newLoopDefinition('p').nodes,
        { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: draftOnly.id } } },
      ],
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'p' });
    act(() => useEditorStore.getState().openNode('sub'));
    expect(await screen.findByText('This loop has no published version.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Subloop'), '');
  });
});
