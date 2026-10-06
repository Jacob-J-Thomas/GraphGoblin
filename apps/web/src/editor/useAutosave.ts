import { GraphGoblinApiError, loops, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { keys } from '../api/queries.js';
import {
  deviceStorageProblem,
  recordServerSave,
  saveLocalDraft,
  subscribeDeviceStorage,
} from '../drafts/local-drafts.js';
import { markApiUnreachable, subscribeApiRecovery } from '../lib/reachability.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { validateDraft } from './model.js';
import { useEditorStore } from './store.js';

export const AUTOSAVE_DELAY_MS = 600;

/**
 * Write the editor's current edits to this device as its unsynced copy, and record the revision
 * there once the write succeeds. A refused write leaves the edits in memory; the device storage's
 * state (`deviceStorageProblem`) says why, and the editor reports it.
 */
function mirror(): void {
  const { loopId, definition, revision, generation, baseToken } = useEditorStore.getState();
  if (!loopId || !definition) return;
  void saveLocalDraft({
    loopId,
    definition,
    savedAt: new Date().toISOString(),
    synced: false,
    ...(baseToken ? { baseToken } : {}),
  }).then(
    () => {
      const now = useEditorStore.getState();
      if (now.loopId === loopId && now.generation === generation) now.setDeviceRevision(revision);
    },
    () => undefined,
  );
}

/** One chain of draft saves per loop: requests for a loop never overlap or complete out of order. */
const queues = new Map<string, Promise<unknown>>();

/**
 * The newest draft token known per loop: from a load or a completed save. The unmount save is
 * queued behind saves in flight and reads it when it runs, so it is based on their result.
 */
const latestTokens = new Map<string, string>();

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
 * After the server accepted a save: advance the loop's token, whether or not the editor that sent
 * it is still open, and record it on the device copy (`recordServerSave`). A newer edit mirrored
 * since the save started stays unsynced and keeps winning on the next load, now based on `token`.
 * The server holds the draft whether or not this device can record that: a device storage failure
 * is reported as its own notice (`deviceStorageProblem`), never as a save still pending.
 */
async function recordSaved(
  loopId: string,
  definition: LoopDefinitionInput,
  token: string,
): Promise<void> {
  latestTokens.set(loopId, token);
  await recordServerSave(loopId, definition, token).catch(() => undefined);
}

/** The server's token from a 409 `DRAFT_CONFLICT`, or false when `error` is something else. */
export function draftConflict(error: unknown): { serverToken: string | undefined } | false {
  if (!(error instanceof GraphGoblinApiError) || error.code !== 'DRAFT_CONFLICT') return false;
  const token = error.problem?.['draftToken'];
  return { serverToken: typeof token === 'string' ? token : undefined };
}

export const CONFLICT_MESSAGE =
  'The draft changed on the server (another tab or device saved it). Nothing is saved to the server until you choose.';

/**
 * Debounced autosave. Every edit is mirrored to IndexedDB at once, so nothing is lost offline or
 * when leaving the editor; the store learns which revision is on the device once that write
 * succeeds (`deviceRevision`), and the device storage's state says when it cannot (blocked by
 * another window's older version, or failing), in which case the edits are in this window only
 * until it works again: when it does, unsaved edits are written to the device at once. A
 * schema-valid draft is then saved with `PUT /loops/{id}/draft`. Saves for a loop are serialized
 * (including the one sent when the editor unmounts), and a save only updates the editor if the
 * same loop is still loaded in the same editor generation. Returns `flush`, which saves now and
 * resolves to whether the server holds the current revision.
 */
export function useAutosave(
  client: GraphGoblinClient,
  delayMs = AUTOSAVE_DELAY_MS,
): () => Promise<boolean> {
  const queryClient = useQueryClient();
  const recoveryRead = useRef<{ generation: number; revision: number } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<
    | { loopId: string; definition: LoopDefinitionInput; revision: number; generation: number }
    | undefined
  >(undefined);
  const revision = useEditorStore((s) => s.revision);
  // A load (for example restoring a set-aside copy) starts a new generation and may leave the
  // revision number unchanged, so the mirror below watches both.
  const loadGeneration = useEditorStore((s) => s.generation);
  // The last rendered token and conflict, for the unmount save: the store may be reset by then.
  const baseToken = useEditorStore((s) => s.baseToken);
  const inConflict = useEditorStore((s) => s.conflict !== undefined);
  const latest = useRef({ inConflict });
  latest.current = { inConflict };
  useEffect(() => {
    const { loopId } = useEditorStore.getState();
    if (loopId && baseToken) latestTokens.set(loopId, baseToken);
  }, [baseToken, loadGeneration]);

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
        // A refused save waits for the user: reload the server draft or overwrite it.
        if (state.conflict) return false;
        const { definition, revision: rev, savedRevision, setSaveState, baseToken } = state;
        if (rev === savedRevision) return true;
        // Where the edits are instead (this device, or this window only) is the device copy's to
        // say, once its write has answered (`saveNotice`).
        if (!validateDraft(definition).schemaValid) {
          setSaveState('invalid');
          return false;
        }
        setSaveState('saving');
        let saved: Awaited<ReturnType<typeof loops.saveDraft>>;
        try {
          saved = await loops.saveDraft(client, loopId, definition, {
            ...(baseToken ? { ifMatch: baseToken } : {}),
          });
        } catch (error) {
          const now = useEditorStore.getState();
          if (now.loopId !== loopId || now.generation !== generation) return false;
          const conflict = draftConflict(error);
          if (conflict) {
            now.setConflict(conflict);
            setSaveState('conflict', CONFLICT_MESSAGE);
          } else if (isOfflineError(error)) {
            setSaveState('offline');
            // A save can be the first request to notice an outage. Refresh the active loop
            // read once per revision so query-driven reachability can recover it. A reachable
            // read with a persistently failing PUT must not create a read/save retry loop.
            const queryKey = keys.loop(loopId);
            if (
              !isOfflineError(queryClient.getQueryState(queryKey)?.error) &&
              (recoveryRead.current?.generation !== generation ||
                recoveryRead.current.revision !== rev)
            ) {
              recoveryRead.current = { generation, revision: rev };
              markApiUnreachable();
              void queryClient.refetchQueries(
                { queryKey, exact: true, type: 'active' },
                { cancelRefetch: false },
              );
            }
          } else {
            setSaveState('error', errorMessage(error));
          }
          return false;
        }
        const isCurrent = () => {
          const now = useEditorStore.getState();
          return now.loopId === loopId && now.generation === generation;
        };
        // Before the device write, so an edit mirrored from here on carries the new token.
        if (isCurrent()) useEditorStore.getState().setBaseToken(saved.draftToken);
        await recordSaved(loopId, definition, saved.draftToken);
        if (!isCurrent()) return false;
        if (useEditorStore.getState().revision === rev) {
          setSaveState('saved', undefined, rev);
          return true;
        }
        // Edited while the request was in flight: the server holds an older revision; go again.
      }
    });
  }, [client, queryClient]);

  useEffect(() => {
    const { loopId, definition, savedRevision } = useEditorStore.getState();
    if (revision === savedRevision || !loopId || !definition) return;
    // Mirror the edit to this device at once: navigating away or closing the tab inside the
    // debounce window must not lose it. The server save stays debounced.
    pending.current = { loopId, definition, revision, generation: loadGeneration };
    mirror();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), delayMs);
  }, [revision, loadGeneration, save, delayMs]);

  // Device storage that refused the mirror (blocked by another window) works again: put the edits
  // that are only in this window on the device now, rather than on the next edit.
  useEffect(
    () =>
      subscribeDeviceStorage(() => {
        if (deviceStorageProblem()) return;
        const { loopId, revision: rev, savedRevision, deviceRevision } = useEditorStore.getState();
        if (loopId && rev !== savedRevision && deviceRevision !== rev) mirror();
      }),
    [],
  );

  useEffect(
    () => () => {
      // Leaving the editor with an unsaved edit: send it now, behind any save in flight, best
      // effort. The local copy above already holds it and wins on the next load if this fails.
      const last = pending.current;
      if (!last || timer.current === undefined) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      if (!validateDraft(last.definition).schemaValid) return;
      // In conflict the user has not chosen yet: the unsynced local copy waits for the next visit.
      if (latest.current.inConflict) return;
      void serializeSave(last.loopId, async () => {
        const token = latestTokens.get(last.loopId);
        const saved = await loops.saveDraft(client, last.loopId, last.definition, {
          ...(token ? { ifMatch: token } : {}),
        });
        await recordSaved(last.loopId, last.definition, saved.draftToken);
      }).catch(() => undefined);
    },
    [client],
  );

  useEffect(() => {
    // Both browser reconnect and confirmed API recovery use the same serialized save path.
    const retry = () => void save();
    const unsubscribeRecovery = subscribeApiRecovery(retry);
    window.addEventListener('online', retry);
    return () => {
      unsubscribeRecovery();
      window.removeEventListener('online', retry);
      clearTimeout(timer.current);
    };
  }, [save]);

  return save;
}
