import type { ChatSendInput, ChatTurn } from '@graphgoblin/contracts';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Icon } from '../components/icons/index.js';
import { GoblinMark } from '../components/icons/Logo.js';
import { PageHeader } from '../components/layout/index.js';
import { Alert, Button, ConfirmAction, Label, Select } from '../components/ui/index.js';
import { ChatApiError, type ChatClient } from './client.js';
import { ChatController, isActiveTurn } from './controller.js';
import { getChatUpdateLocked, setChatSubmissionUnresolved } from '../pwa/chat-update-guard.js';
import { AudioDraftUpload } from './audio-draft-upload.js';
import { ChatMarkdown, CopyReply } from './ChatMarkdown.js';
import {
  getConversationRecorder,
  moveConversationRecorder,
  type VoiceSegment,
} from './recorder.js';

export interface ChatSurfaceProps {
  client: ChatClient;
  storageKey: string;
  onAuthenticationError?: () => void;
  owner?: boolean;
  headerActions?: ReactNode;
  ownerSummary?: (systemLoopId: string) => ReactNode;
  onSetupVoice?: () => void;
  sessionRefreshKey?: number;
}
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const duration = (milliseconds: number) =>
  `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;
const nearBottom = () =>
  document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 120;
const caption = (input: ChatSendInput) => (input.kind === 'text' ? input.text : input.caption);
const terminalNotice = (turn: ChatTurn): string => {
  if (turn.error) return `The chat loop failed: ${turn.error.message}`;
  if (turn.runStatus === 'cancelled')
    return 'Cancelled. Anything the chat loop already did stays done.';
  if (turn.runStatus === 'exhausted') return 'The chat loop hit a limit before replying.';
  return 'The chat loop finished without a usable reply.';
};
function Turn({ turn, owner, retired }: { turn: ChatTurn; owner: boolean; retired: boolean }) {
  return (
    <li className="grid gap-5">
      <article className="ml-auto max-w-[min(85%,35rem)] rounded-xl rounded-br-sm border border-default bg-surface-raised px-3.5 py-2.5">
        <p className="text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere">
          <span className="sr-only">You: </span>
          {caption(turn.input) ?? 'Voice message'}
        </p>
        {turn.input.kind === 'audio' ? (
          <>
            {turn.input.caption ? <p className="mt-1 text-xs text-subtle">Voice message</p> : null}
            {turn.inputTranscript ? (
              <details className="mt-2 text-sm">
                <summary>Transcript</summary>
                <p className="mt-2 whitespace-pre-wrap">
                  {turn.input.kind === 'audio' &&
                  turn.input.caption &&
                  turn.inputTranscript.startsWith(`${turn.input.caption}\n\n`)
                    ? turn.inputTranscript.slice(turn.input.caption.length + 2)
                    : turn.inputTranscript}
                </p>
                {turn.voice?.route ? (
                  <p className="mt-2 font-mono text-xs text-subtle">
                    {turn.voice.route === 'local'
                      ? 'Transcribed on this gateway'
                      : `Transcribed by ${turn.voice.cloudProvider ?? 'the configured cloud provider'}`}
                  </p>
                ) : null}
              </details>
            ) : null}
          </>
        ) : null}
        <p className="mt-1 text-right font-mono text-xs text-subtle">
          <time dateTime={turn.createdAt}>{time(turn.createdAt)}</time>
        </p>
      </article>
      {turn.runStatus === 'succeeded' && turn.response && !turn.error ? (
        <article
          tabIndex={-1}
          data-chat-reply
          className="group max-w-[40rem] border-l-2 border-default pl-3.5"
        >
          <span className="sr-only">Reply: </span>
          <ChatMarkdown text={turn.response.reply} />
          <div className="mt-1 flex items-center gap-3">
            <CopyReply text={turn.response.reply} />
            <time
              dateTime={turn.createdAt}
              className="font-mono text-xs text-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {time(turn.createdAt)}
            </time>
            {owner ? (
              <a
                className="text-xs text-subtle"
                href={`/app/runs/${encodeURIComponent(turn.runId)}`}
              >
                Open run
              </a>
            ) : null}
          </div>
        </article>
      ) : isActiveTurn(turn) || retired ? null : (
        <div className="flex flex-wrap items-start gap-2 text-sm">
          <Icon name="alert" className="text-status-warn-fg" />
          <p>
            <span className="sr-only">Problem: </span>
            {terminalNotice(turn)}
            {owner ? (
              <>
                {' '}
                <a href={`/app/runs/${encodeURIComponent(turn.runId)}`}>Open run</a>
              </>
            ) : null}
          </p>
        </div>
      )}
      {turn.context && turn.context.omittedHistoryPairs > 0 ? (
        <p className="max-w-[40rem] text-xs text-subtle">
          {turn.context.omittedHistoryPairs} earlier{' '}
          {turn.context.omittedHistoryPairs === 1 ? 'pair' : 'pairs'} omitted from the recent
          context to fit this model.
        </p>
      ) : null}
    </li>
  );
}
function Segment({
  segment,
  index,
  disabled,
  onRemove,
}: {
  segment: VoiceSegment;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL?.(segment.blob), [segment.blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL?.(url);
    },
    [url],
  );
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-default bg-surface-raised px-2 py-1.5">
      <span className="text-xs whitespace-nowrap">
        Voice {index + 1} · {duration(segment.durationMs)}
      </span>
      {url ? (
        <audio
          controls
          preload="none"
          src={url}
          aria-label={`Play recording ${index + 1}`}
          className="h-8 w-40 max-w-full"
        />
      ) : null}
      <ConfirmAction
        name={`recording ${index + 1}`}
        accessibleName={`Remove recording ${index + 1}`}
        triggerLabel="Remove"
        disabled={disabled}
        consequences={<p>This removes only this recording from your voice draft.</p>}
        onConfirm={() => {
          onRemove();
          return Promise.resolve();
        }}
        returnFocusTo="chat-message"
      />
    </li>
  );
}
/** Shared owner/device experience; credentials and owner setup remain in the composition root. */
export function ChatSurface({
  client,
  storageKey,
  onAuthenticationError,
  owner = false,
  headerActions,
  ownerSummary,
  onSetupVoice,
  sessionRefreshKey,
}: ChatSurfaceProps) {
  const authRef = useRef(onAuthenticationError);
  authRef.current = onAuthenticationError;
  const controller = useMemo(
    () => new ChatController(client, storageKey, () => authRef.current?.()),
    [client, storageKey],
  );
  const followingRef = useRef(true);
  const forceFollowRef = useRef(false);
  const subscribe = useMemo(
    () => (listener: () => void) =>
      controller.subscribe(() => {
        // The DOM still contains the previous list at this point, before React grows it.
        followingRef.current = forceFollowRef.current || nearBottom();
        listener();
      }),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, controller.getSnapshot);
  const recorder = useMemo(() => {
    const key = `${storageKey}/${state.conversationId ?? 'new'}`;
    if (state.conversationId && state.sending) moveConversationRecorder(`${storageKey}/new`, key);
    return getConversationRecorder(key, state.session?.limits.maxAudioBytes ?? 10 * 1024 * 1024);
  }, [storageKey, state.conversationId, state.sending, state.session?.limits.maxAudioBytes]);
  const recording = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
  const uploadController = useMemo(
    () => new AudioDraftUpload(client, `${storageKey}.voice-upload`),
    [client, storageKey],
  );
  const uploadState = useSyncExternalStore(
    uploadController.subscribe,
    uploadController.getSnapshot,
  );
  useEffect(() => {
    if (uploadController.getSnapshot().saved) void uploadController.check();
  }, [uploadController]);
  const [audioError, setAudioError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [newReply, setNewReply] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const audioProblemRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const lastReplyRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const submittedRef = useRef<{ recorder: typeof recorder; requestId?: string } | undefined>(
    undefined,
  );
  const revealTail = () => endRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => {
    if (sessionRefreshKey !== undefined) void controller.refresh();
  }, [controller, sessionRefreshKey]);
  useEffect(
    () => () => {
      void recorder.stop().catch(() => undefined);
    },
    [recorder],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) void recorder.stop().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [recorder]);
  useEffect(() => {
    const scroll = () => {
      followingRef.current = nearBottom();
      if (followingRef.current) setNewReply(false);
    };
    const resize = () => {
      if (followingRef.current) revealTail();
    };
    window.addEventListener('scroll', scroll, { passive: true });
    window.visualViewport?.addEventListener('resize', resize);
    const element = composerRef.current;
    const measure = () => {
      if (element && endRef.current)
        endRef.current.style.scrollMarginBottom = `${element.getBoundingClientRect().height + 16}px`;
      if (followingRef.current) revealTail();
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (element) observer?.observe(element);
    measure();
    return () => {
      window.removeEventListener('scroll', scroll);
      window.visualViewport?.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    if (state.loading) return;
    const latest = state.turns
      .filter((turn) => turn.response && !turn.error && turn.runStatus === 'succeeded')
      .at(-1);
    if (!restoredRef.current || forceFollowRef.current || followingRef.current) {
      revealTail();
      setNewReply(false);
    } else if (latest && latest.id !== lastReplyRef.current) setNewReply(true);
    if (restoredRef.current && latest && latest.id !== lastReplyRef.current)
      setAnnouncement(`Reply: ${latest.response!.reply.slice(0, 300)}`);
    lastReplyRef.current = latest?.id;
    restoredRef.current = true;
    forceFollowRef.current = false;
  }, [state.turns, state.loading, state.pending]);
  useEffect(() => {
    const element = textareaRef.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [state.draft]);
  const activeTurn = state.turns.find(
    (turn) => isActiveTurn(turn) && !state.retiredRequestIds.includes(turn.requestId),
  );
  useEffect(() => {
    if (!activeTurn && recording.status !== 'recording') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeTurn, recording.status]);
  useEffect(() => {
    const frozen = submittedRef.current;
    const audioId = uploadController.getSnapshot().saved?.audio?.id;
    if (
      audioId &&
      state.turns.some((turn) => turn.input.kind === 'audio' && turn.input.audioId === audioId)
    ) {
      recorder.discard();
      uploadController.clear();
    }
    if (!frozen) return;
    const admitted = state.turns.find((turn) => turn.requestId === frozen.requestId);
    if (admitted) {
      frozen.recorder.discard();
      uploadController.clear();
      submittedRef.current = undefined;
      textareaRef.current?.focus();
    } else if (frozen.requestId && !state.pending && !state.sending) {
      frozen.recorder.thaw();
      submittedRef.current = undefined;
    }
  }, [state.turns, state.pending, state.sending, uploadController, recorder]);
  const resetConversationAnnouncement = () => {
    setAnnouncement('');
    setNewReply(false);
    restoredRef.current = false;
    lastReplyRef.current = undefined;
  };
  const newConversation = () => {
    const current = controller.getSnapshot();
    if (current.pending || current.sending || current.retryBlocked) return;
    resetConversationAnnouncement();
    void controller.newConversation();
  };
  const selectConversation = (conversationId: string) => {
    const current = controller.getSnapshot();
    if (current.pending || current.sending || current.retryBlocked) return;
    resetConversationAnnouncement();
    void controller.selectConversation(conversationId);
  };
  const captureBusy = ['requesting', 'recording', 'finalizing'].includes(recording.status);
  const uploadUncertain = ['checking', 'uncertain'].includes(uploadState.phase);
  const unresolved =
    Boolean(state.pending) || preparing || uploading || state.sending || uploadUncertain;
  const submissionUncertain = Boolean(state.pending && !state.sending) || uploadUncertain;
  const submissionStatus = submissionUncertain
    ? 'Checking what happened…'
    : preparing || uploading || state.sending
      ? 'Sending…'
      : undefined;
  const hasVoice =
    recording.segments.length > 0 || captureBusy || Boolean(uploadState.saved?.audio);
  const blocked = state.authenticationFailed
    ? owner
      ? 'Enter an API key to use Chat.'
      : 'This device needs to pair with the gateway again.'
    : !state.online
      ? 'You’re offline. Reconnect to send.'
      : submissionStatus
        ? submissionStatus
        : activeTurn
          ? 'Waiting for the current reply. Cancel it to send something else.'
          : !(hasVoice ? state.session?.readiness.audio.ready : state.session?.readiness.text.ready)
            ? ((hasVoice
                ? state.session?.readiness.audio.message
                : state.session?.readiness.text.message) ??
              (state.loading ? 'Checking Gateway chat…' : 'Chat isn’t ready yet.'))
            : undefined;
  const unavailableVoice = !state.session?.readiness.audio.ready;
  const voiceOff =
    state.session?.readiness.audio.code === 'CHAT_AUDIO_UNAVAILABLE' ||
    /normaliz|voice.*set up/i.test(state.session?.readiness.audio.message ?? '');
  const audioReason = unavailableVoice
    ? voiceOff
      ? owner
        ? 'Voice isn’t set up yet.'
        : 'Voice messages are off for this device. The gateway owner can set them up.'
      : (state.session?.readiness.audio.message ?? 'Checking voice availability…')
    : undefined;
  const canSend =
    !blocked &&
    uploadState.phase !== 'retired' &&
    recording.status !== 'requesting' &&
    !preparing &&
    Boolean(hasVoice || state.draft.trim());
  const send = async () => {
    if (!canSend || busyRef.current) return;
    if (getChatUpdateLocked()) {
      setAudioError('The app is updating. Try sending again in a moment.');
      return;
    }
    setPreparing(true);
    setChatSubmissionUnresolved(storageKey, true);
    busyRef.current = true;
    forceFollowRef.current = true;
    followingRef.current = true;
    setAudioError(undefined);
    try {
      if (hasVoice) {
        let upload = uploadState.saved?.audio;
        if (!upload) {
          const frozen = await recorder.freeze();
          if (!frozen) return;
          setUploading(true);
          upload = await uploadController.upload(frozen.blob, state.draft);
        }
        if (!upload) {
          recorder.thaw();
          return;
        }
        submittedRef.current = { recorder };
        await controller.send(
          {
            kind: 'audio',
            audioId: upload.id,
            ...(state.draft.trim() ? { caption: state.draft } : {}),
          },
          {
            ...(uploadController.getSnapshot().saved?.pending
              ? { prepared: uploadController.getSnapshot().saved!.pending! }
              : {}),
            onPrepared: uploadController.prepareRequest,
          },
        );
        const snapshot = controller.getSnapshot();
        const pendingId = snapshot.pending?.request.requestId;
        const admitted = snapshot.turns.find(
          (turn) => turn.input.kind === 'audio' && turn.input.audioId === upload.id,
        );
        if (admitted) {
          recorder.discard();
          uploadController.clear();
          submittedRef.current = undefined;
        } else if (pendingId) submittedRef.current = { recorder, requestId: pendingId };
        else {
          recorder.thaw();
          submittedRef.current = undefined;
        }
      } else await controller.send({ kind: 'text', text: state.draft });
      textareaRef.current?.focus();
      revealTail();
    } catch (error) {
      // No replay after ambiguous upload acknowledgement: the operation identity is recovered separately.
      if (error instanceof ChatApiError && error.status === 410)
        await controller.unavailable(error);
      recorder.thaw();
      setAudioError(
        error instanceof Error
          ? error.message
          : 'Couldn’t send this recording. Your draft is kept.',
      );
    } finally {
      busyRef.current = false;
      setPreparing(false);
      setUploading(false);
      setChatSubmissionUnresolved(storageKey, false);
    }
  };
  const invalidateUploadedDraft = () => {
    const audio = uploadController.getSnapshot().saved?.audio;
    if (audio) void client.discardAudio(audio.id).catch(() => undefined);
    uploadController.clear();
  };
  const serverOnlyVoice = Boolean(uploadState.saved?.audio) && !recording.segments.length;
  const serverOnlyReason =
    uploadState.phase === 'retired'
      ? 'Discard the expired upload before recording again.'
      : 'Send or discard the uploaded recording before recording more.';
  const toggleRecording = async () => {
    if (getChatUpdateLocked() && !captureBusy) {
      setAudioError('The app is updating. Try recording again in a moment.');
      return;
    }
    if (activeTurn || unresolved || recording.status === 'finalizing') return;
    if (uploadController.getSnapshot().saved?.audio && !recorder.getSnapshot().segments.length) {
      setAnnouncement(serverOnlyReason);
      return;
    }
    if (unavailableVoice) {
      if (owner && voiceOff && onSetupVoice) onSetupVoice();
      else setAnnouncement(audioReason ?? 'Voice is unavailable.');
      return;
    }
    setAudioError(undefined);
    if (captureBusy) await recorder.stop();
    else {
      invalidateUploadedDraft();
      recorder.thaw();
      await recorder.start();
    }
    textareaRef.current?.focus();
  };
  useEffect(() => {
    if (recording.error && recording.errorRecovery !== 'retry' && !audioError && !uploadState.error)
      return;
    if (audioError || recording.error || uploadState.error) {
      const element = audioProblemRef.current;
      (element?.querySelector<HTMLElement>('button') ?? element)?.focus();
    }
  }, [audioError, recording.error, recording.errorRecovery, uploadState.error]);
  const busyState = recording.status === 'finalizing' ? 'Finalizing recording…' : undefined;
  return (
    <section
      aria-label={owner ? 'Chat' : 'Goblin chat'}
      className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[calc(47.5rem+2*var(--space-page))] min-w-0 flex-col px-page pt-page"
    >
      {owner ? (
        <PageHeader
          title="Chat"
          titleId="chat-heading"
          actions={
            <>
              {headerActions}
              {state.turns.length || state.conversationId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(activeTurn) || unresolved || Boolean(uploadState.saved)}
                  onClick={newConversation}
                >
                  New chat
                </Button>
              ) : null}
            </>
          }
        />
      ) : headerActions ? (
        <div className="flex justify-end gap-2">{headerActions}</div>
      ) : null}
      {owner ? (
        <p className="mt-2 text-sm text-muted">
          {state.session?.systemLoopId ? (
            <>
              Answered by{' '}
              <a href={`/app/loops/${encodeURIComponent(state.session.systemLoopId)}/edit`}>
                Gateway chat
              </a>{' '}
              ·{' '}
              {ownerSummary ? (
                ownerSummary(state.session.systemLoopId)
              ) : (
                <a href={`/app/loops/${encodeURIComponent(state.session.systemLoopId)}/edit`}>
                  View model and workflow
                </a>
              )}
            </>
          ) : (
            'Checking Gateway chat…'
          )}
        </p>
      ) : null}
      <div className="mt-4 flex items-end gap-2">
        {state.conversations.length > 1 ||
        (state.conversations.length > 0 && !state.conversationId) ? (
          <>
            <Label htmlFor="chat-conversation" className="sr-only">
              Conversation
            </Label>
            <Select
              id="chat-conversation"
              value={state.conversationId ?? ''}
              disabled={unresolved || Boolean(uploadState.saved)}
              onChange={(event) => {
                selectConversation(event.target.value);
              }}
            >
              {!state.conversationId ? <option value="">New chat</option> : null}
              {state.conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title ?? 'Conversation'} ·{' '}
                  {new Date(conversation.createdAt).toLocaleDateString()}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {!owner && state.turns.length ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(activeTurn) || unresolved || Boolean(uploadState.saved)}
            onClick={newConversation}
          >
            New chat
          </Button>
        ) : null}
      </div>
      {!state.session && !state.loading ? (
        <p className="my-auto py-16 text-center text-sm text-muted">
          Your conversation loads when {owner ? 'GraphGoblin' : 'Goblin'} can reach the gateway.
        </p>
      ) : state.turns.length ? (
        <ol aria-label="Conversation" className="my-6 grid flex-1 content-start gap-5">
          {state.turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              owner={owner}
              retired={state.retiredRequestIds.includes(turn.requestId)}
            />
          ))}
        </ol>
      ) : (
        <div className="my-auto grid justify-items-center gap-3 py-16 text-center">
          <GoblinMark className="size-12" />
          <h2 className="text-xl font-semibold text-heading">What’s the move?</h2>
          {state.session?.readiness.text.ready ? (
            <p className="max-w-80 text-sm text-muted">
              {state.session.readiness.audio.ready
                ? 'Type it or say it. The goblin doesn’t bite. Much.'
                : 'Type it and send it. The goblin doesn’t bite. Much.'}
            </p>
          ) : null}
        </div>
      )}
      {state.pending ? (
        <div className="mb-5 grid gap-3">
          <article className="ml-auto max-w-[85%] rounded-xl rounded-br-sm border border-default bg-surface-raised px-3.5 py-2.5">
            <p className="whitespace-pre-wrap wrap-anywhere">
              {caption(state.pending.request.input) ?? 'Voice message'}
            </p>
          </article>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={state.sending || state.checking || !state.online}
              onClick={() => void controller.refresh()}
            >
              Check status
            </Button>
            {state.pendingChecked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  state.sending || !state.online || state.authenticationFailed || state.retryBlocked
                }
                onClick={() => void controller.retryPending()}
              >
                Retry same message
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {uploadState.phase !== 'idle' && !state.pending ? (
        <div className="mb-3 text-sm text-muted">
          {uploadState.phase === 'ready' ? (
            <p>Your recording reached the gateway. Press Send to submit this message.</p>
          ) : uploadState.error && uploadState.error !== 'Checking what happened…' ? (
            <p>{uploadState.error}</p>
          ) : null}
          {uploadUncertain ? (
            <Button
              size="sm"
              variant="outline"
              disabled={uploadState.phase === 'checking' || !state.online}
              onClick={() => void uploadController.check()}
            >
              Check upload status
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.recoveryNotice ? (
        <p className="mb-5 text-sm">
          <span className="sr-only">Problem: </span>
          {state.recoveryNotice}
        </p>
      ) : null}
      {state.error ? (
        <Alert title="Chat needs attention">
          {state.error}
          {state.pending ? null : state.retryBlocked ? (
            <Button variant="ghost" size="sm" onClick={() => void controller.refresh()}>
              Check status
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={!canSend} onClick={() => void send()}>
              Try again
            </Button>
          )}
        </Alert>
      ) : null}
      <div ref={endRef} data-chat-tail />
      <form
        ref={composerRef}
        className="sticky bottom-0 z-10 -mx-page bg-surface-app px-page pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {newReply ? (
          <Button
            size="sm"
            variant="outline"
            className="mx-auto mb-2 flex"
            onClick={() => {
              followingRef.current = true;
              revealTail();
              const replies = document.querySelectorAll<HTMLElement>('[data-chat-reply]');
              replies.item(replies.length - 1)?.focus({ preventScroll: true });
              setNewReply(false);
            }}
          >
            <Icon name="chevron" />
            New reply
          </Button>
        ) : null}
        {activeTurn ? (
          <div
            className="mb-2 flex flex-wrap items-center gap-3 text-sm text-muted"
            aria-busy="true"
          >
            <GoblinMark className="size-5 animate-pulse" />
            <span>
              {state.cancellingTurnId === activeTurn.id
                ? 'Cancelling'
                : activeTurn.runStatus === 'paused'
                  ? 'Paused on the gateway.'
                  : activeTurn.runStatus === 'waiting'
                    ? 'Waiting on the gateway.'
                    : activeTurn.runStatus === 'queued'
                      ? 'Queued'
                      : 'Working…'}{' '}
              <span className="font-mono">
                {duration(Math.max(0, clock - Date.parse(activeTurn.createdAt)))}
              </span>
            </span>
            {owner ? (
              <a href={`/app/runs/${encodeURIComponent(activeTurn.runId)}`}>Open run</a>
            ) : null}
            <ConfirmAction
              action="cancel-request"
              name="this request"
              accessibleName="Cancel request"
              disabled={state.cancellingTurnId === activeTurn.id}
              consequences={
                <p>Stops this request if it’s still running. Anything it already did stays done.</p>
              }
              onConfirm={async () => {
                await controller.cancel(activeTurn.id);
                const error = controller.getSnapshot().error;
                if (error) throw new Error(`Couldn’t cancel: ${error}`);
              }}
            />
          </div>
        ) : null}
        {blocked ? (
          <div
            id="chat-send-reason"
            className="mb-2 text-sm text-muted"
            role={submissionStatus ? 'status' : undefined}
          >
            {blocked}
            {!activeTurn && !unresolved && !state.authenticationFailed ? (
              <Button variant="ghost" size="sm" onClick={() => void controller.refresh()}>
                Check connection
              </Button>
            ) : null}
          </div>
        ) : null}
        {!recording.segments.length && uploadState.saved && !state.pending ? (
          <div className="mb-2 flex items-center gap-2 text-sm">
            <p>
              {uploadState.phase === 'retired'
                ? 'This uploaded recording expired.'
                : uploadState.saved.audio
                  ? 'Voice recording ready on the gateway.'
                  : 'The local recording is unavailable after this app reloaded.'}
            </p>
            <ConfirmAction
              name="voice draft"
              accessibleName="Discard voice"
              triggerLabel="Discard voice"
              disabled={unresolved || state.retryBlocked}
              consequences={<p>This forgets this voice draft. It does not submit a message.</p>}
              onConfirm={() => {
                invalidateUploadedDraft();
                return Promise.resolve();
              }}
              returnFocusTo="chat-message"
            />
          </div>
        ) : null}
        {recording.segments.length ? (
          <div className="mb-2 grid gap-2">
            <ol aria-label="Voice recordings" className="flex flex-wrap gap-2">
              {recording.segments.map((segment, index) => (
                <Segment
                  key={segment.id}
                  segment={segment}
                  index={index}
                  disabled={captureBusy || unresolved}
                  onRemove={() => {
                    recorder.thaw();
                    invalidateUploadedDraft();
                    recorder.removeSegment(segment.id);
                  }}
                />
              ))}
            </ol>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-subtle">
                {duration(recording.totalDurationMs)} / 2:00
              </span>
              <ConfirmAction
                name="voice draft"
                accessibleName="Discard voice"
                triggerLabel="Discard voice"
                disabled={captureBusy || unresolved}
                consequences={
                  <p>This removes all recordings in this draft. Your typed caption stays.</p>
                }
                onConfirm={async () => {
                  recorder.discard();
                  if (uploadState.saved?.audio)
                    await client.discardAudio(uploadState.saved.audio.id);
                  uploadController.clear();
                }}
                returnFocusTo="chat-message"
              />
            </div>
          </div>
        ) : null}
        <div className="flex items-end gap-1 rounded-2xl border border-strong bg-surface-field p-1 hover:border-field-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <label htmlFor="chat-message" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-message"
            ref={textareaRef}
            rows={1}
            enterKeyHint="send"
            maxLength={state.session?.limits.maxTextCharacters ?? 16_000}
            value={state.draft}
            placeholder="Tell the goblin…"
            className="min-h-11 max-h-[min(10rem,30dvh)] min-w-0 flex-1 resize-none bg-transparent px-2 py-[11px] text-lg leading-[22px] outline-none placeholder:text-subtle"
            onChange={(event) => controller.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && captureBusy) {
                event.preventDefault();
                void recorder
                  .stop()
                  .then(() => textareaRef.current?.focus())
                  .catch(() => undefined);
              }
              if (
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229 &&
                !event.shiftKey
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:opacity-45 ${recording.status === 'recording' ? 'animate-pulse bg-danger-subtle text-danger-on-subtle' : 'bg-transparent text-default hover:bg-surface-hover'}`}
            aria-disabled={
              Boolean(activeTurn) ||
              unresolved ||
              recording.status === 'finalizing' ||
              serverOnlyVoice ||
              (unavailableVoice && !(owner && voiceOff))
            }
            aria-pressed={recording.status === 'recording'}
            aria-label={
              captureBusy
                ? 'Stop recording'
                : recording.segments.length
                  ? 'Add more voice'
                  : 'Record voice message'
            }
            aria-describedby={
              activeTurn
                ? 'chat-send-reason'
                : serverOnlyVoice
                  ? 'chat-voice-draft-reason'
                  : audioReason
                    ? 'chat-audio-reason'
                    : undefined
            }
            onClick={() =>
              void toggleRecording().catch((error: unknown) =>
                setAudioError(
                  error instanceof Error ? error.message : 'Recording failed. Your draft is kept.',
                ),
              )
            }
          >
            <Icon name={captureBusy ? 'stop' : 'mic'} />
          </button>
          <button
            type="submit"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-accent-strong bg-accent text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:opacity-45"
            aria-label="Send message"
            aria-disabled={!canSend}
            aria-describedby={blocked ? 'chat-send-reason' : undefined}
          >
            <Icon name="send" />
          </button>
        </div>
        {serverOnlyVoice ? (
          <p id="chat-voice-draft-reason" className="mt-2 text-xs text-muted">
            {serverOnlyReason}
          </p>
        ) : null}
        {captureBusy || busyState ? (
          <p className="mt-2 text-sm text-muted" role="status">
            {busyState ??
              (recording.status === 'requesting'
                ? 'Opening microphone…'
                : `Recording ${duration(recording.totalDurationMs)} / 2:00`)}
          </p>
        ) : null}
        {audioReason ? (
          <p id="chat-audio-reason" className="mt-2 text-xs text-muted">
            {audioReason}
            {owner && voiceOff ? (
              <>
                {' '}
                <button type="button" className="underline" onClick={onSetupVoice}>
                  Set up voice
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {hasVoice && state.session?.voice ? (
          <p className="mt-2 text-xs text-muted">
            {state.session.voice.message}
            {state.session.voice.route === 'cloud'
              ? ' This sends your recording to the cloud provider; its billing applies.'
              : state.session.voice.cloudFallbackAllowed
                ? ' Cloud fallback is allowed by your gateway settings.'
                : null}
          </p>
        ) : null}
        {hasVoice &&
        !state.session?.voice &&
        state.session?.readiness.audio.ready &&
        state.session.readiness.audio.message ? (
          <p className="mt-2 text-xs text-muted">{state.session.readiness.audio.message}</p>
        ) : null}
        {owner && !unavailableVoice ? (
          <button
            type="button"
            className="mt-2 text-xs text-subtle underline"
            onClick={onSetupVoice}
          >
            Voice settings
          </button>
        ) : null}
        {recording.dirty ? (
          <p className="mt-2 text-xs text-subtle">
            Voice drafts stay in this open app; reloading or closing loses them.
          </p>
        ) : null}
        {audioError || recording.error || uploadState.error ? (
          <div
            ref={audioProblemRef}
            role="alert"
            tabIndex={-1}
            className="mt-2 text-sm text-status-bad-fg"
          >
            <p>{audioError ?? recording.error ?? uploadState.error}</p>
            {uploadState.phase === 'retired' && recording.segments.length ? (
              <ConfirmAction
                name="expired upload"
                accessibleName="Use kept recording"
                triggerLabel="Use kept recording"
                disabled={unresolved || state.retryBlocked}
                consequences={
                  <p>
                    This forgets the expired upload and keeps your local recording and caption. Your
                    next Send is a new message with a new upload. Nothing is submitted now.
                  </p>
                }
                onConfirm={() => {
                  const current = controller.getSnapshot();
                  if (current.pending || current.retryBlocked)
                    throw new Error(
                      'Check what happened to the previous message before replacing this upload.',
                    );
                  recorder.thaw();
                  invalidateUploadedDraft();
                  return Promise.resolve();
                }}
                returnFocusTo="chat-message"
              />
            ) : recording.error && recording.errorRecovery === 'retry' && !serverOnlyVoice ? (
              <Button size="sm" variant="ghost" onClick={() => void toggleRecording()}>
                Record again
              </Button>
            ) : canSend ? (
              <Button size="sm" variant="ghost" onClick={() => void send()}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
