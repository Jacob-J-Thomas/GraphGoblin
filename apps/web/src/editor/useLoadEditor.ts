import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpgradeIssue } from '@graphgoblin/domain';
import { useLoop } from '../api/queries.js';
import {
  cachedLocalDraft,
  clearArchivedDraft,
  clearActiveLocalDraft,
  clearSetAsideDraft,
  loadArchivedDrafts,
  loadLocalDraft,
  loadSetAsideDraft,
  rememberLocalDraft,
  saveArchivedDraft,
  saveLocalDraft,
  saveSetAsideDraft,
  UNRECONCILED_DEVICE_TOKEN,
  type LocalDraft,
} from '../drafts/local-drafts.js';
import { useEditorStore, type EditorState } from './store.js';
import { loadDeviceUpgrader } from './load-device-upgrader.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';

interface DeviceDraftRead {
  draft?: LocalDraft;
  unconvertible?: LocalDraft & { migrationIssues: UpgradeIssue[] };
  loadFailed?: true;
}

export interface RawDeviceCopy extends LocalDraft {
  migrationIssues: UpgradeIssue[];
  source: 'active' | 'set-aside' | 'archive';
}

/** Current editor drafts may be incomplete; only older formats need the explicit cutover. */
async function readDeviceDraft(draft: LocalDraft | undefined): Promise<DeviceDraftRead> {
  if (!draft) return {};
  const definition = draft.definition as unknown;
  const current = { ...draft };
  delete current.migrationIssues;
  // Device persistence keeps work in progress, including invalid fields and unfinished syntax.
  // Validation still blocks server saves and publication; it must not block reopening an edit.
  if (
    typeof definition === 'object' &&
    definition !== null &&
    'schemaVersion' in definition &&
    definition.schemaVersion === CURRENT_DEFINITION_FORMAT
  )
    return { draft: current };
  let upgradeLoopCurrent: Awaited<ReturnType<typeof loadDeviceUpgrader>>['upgradeLoopCurrent'];
  try {
    ({ upgradeLoopCurrent } = await loadDeviceUpgrader());
  } catch {
    // A stale chunk or failed network request says nothing about the stored definition.
    // Leave every key untouched so a retry or the next editor load can convert it.
    return { loadFailed: true };
  }
  const result = await upgradeLoopCurrent(definition).catch(() => ({
    ok: false as const,
    issues: [
      {
        code: 'UPGRADE_CONVERSION_FAILED',
        path: '/',
        message: 'Conversion failed; the original device copy is retained.',
      },
    ],
  }));
  if (!result.ok) return { unconvertible: { ...draft, migrationIssues: result.issues } };
  return {
    draft: {
      ...current,
      definition: result.value,
      synced: draft.synced,
      // Discard the old token, including on a clean offline cache: any later edits must
      // reconcile through DRAFT_CONFLICT. Synced caches themselves do not trigger a save.
      baseToken: UNRECONCILED_DEVICE_TOKEN,
    },
  };
}

async function preserveOriginal(draft: LocalDraft): Promise<void> {
  await saveArchivedDraft(draft);
  const copies = await loadArchivedDrafts(draft.loopId);
  if (!copies.some((copy) => JSON.stringify(copy) === JSON.stringify(draft)))
    throw new Error('The original device copy could not be verified.');
}

