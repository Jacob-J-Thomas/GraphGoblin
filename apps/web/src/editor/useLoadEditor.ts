import { useEffect, useRef, useState } from 'react';
import { useLoop } from '../api/queries.js';
import {
  clearSetAsideDraft,
  loadLocalDraft,
  loadSetAsideDraft,
  saveLocalDraft,
  saveSetAsideDraft,
  type LocalDraft,
} from '../drafts/local-drafts.js';
import { useEditorStore } from './store.js';

/**
 * Loads the loop's draft (or published definition) into the editor store. An unsynced local draft
 * from IndexedDB wins, because it holds edits the server never received; offline, the local draft
 * alone keeps the editor usable.
 */
export function useLoadEditor(loopId: string) {
  const query = useLoop(loopId);
  const [restored, setRestored] = useState(false);
  const [setAside, setSetAside] = useState<LocalDraft | undefined>();
  const [ready, setReady] = useState(false);
  const dataRef = useRef(query.data);
  dataRef.current = query.data;

  useEffect(() => {
    // Load once per loop; later refetches (after publish, on focus) must not discard edits. A
    // failed fetch with no local copy (offline, or a 401 before an API key is entered) leaves the
    // editor unloaded, and the first successful fetch after it loads it.
    if (ready || !(query.isSuccess || query.isError)) return;
    let cancelled = false;
    void Promise.all([loadLocalDraft(loopId), loadSetAsideDraft(loopId)]).then(
      async ([local, earlierSetAside]) => {
        if (cancelled) return;
        const server = dataRef.current?.draft?.definition ?? dataRef.current?.current?.definition;
        const serverToken = dataRef.current?.draftToken;
        const serverUpdatedAt = dataRef.current?.loop.updatedAt;
        // The server changed after this device's unsynced copy was written (another tab or
        // device saved since): keep the newer server copy and set the local one aside, under its
        // own key so later edits of the server copy cannot overwrite it.
        const serverIsNewer =
          local && !local.synced && server && serverUpdatedAt && serverUpdatedAt > local.savedAt;
        if (local && !local.synced && !serverIsNewer) {
          // Saved later with the token it was based on: a server draft changed since then is
          // reported as a conflict rather than overwritten. Copies from before tokens existed
          // fall back to the server's current token.
          useEditorStore.getState().load(loopId, local.definition, {
            dirty: true,
            baseToken: local.baseToken ?? serverToken,
          });
          setRestored(true);
        } else if (server) {
          if (serverIsNewer) await saveSetAsideDraft(local);
          if (cancelled) return;
          useEditorStore.getState().load(loopId, server, { baseToken: serverToken });
        } else if (local) {
          useEditorStore.getState().load(loopId, local.definition, { baseToken: local.baseToken });
        } else {
          return;
        }
        setSetAside(serverIsNewer ? local : earlierSetAside);
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loopId, ready, query.isSuccess, query.isError]);

  useEffect(() => () => useEditorStore.getState().reset(), [loopId]);
  const restoreSetAside = async () => {
    if (!setAside) return;
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
      setRestored(true);
    }
    await clearSetAsideDraft(loopId);
  };
  const discardSetAside = () => {
    setSetAside(undefined);
    void clearSetAsideDraft(loopId);
  };
  return { query, restored, ready, setAside, restoreSetAside, discardSetAside };
}
