import { type LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import {
  deviceKeys,
  formatThreeDraft,
  storeRawDeviceRecord,
} from '../__fixtures__/device-drafts.js';
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

const BLOCKED = 'This browser holds a device draft this build cannot open';
const notice = (kind: string, name: string, loopId: string, savedAt: string) =>
  `This browser holds ${kind} of “${name}” (loop ${loopId}), saved ${savedAt}, in format 3. This build opens only format 4 drafts and does not convert older ones. Discarding removes only this copy from this browser; the loop on the server and drafts in other browsers stay as they are.`;

describe('unsupported device drafts', () => {
  it('pauses editing for an older unsaved draft, never converts or saves it, and opens the editor only after an explicit discard', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const old = formatThreeDraft(loop.id, 'legacy device copy', 'yesterday');
    await storeRawDeviceRecord(deviceKeys(loop.id).active, old);
    renderApp(`/loops/${loop.id}/edit`, api);

    expect(await screen.findByText(BLOCKED)).toBeVisible();
    const alert = screen.getByText('Unsupported device draft (format 3)').closest('[role]')!;
    expect(alert).toHaveTextContent(
      notice('an unsaved draft', 'legacy device copy', loop.id, 'yesterday'),
    );
    const discard = screen.getByRole('button', { name: 'Discard this device draft' });
    expect(discard).toHaveAccessibleDescription(
      notice('an unsaved draft', 'legacy device copy', loop.id, 'yesterday'),
    );
    expect(screen.queryByRole('heading', { name: 'server copy' })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    expect(await drafts.loadLocalDraft(loop.id)).toEqual(old);
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);

    // Export hands over the stored record exactly; it does not convert it.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:old');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Export this device draft' }));
    const exported = createObjectURL.mock.calls[0]?.[0];
    if (!(exported instanceof Blob)) throw new Error('Expected the export to be a Blob.');
    expect(JSON.parse(await exported.text())).toEqual(old);
    expect(click).toHaveBeenCalled();
    createObjectURL.mockRestore();
    click.mockRestore();

    await user.click(discard);
    expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED)).toBeNull();
    expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
    expect(api.loops.get(loop.id)?.draft?.definition.name).toBe('server copy');
  });

  it('pauses editing for an older set-aside draft and keeps the current device draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const current = {
      loopId: loop.id,
      definition: newLoopDefinition('current device work'),
      savedAt: '2999-01-01T00:00:00.000Z',
      synced: false,
    };
    await drafts.saveLocalDraft(current);
    const old = formatThreeDraft(loop.id, 'set aside long ago', 'last year');
    await storeRawDeviceRecord(deviceKeys(loop.id).setAside, old);
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText(BLOCKED)).toBeVisible();
    expect(
      screen.getByText('Unsupported device draft (format 3)').closest('[role]'),
    ).toHaveTextContent(notice('a set-aside draft', 'set aside long ago', loop.id, 'last year'));
    expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(old);
    await user.click(screen.getByRole('button', { name: 'Discard this device draft' }));
    expect(await screen.findByRole('heading', { name: 'current device work' })).toBeInTheDocument();
    expect(await drafts.loadSetAsideDraft(loop.id)).toBeUndefined();
    expect((await drafts.loadLocalDraft(loop.id))?.definition.name).toBe('current device work');
  });

  it('lists an older archived copy without blocking the editor and discards only that copy', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const old = formatThreeDraft(loop.id, 'archived original', 'long ago');
    const backup = {
      loopId: loop.id,
      definition: newLoopDefinition('current backup'),
      savedAt: 'backup time',
      synced: false,
    };
    await storeRawDeviceRecord(deviceKeys(loop.id).archive, [old, backup]);
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
    expect(screen.queryByText(BLOCKED)).toBeNull();
    expect(
      screen.getByText('Unsupported device draft (format 3)').closest('[role]'),
    ).toHaveTextContent(notice('an archived copy', 'archived original', loop.id, 'long ago'));
    expect(screen.getByText('Saved device backup')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard this device draft' }));
    await waitFor(() =>
      expect(screen.queryByText('Unsupported device draft (format 3)')).toBeNull(),
    );
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([backup]);
    expect(screen.getByText('Saved device backup')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard this device copy' }));
    await waitFor(() => expect(screen.queryByText('Saved device backup')).toBeNull());
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
  });

  it('names an unnamed draft of an unknown format and pauses editing while offline too', async () => {
    const api = new FakeApi();
    api.offline = true;
    const loop = api.addLoop(newLoopDefinition('offline loop'));
    const odd = { loopId: loop.id, definition: { nodes: [] }, savedAt: 'then', synced: false };
    await storeRawDeviceRecord(deviceKeys(loop.id).active, odd);
    renderApp(`/loops/${loop.id}/edit`, api);
    expect(await screen.findByText(BLOCKED)).toBeVisible();
    expect(
      screen.getByText('Unsupported device draft (an unknown format)').closest('[role]'),
    ).toHaveTextContent(
      `This browser holds an unsaved draft of this loop (loop ${loop.id}), saved then, in an unknown format.`,
    );
    expect(await drafts.loadLocalDraft(loop.id)).toEqual(odd);
  });

  it.each([
    ['no definition', {}],
    ['a null definition', { definition: null }],
    ['a text definition', { definition: 'not a definition' }],
  ])(
    'keeps export and discard for a record with %s instead of failing to render',
    async (_name, extra) => {
      const user = userEvent.setup();
      const api = new FakeApi();
      const loop = api.addLoop(newLoopDefinition('server copy'));
      const record = { loopId: loop.id, savedAt: 'then', synced: false, ...extra };
      await storeRawDeviceRecord(deviceKeys(loop.id).active, record);
      renderApp(`/loops/${loop.id}/edit`, api);
      expect(await screen.findByText(BLOCKED)).toBeVisible();
      expect(
        screen.getByText('Unsupported device draft (an unknown format)').closest('[role]'),
      ).toHaveTextContent(
        `This browser holds an unsaved draft of this loop (loop ${loop.id}), saved then, in an unknown format.`,
      );
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:record');
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      await user.click(screen.getByRole('button', { name: 'Export this device draft' }));
      const exported = createObjectURL.mock.calls[0]?.[0];
      if (!(exported instanceof Blob)) throw new Error('Expected the export to be a Blob.');
      expect(JSON.parse(await exported.text())).toEqual(record);
      createObjectURL.mockRestore();
      click.mockRestore();
      await user.click(screen.getByRole('button', { name: 'Discard this device draft' }));
      expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
      expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
    },
  );

  it('keeps the copy and says so when a discard cannot be written', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const old = formatThreeDraft(loop.id, 'stuck copy', 'earlier');
    await storeRawDeviceRecord(deviceKeys(loop.id).active, old);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByText(BLOCKED);
    const clearing = vi
      .spyOn(drafts, 'clearActiveLocalDraft')
      .mockRejectedValueOnce(new Error('storage refused'));
    try {
      await user.click(screen.getByRole('button', { name: 'Discard this device draft' }));
      expect(
        await screen.findByText(
          'The device copy could not be discarded. It is retained; retry when device storage is available.',
        ),
      ).toBeVisible();
      expect(screen.getByText(BLOCKED)).toBeVisible();
      expect(await drafts.loadLocalDraft(loop.id)).toEqual(old);
    } finally {
      clearing.mockRestore();
    }
  });
});

