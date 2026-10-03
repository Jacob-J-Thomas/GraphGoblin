import { loops, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useCallback, useEffect, useRef } from 'react';
import { loadLocalDraft, saveLocalDraft } from '../drafts/local-drafts.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { validateDraft } from './model.js';
import { useEditorStore } from './store.js';

export const AUTOSAVE_DELAY_MS = 600;

/** One chain of draft saves per loop: requests for a loop never overlap or complete out of order. */
const queues = new Map<string, Promise<unknown>>();

/** Run `job` after every save already queued for `loopId`. */
export function serializeSave<T>(loopId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(loopId) ?? Promise.resolve()).then(job, job);
  queues.set(
    loopId,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Mark the device copy as synced, unless a newer edit has been mirrored over it since this save
 * started: that copy must keep winning on the next load.
 */
async function markSynced(loopId: string, definition: LoopDefinitionInput): Promise<void> {
  const local = await loadLocalDraft(loopId);
  if (local && JSON.stringify(local.definition) !== JSON.stringify(definition)) return;
  await saveLocalDraft({ loopId, definition, savedAt: new Date().toISOString(), synced: true });
}

/**
 * Debounced autosave. Every edit is mirrored to IndexedDB at once, so nothing is lost offline or
 * when leaving the editor; a schema-valid draft is then saved with `PUT /loops/{id}/draft`. Saves
 * for a loop are serialized (including the one sent when the editor unmounts), and a save only
 * updates the editor if the same loop is still loaded in the same editor generation. Returns
 * `flush`, which saves now and resolves to whether the server holds the current revision.
 */
export function useAutosave(
  client: GraphGoblinClient,
  delayMs = AUTOSAVE_DELAY_MS,
): () => Promise<boolean> {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<
    { loopId: string; definition: LoopDefinitionInput; revision: number } | undefined
  >(undefined);
  const revision = useEditorStore((s) => s.revision);

  const save = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { loopId, generation } = useEditorStore.getState();
    if (!loopId) return false;
    return serializeSave(loopId, async () => {
      for (;;) {
        const state = useEditorStore.getState();
        if (state.loopId !== loopId || state.generation !== generation || !state.definition)
          return false;
        const { definition, revision: rev, savedRevision, setSaveState } = state;
        if (rev === savedRevision) return true;
        if (!validateDraft(definition).schemaValid) {
          setSaveState(
            'invalid',
            'Fix the schema errors to save to the server. Changes are kept on this device.',
          );
          return false;
        }
        setSaveState('saving');
        try {
          await loops.saveDraft(client, loopId, definition);
        } catch (error) {
          const now = useEditorStore.getState();
          if (now.loopId !== loopId || now.generation !== generation) return false;
          if (isOfflineError(error)) {
            setSaveState(
              'offline',
              'Offline: the draft is kept on this device and saved when the API is back.',
            );
          } else {
            setSaveState('error', errorMessage(error));
          }
          return false;
        }
        const now = useEditorStore.getState();
        if (now.loopId !== loopId || now.generation !== generation) return false;
        if (now.revision === rev) {
          setSaveState('saved', undefined, rev);
          await markSynced(loopId, definition);
          return true;
        }
        // Edited while the request was in flight: the server holds an older revision; go again.
      }
    });
  }, [client]);

  useEffect(() => {
    const { loopId, definition, savedRevision } = useEditorStore.getState();
    if (revision === savedRevision || !loopId || !definition) return;
    // Mirror the edit to this device at once: navigating away or closing the tab inside the
    // debounce window must not lose it. The server save stays debounced.
    pending.current = { loopId, definition, revision };
    void saveLocalDraft({ loopId, definition, savedAt: new Date().toISOString(), synced: false });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), delayMs);
  }, [revision, save, delayMs]);

  useEffect(
    () => () => {
      // Leaving the editor with an unsaved edit: send it now, behind any save in flight, best
      // effort. The local copy above already holds it and wins on the next load if this fails.
      const last = pending.current;
      if (!last || timer.current === undefined) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      if (!validateDraft(last.definition).schemaValid) return;
      void serializeSave(last.loopId, async () => {
        await loops.saveDraft(client, last.loopId, last.definition);
        await markSynced(last.loopId, last.definition);
      }).catch(() => undefined);
    },
    [client],
  );

  useEffect(() => {
    // Retry as soon as the browser is back online.
    const retry = () => void save();
    window.addEventListener('online', retry);
    return () => {
      window.removeEventListener('online', retry);
      clearTimeout(timer.current);
    };
  }, [save]);

  return save;
}
