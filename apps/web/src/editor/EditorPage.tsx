import { GraphGoblinApiError, loops } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../api/context.js';
import { keys, useLoop } from '../api/queries.js';
import { ErrorState } from '../components/status.js';
import { Alert, Badge, Button } from '../components/ui.js';
import {
  clearSetAsideDraft,
  loadLocalDraft,
  loadSetAsideDraft,
  saveLocalDraft,
  saveSetAsideDraft,
  type LocalDraft,
} from '../drafts/local-drafts.js';
import { errorMessage, formatDateTime, isOfflineError, problemIssues } from '../lib/utils.js';
import { Canvas } from './Canvas.js';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import {
  fieldErrorIssues,
  issueKey,
  mergeIssues,
  validateDraft,
  type EditorIssue,
} from './model.js';
import { Palette } from './Palette.js';
import { PropertyPanel } from './PropertyPanel.js';
import { RunLauncher } from './RunLauncher.js';
import { useEditorStore, type SaveState } from './store.js';
import { useAutosave } from './useAutosave.js';
import { ValidationPanel } from './ValidationPanel.js';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'All changes saved',
  invalid: 'Saved on this device only',
  offline: 'Offline: saved on this device',
  error: 'Save failed',
  conflict: 'Draft changed elsewhere',
};

/**
 * Loads the loop's draft (or published definition) into the editor store. An unsynced local draft
 * from IndexedDB wins, because it holds edits the server never received; offline, the local draft
 * alone keeps the editor usable.
 */
