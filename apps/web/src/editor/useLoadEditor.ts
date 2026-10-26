import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoop } from '../api/queries.js';
import {
  cachedLocalDraft,
  clearArchivedDraft,
  clearActiveLocalDraft,
  clearSetAsideDraft,
  isCurrentDeviceDraft,
  loadArchivedDrafts,
  loadLocalDraft,
  loadSetAsideDraft,
  rememberLocalDraft,
  saveArchivedDraft,
  saveLocalDraft,
  saveSetAsideDraft,
  type LocalDraft,
} from '../drafts/local-drafts.js';
import { useEditorStore, type EditorState } from './store.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';

/** A stored device copy and the IndexedDB key it lives under. */
export interface DeviceCopy extends LocalDraft {
  source: 'active' | 'set-aside' | 'archive';
}

async function preserveOriginal(draft: LocalDraft): Promise<void> {
  await saveArchivedDraft(draft);
  const copies = await loadArchivedDrafts(draft.loopId);
  if (!copies.some((copy) => JSON.stringify(copy) === JSON.stringify(draft)))
    throw new Error('The original device copy could not be verified.');
}

function untouched(initial: EditorState | undefined, state: EditorState): boolean {
  return (
    initial?.generation === state.generation &&
    initial.revision === state.revision &&
    initial.fieldErrors === state.fieldErrors &&
    initial.nodeDialogSession === state.nodeDialogSession &&
    initial.historyEpoch === state.historyEpoch
  );
}

/**
 * Loads the loop's draft (or published definition) into the editor store. An unsynced local draft
 * from IndexedDB wins, because it holds edits the server never received; offline, the local draft
 * alone keeps the editor usable.
 *
 * A device copy in another format (written by an older build) is never converted, loaded or
 * overwritten (ADR-0042): it is listed as unsupported with an explicit discard. While one is held
 * under the active or set-aside key, editing and device writes wait for that discard.
 */
