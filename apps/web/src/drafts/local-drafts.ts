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
}

let database: Promise<IDBDatabase> | undefined;

class DraftStoreBlockedError extends Error {}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('graphgoblin', 2);
    let blockedTimeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    request.onblocked = () => {
      blockedTimeout ??= setTimeout(() => {
        timedOut = true;
        reject(
          new DraftStoreBlockedError(
            'Close other GraphGoblin tabs and windows so device drafts can be saved.',
          ),
        );
      }, 3000);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      // Retire pre-upgrade device copies once; new drafts can be incomplete while editing.
      if (db.objectStoreNames.contains('drafts')) db.deleteObjectStore('drafts');
      db.createObjectStore('drafts');
    };
    request.onsuccess = () => {
      clearTimeout(blockedTimeout);
      // An open request cannot be cancelled while blocked. Close its eventual connection.
      if (timedOut) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(blockedTimeout);
      reject(request.error ?? new Error('The device-draft database could not be opened.'));
    };
  });
}

function draftStore(): UseStore {
  if (!database) {
    database = openDraftDatabase();
    void database.then(
      (db) => {
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        db.onclose = () => {
          database = undefined;
        };
      },
      () => {
        database = undefined;
      },
    );
  }
  const connection = database;
  return (mode, callback) =>
    connection.then((db) => callback(db.transaction('drafts', mode).objectStore('drafts')));
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  await set(draft.loopId, draft, draftStore());
}

export async function loadLocalDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(loopId);
}

async function loadDraft(key: string): Promise<LocalDraft | undefined> {
  try {
    return await get<LocalDraft>(key, draftStore());
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
  await update<LocalDraft>(
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
    draftStore(),
  );
}

export async function clearLocalDraft(loopId: string): Promise<void> {
  await del(loopId, draftStore());
  await del(setAsideKey(loopId), draftStore());
}

/**
 * A device copy set aside because the server had a newer draft. Kept under its own key, apart
 * from the live mirror that later edits overwrite, until the user restores or discards it.
 */
function setAsideKey(loopId: string): string {
  return `${loopId}:set-aside`;
}

export async function saveSetAsideDraft(draft: LocalDraft): Promise<void> {
  await set(setAsideKey(draft.loopId), draft, draftStore());
}

export async function loadSetAsideDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(setAsideKey(loopId));
}

export async function clearSetAsideDraft(loopId: string): Promise<void> {
  await del(setAsideKey(loopId), draftStore());
}
