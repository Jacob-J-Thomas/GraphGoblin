import { loops } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../api/context.js';
import { keys, useLoop } from '../api/queries.js';
import { ErrorState } from '../components/status.js';
import { Alert, Badge, Button } from '../components/ui.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { errorMessage, isOfflineError, problemIssues } from '../lib/utils.js';
import { Canvas } from './Canvas.js';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import { validateDraft } from './model.js';
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
};

/**
 * Loads the loop's draft (or published definition) into the editor store. An unsynced local draft
 * from IndexedDB wins, because it holds edits the server never received; offline, the local draft
 * alone keeps the editor usable.
 */
function useLoadEditor(loopId: string) {
  const query = useLoop(loopId);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const settled = query.isSuccess || query.isError;
  const dataRef = useRef(query.data);
  dataRef.current = query.data;

  useEffect(() => {
    // Load once per loop; later refetches (after publish, on focus) must not discard edits, so the
    // effect depends on `settled`, which stays true across refetches, not on the data itself.
    if (!settled) return;
    let cancelled = false;
    void loadLocalDraft(loopId).then((local) => {
      if (cancelled) return;
      const server = dataRef.current?.draft?.definition ?? dataRef.current?.current?.definition;
      if (local && !local.synced) {
        useEditorStore.getState().load(loopId, local.definition, { dirty: true });
        setRestored(true);
        setReady(true);
      } else if (server) {
        useEditorStore.getState().load(loopId, server);
        setReady(true);
      } else if (local) {
        useEditorStore.getState().load(loopId, local.definition);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loopId, settled]);

  useEffect(() => () => useEditorStore.getState().reset(), [loopId]);
  return { query, restored, ready };
}

export function EditorPage() {
  const { loopId = '' } = useParams();
  const client = useApi();
  const queryClient = useQueryClient();
  const { query, restored, ready } = useLoadEditor(loopId);
  const definition = useEditorStore((s) => s.definition);
  const saveState = useEditorStore((s) => s.saveState);
  const saveMessage = useEditorStore((s) => s.saveMessage);
  const connectionError = useEditorStore((s) => s.connectionError);
  const [tab, setTab] = useState<'node' | 'loop' | 'run'>('node');
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const flush = useAutosave(client);
  const validation = useMemo(
    () => (definition ? validateDraft(definition) : { issues: [], schemaValid: false }),
    [definition],
  );

  const publish = useMutation({
    mutationFn: async () => {
      const saved = await flush();
      if (!saved) throw new Error('The draft could not be saved; fix the issues below first.');
      return loops.publish(client, loopId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.loop(loopId) });
      void queryClient.invalidateQueries({ queryKey: keys.loops });
    },
  });

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
      {saveMessage &&
      (saveState === 'offline' || saveState === 'error' || saveState === 'invalid') ? (
        <Alert tone="warn">{saveMessage}</Alert>
      ) : null}
      {publish.isSuccess ? (
        <Alert tone="good">Published version {publish.data.version}.</Alert>
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
      <div className="flex min-h-0 flex-1">
        <aside className="w-36 shrink-0 border-r border-slate-200 bg-slate-50 p-2">
          <Palette />
        </aside>
        <main className="min-w-0 flex-1">
          <ReactFlowProvider>
            <Canvas definition={def} issues={validation.issues} />
          </ReactFlowProvider>
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
    </div>
  );
}
