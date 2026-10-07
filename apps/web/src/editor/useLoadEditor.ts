import { useEffect, useRef, useState } from 'react';
import { upgradeLoopV1, type UpgradeIssue } from '@graphgoblin/domain';
import { useLoop } from '../api/queries.js';
import {
  clearArchivedDraft,
  clearActiveLocalDraft,
  clearSetAsideDraft,
  loadArchivedDrafts,
  loadLocalDraft,
  loadSetAsideDraft,
  saveArchivedDraft,
  saveLocalDraft,
  saveSetAsideDraft,
  type LocalDraft,
} from '../drafts/local-drafts.js';
import { useEditorStore } from './store.js';

interface DeviceDraftRead {
  draft?: LocalDraft;
  unconvertible?: LocalDraft & { migrationIssues: UpgradeIssue[] };
}

export interface RawDeviceCopy extends LocalDraft {
  migrationIssues: UpgradeIssue[];
  source: 'active' | 'set-aside' | 'archive';
}

/** Convert only unambiguous v1 local copies; every other old shape stays untouched and inert. */
function readDeviceDraft(draft: LocalDraft | undefined): DeviceDraftRead {
  if (!draft) return {};
  const definition = draft.definition as unknown;
  const version =
    typeof definition === 'object' && definition !== null && !Array.isArray(definition)
      ? (definition as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version === 2) {
    const current = { ...draft };
    delete current.migrationIssues;
    return { draft: current };
  }
  if (version !== 1) {
    return {
      unconvertible: {
        ...draft,
        migrationIssues: [
          {
            code: 'UPGRADE_VERSION_UNSUPPORTED',
            path: '/schemaVersion',
            message: 'This device copy uses an unsupported loop format.',
          },
        ],
      },
    };
  }
  const result = upgradeLoopV1(definition);
  if (!result.ok) return { unconvertible: { ...draft, migrationIssues: result.issues } };
  const current = { ...draft };
  delete current.migrationIssues;
  return { draft: { ...current, definition: result.value } };
}

/**
 * Loads the loop's draft (or published definition) into the editor store. An unsynced local draft
 * from IndexedDB wins, because it holds edits the server never received; offline, the local draft
 * alone keeps the editor usable.
 */
