import { GraphGoblinApiError, loops } from '@graphgoblin/api-client';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../api/context.js';
import { keys } from '../api/queries.js';
import { ErrorState } from '../components/status.js';
import { Alert, Button, useSidePanelState } from '../components/ui/index.js';
import { focusFallback } from '../lib/focus.js';
import { errorMessage, formatDateTime, isOfflineError, problemIssues } from '../lib/utils.js';
import { Canvas } from './Canvas.js';
import { ConflictNotice } from './ConflictNotice.js';
import { EditorToolbar, OpenInRuns } from './EditorToolbar.js';
import {
  fieldErrorIssues,
  issueKey,
  mergeIssues,
  validateDraft,
  type EditorIssue,
} from './model.js';
import { NodeEditorDialog } from './NodeEditorDialog.js';
import { LOOP_PANEL_STORAGE_KEY, LoopPanel, loopPanelDefault } from './LoopPanel.js';
import { PALETTE_STORAGE_KEY, Palette, palettePanelDefault } from './Palette.js';
import { useEditorStore } from './store.js';
import { useAutosave } from './useAutosave.js';
import { useLoadEditor } from './useLoadEditor.js';
import { useResolveConflict } from './useResolveConflict.js';
import { useUndoShortcuts } from './useUndoShortcuts.js';
import { ValidationIndicator } from './ValidationIndicator.js';

/**
 * The loop editor: the toolbar (with the validation indicator beside Publish), notices about the
 * draft (restored, set aside, conflicting, unsaved, published), the palette, the canvas (each node
 * with its issue badge), the collapsible loop panel (loop settings), and the node editor dialog for
 * the node opened on the canvas. Loading and conflict resolution live in useLoadEditor and
 * useResolveConflict. Runs start from Runs.
 */