function preservationFailure(draft: LocalDraft, source: RawDeviceCopy['source']): RawDeviceCopy {
  return {
    ...draft,
    source,
    migrationIssues: [
      {
        code: 'UPGRADE_PRESERVATION_FAILED',
        path: '/',
        message:
          'The original must be archived and read back before this device copy can be replaced.',
      },
    ],
  };
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
 */
export function useLoadEditor(loopId: string) {
  const query = useLoop(loopId, 'always');
  const [restoredGeneration, setRestoredGeneration] = useState<number>();
  const [setAside, setSetAside] = useState<LocalDraft | undefined>();
  const [setAsideIsLate, setSetAsideIsLate] = useState(false);
  const [rawCopies, setRawCopies] = useState<RawDeviceCopy[]>([]);
  const [preservationBlocked, setPreservationBlocked] = useState(false);
  const [conversionLoadFailed, setConversionLoadFailed] = useState(false);
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
        const [localRead, asideRead] = await Promise.all([
          readDeviceDraft(storedLocal),
          readDeviceDraft(storedSetAside),
        ]);
        if (cancelled) return;
        if (localRead.loadFailed || asideRead.loadFailed) {
          if (!useEditorStore.getState().revision) useEditorStore.getState().reset();
          setConversionLoadFailed(true);
          return;
        }
        setConversionLoadFailed(false);
        const local = localRead.draft;
        const earlierSetAside = asideRead.draft;
        let rawSetAside: RawDeviceCopy[] = asideRead.unconvertible
          ? [{ ...asideRead.unconvertible, source: 'set-aside' as const }]
          : [];
        // Archives are inert originals, not editor candidates. Do not hash/convert them on load.
        const archivedCopies = storedArchive.map((draft): RawDeviceCopy => ({
          ...draft,
          migrationIssues: draft.migrationIssues?.length
            ? draft.migrationIssues
            : [
                {
                  code:
                    draft.definition.schemaVersion === CURRENT_DEFINITION_FORMAT
                      ? 'DEVICE_DRAFT_BACKUP'
                      : 'UPGRADE_ARCHIVED_RAW_COPY',
                  path: '/schemaVersion',
                  message:
                    draft.definition.schemaVersion === CURRENT_DEFINITION_FORMAT
                      ? 'This current-format device draft is retained as a backup.'
                      : 'This original device copy is retained without conversion.',
                },
              ],
          source: 'archive' as const,
        }));
        const preservationFailures: RawDeviceCopy[] = [];
        if (local && storedLocal && local.definition !== storedLocal.definition) {
          try {
            await preserveOriginal(storedLocal);
            if (cancelled) return;
            // Conversion may finish after a server-first editor was edited. Keep the converted
            // candidate for recovery without replacing the newer in-memory work.
            const current = useEditorStore.getState();
            if (
              current.loopId !== loopId ||
              !displayed.current ||
              untouched(displayed.current, current)
            )
              await saveLocalDraft(local);
          } catch {
            preservationFailures.push(preservationFailure(storedLocal, 'active'));
          }
        }
        if (
          asideRead.draft &&
          storedSetAside &&
          asideRead.draft.definition !== storedSetAside.definition
        ) {
          try {
            await preserveOriginal(storedSetAside);
            if (cancelled) return;
            await saveSetAsideDraft(asideRead.draft);
          } catch {
            preservationFailures.push(preservationFailure(storedSetAside, 'set-aside'));
          }
        }
        let failedToPreserveSetAside = false;
        if (asideRead.unconvertible && storedSetAside) {
          try {
            await preserveOriginal(storedSetAside);
            if (cancelled) return;
            await clearSetAsideDraft(loopId, storedSetAside);
            if (await loadSetAsideDraft(loopId))
              throw new Error('The set-aside key could not be cleared after archiving.');
            rawSetAside = [{ ...asideRead.unconvertible, source: 'archive' }];
          } catch {
            // Do not let a later conflict save replace an unverified original set-aside copy.
            failedToPreserveSetAside = true;
          }
        }
        if (cancelled) return;
        const notices = [
          ...(localRead.unconvertible
            ? [{ ...localRead.unconvertible, source: 'active' as const }]
            : []),
          ...rawSetAside,
          ...archivedCopies,
          ...preservationFailures,
        ];
        if (failedToPreserveSetAside || preservationFailures.length > 0) {
          setRawCopies(notices);
          setPreservationBlocked(true);
          setDeviceInspected(true);
          setDeviceWritable(true);
          setReady(true);
          return;
        }
        if (localRead.unconvertible) {
          let source: RawDeviceCopy['source'] = 'active';
          try {
            await preserveOriginal(storedLocal!);
            if (cancelled) return;
            await clearActiveLocalDraft(loopId, storedLocal);
            if (await loadLocalDraft(loopId))
              throw new Error('The active device copy could not be cleared after archiving.');
            source = 'archive';
          } catch {
            if (cancelled) return;
            setPreservationBlocked(true);
          }
          if (cancelled) return;
          setRawCopies([{ ...localRead.unconvertible, source }, ...rawSetAside, ...archivedCopies]);
        }
        if (!localRead.unconvertible) setRawCopies(notices);
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
            setRawCopies((copies) => [...copies, preservationFailure(local, 'active')]);
            setPreservationBlocked(true);
            setDeviceInspected(true);
            setDeviceWritable(true);
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
        if (archivedCopies.length || rawSetAside.length || localRead.unconvertible) setReady(true);
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
  }, [loopId, loadAttempt, showDevice]);

  useEffect(() => () => useEditorStore.getState().reset(), [loopId]);

  useEffect(() => {
    if (reconciled.current || conversionLoadFailed || preservationBlocked) return;
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
          setRawCopies((copies) => [...copies, preservationFailure(local, 'active')]);
          setPreservationBlocked(true);
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
        // remains old; converted copies retain their mandatory explicit-overwrite token.
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
    conversionLoadFailed,
    preservationBlocked,
    setAside,
  ]);

  const restoreSetAside = async () => {
    if (!setAside || setAside.migrationIssues?.length) return;
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
  const discardRawCopy = async (copy: RawDeviceCopy) => {
    setRecoveryError(undefined);
    try {
      if (copy.source === 'active') await clearActiveLocalDraft(loopId, copy);
      else if (copy.source === 'set-aside') await clearSetAsideDraft(loopId, copy);
      else await clearArchivedDraft(loopId, copy);
      if (!alive.current) return;
      const remaining = rawCopies.filter((item) => item !== copy);
      setRawCopies(remaining);
      if (!remaining.some((item) => item.source === 'active' || item.source === 'set-aside'))
        setPreservationBlocked(false);
    } catch {
      if (alive.current)
        setRecoveryError(
          'The original device copy could not be discarded. It is retained; retry when device storage is available.',
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
    rawCopies,
    recoveryError,
    preservationBlocked,
    conversionLoadFailed,
    retryConversion: () => {
      setConversionLoadFailed(false);
      setLoadAttempt((attempt) => attempt + 1);
    },
    restoreSetAside,
    discardSetAside,
    discardRawCopy,
  };
}
