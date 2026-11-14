import { GraphGoblinApiError, loops, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { keys, refreshLoopAfterWrite } from '../api/queries.js';
import {
  deviceStorageProblem,
  recordServerSave,
  rememberLocalDraft,
  saveLocalDraft,
  subscribeDeviceStorage,
} from '../drafts/local-drafts.js';
import { loopNameConflict, sameLoopName } from '../lib/loop-names.js';
import { markApiUnreachable, subscribeApiRecovery } from '../lib/reachability.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { validateDraft } from './model.js';
import { useEditorStore, type NameRetry } from './store.js';

export const AUTOSAVE_DELAY_MS = 600;

/**
 * Write the editor's current edits to this device as its unsynced copy, and record the revision
 * there once the write succeeds. A refused write leaves the edits in memory; the device storage's
 * state (`deviceStorageProblem`) says why, and the editor reports it.
 */
function mirror(persist = true): void {
  const { loopId, definition, decisionRoutes, revision, generation, baseToken } =
    useEditorStore.getState();
  if (!loopId || !definition) return;
  const draft = {
    loopId,
    definition,
    decisionRoutes,
    savedAt: new Date().toISOString(),
    synced: false,
    ...(baseToken ? { baseToken } : {}),
  };
  if (!persist) {
    rememberLocalDraft(draft);
    return;
  }
  void saveLocalDraft(draft).then(
    () => {
      const now = useEditorStore.getState();
      if (now.loopId === loopId && now.generation === generation) now.setDeviceRevision(revision);
    },
    () => undefined,
  );
}

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
 * After the server accepted a save, whether or not the editor that sent it is still open: record
 * it on the device copy (`recordServerSave`), then read the Loops list and the loop's detail again
 * (`refreshLoopAfterWrite`, #237). A newer edit mirrored since the save started takes `token` only
 * when it shares that save's request base; unrelated device work retains its base and explicit
 * reconciliation requirement. The device record's in-memory part is set before the reads start,
 * so an editor reopened meanwhile reconciles the fresh detail against it. The server holds the
 * draft whether or not this device can record that: a device storage failure is reported as its
 * own notice (`deviceStorageProblem`), never as a save still pending.
 */
async function recordSaved(
  queryClient: QueryClient,
  loopId: string,
  definition: LoopDefinitionInput,
  token: string,
  baseToken: string | undefined,
): Promise<void> {
  const recorded = recordServerSave(loopId, definition, token, baseToken);
  void refreshLoopAfterWrite(queryClient, loopId);
  await recorded.catch(() => undefined);
}

/** The server's token from a 409 `DRAFT_CONFLICT`, or false when `error` is something else. */
export function draftConflict(error: unknown): { serverToken: string | undefined } | false {
  if (!(error instanceof GraphGoblinApiError) || error.code !== 'DRAFT_CONFLICT') return false;
  const token = error.problem?.['draftToken'];
  return { serverToken: typeof token === 'string' ? token : undefined };
}

export const CONFLICT_MESSAGE =
  'The server holds a different draft from the one these changes are based on. Nothing is saved to the server until you choose.';

/**
 * Debounced autosave. Every edit is mirrored to IndexedDB at once, so nothing is lost offline or
 * when leaving the editor; the store learns which revision is on the device once that write
 * succeeds (`deviceRevision`), and the device storage's state says when it cannot (blocked by
 * another window's older version, or failing), in which case the edits are in this window only
 * until it works again: when it does, unsaved edits are written to the device at once. A
 * schema-valid draft is then saved with `PUT /loops/{id}/draft`. Saves for a loop are serialized
 * (including the one sent when the editor unmounts), and a save only updates the editor if the
 * same loop is still loaded in the same editor generation. Returns `flush`, which saves now and
 * resolves to whether the server holds the current revision. Given a `NameRetry` (the editor's
 * Try again), that save, and no other, may send the refused name once (#209).
 */
export function useAutosave(
  client: GraphGoblinClient,
  delayMs = AUTOSAVE_DELAY_MS,
  {
    enabled = true,
    deviceReady = true,
    serverReconciled = true,
    system = false,
  }: {
    enabled?: boolean;
    deviceReady?: boolean;
    serverReconciled?: boolean;
    system?: boolean;
  } = {},
): (retry?: NameRetry) => Promise<boolean> {
  const queryClient = useQueryClient();
  const systemRef = useRef(system);
  systemRef.current = system;
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
  const nameConflict = useEditorStore((s) => s.nameConflict);
  const latest = useRef({ inConflict, nameConflict });
  latest.current = { inConflict, nameConflict };
  const enabledRef = useRef(enabled && serverReconciled);
  enabledRef.current = enabled && serverReconciled;
  const deviceReadyRef = useRef(enabled && deviceReady);
  deviceReadyRef.current = enabled && deviceReady;
  /**
   * The token this editor load's work is based on: the load's own (or one it adopted: an
   * overwrite, a reconciliation, a staged voice draft), advanced by each save of that load the
   * server accepts, also after unmount. The save sent on leaving is queued behind saves in flight
   * and reads it when it runs, so it builds on their result; another load's token never applies.
   */
  const chain = useRef<{ generation: number; token: string | undefined } | undefined>(undefined);
  useEffect(() => {
    const { loopId, generation } = useEditorStore.getState();
    if (loopId) chain.current = { generation, token: baseToken };
  }, [baseToken, loadGeneration]);

  const save = useCallback(
    async (retry?: NameRetry): Promise<boolean> => {
      // This save owns `retry`: whatever happens, it ends that attempt's busy mark, unless the
      // store already shows something newer (a fresh refusal, an accepted save, another load).
      const settle = () => {
        if (!retry) return;
        const now = useEditorStore.getState();
        if (now.nameConflict === retry.refusal)
          now.setNameConflict({ ...retry.refusal, retrying: false });
      };
      if (!enabledRef.current) {
        settle();
        return false;
      }
      clearTimeout(timer.current);
      timer.current = undefined;
      const { loopId, generation } = useEditorStore.getState();
      if (!loopId) {
        settle();
        return false;
      }
      // The permission is for the loop and load it was given in, and for one request.
      let permit = retry?.loopId === loopId && retry.generation === generation ? retry : undefined;
      const send = async (): Promise<boolean> => {
        for (;;) {
          if (!enabledRef.current) return false;
          const state = useEditorStore.getState();
          if (state.loopId !== loopId || state.generation !== generation || !state.definition)
            return false;
          // A refused save waits for the user: reload the server draft or overwrite it.
          if (state.conflict) return false;
          const { definition, revision: rev, savedRevision, setSaveState, baseToken } = state;
          if (rev === savedRevision) return true;
          // Where the edits are instead (this device, or this window only) is the device copy's to
          // say, once its write has answered (`saveNotice`).
          if (!validateDraft(definition, systemRef.current).schemaValid) {
            setSaveState('invalid', systemRef.current ? 'SYSTEM_CHAT_CONTRACT_INVALID' : undefined);
            return false;
          }
          // Another loop holds this name (#209): keep every edit on the device and send nothing
          // until the name changes or this save carries the user's deliberate Try again of it.
          const held = state.nameConflict;
          const deliberate =
            permit !== undefined && sameLoopName(definition.name, permit.refusal.name);
          if (held && !deliberate && sameLoopName(definition.name, held.name)) {
            setSaveState('name-conflict');
            return false;
          }
          // Spent by this request, whatever its answer: a later pass sends only as any save would.
          permit = undefined;
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
            const refused = conflict ? undefined : loopNameConflict(error, definition.name);
            // A name refusal replaces the guidance. Any other failure leaves it, and a Try again
            // still queued behind this save, as they are: only that attempt's own save ends it.
            if (refused) {
              now.setNameConflict({
                name: definition.name,
                suggestedName: refused.suggestedName,
                retrying: false,
                retried: deliberate,
              });
            } else if (conflict) {
              // A stale base takes precedence on the server; its own notice asks Reload or
              // Overwrite, and an overwrite that meets the name again is refused afresh.
              now.setNameConflict(undefined);
            }
            if (refused) {
              setSaveState('name-conflict');
            } else if (conflict) {
              now.setConflict(conflict);
              setSaveState('conflict', CONFLICT_MESSAGE);
            } else if (
              systemRef.current &&
              error instanceof GraphGoblinApiError &&
              error.code === 'SYSTEM_CHAT_CONTRACT_INVALID'
            ) {
              setSaveState('invalid', 'SYSTEM_CHAT_CONTRACT_INVALID');
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
          if (chain.current?.generation === generation)
            chain.current = { generation, token: saved.draftToken };
          // Before the device write, so an edit mirrored from here on carries the new token.
          if (isCurrent()) {
            useEditorStore.getState().setBaseToken(saved.draftToken);
            // The server took this name, so an earlier refusal no longer applies.
            useEditorStore.getState().setNameConflict(undefined);
          }
          await recordSaved(queryClient, loopId, definition, saved.draftToken, baseToken);
          if (!isCurrent()) return false;
          if (useEditorStore.getState().revision === rev) {
            setSaveState('saved', undefined, rev, {
              revision: rev,
              definition: saved.draft.definition,
              token: saved.draftToken,
            });
            return true;
          }
          // Edited while the request was in flight: the server holds an older revision; go again.
        }
      };
      return serializeSave(loopId, async () => {
        try {
          return await send();
        } finally {
          settle();
        }
      });
    },
    [client, queryClient],
  );

  useEffect(() => {
    if (!enabled) {
      clearTimeout(timer.current);
      timer.current = undefined;
      return;
    }
    const { loopId, definition, savedRevision } = useEditorStore.getState();
    if (revision === savedRevision || !loopId || !definition) return;
    // Mirror the edit to this device at once: navigating away or closing the tab inside the
    // debounce window must not lose it. The server save stays debounced.
    pending.current = { loopId, definition, revision, generation: loadGeneration };
    if (useEditorStore.getState().deviceRevision !== revision) mirror(deviceReady);
    clearTimeout(timer.current);
    timer.current = serverReconciled ? setTimeout(() => void save(), delayMs) : undefined;
  }, [revision, loadGeneration, save, delayMs, enabled, deviceReady, serverReconciled]);

  // Device storage that refused the mirror (blocked by another window) works again: put the edits
  // that are only in this window on the device now, rather than on the next edit.
  useEffect(() => {
    if (!enabled) return;
    return subscribeDeviceStorage(() => {
      if (!deviceReadyRef.current) return;
      if (deviceStorageProblem()) return;
      const { loopId, revision: rev, savedRevision, deviceRevision } = useEditorStore.getState();
      if (loopId && rev !== savedRevision && deviceRevision !== rev) mirror();
    });
  }, [enabled]);

  useEffect(
    () => () => {
      // Leaving the editor with an unsaved edit: send it now, behind any save in flight, best
      // effort. The local copy above already holds it and wins on the next load if this fails.
      if (!enabledRef.current) {
        clearTimeout(timer.current);
        return;
      }
      const last = pending.current;
      if (!last || timer.current === undefined) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      if (!validateDraft(last.definition, systemRef.current).schemaValid) return;
      // In conflict the user has not chosen yet: the unsynced local copy waits for the next visit.
      if (latest.current.inConflict) return;
      // Still the refused name: the device copy keeps it, and the next visit's save asks again.
      const refusedName = latest.current.nameConflict;
      if (refusedName && sameLoopName(last.definition.name, refusedName.name)) return;
      void serializeSave(last.loopId, async () => {
        // A later load of this editor (Reload server draft, a restored device copy) replaced the
        // one this snapshot came from: the user's choice and the device copy stand, nothing is sent.
        const base = chain.current;
        if (base?.generation !== last.generation) return;
        const saved = await loops.saveDraft(client, last.loopId, last.definition, {
          ...(base.token ? { ifMatch: base.token } : {}),
        });
        await recordSaved(queryClient, last.loopId, last.definition, saved.draftToken, base.token);
      }).catch(() => undefined);
    },
    [client, queryClient],
  );

  useEffect(() => {
    if (!enabled) return;
    // Both browser reconnect and confirmed API recovery use the same serialized save path.
    const retry = () => void save();
    const unsubscribeRecovery = subscribeApiRecovery(retry);
    window.addEventListener('online', retry);
    return () => {
      unsubscribeRecovery();
      window.removeEventListener('online', retry);
      clearTimeout(timer.current);
    };
  }, [save, enabled]);

  return save;
}
