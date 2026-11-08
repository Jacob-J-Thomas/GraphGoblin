import type { ChatTurn } from '@graphgoblin/contracts';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '../components/icons/index.js';
import { GoblinMark } from '../components/icons/Logo.js';
import { PageHeader } from '../components/layout/index.js';
import { Alert, Button, ConfirmAction, Label, Select } from '../components/ui/index.js';
import { ChatApiError, type ChatClient } from './client.js';
import { ChatController, isActiveTurn } from './controller.js';
import { ChatRecorder, recordingAvailable, supportedChatAudioType } from './recorder.js';

export interface ChatSurfaceProps {
  client: ChatClient;
  storageKey: string;
  onAuthenticationError?: () => void;
  owner?: boolean;
  headerActions?: ReactNode;
}
const time = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const terminalNotice = (turn: ChatTurn): string => {
  if (turn.error) return `The chat loop failed: ${turn.error.message}`;
  if (turn.runStatus === 'cancelled')
    return 'Cancelled. Anything the chat loop already did stays done.';
  if (turn.runStatus === 'exhausted') return 'The chat loop hit a limit before replying.';
  return 'The chat loop finished without a usable reply.';
};
function Turn({
  turn,
  owner,
  cancelling,
  retired,
  onCancel,
}: {
  turn: ChatTurn;
  owner: boolean;
  cancelling: boolean;
  retired: boolean;
  onCancel: () => Promise<void>;
}) {
  const active = isActiveTurn(turn) && !retired;
  return (
    <li className="grid gap-5">
      <article className="ml-auto max-w-[min(85%,35rem)] rounded-xl rounded-br-sm border border-default bg-surface-raised px-3.5 py-2.5">
        <p className="text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere">
          <span className="sr-only">You: </span>
          {turn.input.kind === 'text' ? turn.input.text : (turn.inputTranscript ?? 'Voice message')}
        </p>
        <p className="mt-1 text-right font-mono text-xs text-subtle">
          <time dateTime={turn.createdAt}>{time(turn.createdAt)}</time>
        </p>
        {turn.inputTranscript ? (
          <p className="mt-1 font-mono text-xs text-subtle">Transcript</p>
        ) : null}
      </article>
      {turn.runStatus === 'succeeded' && turn.response && !turn.error ? (
        <article
          tabIndex={-1}
          data-chat-reply
          className="max-w-[40rem] border-l-2 border-default pl-3.5"
        >
          <p className="text-[15px] leading-normal whitespace-pre-wrap wrap-anywhere">
            <span className="sr-only">Reply: </span>
            {turn.response.reply}
          </p>
          <p className="mt-1 font-mono text-xs text-subtle">
            {owner ? <a href={`/app/runs/${encodeURIComponent(turn.runId)}`}>Open run</a> : null}
          </p>
        </article>
      ) : active ? (
        <div className="max-w-[40rem] border-l-2 border-accent-strong pl-3.5" aria-busy="true">
          <p className="text-sm text-muted">
            <span className="animate-ellipsis">
              {cancelling
                ? 'Cancelling'
                : turn.runStatus === 'queued'
                  ? 'Queued'
                  : turn.runStatus === 'paused'
                    ? owner
                      ? 'Paused. Open the run for details.'
                      : 'Paused on the gateway.'
                    : turn.runStatus === 'waiting'
                      ? owner
                        ? 'Waiting. Open the run to see what it needs.'
                        : 'Waiting on the gateway. Ask its owner if this doesn’t move.'
                      : 'Working'}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {owner ? (
              <a className="text-sm" href={`/app/runs/${encodeURIComponent(turn.runId)}`}>
                Open run
              </a>
            ) : null}
            <ConfirmAction
              action="cancel-request"
              disabled={cancelling}
              name="this request"
              accessibleName="Cancel request"
              consequences={
                <p>Stops this request if it’s still running. Anything it already did stays done.</p>
              }
              onConfirm={onCancel}
            />
          </div>
        </div>
      ) : retired ? null : (
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
    </li>
  );
}

/** Shared by the owner shell and Goblin. Credentials and management navigation are explicit props. */
export function ChatSurface({
  client,
  storageKey,
  onAuthenticationError,
  owner = false,
  headerActions,
}: ChatSurfaceProps) {
  const authRef = useRef(onAuthenticationError);
  authRef.current = onAuthenticationError;
  const controller = useMemo(
    () => new ChatController(client, storageKey, () => authRef.current?.()),
    [client, storageKey],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const recorder = useMemo(
    () => new ChatRecorder(state.session?.limits.maxAudioBytes ?? 10 * 1024 * 1024),
    [state.session?.limits.maxAudioBytes],
  );
  const recording = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
  const [fileAttachment, setFileAttachment] = useState<Blob>();
  const attachment = fileAttachment ?? recording.blob;
  const [elapsed, setElapsed] = useState(0);
  const [attachmentName, setAttachmentName] = useState('Voice message');
  const [audioError, setAudioError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [newReply, setNewReply] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const lastReplyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const focused = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocusedRef.current = event.target;
    };
    document.addEventListener('focusin', focused);
    return () => document.removeEventListener('focusin', focused);
  }, []);
  useEffect(() => {
    if (!state.recoveryNotice) return;
    // An external controller event invalidates this local media and announces its disposition.
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFileAttachment(undefined);
    recorder.cancel();
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAudioError(undefined);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAnnouncement(`Problem: ${state.recoveryNotice}`);
    if (lastFocusedRef.current && !lastFocusedRef.current.isConnected) textareaRef.current?.focus();
  }, [state.recoveryNotice, recorder]);
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => () => recorder.cancel(), [recorder]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) recorder.stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [recorder]);
  useEffect(() => {
    if (recording.status !== 'recording') return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording.status]);
  useEffect(() => {
    const element = textareaRef.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [state.draft]);
  useEffect(() => {
    if (state.loading) return;
    const latest = state.turns
      .filter((turn) => turn.response && !turn.error && turn.runStatus === 'succeeded')
      .at(-1);
    const nearBottom =
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 120;
    if (!restoredRef.current || nearBottom)
      endRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    else if (latest?.id !== lastReplyRef.current) setNewReply(true);
    if (restoredRef.current && latest && latest.id !== lastReplyRef.current)
      setAnnouncement(`Reply: ${latest.response!.reply.slice(0, 300)}`);
    lastReplyRef.current = latest?.id;
    restoredRef.current = true;
  }, [state.turns, state.loading]);
  const active = state.turns.some(
    (turn) => isActiveTurn(turn) && !state.retiredRequestIds.includes(turn.requestId),
  );
  const recordingBusy = recording.status === 'recording' || recording.status === 'requesting';
  const reason = state.authenticationFailed
    ? 'This chat needs authorization. Pair again or check your gateway access.'
    : !state.online
      ? 'You’re offline. Reconnect to send.'
      : !(attachment ? state.session?.readiness.audio.ready : state.session?.readiness.text.ready)
        ? ((attachment
            ? state.session?.readiness.audio.message
            : state.session?.readiness.text.message) ??
          (state.loading ? 'Checking Gateway chat…' : 'Chat isn’t ready yet.'))
        : state.pending || active || state.sending
          ? 'Wait for this request to finish, or cancel it.'
          : recordingBusy
            ? 'Stop recording first.'
            : uploading
              ? 'Uploading audio…'
              : undefined;
  const audioReason = state.session?.readiness.audio.ready
    ? undefined
    : (state.session?.readiness.audio.message ??
      'Audio is unavailable until a normalizer is configured in the chat loop.');
  const deviceAudioOff = !owner && state.session?.readiness.audio.code === 'CHAT_AUDIO_UNAVAILABLE';
  const deviceAudioOffMessage =
    'Voice messages are off for this device. The gateway owner can set them up.';
  const announceAudioUnavailable = () => {
    if (deviceAudioOff) setAnnouncement(deviceAudioOffMessage);
    else setAudioError(`Voice messages aren’t available here. ${audioReason}`);
  };
  const canSend = !reason && Boolean(attachment || state.draft.trim());
  const send = async () => {
    if (!canSend) return;
    setAudioError(undefined);
    if (attachment) {
      setUploading(true);
      let audioId: string | undefined;
      try {
        const upload = await client.upload(attachment);
        audioId = upload.id;
        await controller.send({ kind: 'audio', audioId });
        if (!controller.getSnapshot().pending) {
          setFileAttachment(undefined);
          recorder.cancel();
        }
      } catch (error) {
        if (
          error instanceof ChatApiError &&
          error.status === 410 &&
          ['CHAT_HISTORY_DELETED', 'CHAT_AUDIO_EXPIRED'].includes(error.code)
        )
          await controller.unavailable(error);
        else
          setAudioError(
            error instanceof ChatApiError
              ? error.message
              : 'Audio could not be uploaded. Check the connection and try again.',
          );
      } finally {
        // Discard only a definite unsent upload. Unknown acknowledgement keeps it for same-ID recovery.
        if (
          audioId &&
          !controller.getSnapshot().recoveryNotice &&
          !controller.getSnapshot().pending &&
          !controller
            .getSnapshot()
            .turns.some((turn) => turn.input.kind === 'audio' && turn.input.audioId === audioId)
        )
          void client.discardAudio(audioId).catch(() => undefined);
        setUploading(false);
      }
    } else await controller.send({ kind: 'text', text: state.draft });
    textareaRef.current?.focus();
  };
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
              {state.turns.length ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={active || Boolean(state.pending) || state.sending}
                  onClick={() => void controller.newConversation()}
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
              </a>
            </>
          ) : (
            'Checking Gateway chat…'
          )}
        </p>
      ) : null}
      <div className="mt-4 flex items-end gap-2">
        {state.conversations.length > 1 ? (
          <>
            <Label htmlFor="chat-conversation" className="sr-only">
              Conversation
            </Label>
            <Select
              id="chat-conversation"
              value={state.conversationId ?? ''}
              disabled={Boolean(state.pending) || state.sending}
              onChange={(event) => void controller.selectConversation(event.target.value)}
            >
              {state.conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {new Date(conversation.createdAt).toLocaleString()}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {!owner && state.turns.length ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={active || Boolean(state.pending)}
            onClick={() => void controller.newConversation()}
          >
            New chat
          </Button>
        ) : null}
      </div>
      {!state.session && !state.loading ? (
        <p className="my-auto py-16 text-center text-sm text-muted">
          Your conversation loads when Goblin can reach the gateway.
        </p>
      ) : state.turns.length ? (
        <ol aria-label="Conversation" className="my-6 grid flex-1 content-start gap-5">
          {state.turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              owner={owner}
              cancelling={state.cancellingTurnId === turn.id}
              retired={state.retiredRequestIds.includes(turn.requestId)}
              onCancel={async () => {
                await controller.cancel(turn.id);
                const error = controller.getSnapshot().error;
                if (error) throw new Error(`Couldn’t cancel: ${error}`);
              }}
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
                ? 'Type it, say it, or attach a voice memo. The goblin doesn’t bite. Much.'
                : 'Type it and send it. The goblin doesn’t bite. Much.'}
            </p>
          ) : null}
        </div>
      )}
      {state.pending ? (
        <div className="mb-5 grid gap-3">
          <article className="ml-auto max-w-[85%] rounded-xl rounded-br-sm border border-default bg-surface-raised px-3.5 py-2.5">
            <p className="whitespace-pre-wrap wrap-anywhere">
              {state.pending.request.input.kind === 'text'
                ? state.pending.request.input.text
                : 'Voice message'}
            </p>
            <p className="font-mono text-xs text-subtle">
              {state.sending ? 'Sending…' : 'Acknowledgement unknown'}
            </p>
          </article>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={state.sending || !state.online}
              onClick={() => void controller.refresh()}
            >
              Check status
            </Button>
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
          </div>
        </div>
      ) : null}
      {state.recoveryNotice ? (
        <div className="mb-5 flex items-start gap-2 text-sm">
          <Icon name="alert" className="text-status-warn-fg" />
          <p>
            <span className="sr-only">Problem: </span>
            {state.recoveryNotice}
          </p>
        </div>
      ) : null}
      {state.error ? (
        <Alert title="Chat needs attention">
          {state.error}
          <Button variant="ghost" size="sm" onClick={() => void controller.refresh()}>
            Retry now
          </Button>
        </Alert>
      ) : null}
      <div ref={endRef} />
      <form
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
              endRef.current?.scrollIntoView();
              document.querySelector<HTMLElement>('[data-chat-reply]:last-of-type')?.focus();
              setNewReply(false);
            }}
          >
            <Icon name="chevron" />
            New reply
          </Button>
        ) : null}
        {reason ? (
          <div id="chat-send-reason" className="mb-2">
            <Alert tone="warn" className="py-2">
              {reason}
            </Alert>
          </div>
        ) : null}
        {attachment ? (
          <div className="mb-2 flex items-center gap-2 text-sm">
            <Icon name="mic" />
            <span className="min-w-0 wrap-anywhere">
              {attachmentName} · {(attachment.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove audio"
              onClick={() => {
                setFileAttachment(undefined);
                recorder.cancel();
                textareaRef.current?.focus();
              }}
            >
              <Icon name="close" />
            </Button>
          </div>
        ) : null}
        <div className="flex items-end gap-0.5 rounded-2xl border border-strong bg-surface-field p-1 hover:border-field-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/webm,video/mp4"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (!chosen) return;
              if (!supportedChatAudioType(chosen.type)) {
                setAudioError(
                  'That file isn’t a supported audio type. Try WebM, MP4, MP3, WAV, Ogg or FLAC.',
                );
                return;
              }
              if (!chosen.size || chosen.size > (state.session?.limits.maxAudioBytes ?? 0)) {
                setAudioError('That file is empty or too big. Audio must be 10 MiB or smaller.');
                return;
              }
              setFileAttachment(chosen);
              setAttachmentName(chosen.name);
              setAudioError(undefined);
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 rounded-full"
            aria-disabled={
              Boolean(audioReason) || recordingBusy || uploading || Boolean(state.pending) || active
            }
            aria-label="Attach audio"
            aria-describedby={audioReason ? 'chat-audio-reason' : undefined}
            title={audioReason}
            onClick={() => {
              if (audioReason) {
                announceAudioUnavailable();
                return;
              }
              if (!recordingBusy && !uploading && !state.pending && !active)
                fileRef.current?.click();
            }}
          >
            <Icon name="attach" />
          </Button>
          <label htmlFor="chat-message" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-message"
            ref={textareaRef}
            rows={1}
            maxLength={state.session?.limits.maxTextCharacters ?? 16_000}
            value={state.draft}
            disabled={Boolean(attachment)}
            placeholder={
              attachment ? 'Voice message ready. Send it or remove it.' : 'Tell the goblin…'
            }
            className="min-h-11 max-h-[min(10rem,30dvh)] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[11px] text-lg leading-[22px] outline-none placeholder:text-subtle"
            onChange={(event) => controller.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              if (
                event.ctrlKey ||
                event.metaKey ||
                (!event.shiftKey && !window.matchMedia?.('(pointer: coarse)').matches)
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`size-11 rounded-full ${recording.status === 'recording' ? 'bg-danger-subtle text-danger-on-subtle' : ''}`}
            aria-disabled={
              Boolean(audioReason) ||
              Boolean(attachment) ||
              uploading ||
              Boolean(state.pending) ||
              active
            }
            aria-pressed={recording.status === 'recording'}
            aria-label={recordingBusy ? 'Stop recording' : 'Record voice message'}
            aria-describedby={audioReason ? 'chat-audio-reason' : undefined}
            title={
              audioReason ??
              (!recordingAvailable()
                ? 'This browser can’t record. Attach an audio file instead.'
                : undefined)
            }
            onClick={() => {
              if (audioReason) {
                announceAudioUnavailable();
                return;
              }
              if (attachment || uploading || state.pending || active) return;
              if (recordingBusy) {
                recorder.stop();
                sendRef.current?.focus();
              } else {
                setElapsed(0);
                setAttachmentName('Voice message');
                void recorder.start();
              }
            }}
          >
            <Icon name={recording.status === 'recording' ? 'stop' : 'mic'} />
          </Button>
          <Button
            ref={sendRef}
            type="submit"
            size="icon"
            className="size-11 rounded-full"
            aria-label="Send message"
            aria-disabled={!canSend}
            aria-describedby={reason ? 'chat-send-reason' : undefined}
          >
            <Icon name="send" />
          </Button>
        </div>
        {recordingBusy ? (
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <span className="font-mono">
              {recording.status === 'requesting'
                ? 'Opening microphone…'
                : `Recording ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}${elapsed >= 105 ? ' · Recording stops at 2:00.' : ''}`}
            </span>
            <Button size="sm" variant="ghost" onClick={recorder.cancel}>
              Discard
            </Button>
          </div>
        ) : null}
        {audioReason ? (
          <p id="chat-audio-reason" className="mt-2 text-xs text-muted">
            {deviceAudioOff ? deviceAudioOffMessage : audioReason}
          </p>
        ) : (
          <p className="mt-2 font-mono text-xs text-subtle">
            Audio configured by loop · up to 2 minutes / 10 MiB
          </p>
        )}
        {audioError || recording.error ? (
          <p role="alert" className="mt-2 text-sm text-status-bad-fg">
            {audioError ?? recording.error}
          </p>
        ) : null}
      </form>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