export function useLoadEditor(loopId: string) {
  const query = useLoop(loopId, 'always');
  const [restoredGeneration, setRestoredGeneration] = useState<number>();
  const [setAside, setSetAside] = useState<LocalDraft | undefined>();
  const [setAsideIsLate, setSetAsideIsLate] = useState(false);
  const [unsupportedCopies, setUnsupportedCopies] = useState<DeviceCopy[]>([]);
  const [backups, setBackups] = useState<DeviceCopy[]>([]);
  const [preservationFailures, setPreservationFailures] = useState<DeviceCopy[]>([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string>();
  // A failed inspection permits server reconciliation, but cannot authorize device mirrors.
  const [deviceInspected, setDeviceInspected] = useState(false);
  const [deviceWritable, setDeviceWritable] = useState(false);
  const [deviceReadError, setDeviceReadError] = useState<string>();
  const [serverReconciled, setServerReconciled] = useState(false);
  const candidate = useRef<LocalDraft | undefined>(undefined);
  const displayed = useRef<EditorState | undefined>(undefined);
  const reconciled = useRef(false);
  const alive = useRef(true);
  const unsupportedBlocked = unsupportedCopies.some((copy) => copy.source !== 'archive');
  const preservationBlocked = preservationFailures.length > 0;

  const showDevice = useCallback(
    (local: LocalDraft, durable: boolean) => {
      useEditorStore.getState().load(loopId, local.definition, {
        dirty: !local.synced,
        baseToken: local.baseToken,
        decisionRoutes: local.decisionRoutes,
        deviceSaved: durable,
      });
      displayed.current = useEditorStore.getState();
      if (!local.synced) setRestoredGeneration(displayed.current.generation);
      setReady(true);
    },
    [loopId],
  );

  const blockPreservation = useCallback((draft: LocalDraft, source: DeviceCopy['source']) => {
    setPreservationFailures((copies) => [...copies, { ...draft, source }]);
    setDeviceInspected(true);
    setDeviceWritable(true);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    const warm = cachedLocalDraft(loopId);
    if (warm) {
      candidate.current = warm.draft;
      if (!displayed.current || useEditorStore.getState().loopId !== loopId)
        showDevice(warm.draft, warm.durable);
    }
    // Start all durable reads alongside the query, even when it has a cached answer.
    void Promise.all([
      loadLocalDraft(loopId),
      loadSetAsideDraft(loopId),
      loadArchivedDrafts(loopId),
    ])
      .then(async ([storedLocal, storedSetAside, storedArchive]) => {
        if (cancelled) return;
        const copies: DeviceCopy[] = [
          ...(storedLocal ? [{ ...storedLocal, source: 'active' as const }] : []),
          ...(storedSetAside ? [{ ...storedSetAside, source: 'set-aside' as const }] : []),
          ...storedArchive.map((draft) => ({ ...draft, source: 'archive' as const })),
        ];
        const unsupported = copies.filter((copy) => !isCurrentDeviceDraft(copy));
        setUnsupportedCopies(unsupported);
        setBackups(
          copies.filter((copy) => copy.source === 'archive' && isCurrentDeviceDraft(copy)),
        );
        if (unsupported.length) setReady(true);
        if (unsupported.some((copy) => copy.source !== 'archive')) {
          // Nothing is loaded from or written to the device until the user discards the copy.
          if (!useEditorStore.getState().revision) useEditorStore.getState().reset();
          setDeviceInspected(true);
          setDeviceWritable(false);
          return;
        }
        const local = storedLocal;
        const earlierSetAside = storedSetAside;
        setSetAside(earlierSetAside);
        setSetAsideIsLate(false);
        // A write made during the read wins, even if the read returned an older durable copy.
        const latest = cachedLocalDraft(loopId);
        const chosen = latest?.draft ?? local;
        candidate.current = warm?.draft ?? local ?? chosen;
        if (
          local &&
          latest &&
          local.loopId === loopId &&
          JSON.stringify(local.definition) !== JSON.stringify(latest.draft.definition) &&
          (warm || !untouched(displayed.current, useEditorStore.getState()))
        ) {
          // The late durable copy is a separate recovery candidate, never an editor replacement.
          try {
            if (earlierSetAside) await preserveOriginal(earlierSetAside);
            if (cancelled) return;
            await saveSetAsideDraft(local);
          } catch {
            if (cancelled) return;
            blockPreservation(local, 'active');
            return;
          }
          if (cancelled) return;
          setSetAside(local);
          setSetAsideIsLate(true);
        }
        if (chosen && (!displayed.current || !warm)) {
          const state = useEditorStore.getState();
          if (state.loopId !== loopId) showDevice(chosen, latest?.durable ?? true);
          else if (untouched(displayed.current, state)) showDevice(chosen, latest?.durable ?? true);
        }
        setDeviceInspected(true);
        setDeviceWritable(true);
        if (storedArchive.length) setReady(true);
      })
      .catch((error: unknown) => {
        // Server saves use a safe read-modify-write and remain available without device storage.
        // Direct mirrors must wait until a retry inspects and preserves the unread active copy.
        if (!cancelled) {
          setDeviceReadError(errorMessage(error));
          setDeviceInspected(true);
          setDeviceWritable(false);
        }
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [loopId, loadAttempt, showDevice, blockPreservation]);

  useEffect(() => () => useEditorStore.getState().reset(), [loopId]);

  useEffect(() => {
    if (reconciled.current || unsupportedBlocked || preservationBlocked) return;
    // A cached query may be stale; wait for its active read, including a later offline recovery.
    if (!query.isSuccess || query.isFetching || !query.isFetchedAfterMount) {
      if (query.isError && ready)
        useEditorStore
          .getState()
          .setSaveState(
            isOfflineError(query.error) ? 'offline' : 'error',
            errorMessage(query.error),
          );
      return;
    }
    const server = query.data.draft?.definition ?? query.data.current?.definition;
    if (!server) {
      if (deviceInspected) {
        reconciled.current = true;
        setReady(true);
        setServerReconciled(true);
      }
      return;
    }
    const token = query.data.draftToken;
    const state = useEditorStore.getState();
    if (state.loopId !== loopId) {
      useEditorStore.getState().load(loopId, server, { baseToken: token });
      displayed.current = useEditorStore.getState();
      setReady(true);
    }
    if (!deviceInspected) return;
    reconciled.current = true;
    void (async () => {
      // A previous editor's queued save may have advanced this copy/token since mount.
      const latest = cachedLocalDraft(loopId);
      const local = latest?.draft ?? candidate.current;
      const now = useEditorStore.getState();
      const unchanged = untouched(displayed.current, now);
      const serverIsNewer =
        local &&
        !local.synced &&
        (!local.baseToken || local.baseToken !== token) &&
        query.data.loop.updatedAt > local.savedAt;
      if (serverIsNewer) {
        try {
          // Do not replace an earlier set-aside copy while retaining this one.
          if (setAside) await preserveOriginal(setAside);
          await saveSetAsideDraft(local);
        } catch {
          if (!alive.current) return;
          blockPreservation(local, 'active');
          return;
        }
        if (!alive.current) return;
        setSetAside(local);
        setSetAsideIsLate(false);
      }
      if (!alive.current) return;
      const current = useEditorStore.getState();
      const stillUnchanged = unchanged && untouched(now, current);
      if (stillUnchanged && (!local || local.synced || serverIsNewer)) {
        if (
          current.baseToken !== token ||
          JSON.stringify(current.definition) !== JSON.stringify(server)
        )
          current.load(loopId, server, { baseToken: token });
        // Keep warm navigation on the reconciled copy without claiming a durable write.
        rememberLocalDraft({
          loopId,
          definition: server,
          savedAt: new Date().toISOString(),
          synced: true,
          ...(token ? { baseToken: token } : {}),
        });
      } else if (local) {
        // Never replace edits made while the server or storage was in flight. An old token
        // remains old.
        const basedOnLatest =
          latest && JSON.stringify(latest.draft.definition) === JSON.stringify(current.definition);
        const base = basedOnLatest
          ? (local.baseToken ?? current.baseToken)
          : (current.baseToken ?? local.baseToken);
        if (current.baseToken !== (base ?? token)) current.setBaseToken(base ?? token);
        if (
          serverIsNewer ||
          (base && base !== token) ||
          (local.synced && !base && JSON.stringify(current.definition) !== JSON.stringify(server))
        ) {
          // A formerly synced cache retained for held input/dialog work can now differ from
          // the server without a definition edit. Explicit overwrite must save it too.
          if (current.revision === current.savedRevision)
            useEditorStore.setState({ revision: current.revision + 1 });
          current.setConflict({ serverToken: token });
          current.setSaveState('conflict');
        }
      }
      setServerReconciled(true);
    })();
  }, [
    loopId,
    query.data,
    query.isSuccess,
    query.isError,
    query.error,
    query.isFetching,
    query.isFetchedAfterMount,
    deviceInspected,
    ready,
    unsupportedBlocked,
    preservationBlocked,
    setAside,
    blockPreservation,
  ]);

  const restoreSetAside = async () => {
    if (!setAside) return;
    const restoredCopy = setAside;
    const started = useEditorStore.getState();
    const { baseToken, conflict } = started;
    const token = conflict?.serverToken ?? baseToken;
    setRecoveryError(undefined);
    try {
      // The click authorizes this exact overwrite token. Retain the backup on a failed write.
      await saveLocalDraft({
        ...restoredCopy,
        savedAt: new Date().toISOString(),
        synced: false,
        ...(token ? { baseToken: token } : {}),
      });
      const now = useEditorStore.getState();
      if (now.loopId === loopId && untouched(started, now)) {
        setSetAside(undefined);
        now.load(loopId, restoredCopy.definition, {
          dirty: true,
          baseToken: token,
          decisionRoutes: restoredCopy.decisionRoutes,
          deviceSaved: true,
        });
        setRestoredGeneration(useEditorStore.getState().generation);
        await clearSetAsideDraft(loopId, restoredCopy);
        if (alive.current) setSetAside(undefined);
      } else if (now.loopId !== loopId) {
        // Navigation is safe: the persisted active copy will be found on the next visit.
        await clearSetAsideDraft(loopId, restoredCopy);
      }
    } catch {
      if (alive.current) setSetAside(restoredCopy);
      if (alive.current)
        setRecoveryError(
          'The device copy could not be restored. Its backup is retained; retry when device storage is available.',
        );
    }
  };
  const discardSetAside = async () => {
    if (!setAside) return;
    setRecoveryError(undefined);
    try {
      await clearSetAsideDraft(loopId, setAside);
      if (alive.current) setSetAside(undefined);
    } catch {
      if (alive.current)
        setRecoveryError(
          'The device copy could not be discarded. It is retained; retry when device storage is available.',
        );
    }
  };
  /**
   * Remove exactly this stored copy from this browser, after the user chose it. Discarding the
   * last copy that held editing back reads device storage again and opens the editor.
   */
  const discardDeviceCopy = async (copy: DeviceCopy) => {
    setRecoveryError(undefined);
    try {
      if (copy.source === 'active') await clearActiveLocalDraft(loopId, copy);
      else if (copy.source === 'set-aside') await clearSetAsideDraft(loopId, copy);
      else await clearArchivedDraft(loopId, copy);
      if (!alive.current) return;
      const others = (copies: DeviceCopy[]) => copies.filter((item) => item !== copy);
      const blocking = (copies: DeviceCopy[]) =>
        copies.some((item) => item.source === 'active' || item.source === 'set-aside');
      const unsupported = others(unsupportedCopies);
      const failures = others(preservationFailures);
      setUnsupportedCopies(unsupported);
      setBackups(others(backups));
      setPreservationFailures(blocking(failures) ? failures : []);
      if (
        (blocking(unsupportedCopies) || preservationBlocked) &&
        !blocking(unsupported) &&
        !blocking(failures)
      ) {
        // Inspect the device and reconcile with the server again, as on opening the editor; the
        // discarded copy must not be reconciled from memory before the new read finishes.
        reconciled.current = false;
        candidate.current = undefined;
        setDeviceInspected(false);
        setLoadAttempt((attempt) => attempt + 1);
      }
    } catch {
      if (alive.current)
        setRecoveryError(
          'The device copy could not be discarded. It is retained; retry when device storage is available.',
        );
    }
  };
  return {
    query,
    restoredGeneration,
    ready,
    serverReconciled,
    deviceInspected,
    deviceWritable,
    deviceReadError,
    retryDeviceRead: () => {
      setDeviceReadError(undefined);
      setLoadAttempt((attempt) => attempt + 1);
    },
    setAside,
    setAsideIsLate,
    unsupportedCopies,
    unsupportedBlocked,
    backups,
    preservationFailures,
    preservationBlocked,
    recoveryError,
    restoreSetAside,
    discardSetAside,
    discardDeviceCopy,
  };
}
