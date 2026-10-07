import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { del, get, set, update, type UseStore } from 'idb-keyval';

/**
 * Unsaved editor drafts mirrored to IndexedDB, so a reload or an offline spell never loses work.
 * The server draft stays the source of truth once an autosave succeeds.
 */
export interface LocalDraft {
  loopId: string;
  definition: LoopDefinitionInput;
  savedAt: string;
  /** True once the server accepted this exact definition. */
  synced: boolean;
  /** The server draft token this copy is based on, sent as `If-Match` when it is saved. */
  baseToken?: string;
  /** Present only when a legacy local copy was preserved because safe conversion was impossible. */
  migrationIssues?: { code: string; path: string; message: string }[];
}

/**
 * Why device storage refused its last operation. `blocked`: another GraphGoblin window still holds
 * an older version's connection, so the store upgrade cannot run (it clears by itself when that
 * window lets go); `failed`: anything else (it clears when an operation succeeds again).
 */
export interface DeviceStorageProblem {
  kind: 'blocked' | 'failed';
  message: string;
}

/** How long an upgrade may wait for other windows before device storage counts as blocked. */
const BLOCKED_GRACE_MS = 3000;

const BLOCKED_MESSAGE = 'Close other GraphGoblin tabs and windows so device drafts can be saved.';

class DraftStoreBlockedError extends Error {}

let database: Promise<IDBDatabase> | undefined;
let problem: DeviceStorageProblem | undefined;
const listeners = new Set<() => void>();

function report(next: DeviceStorageProblem | undefined): void {
  if (problem?.kind === next?.kind && problem?.message === next?.message) return;
  problem = next;
  for (const listener of listeners) listener();
}

/** The device storage's state now: undefined while it works (or before it was first used). */
export function deviceStorageProblem(): DeviceStorageProblem | undefined {
  return problem;
}

/**
 * Called whenever the device storage's state changes: an operation fails, one succeeds after a
 * failure, or the upgrade other windows were blocking completes. Returns the unsubscribe.
 */
export function subscribeDeviceStorage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('graphgoblin', 2);
    let blockedTimeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    request.onblocked = () => {
      blockedTimeout ??= setTimeout(() => {
        timedOut = true;
        reject(new DraftStoreBlockedError(BLOCKED_MESSAGE));
      }, BLOCKED_GRACE_MS);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      // Retire pre-upgrade device copies once; new drafts can be incomplete while editing.
      if (db.objectStoreNames.contains('drafts')) db.deleteObjectStore('drafts');
      db.createObjectStore('drafts');
    };
    request.onsuccess = () => {
      clearTimeout(blockedTimeout);
      if (!timedOut) return resolve(request.result);
      // The other windows let go after the grace: the store is available from now on, and its
      // users hear so at once rather than on their next write.
      connect(Promise.resolve(request.result));
      report(undefined);
    };
    request.onerror = () => {
      clearTimeout(blockedTimeout);
      const error = request.error ?? new Error('The device-draft database could not be opened.');
      if (!timedOut) return reject(error);
      // The upgrade that was blocked failed after all: the next operation opens again.
      database = undefined;
      report({ kind: 'failed', message: error.message });
    };
  });
}

/** Use `opening` as the connection, and forget it when it closes or fails. */
function connect(opening: Promise<IDBDatabase>): void {
  database = opening;
  void opening.then(
    (db) => {
      db.onversionchange = () => {
        db.close();
        if (database === opening) database = undefined;
      };
      db.onclose = () => {
        if (database === opening) database = undefined;
      };
    },
    (error: unknown) => {
      // While blocked, operations keep this rejection and fail at once, until the pending upgrade
      // completes and replaces it (above). After any other failure the next operation opens again.
      if (!(error instanceof DraftStoreBlockedError) && database === opening) database = undefined;
    },
  );
}

function draftStore(): UseStore {
  if (!database) connect(openDraftDatabase());
  const connection = database!;
  return (mode, callback) =>
    connection.then((db) => callback(db.transaction('drafts', mode).objectStore('drafts')));
}

/**
 * Run one operation on the store and keep the device storage's state up to date: a success means
 * it works, a failure says why (`deviceStorageProblem`). The failure is rethrown.
 */