describe('restoring a set-aside copy', () => {
  it('restores unfinished current JSONata into the editor instead of treating it as unsupported', async () => {
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
    expect(screen.queryByText(/Unsupported device draft/)).toBeNull();
    expect(await drafts.loadArchivedDrafts(loop.id)).toEqual([]);
    expect((await drafts.loadLocalDraft(loop.id))?.definition).toEqual(definition);
  });

  it('pauses editing when an earlier set-aside copy cannot be archived, and continues once the blocked copy is discarded', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(newLoopDefinition('server copy'));
    const earlier = {
      loopId: loop.id,
      definition: newLoopDefinition('earlier set-aside'),
      savedAt: '1800-01-01T00:00:00.000Z',
      synced: false,
    };
    const stale = {
      loopId: loop.id,
      definition: newLoopDefinition('stale device work'),
      savedAt: '1900-01-01T00:00:00.000Z',
      synced: false,
      baseToken: 'old-token',
    };
    await drafts.saveSetAsideDraft(earlier);
    await drafts.saveLocalDraft(stale);
    gate.failArchive = true;
    try {
      renderApp(`/loops/${loop.id}/edit`, api);
      expect(await screen.findByText('Device copy preservation failed')).toBeInTheDocument();
      expect(screen.getByText('This device copy could not be preserved')).toBeVisible();
      // The stale copy is unsaved work, yet nothing autosaves while the page is paused.
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
      expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(earlier);
      expect(await drafts.loadLocalDraft(loop.id)).toEqual(stale);
      await user.click(screen.getByRole('button', { name: 'Discard this device copy' }));
      expect(await screen.findByRole('heading', { name: 'server copy' })).toBeInTheDocument();
      expect(await screen.findByText('The server has a newer draft')).toBeVisible();
      expect(await drafts.loadLocalDraft(loop.id)).toBeUndefined();
      expect(await drafts.loadSetAsideDraft(loop.id)).toEqual(earlier);
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