export function EditorPage() {
  const { loopId = '' } = useParams();
  const client = useApi();
  const queryClient = useQueryClient();
  const { query, restoredGeneration, ready, setAside, restoreSetAside, discardSetAside } =
    useLoadEditor(loopId);
  const definition = useEditorStore((s) => s.definition);
  const saveState = useEditorStore((s) => s.saveState);
  const saveMessage = useEditorStore((s) => s.saveMessage);
  const generation = useEditorStore((s) => s.generation);
  const connectionError = useEditorStore((s) => s.connectionError);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const nodeDialogOpen = useEditorStore((s) => s.nodeDialogOpen);
  const nodeDialogSession = useEditorStore((s) => s.nodeDialogSession);
  const [panelExpanded, setPanelExpanded] = useSidePanelState(
    LOOP_PANEL_STORAGE_KEY,
    loopPanelDefault,
  );
  const [paletteExpanded, setPaletteExpanded] = useSidePanelState(
    PALETTE_STORAGE_KEY,
    palettePanelDefault,
  );
  const flush = useAutosave(client);
  useUndoShortcuts();
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
  const [dismissedRestoreGeneration, setDismissedRestoreGeneration] = useState<number>();
  const [dismissedSaveNotice, setDismissedSaveNotice] = useState<
    { generation: number; state: typeof saveState; message: string } | undefined
  >();
  const [dismissalAnnouncement, setDismissalAnnouncement] = useState(0);
  const noticeContainerRef = useRef<HTMLDivElement>(null);
  const saveStatusRef = useRef<HTMLSpanElement>(null);

  // Pending and saving are transient parts of an edit. Keep a dismissal until saving settles on
  // a different state/message or a new editor load starts.
  useEffect(
    () =>
      useEditorStore.subscribe((state) => {
        if (state.saveState === 'pending' || state.saveState === 'saving') return;
        setDismissedSaveNotice((dismissed) =>
          dismissed &&
          dismissed.generation === state.generation &&
          dismissed.state === state.saveState &&
          dismissed.message === state.saveMessage
            ? dismissed
            : undefined,
        );
      }),
    [],
  );

  if (!ready) {
    if (query.isError && !isOfflineError(query.error))
      return <ErrorState error={query.error} what="Loop" />;
    if (query.isError) return <ErrorState error={query.error} what="The editor" />;
    return <p className="p-page text-sm text-muted">Loading loop…</p>;
  }
  const def = definition as LoopDefinitionInput;
  const published = query.data?.current?.definition;
  const errors = validation.issues.filter((i) => i.severity === 'error').length;
  const editing = nodeDialogOpen ? def.nodes.find((n) => n.id === selectedNodeId) : undefined;
  const saveNoticeIsActive =
    Boolean(saveMessage) &&
    (saveState === 'offline' || saveState === 'error' || saveState === 'invalid');
  const showRestoredNotice =
    restoredGeneration === generation && dismissedRestoreGeneration !== generation;
  const showSaveNotice =
    saveNoticeIsActive &&
    (dismissedSaveNotice?.generation !== generation ||
      dismissedSaveNotice.state !== saveState ||
      dismissedSaveNotice.message !== saveMessage);
  const announceDismissalAndRestoreFocus = () => {
    setDismissalAnnouncement((count) => count + 1);
    window.requestAnimationFrame(() => {
      const nextDismissButton =
        noticeContainerRef.current?.querySelector<HTMLButtonElement>('[data-alert-dismiss]');
      if (nextDismissButton) nextDismissButton.focus();
      else focusFallback(saveStatusRef.current);
    });
  };

  const notices = [
    showRestoredNotice ? (
      <Alert
        key="restored"
        tone="info"
        onDismiss={() => {
          setDismissedRestoreGeneration(generation);
          announceDismissalAndRestoreFocus();
        }}
      >
        Restored unsaved changes from this device.
      </Alert>
    ) : null,
    setAside ? (
      <Alert key="set-aside" tone="warn" title="The server has a newer draft">
        This device has unsaved changes from {formatDateTime(setAside.savedAt)}, older than the
        draft saved on the server since, which is shown.{' '}
        <span className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void restoreSetAside()}>
            Use this device&apos;s copy instead
          </Button>
          <Button size="sm" variant="ghost" onClick={discardSetAside}>
            Discard it
          </Button>
        </span>
      </Alert>
    ) : null,
    conflict ? <ConflictNotice key="conflict" resolve={resolve} /> : null,
    showSaveNotice ? (
      <Alert
        key="save"
        tone="warn"
        onDismiss={() => {
          setDismissedSaveNotice({ generation, state: saveState, message: saveMessage ?? '' });
          announceDismissalAndRestoreFocus();
        }}
      >
        {saveMessage}
      </Alert>
    ) : null,
    publish.isSuccess && publishedRevision === revision ? (
      <Alert key="published" tone="good">
        <span className="flex flex-wrap items-center gap-x-3">
          {publish.data.version
            ? `Published version ${publish.data.version.version}.`
            : 'Nothing to publish: there are no changes since the published version.'}
          {/* The "run it" prompt: the same link as the toolbar's, to the New run flow. */}
          {publish.data.version ? <OpenInRuns loopId={loopId} published /> : null}
        </span>
      </Alert>
    ) : null,
    publish.isError ? (
      <Alert key="publish-failed" title="Publish failed">
        {errorMessage(publish.error)}
        <ul className="list-disc pl-4">
          {problemIssues(publish.error).map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      </Alert>
    ) : null,
    connectionError ? (
      <Alert key="connection" tone="warn">
        Connection refused: {connectionError}
      </Alert>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <EditorToolbar
        loopId={loopId}
        name={def.name}
        published={Boolean(published)}
        version={query.data?.current?.version}
        saveState={saveState}
        saveMessage={saveMessage}
        errors={errors}
        validation={
          <ValidationIndicator
            issues={validation.issues}
            definition={def}
            check={
              serverCheck.isError
                ? 'error'
                : serverCheck.isPending || serverCheck.isFetching
                  ? 'pending'
                  : 'done'
            }
          />
        }
        publishing={publish.isPending}
        onPublish={() => publish.mutate()}
        saveStatusRef={saveStatusRef}
      />
      {notices.length > 0 ? (
        <div
          ref={noticeContainerRef}
          className="grid shrink-0 gap-2 border-b border-default bg-surface-raised px-4 py-3"
        >
          {notices}
        </div>
      ) : null}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={dismissalAnnouncement}>
          {dismissalAnnouncement > 0 ? 'Notice dismissed' : ''}
        </span>
      </span>
      <ReactFlowProvider>
        <div className="flex min-h-0 flex-1">
          <Palette expanded={paletteExpanded} onExpandedChange={setPaletteExpanded} />
          <main className="min-w-0 flex-1">
            <Canvas definition={def} issues={validation.issues} />
          </main>
          <LoopPanel
            definition={def}
            issues={validation.issues}
            expanded={panelExpanded}
            onExpandedChange={setPanelExpanded}
          />
        </div>
      </ReactFlowProvider>
      {/* Outside the canvas, so keys pressed in the dialog never reach the canvas handlers. */}
      {editing ? (
        <NodeEditorDialog
          key={nodeDialogSession}
          node={editing}
          definition={def}
          issues={validation.issues}
          loopId={loopId}
          notice={conflict ? <ConflictNotice resolve={resolve} /> : null}
        />
      ) : null}
    </div>
  );
}
