import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import * as drafts from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

/** Holds the IndexedDB write of the restored copy until released. */
const gate = vi.hoisted(() => ({
  hold: false,
  failArchive: false,
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
        base.nodes[0],
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
        base.nodes[1],
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
        { id: 'e2', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
      ],
    };
  }

  it('converts an unambiguous v1 device draft before loading it into the editor', async () => {
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const legacy = legacyLoop('legacy device copy', ['expression']);
    await drafts.saveLocalDraft({
      loopId: loop.id,
      definition: legacy as LoopDefinitionInput,
      savedAt: '9999-01-01T00:00:00.000Z',
      synced: false,
    });

    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'legacy device copy' })).toBeInTheDocument();
    await waitFor(async () => {
      const saved = await drafts.loadLocalDraft(loop.id);
      expect(saved?.definition.schemaVersion).toBe(2);
      expect(saved?.definition.settings?.defaults).toEqual({
        byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } },
      });
      const decision = saved?.definition.nodes.find((node) => node.kind === 'decision');
      expect(
        decision?.kind === 'decision'
          ? decision.config.answer.options.map((option) => option.id)
          : [],
      ).toEqual(['yes', 'no']);
    });
    expect(await drafts.loadSetAsideDraft(loop.id)).toBeUndefined();
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
      definition: newLoopDefinition('older valid active copy'),
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
