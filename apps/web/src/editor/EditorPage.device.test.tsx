import { act, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, promisifyRequest, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Fixtures from '../__fixtures__/fake-api.js';
import type * as Render from '../__fixtures__/render.js';
import type * as LocalDrafts from '../drafts/local-drafts.js';
import type * as Model from './model.js';
import type * as Store from './store.js';

/**
 * Device storage blocked by an older tab (phase review F2): a tab of the previous version keeps
 * its version 1 connection open and does not close it on `versionchange`, so this editor's
 * version 2 upgrade waits. Each test starts from a fresh database and fresh modules, so the
 * draft store opens (and is blocked) anew.
 */
let modules: {
  FakeApi: typeof Fixtures.FakeApi;
  renderApp: typeof Render.renderApp;
  drafts: typeof LocalDrafts;
  newLoopDefinition: typeof Model.newLoopDefinition;
  useEditorStore: typeof Store.useEditorStore;
};
let oldDatabase: IDBDatabase;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const oldStore = createStore('graphgoblin', 'drafts');
  await set('older-tab', 'a copy from the previous version', oldStore);
  oldDatabase = await oldStore('readonly', (store) => store.transaction.db);
  localStorage.setItem('graphgoblin-loop-panel', 'expanded');
  modules = {
    FakeApi: (await import('../__fixtures__/fake-api.js')).FakeApi,
    renderApp: (await import('../__fixtures__/render.js')).renderApp,
    drafts: await import('../drafts/local-drafts.js'),
    newLoopDefinition: (await import('./model.js')).newLoopDefinition,
    useEditorStore: (await import('./store.js')).useEditorStore,
  };
});

afterEach(async () => {
  oldDatabase.close();
  try {
    await promisifyRequest(indexedDB.deleteDatabase('graphgoblin'));
  } finally {
    vi.unstubAllGlobals();
  }
});

const SAVE_WAIT = { timeout: 6000 };
const saveState = () => screen.getByTestId('save-state');
const deviceNotice = () => screen.queryByText(/blocks this device’s draft storage/);

/** Open the editor; its first look at device storage waits out the blocked upgrade's grace. */
async function openBlockedEditor() {
  const { FakeApi, renderApp, newLoopDefinition } = modules;
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition('blocked'));
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'blocked' }, SAVE_WAIT);
  // The instruction is there from the start, before any edit.
  expect(await screen.findByText(/Close other GraphGoblin tabs and windows/)).toBeInTheDocument();
  expect(modules.drafts.deviceStorageProblem()).toMatchObject({ kind: 'blocked' });
  return { api, loop };
}

/** Let the old tab go, and wait for the store's upgrade to complete. */
async function closeOldTab() {
  const available = new Promise<void>((resolve) => {
    const stop = modules.drafts.subscribeDeviceStorage(() => {
      if (modules.drafts.deviceStorageProblem()) return;
      stop();
      resolve();
    });
  });
  act(() => oldDatabase.close());
  await act(() => available);
}

describe('device storage blocked by an older tab', () => {
  it('says a schema-invalid edit is in this window only, then saves it on the device once the old tab closes', async () => {
    const { api, loop } = await openBlockedEditor();
    const store = () => modules.useEditorStore.getState();
    // A subloop without its loop is schema-invalid: it cannot go to the server.
    act(() => void store().addNode('subloop', { x: 0, y: 200 }));
    await waitFor(
      () => expect(saveState()).toHaveTextContent('Kept in this window only'),
      SAVE_WAIT,
    );
    expect(saveState()).not.toHaveTextContent('device');
    expect(
      screen.getByText(
        'Fix the schema errors to save to the server. Changes are kept in this window only.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Changes are kept on this device/)).toBeNull();
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
    expect(store().deviceRevision).toBeUndefined();

    // The old tab closes: the store says so, and the edits go to the device at once.
    await closeOldTab();
    await waitFor(() => expect(saveState()).toHaveTextContent('Saved on this device only'));
    expect(deviceNotice()).toBeNull();
    expect(
      screen.getByText(
        'Fix the schema errors to save to the server. Changes are kept on this device.',
      ),
    ).toBeInTheDocument();
    expect(store().deviceRevision).toBe(store().revision);
    const local = await modules.drafts.loadLocalDraft(loop.id);
    expect(local).toMatchObject({ synced: false });
    expect(local?.definition.nodes.map((node) => node.id)).toContain('subloop');
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(0);
  });

  it('shows a valid edit saved to the server, with the device notice apart, until the old tab closes', async () => {
    const { api, loop } = await openBlockedEditor();
    const store = () => modules.useEditorStore.getState();
    act(() => store().updateMeta({ description: 'to the server' }));
    // Saved to the server, not pending: the device's refusal is its own notice.
    await waitFor(() => expect(saveState()).toHaveTextContent('All changes saved'), SAVE_WAIT);
    expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1);
    expect(deviceNotice()).toBeInTheDocument();
    expect(screen.getByText('Changes are not kept on this device')).toBeVisible();

    await closeOldTab();
    await waitFor(() => expect(deviceNotice()).toBeNull());
    expect(saveState()).toHaveTextContent('All changes saved');
    // Nothing was unsaved, so nothing needed writing: the server's copy is the one to load.
    expect(await modules.drafts.loadLocalDraft(loop.id)).toBeUndefined();
    // Later edits are mirrored again.
    act(() => store().updateMeta({ description: 'mirrored' }));
    await waitFor(async () =>
      expect((await modules.drafts.loadLocalDraft(loop.id))?.definition.description).toBe(
        'mirrored',
      ),
    );
  });
});
