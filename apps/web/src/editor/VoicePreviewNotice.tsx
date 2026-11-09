import { VoicePreviewSchema } from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../api/context.js';
import { keys } from '../api/queries.js';
import { Alert, Button } from '../components/ui/index.js';
import { voiceErrorMessage, voiceSetup } from '../settings/voice-client.js';
import { useEditorStore, type EditorState } from './store.js';
import { serializeSave } from './useAutosave.js';

function sameSnapshot(left: EditorState, right: EditorState): boolean {
  return (
    left.loopId === right.loopId &&
    left.definition === right.definition &&
    left.generation === right.generation &&
    left.revision === right.revision &&
    left.savedRevision === right.savedRevision &&
    left.baseToken === right.baseToken &&
    left.historyEpoch === right.historyEpoch &&
    left.fieldErrors === right.fieldErrors
  );
}

function cleanSnapshot(state: EditorState): boolean {
  return (
    state.revision === state.savedRevision &&
    !state.conflict &&
    !Object.values(state.fieldErrors).some((scope) => Object.keys(scope).length > 0)
  );
}

/** A route preview is read-only until the owner requests the backend's atomic stage operation. */
export function VoicePreviewNotice({
  value,
  loopId,
  ready,
  restored,
  onStagingChange,
  storageUnavailableReason,
  onRetryStorage,
  onApplied,
}: {
  value: unknown;
  loopId: string;
  ready: boolean;
  restored: boolean;
  onStagingChange: (staging: boolean) => void;
  storageUnavailableReason?: string | undefined;
  onRetryStorage?: (() => void) | undefined;
  onApplied?: (() => void) | undefined;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const parsed = useMemo(() => VoicePreviewSchema.safeParse(value), [value]);
  const state = useEditorStore();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (busyRef.current) onStagingChange(false);
    };
  }, [onStagingChange]);
  if (dismissed) return null;
  if (!parsed.success)
    return (
      <Alert tone="warn" title="Voice preview could not be opened">
        Return to Voice settings and create a new preview for this loop.
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss preview
        </Button>
      </Alert>
    );
  const preview = parsed.data;
  const blocked =
    stableHash(preview.definition) !== preview.previewHash
      ? 'This preview does not match its reviewed draft. Create a new voice preview from Voice settings.'
      : preview.loopId !== loopId || state.loopId !== loopId
        ? 'This preview belongs to another loop. Open Voice settings and choose this loop.'
        : !ready
          ? (storageUnavailableReason ??
            'Wait for the server and this device’s draft to finish loading.')
          : restored
            ? 'A restored device draft is open. Your work is kept; save or reconcile it, then create a new voice preview from Voice settings.'
            : !cleanSnapshot(state)
              ? 'Your draft has local changes or unfinished fields. Save or reconcile them, then create a new voice preview from Voice settings.'
              : !state.definition ||
                  state.baseToken !== preview.baseHash ||
                  stableHash(state.definition) !== preview.baseHash
                ? 'This draft changed after the preview. Your work is kept; create a new voice preview from Voice settings.'
                : undefined;
  const apply = async () => {
    if (busyRef.current || blocked || applied || !state.definition) return;
    const expected = useEditorStore.getState();
    const source = expected.definition;
    if (!source) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    onStagingChange(true);
    try {
      await serializeSave(loopId, async () => {
        const now = useEditorStore.getState();
        if (!aliveRef.current || !sameSnapshot(now, expected) || !cleanSnapshot(now))
          throw new Error('VOICE_EDITOR_CHANGED');
        const result = await voiceSetup.stage(client, {
          loopId,
          expectedDraftHash: preview.baseHash,
          expectedConfigRevision: preview.configRevision,
          expectedPreviewHash: preview.previewHash,
        });
        if (!aliveRef.current) return;
        if (result.loopId !== loopId || result.draftHash !== preview.previewHash) {
          setError(
            'The gateway returned a different staged draft. Your local work is kept. Reopen the loop to review its server draft.',
          );
          return;
        }
        const issue = useEditorStore
          .getState()
          .applyStagedVoicePreview(source, preview.definition, expected, result.draftHash);
        if (issue) {
          setError(issue);
          return;
        }
        setApplied(true);
        void queryClient.invalidateQueries({ queryKey: keys.loop(loopId) });
        void queryClient.invalidateQueries({ queryKey: keys.loops });
        onApplied?.();
      });
    } catch (cause) {
      if (aliveRef.current)
        setError(
          cause instanceof Error && cause.message === 'VOICE_EDITOR_CHANGED'
            ? 'The editor changed before applying. Your work is kept; create a new voice preview.'
            : voiceErrorMessage(cause),
        );
    } finally {
      busyRef.current = false;
      if (aliveRef.current) {
        setBusy(false);
        onStagingChange(false);
      }
    }
  };
  const normalizer = preview.definition.nodes.find((node) => node.id === 'chat-normalize');
  return (
    <Alert
      tone={applied ? 'good' : 'info'}
      title={applied ? 'Voice draft applied' : 'Review the voice draft'}
    >
      <div className="grid gap-3">
        <p>
          {applied
            ? 'Saved as a draft. Undo restores the previous draft. Publish when you are ready to use it.'
            : preview.message}
        </p>
        {!applied ? (
          <>
            <p className="text-sm">
              This preview changes only this loop. Applying saves a draft; publishing remains a
              separate action.
            </p>
            <details>
              <summary className="cursor-pointer font-semibold">Proposed voice step</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-xs">
                {JSON.stringify(normalizer ?? preview.definition, null, 2)}
              </pre>
            </details>
            <details>
              <summary className="cursor-pointer font-semibold">Full proposed draft</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-xs">
                {JSON.stringify(preview.definition, null, 2)}
              </pre>
            </details>
            {blocked ? (
              <p role="status" className="text-sm">
                {blocked}
              </p>
            ) : null}
            {!ready && storageUnavailableReason && onRetryStorage ? (
              <Button size="sm" variant="outline" onClick={onRetryStorage}>
                Retry device draft storage
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={Boolean(blocked) || busy}
              aria-busy={busy}
              onClick={() => void apply()}
            >
              {busy ? 'Applying voice draft…' : 'Apply reviewed voice draft'}
            </Button>
          </>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDismissed(true)}>
          Dismiss preview
        </Button>
      </div>
    </Alert>
  );
}

/** A custom normalizer is reviewed in place; the managed preset never replaces it. */
export function VoiceCustomReviewNotice({ loopId }: { loopId: string }) {
  const state = useEditorStore();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const normalizer =
    state.loopId === loopId && state.definition?.nodes.find((node) => node.id === 'chat-normalize');
  return (
    <Alert tone="info" title="Review this loop’s custom voice step">
      <div className="grid gap-3">
        <p>
          This loop has a custom normalizer. Review its existing step and how it handles typed text
          and recordings. Your authored steps and any local draft are kept; the managed voice preset
          cannot replace this step.
        </p>
        {normalizer ? (
          <Button size="sm" onClick={() => useEditorStore.getState().openNode('chat-normalize')}>
            Review existing normalizer
          </Button>
        ) : (
          <p>
            The current draft has no chat-normalize step. Use this loop’s voice controls to review
            its configuration.
          </p>
        )}
        <p className="text-sm">Changes follow the editor’s normal save and Publish actions.</p>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Dismiss review
        </Button>
      </div>
    </Alert>
  );
}
