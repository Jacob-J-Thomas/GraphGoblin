import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import * as converter from '@graphgoblin/domain/upgrade';
import * as drafts from '../drafts/local-drafts.js';
import * as deviceUpgrader from './load-device-upgrader.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

/** Holds the IndexedDB write of the restored copy until released. */
const gate = vi.hoisted(() => ({
  hold: false,
  failArchive: false,
  hideArchive: false,
  release: (): void => undefined,
}));

vi.mock('../drafts/local-drafts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof drafts>();
  return {
    ...actual,
    saveLocalDraft: async (draft: Parameters<typeof actual.saveLocalDraft>[0]) => {
      if (gate.hold && draft.definition.name === 'older local copy') {
        await new Promise<void>((resolve) => (gate.release = resolve));
      }
      return actual.saveLocalDraft(draft);
    },
    loadArchivedDrafts: async (loopId: string) =>
      gate.hideArchive ? [] : actual.loadArchivedDrafts(loopId),
    saveArchivedDraft: async (draft: Parameters<typeof actual.saveArchivedDraft>[0]) => {
      if (gate.failArchive) throw new Error('simulated archive failure');
      return actual.saveArchivedDraft(draft);
    },
  };
});

describe('restoring a set-aside copy', () => {
  function legacyLoop(name: string, strategy: string[]): unknown {
    const base = newLoopDefinition(name);
    return {
      ...base,
      schemaVersion: 1,
      settings: {
        workingDirectory: { kind: 'temp' },
        defaults: { model: 'gpt-6-luna', effort: 'low' },
      },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            routes: [
              { label: 'yes', description: 'Approved' },
              { label: 'no', description: 'Rejected' },
            ],
            question: 'Choose',
            strategy,
            expression: { jsonata: '"yes"' },
            codex: { model: 'gpt-6-luna', effort: 'high' },
            jev: { model: 'kev', minConfidence: 0.7 },
          },
        },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
        { id: 'e2', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
      ],
    };
  }

  it('restores unfinished current JSONata into the editor instead of archiving it as an upgrade failure', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const definition: LoopDefinitionInput = {
      ...newLoopDefinition('unfinished local expression'),
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: '(' },
        },
      ],
    };
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition,
      savedAt: '2999-01-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(
      await screen.findByRole('heading', { name: 'unfinished local expression' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Restored unsaved changes from this device.'),
    ).toBeInTheDocument();
    expect(useEditorStore.getState().definition).toEqual(definition);
    expect(screen.queryByText('This device copy could not be migrated safely')).toBeNull();
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
    expect((await drafts.loadLocalDraft(loop.id))?.definition).toEqual(definition);
  });

  it('converts a v1 draft, archives the exact original and requires explicit first-save overwrite', async () => {
    const api = new FakeApi(),
      loop = api.addLoop(newLoopDefinition('server copy'));
    const original = {
      loopId: loop.id,
      definition: legacyLoop('legacy device copy', ['expression']) as LoopDefinitionInput,
      savedAt: '9999-01-01T00:00:00.000Z',
      synced: false,
    };
    await drafts.saveLocalDraft(original);
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'legacy device copy' })).toBeInTheDocument();
    await waitFor(async () => expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]));
    expect(await drafts.loadLocalDraft(loop.id)).toMatchObject({
      synced: false,
      definition: { schemaVersion: 4 },
      baseToken: 'unreconciled-device-format',
    });
    await screen.findByText('This device draft was converted to format 4');
    expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('server copy');
    await userEvent.click(screen.getByRole('button', { name: 'Overwrite with this copy' }));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('legacy device copy');
  });

  function oldManual(name: string, pending = false): LoopDefinitionInput {
    return {
      schemaVersion: 3,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: pending ? { criteria: [{ when: 'max-iterations', value: 3 }] } : {},
        },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    } as unknown as LoopDefinitionInput;
  }

  it.each(['retry', 'reopen'] as const)(
    'leaves all device keys untouched after a chunk-load failure and converts on %s',
    async (recovery) => {
      const api = new FakeApi(),
        loop = api.addLoop(newLoopDefinition('server copy'));
      const original = {
        loopId: loop.id,
        definition: oldManual('device work'),
        savedAt: '2999-01-01T00:00:00.000Z',
        synced: false,
        baseToken: 'old-token',
      };
      const aside = { ...original, definition: oldManual('earlier work'), savedAt: 'aside' };
      const archive = { ...original, definition: oldManual('archived work'), savedAt: 'archive' };
      await drafts.saveLocalDraft(original);
      await drafts.saveSetAsideDraft(aside);
      await drafts.saveArchivedDraft(archive);
      const loading = vi.spyOn(deviceUpgrader, 'loadDeviceUpgrader');
      // Exercise a failure for either source, including after the active copy converted in memory.
      if (recovery === 'retry')
        loading.mockRejectedValueOnce(new Error('stale chunk')).mockResolvedValueOnce(converter);
      else
        loading.mockResolvedValueOnce(converter).mockRejectedValueOnce(new Error('network error'));
      try {
        const view = renderApp(`/loops/${loop.id}/edit`, api);
        await screen.findByText('Device draft conversion could not load');
        expect(screen.getByText(/Your device copies are unchanged/)).toBeVisible();
        expect(screen.queryByText('This device copy could not be migrated safely')).toBeNull();
        expect(await drafts.loadLocalDraft(loop.id)).toEqual(original);
        expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(aside);
        expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([archive]);
        expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
        expect(useEditorStore.getState().definition).toBeUndefined();
        loading.mockRestore();
        if (recovery === 'retry')
          await userEvent.click(screen.getByRole('button', { name: 'Retry conversion' }));
        else {
          view.unmount();
          renderApp(`/loops/${loop.id}/edit`, api);
        }
        await screen.findByRole('heading', { name: 'device work' });
        expect(screen.queryByText('Device draft conversion could not load')).toBeNull();
        expect(await drafts.loadLocalDraft(loop.id)).toMatchObject({
          definition: { schemaVersion: 4, name: 'device work' },
          synced: false,
          baseToken: 'unreconciled-device-format',
        });
        expect(await drafts.loadSetAsideDraft(loop.id)).toMatchObject({
          definition: { schemaVersion: 4, name: 'earlier work' },
        });
        expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([archive, original, aside]);
        await screen.findByText('This device draft was converted to format 4');
        expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('server copy');
      } finally {
        loading.mockRestore();
      }
    },
  );

  it('still preserves an inert exportable original when the loaded converter fails', async () => {
    const api = new FakeApi(),
      loop = api.addLoop(newLoopDefinition('server copy'));
    const original = {
      loopId: loop.id,
      definition: oldManual('failed conversion'),
      savedAt: 'old',
      synced: false,
    };
    await drafts.saveLocalDraft(original);
    const conversion = vi
      .spyOn(converter, 'upgradeLoopCurrent')
      .mockRejectedValueOnce(new Error('conversion failed'));
    try {
      renderApp(`/loops/${loop.id}/edit`, api);
      await screen.findByText('This device copy could not be migrated safely');
      expect(screen.queryByText('Device draft conversion could not load')).toBeNull();
      expect(screen.getByRole('button', { name: 'Export original device copy' })).toBeVisible();
      expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]);
      expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
      expect(useEditorStore.getState().definition?.name).toBe('server copy');
    } finally {
      conversion.mockRestore();
    }
  });

  it('keeps pending v3 review ids and hashes with an exportable inert original, including archives', async () => {
    const api = new FakeApi(),
      loop = api.addLoop(newLoopDefinition('server copy'));
    const original = {
      loopId: loop.id,
      definition: oldManual('pending draft', true),
      savedAt: 'old',
      synced: false,
      baseToken: 'old-token',
    };
    const archive = { ...original, savedAt: 'archived' };
    await drafts.saveLocalDraft(original);
    await drafts.saveArchivedDraft(archive);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'server copy' });
    expect(await screen.findAllByText('/nodes/1/config:exit-policy')).toHaveLength(1);
    expect(screen.getByText('Original device copy preserved')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export original device copy' })).toBeVisible();
    expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([archive, original]);
    expect(useEditorStore.getState().definition?.name).toBe('server copy');
  });

  it.each(['write', 'readback'] as const)(
    'blocks overwrite of an automatic conversion after archive %s failure',
    async (failure) => {
      const api = new FakeApi(),
        loop = api.addLoop(newLoopDefinition('server copy'));
      const original = {
        loopId: loop.id,
        definition: oldManual('automatic draft'),
        savedAt: 'old',
        synced: true,
        baseToken: 'old-token',
      };
      await drafts.saveLocalDraft(original);
      gate.failArchive = failure === 'write';
      gate.hideArchive = failure === 'readback';
      try {
        renderApp(`/loops/${loop.id}/edit`, api);
        await screen.findByText('Device copy preservation failed');
        act(() => useEditorStore.getState().updateMeta({ description: 'blocked' }));
        await new Promise((resolve) => setTimeout(resolve, 650));
        expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
        expect(await drafts.loadLocalDraft(loop.id)).toEqual(original);
      } finally {
        gate.failArchive = false;
        gate.hideArchive = false;
      }
    },
  );

  it.each([false, true])(
    'keeps a converted synced mirror as a clean cache, with offline=%s',
    async (offline) => {
      const api = new FakeApi(),
        loop = api.addLoop(newLoopDefinition('server copy'));
      api.offline = offline;
      const original = {
        loopId: loop.id,
        definition: oldManual('cached device copy'),
        savedAt: '2999-01-01T00:00:00.000Z',
        synced: true,
        baseToken: 'old-token',
      };
      await drafts.saveLocalDraft(original);
      renderApp(`/loops/${loop.id}/edit`, api);
      await screen.findByRole('heading', { name: offline ? 'cached device copy' : 'server copy' });
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(useEditorStore.getState().revision).toBe(useEditorStore.getState().savedRevision);
      expect(useEditorStore.getState().conflict).toBeUndefined();
      expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
      expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]);
      expect(await drafts.loadLocalDraft(loop.id)).toMatchObject({
        synced: true,
        definition: { schemaVersion: 4 },
      });
    },
  );

  it('sets stale converted unsynced work aside and restores it only by explicit choice', async () => {
    const api = new FakeApi(),
      loop = api.addLoop(newLoopDefinition('server copy'));
    const original = {
      loopId: loop.id,
      definition: oldManual('stale device work'),
      savedAt: '1900-01-01T00:00:00.000Z',
      synced: false,
      baseToken: 'old-token',
    };
    await drafts.saveLocalDraft(original);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'server copy' });
    expect(await screen.findByText('The server has a newer draft')).toBeVisible();
    expect(await drafts.loadSetAsideDraft(loop.id)).toMatchObject({
      synced: false,
      definition: { name: 'stale device work', schemaVersion: 4 },
    });
    expect(useEditorStore.getState().conflict).toBeUndefined();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]);
    await userEvent.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    await screen.findByRole('heading', { name: 'stale device work' });
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
    expect(useEditorStore.getState().conflict).toBeUndefined();
  });

  it.each([false, true])(
    'does not convert archives or current drafts, with current cache=%s',
    async (currentCache) => {
      const api = new FakeApi(),
        loop = api.addLoop(newLoopDefinition('server copy'));
      const original = {
        loopId: loop.id,
        definition: oldManual('inert old archive', true),
        savedAt: 'old',
        synced: false,
      };
      await drafts.saveArchivedDraft(original);
      if (currentCache)
        await drafts.saveLocalDraft({
          loopId: loop.id,
          definition: newLoopDefinition('current cache'),
          savedAt: 'old',
          synced: true,
        });
      const conversion = vi.spyOn(converter, 'upgradeLoopCurrent');
      try {
        renderApp(`/loops/${loop.id}/edit`, api);
        await screen.findByText('Original device copy preserved');
        expect(screen.getByRole('button', { name: 'Export original device copy' })).toBeVisible();
        expect(conversion).not.toHaveBeenCalled();
        expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]);
      } finally {
        conversion.mockRestore();
      }
    },
  );

  it('preserves and converts a set-aside copy and keeps its archived original inert on reopening', async () => {
    const api = new FakeApi(),
      loop = api.addLoop(newLoopDefinition('server copy'));
    const original = {
      loopId: loop.id,
      definition: oldManual('automatic aside'),
      savedAt: 'old',
      synced: true,
      baseToken: 'old-token',
    };
    await drafts.saveSetAsideDraft(original);
    const view = renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('button', { name: "Use this device's copy instead" });
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([original]);
    expect(await drafts.loadSetAsideDraft(loop.id)).toMatchObject({
      synced: true,
      baseToken: 'unreconciled-device-format',
      definition: { schemaVersion: 4 },
    });
    view.unmount();
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByText('Original device copy preserved');
    expect(screen.getByRole('button', { name: 'Export original device copy' })).toBeVisible();
    expect((await drafts.loadArchivedDrafts(loop.id))[0]).toEqual(original);
    await userEvent.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    await screen.findByRole('heading', { name: 'automatic aside' });
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
    );
  });

  it('keeps an ambiguous v1 device draft raw and prevents it from replacing the server copy', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const legacy = legacyLoop('ambiguous device copy', ['jev', 'codex']);
    const earlier = legacyLoop('earlier raw copy', ['jev', 'codex']);
    const original = {
      loopId: loop.id,
      definition: legacy as LoopDefinitionInput,
      savedAt: 'active-source-time',
      synced: false,
    };
    const earlierOriginal = {
      loopId: loop.id,
      definition: earlier as LoopDefinitionInput,
      savedAt: 'aside-source-time',
      synced: false,
    };
    await drafts.saveLocalDraft(original);
    await drafts.saveSetAsideDraft(earlierOriginal);

    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
    expect(
      await screen.findAllByText('This device copy could not be migrated safely'),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: "Use this device's copy instead" })).toBeNull();
    await waitFor(async () =>
      expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([earlierOriginal, original]),
    );
    expect(await drafts.loadSetAsideDraft(loop.id)).toBeUndefined();
    expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Export original device copy' }));
    const exported = createObjectURL.mock.calls[0]?.[0];
    if (!(exported instanceof Blob)) throw new Error('Expected the export to be a Blob.');
    expect(JSON.parse(await exported.text())).toEqual(original);
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it('archives an ambiguous set-aside before a newer server copy moves a valid active draft there', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const active = {
      loopId: loop.id,
      definition: LoopDefinitionSchema.parse(newLoopDefinition('older valid active copy')),
      savedAt: '1900-01-01T00:00:00.000Z',
      synced: false,
    };
    const aside = {
      loopId: loop.id,
      definition: legacyLoop('ambiguous set-aside copy', ['jev', 'codex']) as LoopDefinitionInput,
      savedAt: 'aside-source-time',
      synced: false,
    };
    await drafts.saveLocalDraft(active);
    await drafts.saveSetAsideDraft(aside);

    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
    await waitFor(async () => expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([aside]));
    await waitFor(async () => expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(active));
    expect(await drafts.loadLocalDraft(loop.id)).toEqual(active);
    expect(
      await screen.findByRole('button', { name: 'Export original device copy' }),
    ).toBeInTheDocument();
  });

  it('offers the original device-copy export when no server definition is available', async () => {
    const api = new FakeApi();
    api.offline = true;
    const loop = api.addLoop(newLoopDefinition('offline loop'));
    const original = {
      loopId: loop.id,
      definition: legacyLoop('offline ambiguous copy', ['jev', 'codex']) as LoopDefinitionInput,
      savedAt: 'offline-source-time',
      synced: false,
    };
    await drafts.saveLocalDraft(original);
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(
      await screen.findByRole('button', { name: 'Export original device copy' }),
    ).toBeInTheDocument();
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:offline-original');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Export original device copy' }));
    const exported = createObjectURL.mock.calls[0]?.[0];
    if (!(exported instanceof Blob)) throw new Error('Expected the export to be a Blob.');
    expect(JSON.parse(await exported.text())).toEqual(original);
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it('fails closed without overwriting either raw source when archiving fails', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const active = {
      loopId: loop.id,
      definition: legacyLoop('ambiguous active copy', ['jev', 'codex']) as LoopDefinitionInput,
      savedAt: 'active-source-time',
      synced: false,
    };
    const aside = {
      loopId: loop.id,
      definition: legacyLoop('ambiguous aside copy', ['jev', 'codex']) as LoopDefinitionInput,
      savedAt: 'aside-source-time',
      synced: false,
    };
    await drafts.saveLocalDraft(active);
    await drafts.saveSetAsideDraft(aside);
    gate.failArchive = true;
    try {
      renderApp(`/loops/${loop.id}/edit`, api);
      expect(await screen.findByText('Device copy preservation failed')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add node/i })).toBeNull();
      act(() => useEditorStore.getState().updateMeta({ description: 'must not autosave' }));
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
      expect(await drafts.loadLocalDraft(loop.id)).toEqual(active);
      expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(aside);
      expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
    } finally {
      gate.failArchive = false;
    }
  });

  it('keeps a dismissed restore notice hidden while the restored editor generation is edited', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${loop.id}/edit`, api);
    await user.click(await screen.findByRole('button', { name: "Use this device's copy instead" }));
    expect(
      await screen.findByText('Restored unsaved changes from this device.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText('Restored unsaved changes from this device.')).toBeNull();
    expect(screen.getByText('Notice dismissed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveFocus());
    expect(screen.getByTestId('save-state')).toHaveAttribute('tabindex', '-1');

    act(() => useEditorStore.getState().updateMeta({ description: 'edited after dismissal' }));
    expect(screen.queryByText('Restored unsaved changes from this device.')).toBeNull();
  });

  it('does not load into another loop opened while the restore was being persisted', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const a = api.addLoop(newLoopDefinition('server copy'));
    const b = api.addLoop(newLoopDefinition('loop b'));
    await drafts.saveLocalDraft({
      loopId: a.id,
      definition: newLoopDefinition('older local copy'),
      savedAt: '2026-10-01T00:00:00.000Z',
      synced: false,
    });
    renderApp(`/loops/${a.id}/edit`, api);
    expect(await screen.findByText('The server has a newer draft')).toBeInTheDocument();

    gate.hold = true;
    await user.click(screen.getByRole('button', { name: "Use this device's copy instead" }));
    // Navigate to loop B and edit it while A's restore is still being written.
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Loops' }),
    );
    await user.click(await screen.findByRole('link', { name: 'loop b' }));
    expect(await screen.findByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    act(() => useEditorStore.getState().updateMeta({ description: 'work on b' }));

    gate.hold = false;
    gate.release();
    await waitFor(async () => expect(await drafts.loadSetAsideDraft(a.id)).toBeUndefined());

    // B is untouched.
    const state = useEditorStore.getState();
    expect(state.loopId).toBe(b.id);
    expect(state.definition).toMatchObject({ name: 'loop b', description: 'work on b' });
    expect(screen.getByRole('heading', { name: 'loop b' })).toBeInTheDocument();
    await waitFor(() =>
      expect(api.callsTo('PUT', `/loops/${b.id}/draft`).length).toBeGreaterThan(0),
    );
    expect(api.callsTo('PUT', `/loops/${a.id}/draft`)).toHaveLength(0);

    // A's restored copy is durable and comes back on the next visit.
    expect(await drafts.loadLocalDraft(a.id)).toMatchObject({
      synced: false,
      definition: { name: 'older local copy' },
    });
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Loops' }),
    );
    await user.click(await screen.findByRole('link', { name: 'server copy' }));
    expect(await screen.findByRole('heading', { name: 'older local copy' })).toBeInTheDocument();
  });
});
