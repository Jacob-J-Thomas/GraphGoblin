import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import {
  loadLocalDraft,
  loadSetAsideDraft,
  saveLocalDraft,
  saveSetAsideDraft,
} from '../drafts/local-drafts.js';
import { useApiKeyStore } from '../api/api-key.js';
import { KIND_MIME } from './model.js';
import { newLoopDefinition } from './model.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { useEditorStore } from './store.js';

const SAVE_WAIT = { timeout: 4000 };

describe('EditorPage', () => {
  it('loads a draft, adds nodes from the palette, edits properties, and autosaves', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('my loop'));
    renderApp(`/loops/${loop.id}/edit`, api);

    expect(await screen.findByRole('heading', { name: 'my loop' })).toBeInTheDocument();
    expect(screen.getByText('draft only')).toBeInTheDocument();
    expect(screen.getByText('✓ Ready to publish')).toBeInTheDocument();
    expect(screen.getByTestId('node-start')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    // The new node is selected, so its generated form shows; its port is unconnected.
    expect(screen.getByRole('form', { name: 'wait config' })).toBeInTheDocument();
    expect(screen.getAllByText(/PORT_UNCONNECTED|NODE_UNREACHABLE/).length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText('Label'));
    await user.type(screen.getByLabelText('Label'), 'Approval');
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
    // Clicking a schema issue selects its node.
    await user.click(screen.getAllByRole('button', { name: /SCHEMA subloop/ })[0]!);
    expect(useEditorStore.getState().selectedNodeId).toBe('subloop');
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

  it('publishes, surfaces 422 issues, and starts a run from the run panel', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'minimal' });
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();

    // Structural error: the server refuses with 422 and the issues are listed.
    await user.click(screen.getByRole('button', { name: 'Add Mutate node' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Publish failed')).toBeInTheDocument();
    expect(screen.getAllByText(/mutate/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Delete node' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs\//));
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
    useEditorStore.getState().select('start');
    await screen.findByRole('form', { name: 'start config' });
    setCode('Input schema', '{"type": ');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/does not parse; fix them first/)).toBeInTheDocument();
    expect(api.callsTo('POST', `/loops/${loop.id}/publish`)).toHaveLength(0);

    // Fixing the text clears the issue.
    setCode('Input schema', '{"type": "object"}');
    await waitFor(() => expect(screen.queryByText(/FIELD_UNPARSED/)).toBeNull());

    // Leaving the node keeps the blocker and the text; coming back shows the text again.
    setCode('Input schema', '{"broken": ');
    expect(await screen.findByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    useEditorStore.getState().select(undefined);
    await screen.findByText('Select a node to edit its properties.');
    expect(screen.getByText(/FIELD_UNPARSED/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/does not parse; fix them first/)).toBeInTheDocument();
    useEditorStore.getState().select('start');
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
    useEditorStore.getState().select(undefined);
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
    const form = screen.getByRole('form', { name: 'Connect wait' });
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

    // A new exit's default return channels are shown as a default until customized.
    await user.click(screen.getByRole('button', { name: 'Add Exit node' }));
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

    await user.click(screen.getByRole('button', { name: 'Loop settings' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'sink');
    expect(screen.getByRole('heading', { name: 'sink' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Description'), 'x');
    await user.clear(screen.getByLabelText('Max iterations'));
    await user.type(screen.getByLabelText('Max iterations'), '4');
    expect(useEditorStore.getState().definition!.settings).toMatchObject({ maxIterations: 4 });
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(Object.keys(useEditorStore.getState().definition!.variables!)).toContain('key2');

    await user.click(screen.getByRole('tab', { name: 'Node' }));
    useEditorStore.getState().select('check');
    await screen.findByRole('form', { name: 'check config' });
    const idInput = screen.getByLabelText('Node id');
    await user.clear(idInput);
    await user.type(idInput, '9bad{Enter}');
    expect(screen.getByText(/Use a letter first/)).toBeInTheDocument();
    await user.clear(idInput);
    await user.type(idInput, 'infer{Enter}');
    expect(screen.getByText(/"infer" is already used/)).toBeInTheDocument();
    await user.clear(idInput);
    await user.type(idInput, 'verify');
    fireEvent.blur(idInput);
    expect(useEditorStore.getState().selectedNodeId).toBe('verify');
    fireEvent.blur(screen.getByLabelText('Node id'));

    await user.click(screen.getByRole('button', { name: /Remove edge e5b/ }));
    expect(useEditorStore.getState().definition!.edges.some((e) => e.id === 'e5b')).toBe(false);

    useEditorStore.getState().removeEdge('e2');
    useEditorStore.getState().select('nightly');
    expect(await screen.findByText('No outgoing edges.')).toBeInTheDocument();
    useEditorStore.getState().select(undefined);
    expect(await screen.findByText('Select a node to edit its properties.')).toBeInTheDocument();
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
    useEditorStore.getState().select('sub');
    expect(await screen.findByText('This loop has no published version.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Subloop'), '');
  });
});