export function useLoadEditor(loopId: string) {
  const query = useLoop(loopId);
  const [restoredGeneration, setRestoredGeneration] = useState<number>();
  const [setAside, setSetAside] = useState<LocalDraft | undefined>();
  const [rawCopies, setRawCopies] = useState<RawDeviceCopy[]>([]);
  const [preservationBlocked, setPreservationBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const dataRef = useRef(query.data);
  dataRef.current = query.data;

  useEffect(() => {
    // Load once per loop; later refetches (after publish, on focus) must not discard edits. A
    // failed fetch with no local copy (offline, or a 401 before an API key is entered) leaves the
    // editor unloaded, and the first successful fetch after it loads it.
    if (ready || !(query.isSuccess || query.isError)) return;
    let cancelled = false;
    void Promise.all([
      loadLocalDraft(loopId),
      loadSetAsideDraft(loopId),
      loadArchivedDrafts(loopId),
    ]).then(async ([storedLocal, storedSetAside, storedArchive]) => {
      if (cancelled) return;
      const localRead = readDeviceDraft(storedLocal);
      const asideRead = readDeviceDraft(storedSetAside);
      const local = localRead.draft;
      const earlierSetAside = asideRead.draft;
      let rawSetAside: RawDeviceCopy[] = asideRead.unconvertible
        ? [{ ...asideRead.unconvertible, source: 'set-aside' as const }]
        : [];
      const archivedCopies = storedArchive.map((draft) => {
        const read = readDeviceDraft(draft);
        return {
          ...(read.unconvertible ?? {
            ...draft,
            migrationIssues: [
              {
                code: 'UPGRADE_ARCHIVED_RAW_COPY',
                path: '/schemaVersion',
                message: 'This original device copy is retained without conversion.',
              },
            ],
          }),
          source: 'archive' as const,
        };
      });
      if (local && storedLocal && local.definition !== storedLocal.definition) {
        // Best effort: the pure conversion is already safe in memory, and keeping the old copy
        // on a storage failure lets the next load retry the same deterministic conversion.
        try {
          await saveLocalDraft(local);
        } catch {
          /* device storage reports the failure */
        }
      }
      if (
        asideRead.draft &&
        storedSetAside &&
        asideRead.draft.definition !== storedSetAside.definition
      ) {
        try {
          await saveSetAsideDraft(asideRead.draft);
        } catch {
          /* preserve the stored source */
        }
      }
      let failedToPreserveSetAside = false;
      if (asideRead.unconvertible && storedSetAside) {
        try {
          await saveArchivedDraft(storedSetAside);
          const savedArchive = await loadArchivedDrafts(loopId);
          const archived = savedArchive.some(
            (copy) =>
              copy.savedAt === storedSetAside.savedAt &&
              JSON.stringify(copy.definition) === JSON.stringify(storedSetAside.definition),
          );
          if (!archived)
            throw new Error('The original set-aside device copy could not be verified.');
          await clearSetAsideDraft(loopId);
          if (await loadSetAsideDraft(loopId))
            throw new Error('The set-aside key could not be cleared after archiving.');
          rawSetAside = [{ ...asideRead.unconvertible, source: 'archive' }];
        } catch {
          // Do not let a later conflict save replace an unverified original set-aside copy.
          failedToPreserveSetAside = true;
        }
      }
      const server = dataRef.current?.draft?.definition ?? dataRef.current?.current?.definition;
      const serverToken = dataRef.current?.draftToken;
      const serverUpdatedAt = dataRef.current?.loop.updatedAt;
      // The server changed after this device's unsynced copy was written (another tab or
      // device saved since): keep the newer server copy and set the local one aside, under its
      // own key so later edits of the server copy cannot overwrite it.
      const serverIsNewer =
        local && !local.synced && server && serverUpdatedAt && serverUpdatedAt > local.savedAt;
      if (failedToPreserveSetAside) {
        if (server) useEditorStore.getState().load(loopId, server, { baseToken: serverToken });
        setRawCopies([
          ...(localRead.unconvertible
            ? [{ ...localRead.unconvertible, source: 'active' as const }]
            : []),
          ...rawSetAside,
          ...archivedCopies,
        ]);
        setPreservationBlocked(true);
        setReady(true);
        return;
      }
      if (localRead.unconvertible) {
        // Never put an ambiguous v1 decision or an unknown version into the live editor store.
        // Archive and verify it before allowing the active autosave key to be reused. Never
        // replace an existing set-aside copy while doing this migration.
        let source: RawDeviceCopy['source'] = 'active';
        let failedToPreserve = false;
        try {
          await saveArchivedDraft(storedLocal!);
          const savedArchive = await loadArchivedDrafts(loopId);
          const archived = savedArchive.some(
            (copy) =>
              copy.savedAt === storedLocal!.savedAt &&
              JSON.stringify(copy.definition) === JSON.stringify(storedLocal!.definition),
          );
          if (!archived) throw new Error('The original device copy could not be verified.');
          await clearActiveLocalDraft(loopId);
          if (await loadLocalDraft(loopId))
            throw new Error('The active device copy could not be cleared after archiving.');
          source = 'archive';
        } catch {
          // Keep the active key untouched and block every edit/autosave path until recovery.
          failedToPreserve = true;
        }
        if (server) useEditorStore.getState().load(loopId, server, { baseToken: serverToken });
        setSetAside(earlierSetAside);
        setRawCopies([{ ...localRead.unconvertible, source }, ...rawSetAside, ...archivedCopies]);
        setPreservationBlocked(failedToPreserve);
        setReady(true);
        return;
      }
      if (local && !local.synced && !serverIsNewer) {
        // Saved later with the token it was based on: a server draft changed since then is
        // reported as a conflict rather than overwritten. Copies from before tokens existed
        // fall back to the server's current token.
        useEditorStore.getState().load(loopId, local.definition, {
          dirty: true,
          baseToken: local.baseToken ?? serverToken,
        });
        setRestoredGeneration(useEditorStore.getState().generation);
      } else if (server) {
        if (serverIsNewer) await saveSetAsideDraft(local);
        if (cancelled) return;
        useEditorStore.getState().load(loopId, server, { baseToken: serverToken });
      } else if (local) {
        useEditorStore.getState().load(loopId, local.definition, { baseToken: local.baseToken });
      } else if (archivedCopies.length > 0 || rawSetAside.length > 0) {
        setRawCopies([...archivedCopies, ...rawSetAside]);
        setReady(true);
        return;
      } else {
        return;
      }
      setSetAside(serverIsNewer ? local : earlierSetAside);
      setRawCopies([...archivedCopies, ...rawSetAside]);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loopId, ready, query.isSuccess, query.isError]);

  useEffect(() => () => useEditorStore.getState().reset(), [loopId]);
  const restoreSetAside = async () => {
    if (!setAside || setAside.migrationIssues?.length) return;
    const restoredCopy = setAside;
    const startedIn = useEditorStore.getState().generation;
    setSetAside(undefined);
    // Mirror the restored copy as this device's unsynced draft before its backup goes, so
    // leaving at any point afterwards still finds it on the next load.
    await saveLocalDraft({
      loopId,
      definition: restoredCopy.definition,
      savedAt: new Date().toISOString(),
      synced: false,
    });
    // Load it only into the editor that asked: after navigating away (the store was reset or
    // now holds another loop) the durable copy above is restored on the next visit instead.
    const now = useEditorStore.getState();
    if (now.loopId === loopId && now.generation === startedIn) {
      // Choosing this copy over the newer server draft is an explicit overwrite: base it on the
      // server draft shown now.
      now.load(loopId, restoredCopy.definition, { dirty: true, baseToken: now.baseToken });
      setRestoredGeneration(useEditorStore.getState().generation);
    }
    await clearSetAsideDraft(loopId);
  };
  const discardSetAside = () => {
    setSetAside(undefined);
    void clearSetAsideDraft(loopId);
  };
  const discardRawCopy = async (copy: RawDeviceCopy) => {
    if (copy.source === 'active') await clearActiveLocalDraft(loopId);
    else if (copy.source === 'set-aside') await clearSetAsideDraft(loopId);
    else await clearArchivedDraft(loopId, copy);
    const remaining = rawCopies.filter((item) => item !== copy);
    setRawCopies(remaining);
    if (!remaining.some((item) => item.source === 'active' || item.source === 'set-aside'))
      setPreservationBlocked(false);
  };
  return {
    query,
    restoredGeneration,
    ready,
    setAside,
    rawCopies,
    preservationBlocked,
    restoreSetAside,
    discardSetAside,
    discardRawCopy,
  };
}