async function run<T>(operation: (store: UseStore) => Promise<T>): Promise<T> {
  try {
    const result = await operation(draftStore());
    report(undefined);
    return result;
  } catch (error) {
    report(
      error instanceof DraftStoreBlockedError
        ? { kind: 'blocked', message: error.message }
        : {
            kind: 'failed',
            message: error instanceof Error ? error.message || error.name : String(error),
          },
    );
    throw error;
  }
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  await run((store) => set(draft.loopId, draft, store));
}

export async function loadLocalDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(loopId);
}

/** A blocked store reads as no copy, so the editor opens on the server's; the state says why. */
async function loadDraft(key: string): Promise<LocalDraft | undefined> {
  try {
    return await run((store) => get<LocalDraft>(key, store));
  } catch (error) {
    if (error instanceof DraftStoreBlockedError) return undefined;
    throw error;
  }
}

/**
 * Record that the server accepted `definition` with `token`, in one IndexedDB transaction so a
 * concurrent mirror write is never lost. A device copy of that exact definition becomes synced. A
 * newer device copy (edited since the save started) keeps its definition and stays unsynced, but
 * is now based on `token`: its next save must not conflict with the write it descends from.
 */
export async function recordServerSave(
  loopId: string,
  definition: LoopDefinitionInput,
  token: string,
): Promise<void> {
  await run((store) =>
    update<LocalDraft>(
      loopId,
      (local) => {
        if (local && JSON.stringify(local.definition) !== JSON.stringify(definition)) {
          return { ...local, baseToken: token };
        }
        return {
          loopId,
          definition,
          savedAt: new Date().toISOString(),
          synced: true,
          baseToken: token,
        };
      },
      store,
    ),
  );
}

export async function clearLocalDraft(loopId: string): Promise<void> {
  await run(async (store) => {
    await del(loopId, store);
    await del(setAsideKey(loopId), store);
    await del(archiveKey(loopId), store);
  });
}

/** Remove only the live mirror after a legacy copy has been durably set aside. */
export async function clearActiveLocalDraft(loopId: string): Promise<void> {
  await run((store) => del(loopId, store));
}

/**
 * A device copy set aside because the server had a newer draft. Kept under its own key, apart
 * from the live mirror that later edits overwrite, until the user restores or discards it.
 */
function setAsideKey(loopId: string): string {
  return `${loopId}:set-aside`;
}

export async function saveSetAsideDraft(draft: LocalDraft): Promise<void> {
  await run((store) => set(setAsideKey(draft.loopId), draft, store));
}

export async function loadSetAsideDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(setAsideKey(loopId));
}

export async function clearSetAsideDraft(loopId: string): Promise<void> {
  await run((store) => del(setAsideKey(loopId), store));
}

/** Raw device copies that could not be converted safely, kept outside the live autosave key. */
function archiveKey(loopId: string): string {
  return `${loopId}:raw-archive`;
}

export async function loadArchivedDrafts(loopId: string): Promise<LocalDraft[]> {
  return (await loadDrafts(archiveKey(loopId))) ?? [];
}

async function loadDrafts(key: string): Promise<LocalDraft[] | undefined> {
  try {
    return await run((store) => get<LocalDraft[]>(key, store));
  } catch (error) {
    if (error instanceof DraftStoreBlockedError) return undefined;
    throw error;
  }
}

export async function saveArchivedDraft(draft: LocalDraft): Promise<void> {
  await run((store) =>
    update<LocalDraft[]>(
      archiveKey(draft.loopId),
      (copies) => {
        const current = copies ?? [];
        const duplicate = current.some(
          (copy) =>
            copy.savedAt === draft.savedAt &&
            JSON.stringify(copy.definition) === JSON.stringify(draft.definition),
        );
        return duplicate ? current : [...current, draft];
      },
      store,
    ),
  );
}

export async function clearArchivedDraft(loopId: string, draft: LocalDraft): Promise<void> {
  await run((store) =>
    update<LocalDraft[]>(
      archiveKey(loopId),
      (copies) =>
        (copies ?? []).filter(
          (copy) =>
            copy.savedAt !== draft.savedAt ||
            JSON.stringify(copy.definition) !== JSON.stringify(draft.definition),
        ),
      store,
    ),
  );
}
