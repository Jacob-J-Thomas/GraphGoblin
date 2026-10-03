import { loops, type GraphGoblinClient } from '@graphgoblin/api-client';
import { useCallback, useEffect, useRef } from 'react';
import { saveLocalDraft } from '../drafts/local-drafts.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { validateDraft } from './model.js';
import { useEditorStore } from './store.js';

export const AUTOSAVE_DELAY_MS = 600;

/**
 * Debounced autosave. Every edit is mirrored to IndexedDB first, so nothing is lost offline; a
 * schema-valid draft is then saved with `PUT /loops/{id}/draft`. Returns `flush`, which saves now
 * and resolves to whether the server holds the current revision.
 */
export function useAutosave(
  client: GraphGoblinClient,
  delayMs = AUTOSAVE_DELAY_MS,
): () => Promise<boolean> {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revision = useEditorStore((s) => s.revision);

  const save = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const {
      loopId,
      definition,
      revision: rev,
      savedRevision,
      setSaveState,
    } = useEditorStore.getState();
    if (!loopId || !definition) return false;
    if (rev === savedRevision) return true;
    await saveLocalDraft({ loopId, definition, savedAt: new Date().toISOString(), synced: false });
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
      if (useEditorStore.getState().revision === rev) {
        setSaveState('saved', undefined, rev);
        await saveLocalDraft({
          loopId,
          definition,
          savedAt: new Date().toISOString(),
          synced: true,
        });
      }
      return true;
    } catch (error) {
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
  }, [client]);

  useEffect(() => {
    const { savedRevision } = useEditorStore.getState();
    if (revision === savedRevision) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), delayMs);
  }, [revision, save, delayMs]);

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