function useLoadEditor(loopId: string) {
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

/**
 * The two ways out of a draft conflict (409 `DRAFT_CONFLICT`): load the server draft, dropping
 * this editor's unsaved changes, or save this copy over it. Neither happens without a click.
 */
function useResolveConflict(loopId: string, flush: () => Promise<boolean>) {
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
  const reload = () =>
    run(async () => {
      const detail = await loops.get(client, loopId);
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
      useEditorStore.getState().load(loopId, definition, { baseToken: detail.draftToken });
    });
  const overwrite = () =>
    run(async () => {
      const state = useEditorStore.getState();
      if (!state.conflict) return;
      let serverToken = state.conflict.serverToken;
      if (!serverToken) serverToken = (await loops.get(client, loopId)).draftToken;
      state.setBaseToken(serverToken);
      state.setConflict(undefined);
      state.setSaveState('pending');
      await flush();
    });
  return { busy, error, reload, overwrite };
}

export function EditorPage() {
  const { loopId = '' } = useParams();
  const client = useApi();
  const queryClient = useQueryClient();
  const { query, restored, ready, setAside, restoreSetAside, discardSetAside } =
    useLoadEditor(loopId);
  const definition = useEditorStore((s) => s.definition);
  const saveState = useEditorStore((s) => s.saveState);
  const saveMessage = useEditorStore((s) => s.saveMessage);
  const connectionError = useEditorStore((s) => s.connectionError);
  const [tab, setTab] = useState<'node' | 'loop' | 'run'>('node');
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const flush = useAutosave(client);
  const conflict = useEditorStore((s) => s.conflict);
  const resolve = useResolveConflict(loopId, flush);
  const savedRevision = useEditorStore((s) => s.savedRevision);
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  const local = useMemo(
    () => (definition ? validateDraft(definition) : { issues: [], schemaValid: false }),
    [definition],
  );
  // The API's own checks (cron syntax, subloop references) for the revision the server holds.
  const serverCheck = useQuery({
    queryKey: ['loops', loopId, 'validate', savedRevision],
    enabled: Boolean(definition) && local.schemaValid,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const checked = definition as LoopDefinitionInput;
      const result = await loops.validate(client, loopId, checked);
      const known = new Set(validateDraft(checked).issues.map(issueKey));
      return result.issues
        .map(({ nodeId, edgeId, ...rest }): EditorIssue => ({
          ...rest,
          ...(nodeId ? { nodeId } : {}),
          ...(edgeId ? { edgeId } : {}),
        }))
        .filter((issue) => !known.has(issueKey(issue)));
    },
  });
  const validation = useMemo(
    () => ({
      issues: mergeIssues(local, serverCheck.data, fieldErrorIssues(fieldErrors)),
    }),
    [local, serverCheck.data, fieldErrors],
  );

  const publish = useMutation({
    mutationFn: async () => {
      if (Object.keys(useEditorStore.getState().fieldErrors).length > 0)
        throw new Error('Some fields hold text that does not parse; fix them first.');
      const saved = await flush();
      if (!saved && useEditorStore.getState().conflict)
        throw new Error('The draft changed on the server; reload it or overwrite it first.');
      if (!saved) throw new Error('The draft could not be saved; fix the issues below first.');
      try {
        return { version: await loops.publish(client, loopId) };
      } catch (error) {
        // Nothing changed since the last publish: say so instead of reporting a failure.
        if (error instanceof GraphGoblinApiError && error.code === 'NO_DRAFT')
          return { version: undefined };
        throw error;
      }
    },
    onSuccess: () => {
      setPublishedRevision(useEditorStore.getState().revision);
      void queryClient.invalidateQueries({ queryKey: keys.loop(loopId) });
      void queryClient.invalidateQueries({ queryKey: keys.loops });
    },
  });
  const revision = useEditorStore((s) => s.revision);
  // The outcome stays visible only until the next edit; after that it describes an older draft.
  const [publishedRevision, setPublishedRevision] = useState<number | undefined>();

  if (!ready) {
    if (query.isError && !isOfflineError(query.error))
      return <ErrorState error={query.error} what="Loop" />;
    if (query.isError) return <ErrorState error={query.error} what="The editor" />;
    return <p className="p-4 text-sm text-slate-500">Loading loop…</p>;
  }
  const def = definition as LoopDefinitionInput;
  const published = query.data?.current?.definition;
  const errors = validation.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Link to="/loops" className="text-sm text-slate-500 hover:underline">
          Loops
        </Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-sm font-semibold">{def.name}</h1>
        {published ? (
          <Badge tone="good">published v{query.data?.current?.version}</Badge>
        ) : (
          <Badge>draft only</Badge>
        )}
        <span className="text-xs text-slate-600" data-testid="save-state" title={saveMessage}>
          {SAVE_LABEL[saveState]}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setTab('loop');
              setSettingsEpoch((e) => e + 1);
            }}
          >
            Loop settings
          </Button>
          <Button variant="outline" disabled={!published} onClick={() => setTab('run')}>
            Run
          </Button>
          <Button
            onClick={() => publish.mutate()}
            disabled={publish.isPending}
            title={errors > 0 ? `${errors} validation error(s) will block publishing` : undefined}
          >
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </header>
      {restored ? <Alert tone="info">Restored unsaved changes from this device.</Alert> : null}
      {setAside ? (
        <Alert tone="warn" title="The server has a newer draft">
          This device has unsaved changes from {formatDateTime(setAside.savedAt)}, older than the
          draft saved on the server since, which is shown.{' '}
          <Button size="sm" variant="outline" onClick={() => void restoreSetAside()}>
            Use this device&apos;s copy instead
          </Button>{' '}
          <Button size="sm" variant="ghost" onClick={discardSetAside}>
            Discard it
          </Button>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert tone="warn" title="The draft changed on the server">
          Another tab or device saved this loop&apos;s draft after this editor loaded it. Your
          changes are kept on this device and nothing was overwritten.{' '}
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.busy}
            onClick={() => void resolve.reload()}
          >
            Reload server draft
          </Button>{' '}
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.busy}
            onClick={() => void resolve.overwrite()}
          >
            Overwrite with this copy
          </Button>
          {resolve.error ? <span className="block">{resolve.error}</span> : null}
        </Alert>
      ) : null}
      {saveMessage &&
      (saveState === 'offline' || saveState === 'error' || saveState === 'invalid') ? (
        <Alert tone="warn">{saveMessage}</Alert>
      ) : null}
      {publish.isSuccess && publishedRevision === revision ? (
        <Alert tone="good">
          {publish.data.version
            ? `Published version ${publish.data.version.version}.`
            : 'Nothing to publish: there are no changes since the published version.'}
        </Alert>
      ) : null}
      {publish.isError ? (
        <Alert title="Publish failed">
          {errorMessage(publish.error)}
          <ul className="list-disc pl-4">
            {problemIssues(publish.error).map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {connectionError ? <Alert tone="warn">Connection refused: {connectionError}</Alert> : null}
      <ReactFlowProvider>
        <div className="flex min-h-0 flex-1">
          <aside className="w-36 shrink-0 border-r border-slate-200 bg-slate-50 p-2">
            <Palette />
          </aside>
          <main className="min-w-0 flex-1">
            <Canvas definition={def} issues={validation.issues} />
          </main>
          <aside className="w-96 shrink-0 overflow-auto border-l border-slate-200 bg-white p-3">
            <div className="mb-2 flex gap-1" role="tablist" aria-label="Panels">
              {(['node', 'loop', 'run'] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  role="tab"
                  aria-selected={tab === t}
                  variant={tab === t ? 'secondary' : 'ghost'}
                  onClick={() => setTab(t)}
                >
                  {t === 'node' ? 'Node' : t === 'loop' ? 'Loop' : 'Run'}
                </Button>
              ))}
            </div>
            {tab === 'node' ? (
              <PropertyPanel definition={def} issues={validation.issues} loopId={loopId} />
            ) : null}
            {tab === 'loop' ? <LoopSettingsPanel definition={def} epoch={settingsEpoch} /> : null}
            {tab === 'run' ? (
              published ? (
                <RunLauncher loopId={loopId} published={published} />
              ) : (
                <p className="text-sm text-slate-500">Publish the loop to run it.</p>
              )
            ) : null}
            <hr className="my-3" />
            <ValidationPanel issues={validation.issues} />
          </aside>
        </div>
      </ReactFlowProvider>
    </div>
  );
}
