import { minimalLoop } from '@graphgoblin/contracts/testing';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, promisifyRequest, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LocalDrafts from './local-drafts.js';

let drafts: typeof LocalDrafts;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  drafts = await import('./local-drafts.js');
});

afterEach(async () => {
  try {
    await promisifyRequest(indexedDB.deleteDatabase('graphgoblin'));
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('local drafts in IndexedDB', () => {
  it('silently skips blocked loads, rejects saves, and retries after the old tab closes', async () => {
    const oldStore = createStore('graphgoblin', 'drafts');
    const draft = { loopId: 'blocked', definition: minimalLoop(), savedAt: 'now', synced: false };
    await set(draft.loopId, draft, oldStore);
    const oldDatabase = await oldStore('readonly', (store) => store.transaction.db);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = Promise.all([
        drafts.loadLocalDraft(draft.loopId),
        drafts.loadSetAsideDraft(draft.loopId),
        drafts.saveLocalDraft(draft).then(
          () => 'saved',
          (error: unknown) => error,
        ),
      ]);
      const deadline = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('still blocked'), 4000);
      });
      expect(await Promise.race([result, deadline])).toEqual([
        undefined,
        undefined,
        expect.objectContaining({ message: expect.stringContaining('Close other GraphGoblin') }),
      ]);
    } finally {
      clearTimeout(timer);
      oldDatabase.close();
    }
    await drafts.saveLocalDraft(draft);
    expect(await drafts.loadLocalDraft(draft.loopId)).toEqual(draft);
  });

  it('finishes an upgrade when the older tab closes before the timeout', async () => {
    const oldStore = createStore('graphgoblin', 'drafts');
    await set('before-upgrade', 'old copy', oldStore);
    const oldDatabase = await oldStore('readonly', (store) => store.transaction.db);
    oldDatabase.onversionchange = () => {
      setTimeout(() => oldDatabase.close(), 10);
    };
    try {
      expect(await drafts.loadLocalDraft('before-upgrade')).toBeUndefined();
      await drafts.saveLocalDraft({
        loopId: 'after-upgrade',
        definition: minimalLoop(),
        savedAt: 'now',
        synced: false,
      });
      expect(await drafts.loadLocalDraft('after-upgrade')).toMatchObject({
        loopId: 'after-upgrade',
      });
    } finally {
      oldDatabase.close();
    }
  });

  it('keeps other database failures visible instead of treating them as an absent copy', async () => {
    const opening = indexedDB.open('graphgoblin', 3);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts');
    (await promisifyRequest(opening)).close();
    await expect(drafts.loadLocalDraft('future')).rejects.toHaveProperty('name', 'VersionError');
  });

  it('retires the version 1 store once and opens an empty version 2 store', async () => {
    const opening = indexedDB.open('graphgoblin', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts');
    const oldDatabase = await promisifyRequest(opening);
    const transaction = oldDatabase.transaction('drafts', 'readwrite');
    const draft = {
      loopId: 'before-upgrade',
      definition: minimalLoop(),
      savedAt: 'before',
      synced: false,
    };
    transaction.objectStore('drafts').put(draft, draft.loopId);
    transaction.objectStore('drafts').put(draft, `${draft.loopId}:set-aside`);
    await promisifyRequest(transaction);
    oldDatabase.close();

    expect(await drafts.loadLocalDraft(draft.loopId)).toBeUndefined();
    expect(await drafts.loadSetAsideDraft(draft.loopId)).toBeUndefined();
    const database = await promisifyRequest(indexedDB.open('graphgoblin'));
    try {
      expect(database.version).toBe(2);
      expect(Array.from(database.objectStoreNames)).toEqual(['drafts']);
      expect(
        await promisifyRequest(database.transaction('drafts').objectStore('drafts').getAllKeys()),
      ).toEqual([]);
    } finally {
      database.close();
    }

    await drafts.saveLocalDraft(draft);
    vi.resetModules();
    const reloaded = await import('./local-drafts.js');
    expect(await reloaded.loadLocalDraft(draft.loopId)).toEqual(draft);
  });

  it.each(['live', 'set-aside'] as const)(
    'preserves a schema-invalid %s draft after reload',
    async (kind) => {
      const draft = {
        loopId: `in-progress-${kind}`,
        definition: { ...minimalLoop(), name: '' },
        savedAt: 'now',
        synced: false,
      };
      const save = kind === 'live' ? drafts.saveLocalDraft : drafts.saveSetAsideDraft;
      await save(draft);
      vi.resetModules();
      const reloaded = await import('./local-drafts.js');
      const load = kind === 'live' ? reloaded.loadLocalDraft : reloaded.loadSetAsideDraft;
      expect(await load(draft.loopId)).toEqual(draft);
      expect(await load(draft.loopId)).toEqual(draft);
    },
  );

  it('saves, loads, and clears a draft per loop, including its set-aside copy', async () => {
    expect(await drafts.loadLocalDraft('L1')).toBeUndefined();
    const draft = { loopId: 'L1', definition: minimalLoop(), savedAt: 'now', synced: false };
    await drafts.saveLocalDraft(draft);
    await drafts.saveSetAsideDraft(draft);
    expect(await drafts.loadLocalDraft('L1')).toEqual(draft);
    expect(await drafts.loadSetAsideDraft('L1')).toEqual(draft);
    await drafts.clearSetAsideDraft('L1');
    expect(await drafts.loadSetAsideDraft('L1')).toBeUndefined();
    expect(await drafts.loadLocalDraft('L1')).toEqual(draft);
    await drafts.saveSetAsideDraft(draft);
    await drafts.clearLocalDraft('L1');
    expect(await drafts.loadLocalDraft('L1')).toBeUndefined();
    expect(await drafts.loadSetAsideDraft('L1')).toBeUndefined();
  });
});
