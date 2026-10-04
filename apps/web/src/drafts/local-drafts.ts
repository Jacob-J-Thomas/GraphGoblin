import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { createStore, del, promisifyRequest, set, update, type UseStore } from 'idb-keyval';

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

let store: UseStore | undefined;

function draftStore(): UseStore {
  store ??= createStore('graphgoblin', 'drafts');
  return store;
}

export async function saveLocalDraft(draft: LocalDraft): Promise<void> {
  await set(draft.loopId, draft, draftStore());
}

export async function loadLocalDraft(loopId: string): Promise<LocalDraft | undefined> {
  return loadDraft(loopId);
}

/** Discard device copies that no longer satisfy the current contract. */
async function loadDraft(key: string): Promise<LocalDraft | undefined> {
  return draftStore()('readwrite', (store) => {
    let draft: LocalDraft | undefined;
    const request = store.get(key) as IDBRequest<LocalDraft | undefined>;
    request.onsuccess = () => {
      draft = request.result;
      if (draft && !LoopDefinitionSchema.safeParse(draft.definition).success) {
        store.delete(key);
        draft = undefined;
      }
    };
    return promisifyRequest(store.transaction).then(() => draft);
  });
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
