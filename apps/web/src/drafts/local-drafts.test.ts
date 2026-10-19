import { minimalLoop } from '@graphgoblin/contracts/testing';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, promisifyRequest, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LocalDrafts from './local-drafts.js';
import {
  deviceKeys,
  formatThreeDraft,
  storeRawDeviceRecord,
} from '../__fixtures__/device-drafts.js';

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

/** Settle `promise` as a value: its result, or the error it rejected with. */
const settled = (promise: Promise<unknown>) =>
  promise.then(
    (value) => value ?? 'done',
    (error: unknown) => error,
  );

describe('local drafts in IndexedDB', () => {
  it('silently skips blocked loads, rejects saves, says it is blocked, and recovers when the old tab closes', async () => {
    // An older tab's version 1 connection that does not close on `versionchange`.
    const oldStore = createStore('graphgoblin', 'drafts');
    const draft = { loopId: 'blocked', definition: minimalLoop(), savedAt: 'now', synced: false };
    await set(draft.loopId, draft, oldStore);
    const oldDatabase = await oldStore('readonly', (store) => store.transaction.db);
    const changes: unknown[] = [];
    const unsubscribe = drafts.subscribeDeviceStorage(() =>
      changes.push(drafts.deviceStorageProblem()),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(drafts.deviceStorageProblem()).toBeUndefined();
      const result = Promise.all([
        drafts.loadLocalDraft(draft.loopId),
        drafts.loadSetAsideDraft(draft.loopId),
        settled(drafts.saveLocalDraft(draft)),
      ]);
      const deadline = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('still blocked'), 4000);
      });
      expect(await Promise.race([result, deadline])).toEqual([
        undefined,
        undefined,
        expect.objectContaining({ message: expect.stringContaining('Close other GraphGoblin') }),
      ]);
      expect(drafts.deviceStorageProblem()).toEqual({
        kind: 'blocked',
        message: expect.stringContaining('Close other GraphGoblin'),
      });
      expect(changes).toHaveLength(1);
      // Known to be blocked: later operations fail at once, without another grace period.
      const started = performance.now();
      expect(
        await Promise.all([
          settled(drafts.saveLocalDraft(draft)),
          settled(drafts.recordServerSave(draft.loopId, draft.definition, 'token', undefined)),
          settled(drafts.clearSetAsideDraft(draft.loopId)),
        ]),
      ).toEqual([
        expect.objectContaining({ message: expect.stringContaining('Close other') }),
        expect.objectContaining({ message: expect.stringContaining('Close other') }),
        expect.objectContaining({ message: expect.stringContaining('Close other') }),
      ]);
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      clearTimeout(timer);
    }
    // The old tab lets go: the pending upgrade completes and the store says so by itself.
    const recovered = new Promise<void>((resolve) => {
      const stop = drafts.subscribeDeviceStorage(() => {
        if (drafts.deviceStorageProblem()) return;
        stop();
        resolve();
      });
    });
    oldDatabase.close();
    await recovered;
    expect(changes.at(-1)).toBeUndefined();
    unsubscribe();
    // The upgrade preserved the version 1 copy; writes work again.
    expect(await drafts.loadLocalDraft(draft.loopId)).toEqual(draft);
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
      expect(await drafts.loadLocalDraft('before-upgrade')).toBe('old copy');
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
    // The storage says it failed, and why, until an operation succeeds again (the next one opens
    // the store afresh).
    expect(drafts.deviceStorageProblem()).toMatchObject({ kind: 'failed' });
    expect(drafts.deviceStorageProblem()?.message).not.toBe('');
    await promisifyRequest(indexedDB.deleteDatabase('graphgoblin'));
    await drafts.saveLocalDraft({
      loopId: 'again',
      definition: minimalLoop(),
      savedAt: 'now',
      synced: false,
    });
    expect(drafts.deviceStorageProblem()).toBeUndefined();
  });

  it('preserves the version 1 store when opening version 2', async () => {
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

    expect(await drafts.loadLocalDraft(draft.loopId)).toEqual(draft);
    expect(await drafts.loadSetAsideDraft(draft.loopId)).toEqual(draft);
    const database = await promisifyRequest(indexedDB.open('graphgoblin'));
    try {
      expect(database.version).toBe(2);
      expect(Array.from(database.objectStoreNames)).toEqual(['drafts']);
      expect(
        await promisifyRequest(database.transaction('drafts').objectStore('drafts').getAllKeys()),
      ).toEqual([draft.loopId, `${draft.loopId}:set-aside`]);
    } finally {
      database.close();
    }

    await drafts.saveLocalDraft(draft);
    vi.resetModules();
    const reloaded = await import('./local-drafts.js');
    expect(await reloaded.loadLocalDraft(draft.loopId)).toEqual(draft);
  });

  it.each(['active', 'set-aside', 'server-save'] as const)(
    'never replaces a late-discovered %s copy in another format, and converts nothing',
    async (kind) => {
      const loopId = `late-old-copy-${kind}`;
      const original = formatThreeDraft(loopId, 'written by an older build', 'old');
      const keys = deviceKeys(loopId);
      await storeRawDeviceRecord(kind === 'set-aside' ? keys.setAside : keys.active, original);
      const attempt =
        kind === 'server-save'
          ? drafts.recordServerSave(loopId, minimalLoop(), 'new-token', original.baseToken)
          : (kind === 'set-aside' ? drafts.saveSetAsideDraft : drafts.saveLocalDraft)({
              loopId,
              definition: minimalLoop(),
              savedAt: 'now',
              synced: false,
            });
      await expect(attempt).rejects.toThrow(drafts.UnsupportedDeviceDraftError);
      expect(drafts.deviceStorageProblem()).toEqual({
        kind: 'failed',
        message:
          'This device holds a draft of this loop in an unsupported format. Discard it in the editor before saving here.',
      });
      const load = kind === 'set-aside' ? drafts.loadSetAsideDraft : drafts.loadLocalDraft;
      expect(await load(loopId)).toEqual(original);
      expect(await drafts.loadArchivedDrafts(loopId)).toEqual([]);
      expect(drafts.cachedLocalDraft(loopId)?.draft.definition).not.toEqual(original.definition);
      // An explicit discard removes it; the next write is then accepted.
      await drafts.clearLocalDraft(loopId);
      await drafts.saveLocalDraft({
        loopId,
        definition: minimalLoop(),
        savedAt: 'later',
        synced: false,
      });
      expect(drafts.isCurrentDeviceDraft((await drafts.loadLocalDraft(loopId))!)).toBe(true);
    },
  );

  it.each(['active', 'set-aside'] as const)(
    'never clears a changed %s source after archiving an earlier copy',
    async (source) => {
      const original = {
        loopId: 'changed-source',
        definition: minimalLoop(),
        savedAt: 'old',
        synced: false,
      };
      const newer = { ...original, definition: { ...minimalLoop(), name: 'new work' } };
      const save = source === 'active' ? drafts.saveLocalDraft : drafts.saveSetAsideDraft;
      const load = source === 'active' ? drafts.loadLocalDraft : drafts.loadSetAsideDraft;
      const clear = source === 'active' ? drafts.clearActiveLocalDraft : drafts.clearSetAsideDraft;
      await save(original);
      await drafts.saveArchivedDraft(original);
      await save(newer);
      await expect(clear(original.loopId, original)).rejects.toThrow('changed before removal');
      expect(await load(original.loopId)).toEqual(newer);
      await clear(original.loopId, newer);
      expect(await load(original.loopId)).toBeUndefined();
    },
  );

  it('keeps distinct original metadata when archiving and discarding otherwise identical copies', async () => {
    const first = {
      loopId: 'distinct-originals',
      definition: minimalLoop(),
      savedAt: 'same-time',
      synced: false,
      baseToken: 'one',
    };
    const second = { ...first, baseToken: 'two' };
    await drafts.saveArchivedDraft(first);
    await drafts.saveArchivedDraft(second);
    await drafts.saveArchivedDraft(first);
    expect(await drafts.loadArchivedDrafts(first.loopId)).toEqual([first, second]);
    await drafts.clearArchivedDraft(first.loopId, first);
    expect(await drafts.loadArchivedDrafts(first.loopId)).toEqual([second]);
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

describe('per-loop memory copies and durable status', () => {
  it('makes each latest write available synchronously without claiming durability early', async () => {
    const a = { loopId: 'cache-a', definition: minimalLoop(), savedAt: 'a', synced: false };
    const b = { ...a, loopId: 'cache-b', savedAt: 'b' };
    const first = drafts.saveLocalDraft(a);
    expect(drafts.cachedLocalDraft(a.loopId)).toEqual({ draft: a, durable: false });
    const second = drafts.saveLocalDraft(b);
    const newer = { ...a, definition: { ...a.definition, description: 'newest' }, savedAt: 'new' };
    const third = drafts.saveLocalDraft(newer);
    expect(drafts.cachedLocalDraft(a.loopId)).toEqual({ draft: newer, durable: false });
    await Promise.all([first, second, third]);
    expect(drafts.cachedLocalDraft(a.loopId)).toEqual({ draft: newer, durable: true });
    expect(drafts.cachedLocalDraft(b.loopId)).toEqual({ draft: b, durable: true });
    expect(await drafts.loadLocalDraft(a.loopId)).toEqual(newer);
    await drafts.clearLocalDraft(a.loopId);
    expect(drafts.cachedLocalDraft(a.loopId)).toBeUndefined();
    expect(drafts.cachedLocalDraft(b.loopId)?.draft).toEqual(b);
  });

  it('keeps memory-only work separate from an older durable copy and clears only the expected copy', async () => {
    const old = { loopId: 'memory-only', definition: minimalLoop(), savedAt: 'old', synced: false };
    await drafts.saveLocalDraft(old);
    const newer = {
      ...old,
      savedAt: 'new',
      definition: { ...old.definition, description: 'memory only' },
    };
    drafts.rememberLocalDraft(newer);
    expect(await drafts.loadLocalDraft(old.loopId)).toEqual(old);
    expect(drafts.cachedLocalDraft(old.loopId)).toEqual({ draft: newer, durable: false });
    await drafts.clearActiveLocalDraft(old.loopId, old);
    expect(drafts.cachedLocalDraft(old.loopId)?.draft).toEqual(newer);
    await drafts.clearActiveLocalDraft(old.loopId);
    expect(drafts.cachedLocalDraft(old.loopId)).toBeUndefined();
  });

  it('advances the newest cached edit to the accepted token while keeping it unsynced', async () => {
    const copy = {
      loopId: 'record-cache',
      baseToken: 'save-base',
      definition: minimalLoop(),
      savedAt: 'old',
      synced: false,
    };
    await drafts.saveLocalDraft(copy);
    const edited = { ...copy, definition: { ...copy.definition, description: 'new edit' } };
    await drafts.saveLocalDraft(edited);
    const recording = drafts.recordServerSave(
      copy.loopId,
      copy.definition,
      'next-token',
      copy.baseToken,
    );
    expect(drafts.cachedLocalDraft(copy.loopId)).toMatchObject({
      durable: false,
      draft: { synced: false, baseToken: 'next-token', definition: { description: 'new edit' } },
    });
    await recording;
    expect(drafts.cachedLocalDraft(copy.loopId)?.durable).toBe(true);
    expect(await drafts.loadLocalDraft(copy.loopId)).toMatchObject({
      synced: false,
      baseToken: 'next-token',
      definition: { description: 'new edit' },
    });
  });
});

it('F3: recording a server save never marks a different memory-only definition durable', async () => {
  const stored = {
    loopId: 'review-f3',
    baseToken: 'save-base',
    definition: minimalLoop(),
    savedAt: 'old',
    synced: false,
  };
  await drafts.saveLocalDraft(stored);
  const memory = {
    ...stored,
    definition: { ...stored.definition, description: 'never persisted' },
  };
  drafts.rememberLocalDraft(memory);
  await drafts.recordServerSave(
    stored.loopId,
    stored.definition,
    'accepted-token',
    stored.baseToken,
  );
  expect(await drafts.loadLocalDraft(stored.loopId)).toMatchObject({
    definition: stored.definition,
    synced: true,
    baseToken: 'accepted-token',
  });
  expect(drafts.cachedLocalDraft(stored.loopId)).toMatchObject({
    draft: { definition: memory.definition, synced: false, baseToken: 'accepted-token' },
    durable: false,
  });
});

it.each([
  ['foreign', 'earlier-session-base', 'save-base'],
  ['unknown', undefined, undefined],
  ['missing', undefined, 'save-base'],
] as const)(
  're-review F1: a differing %s copy keeps its base in storage and memory without a durability claim',
  async (_kind, baseToken, saveBase) => {
    const saved = minimalLoop();
    const unread = {
      loopId: 'unrelated-base',
      definition: { ...saved, description: 'work from a different base' },
      savedAt: 'earlier',
      synced: false,
      ...(baseToken ? { baseToken } : {}),
    };
    await drafts.saveLocalDraft(unread);
    await drafts.recordServerSave(unread.loopId, saved, 'accepted-token', saveBase);
    expect(await drafts.loadLocalDraft(unread.loopId)).toEqual(unread);
    expect(drafts.cachedLocalDraft(unread.loopId)).toEqual({ draft: unread, durable: false });
  },
);

it('re-review F1: a matching memory base cannot claim a foreign durable base was advanced', async () => {
  const saved = minimalLoop();
  const foreign = {
    loopId: 'durable-base-mismatch',
    definition: { ...saved, description: 'newer work' },
    savedAt: 'earlier',
    synced: false,
    baseToken: 'foreign-base',
  };
  await drafts.saveLocalDraft(foreign);
  drafts.rememberLocalDraft({ ...foreign, baseToken: 'save-base' });
  await drafts.recordServerSave(foreign.loopId, saved, 'accepted-token', 'save-base');
  expect(await drafts.loadLocalDraft(foreign.loopId)).toEqual(foreign);
  expect(drafts.cachedLocalDraft(foreign.loopId)).toMatchObject({
    draft: { baseToken: 'accepted-token' },
    durable: false,
  });
});

it.each(['definition', 'decision routes'] as const)(
  'second review F1: a same-base stored %s mismatch with the latest mirror is not rebased',
  async (mismatch) => {
    const saved = minimalLoop();
    const unread = {
      loopId: 'same-base-unread',
      definition: { ...saved, description: 'unread work' },
      decisionRoutes: { choice: { nextKey: 1, rows: [{ key: 0, id: 'old', edgeIds: ['edge'] }] } },
      savedAt: 'earlier',
      synced: false,
      baseToken: 'save-base',
    };
    await drafts.saveLocalDraft(unread);
    drafts.rememberLocalDraft({
      ...unread,
      ...(mismatch === 'definition'
        ? { definition: { ...saved, description: 'this editor newest work' } }
        : { decisionRoutes: { choice: { nextKey: 2, rows: [] } } }),
    });
    await drafts.recordServerSave(unread.loopId, saved, 'accepted-token', 'save-base');
    expect(await drafts.loadLocalDraft(unread.loopId)).toEqual(unread);
    expect(drafts.cachedLocalDraft(unread.loopId)?.durable).toBe(false);
  },
);

it('second review F1: a mirror queued after the save replaces the old copy with its already accepted token', async () => {
  const saved = minimalLoop();
  const earlier = {
    loopId: 'queued-mirror',
    definition: { ...saved, description: 'earlier mirror' },
    savedAt: 'earlier',
    synced: false,
    baseToken: 'save-base',
  };
  await drafts.saveLocalDraft(earlier);
  const originalPut = IDBObjectStore.prototype.put;
  const stored: unknown[] = [];
  const writing = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key,
  ) {
    if (key === earlier.loopId) stored.push(value);
    return originalPut.call(this, value, key);
  });
  try {
    const recording = drafts.recordServerSave(earlier.loopId, saved, 'accepted-token', 'save-base');
    const newest = {
      ...earlier,
      definition: { ...saved, description: 'mirror queued after save' },
      baseToken: 'accepted-token',
    };
    const mirrored = drafts.saveLocalDraft(newest);
    await Promise.all([recording, mirrored]);
    expect(stored).toEqual([earlier, newest]);
    expect(await drafts.loadLocalDraft(earlier.loopId)).toEqual(newest);
    expect(drafts.cachedLocalDraft(earlier.loopId)).toEqual({ draft: newest, durable: true });
  } finally {
    writing.mockRestore();
  }
});
