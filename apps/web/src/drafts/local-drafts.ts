import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createStore, del, get, set, type UseStore } from 'idb-keyval';

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
  return get<LocalDraft>(loopId, draftStore());
}

export async function clearLocalDraft(loopId: string): Promise<void> {
  await del(loopId, draftStore());
}
