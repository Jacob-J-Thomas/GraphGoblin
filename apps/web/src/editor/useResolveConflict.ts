import { loops } from '@graphgoblin/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../api/context.js';
import { keys } from '../api/queries.js';
import { saveLocalDraft } from '../drafts/local-drafts.js';
import { errorMessage } from '../lib/utils.js';
import { useEditorStore } from './store.js';

/**
 * The two ways out of a draft conflict (409 `DRAFT_CONFLICT`): load the server draft, dropping
 * this editor's unsaved changes, or save this copy over it. Neither happens without a click.
 */
export function useResolveConflict(loopId: string, flush: () => Promise<boolean>) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await job();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  /**
   * The editor that asked: the same loop in the same load generation. Every step after an await
   * re-checks it, so a slow answer for loop A never lands in the editor of loop B (or in a newer
   * load of A).
   */
  const askedBy = () => {
    const { loopId: current, generation } = useEditorStore.getState();
    return () => {
      const now = useEditorStore.getState();
      return current === loopId && now.loopId === loopId && now.generation === generation;
    };
  };
  const reload = () =>
    run(async () => {
      const stillAsking = askedBy();
      const detail = await loops.get(client, loopId);
      if (!stillAsking()) return;
      const definition = detail.draft?.definition ?? detail.current?.definition;
      if (!definition) throw new Error('The server has no draft or published version to load.');
      queryClient.setQueryData(keys.loop(loopId), detail);
      await saveLocalDraft({
        loopId,
        definition,
        savedAt: new Date().toISOString(),
        synced: true,
        ...(detail.draftToken ? { baseToken: detail.draftToken } : {}),
      });
      if (!stillAsking()) return;
      useEditorStore.getState().load(loopId, definition, { baseToken: detail.draftToken });
    });
  const overwrite = () =>
    run(async () => {
      const stillAsking = askedBy();
      if (!stillAsking() || !useEditorStore.getState().conflict) return;
      let serverToken = useEditorStore.getState().conflict?.serverToken;
      if (!serverToken) {
        serverToken = (await loops.get(client, loopId)).draftToken;
        if (!stillAsking()) return;
      }
      const state = useEditorStore.getState();
      state.setBaseToken(serverToken);
      state.setConflict(undefined);
      state.setSaveState('pending');
      await flush();
    });
  return { busy, error, reload, overwrite };
}
