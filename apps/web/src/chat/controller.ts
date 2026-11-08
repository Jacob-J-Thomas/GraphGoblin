import {
  ChatSendRequestSchema,
  UlidSchema,
  type ChatConversation,
  type ChatSendInput,
  type ChatSendRequest,
  type ChatSession,
  type ChatTurn,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import { ChatApiError, type ChatClient } from './client.js';

export interface PendingChatRequest {
  conversationId: string;
  request: ChatSendRequest;
}
const SavedSchema = z.object({
  conversationId: UlidSchema.optional(),
  draft: z.string().max(16_000),
  pending: z.object({ conversationId: UlidSchema, request: ChatSendRequestSchema }).optional(),
});
export interface ChatState {
  session: ChatSession | undefined;
  conversations: ChatConversation[];
  conversationId: string | undefined;
  turns: ChatTurn[];
  draft: string;
  pending: PendingChatRequest | undefined;
  loading: boolean;
  sending: boolean;
  error: string | undefined;
  authenticationFailed: boolean;
  online: boolean;
  cancellingTurnId: string | undefined;
  recoveryNotice: string | undefined;
  retryBlocked: boolean;
  retiredRequestIds: string[];
  historyPollingStopped: boolean;
}
export const isActiveTurn = (turn: ChatTurn): boolean =>
  ['queued', 'running', 'waiting', 'paused'].includes(turn.runStatus);
const message = (error: unknown) =>
  error instanceof ChatApiError
    ? error.message
    : 'The gateway could not be reached. Check the connection and try again.';

const isKnownGone = (error: unknown): error is ChatApiError =>
  error instanceof ChatApiError &&
  error.status === 410 &&
  ['CHAT_HISTORY_DELETED', 'CHAT_AUDIO_EXPIRED'].includes(error.code);
type RequestIdentity = Pick<ChatTurn, 'conversationId' | 'requestId'>;
const identityKey = (identity: RequestIdentity) =>
  `${identity.conversationId}/${identity.requestId}`;

/** A lost acknowledgement is recovered only by GET. POST is always an explicit user action. */
export class ChatController {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private generation = 0;
  private failures = 0;
  private readSequence = 0;
  private pollOffset = 0;
  private pausedPolls = new Set<string>();
  private fullRead:
    | {
        generation: number;
        sequence: number;
        conversationId: string | undefined;
        promise: Promise<void>;
      }
    | undefined;
  private storage: Storage;
  private state: ChatState;
  constructor(
    private readonly client: ChatClient,
    private readonly storageKey: string,
    private readonly onAuthenticationError?: () => void,
    storage: Storage = sessionStorage,
  ) {
    this.storage = storage;
    let saved: z.infer<typeof SavedSchema> = { draft: '' };
    try {
      const parsed = SavedSchema.safeParse(JSON.parse(storage.getItem(storageKey) ?? 'null'));
      if (parsed.success) saved = parsed.data;
    } catch {
      /* Storage can be unavailable; persistence is required before an actual send. */
    }
    this.state = {
      session: undefined,
      conversations: [],
      conversationId: saved.pending?.conversationId ?? saved.conversationId,
      turns: [],
      draft: saved.draft,
      pending: saved.pending,
      loading: true,
      sending: false,
      error: undefined,
      authenticationFailed: false,
      online: navigator.onLine,
      cancellingTurnId: undefined,
      recoveryNotice: undefined,
      retryBlocked: false,
      retiredRequestIds: [],
      historyPollingStopped: false,
    };
  }
  getSnapshot = (): ChatState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private persist(state: ChatState = this.state): void {
    this.storage.setItem(
      this.storageKey,
      JSON.stringify({
        draft: state.draft,
        ...(state.conversationId ? { conversationId: state.conversationId } : {}),
        ...(state.pending ? { pending: state.pending } : {}),
      }),
    );
  }
  setDraft = (draft: string): void => {
    this.set({ draft });
    try {
      this.persist();
    } catch {
      /* Keep the draft in this window. */
    }
  };
  private retireRequest(error: ChatApiError, requestId?: string): void {
    const notice =
      error.code === 'CHAT_HISTORY_DELETED'
        ? 'This request was deleted on the gateway. The rest of this conversation is still here.'
        : error.code === 'CHAT_AUDIO_EXPIRED'
          ? `This voice message expired on the gateway.${this.state.session?.readiness.audio.ready ? ' Record a new one or attach the file again.' : ''}`
          : `The gateway no longer has this request.${error.message ? ` ${error.message.slice(0, 500)}` : ''}`;
    const retiredRequestIds = [
      ...new Set([...this.state.retiredRequestIds, ...(requestId ? [requestId] : [])]),
    ];
    for (const key of this.pausedPolls)
      if (requestId && key.endsWith(`/${requestId}`)) this.pausedPolls.delete(key);
    const remainingPending =
      requestId && this.state.pending?.request.requestId === requestId
        ? undefined
        : this.state.pending;
    this.set({
      retryBlocked:
        this.pausedPolls.size > 0 || Boolean(remainingPending && this.state.retryBlocked),
      pending: remainingPending,
      retiredRequestIds,
      recoveryNotice: notice,
      cancellingTurnId: undefined,
      error: this.pausedPolls.size ? this.state.error : undefined,
    });
    clearTimeout(this.timer);
    try {
      this.persist();
    } catch {
      /* A repeated recovery remains read-only. */
    }
  }
  /** Upload refusal has no admitted turn, but follows the same one-read recovery policy. */
  unavailable = async (error: ChatApiError): Promise<void> => {
    if (!isKnownGone(error)) {
      this.fail(error);
      return;
    }
    this.retireRequest(error);
    await this.refresh();
  };
  private hasActiveTurn(): boolean {
    return this.state.turns.some(
      (turn) => isActiveTurn(turn) && !this.state.retiredRequestIds.includes(turn.requestId),
    );
  }
  private fail(error: unknown): void {
    if (error instanceof ChatApiError && error.status === 410) {
      this.set({
        error: `The gateway could not resolve this request. ${error.message.slice(0, 500)}`,
        retryBlocked: Boolean(this.state.pending) || this.pausedPolls.size > 0,
      });
      try {
        this.persist();
      } catch {
        /* Keep uncertainty in this window. */
      }
      return;
    }
    const auth = error instanceof ChatApiError && (error.status === 401 || error.status === 403);
    this.set({ error: message(error), ...(auth ? { authenticationFailed: true } : {}) });
    if (auth) {
      clearTimeout(this.timer);
      this.onAuthenticationError?.();
    }
  }
  start = (): void => {
    this.abort = new AbortController();
    const generation = ++this.generation;
    void this.refresh(generation);
    window.addEventListener('online', this.reconnect);
    window.addEventListener('offline', this.disconnect);
    window.addEventListener('focus', this.focus);
    document.addEventListener('visibilitychange', this.visibility);
  };
  stop = (): void => {
    ++this.generation;
    this.abort?.abort();
    clearTimeout(this.timer);
    window.removeEventListener('online', this.reconnect);
    window.removeEventListener('offline', this.disconnect);
    window.removeEventListener('focus', this.focus);
    document.removeEventListener('visibilitychange', this.visibility);
  };
  private focus = (): void => {
    void this.refresh(this.generation);
  };
  private visibility = (): void => {
    if (!document.hidden) this.focus();
  };
  private reconnect = (): void => {
    this.set({ online: true });
    void this.refresh(this.generation);
  };
  private disconnect = (): void => {
    this.set({ online: false });
    clearTimeout(this.timer);
  };
  private schedule(generation: number): void {
    clearTimeout(this.timer);
    if (generation !== this.generation || !this.state.online || this.state.authenticationFailed)
      return;
    if (this.pollTargets(false).length)
      this.timer = setTimeout(
        () => void this.poll(generation),
        Math.min(1000 * 2 ** this.failures, 15_000),
      );
  }
  private pollTargets(includePaused: boolean): RequestIdentity[] {
    const candidates: RequestIdentity[] = [
      ...(this.state.pending
        ? [
            {
              conversationId: this.state.pending.conversationId,
              requestId: this.state.pending.request.requestId,
            },
          ]
        : []),
      ...this.state.turns.filter(
        (turn) => isActiveTurn(turn) && !this.state.retiredRequestIds.includes(turn.requestId),
      ),
    ];
    return [...new Map(candidates.map((target) => [identityKey(target), target])).values()].filter(
      (target) => includePaused || !this.pausedPolls.has(identityKey(target)),
    );
  }
  private holdUncertain(target: RequestIdentity, error: ChatApiError): void {
    this.pausedPolls.add(identityKey(target));
    this.set({ retryBlocked: true });
    this.fail(error);
  }
  private poll = async (generation: number): Promise<void> => {
    if (generation !== this.generation || !this.state.online || this.state.authenticationFailed)
      return;
    const available = this.pollTargets(false);
    const pendingKey = this.state.pending
      ? `${this.state.pending.conversationId}/${this.state.pending.request.requestId}`
      : undefined;
    const pending = available.find((target) => identityKey(target) === pendingKey);
    const ordinary = available.filter((target) => target !== pending);
    const count = Math.min(8 - Number(Boolean(pending)), ordinary.length);
    const selected = Array.from(
      { length: count },
      (_, index) => ordinary[(this.pollOffset + index) % ordinary.length]!,
    );
    if (ordinary.length) this.pollOffset = (this.pollOffset + count) % ordinary.length;
    const targets = pending ? [pending, ...selected] : selected;
    if (!targets.length) return;
    const sequence = ++this.readSequence;
    const current = () => generation === this.generation && sequence === this.readSequence;
    let transition = false;
    let failure: unknown;
    let transient = false;
    for (let offset = 0; offset < targets.length; offset += 4) {
      const batch = targets.slice(offset, offset + 4);
      const results = await Promise.allSettled(
        batch.map((target) =>
          this.client.request(target.conversationId, target.requestId, this.abort?.signal),
        ),
      );
      if (!current()) return;
      for (let index = 0; index < results.length; index++) {
        const target = batch[index]!;
        const result = results[index]!;
        if (result.status === 'fulfilled') {
          const previous = this.state.turns.find(
            (turn) => identityKey(turn) === identityKey(target),
          );
          const wasPending = this.state.pending?.request.requestId === target.requestId;
          transition ||=
            !isActiveTurn(result.value) &&
            (Boolean(previous && isActiveTurn(previous)) || wasPending);
          this.accept(result.value, false);
        } else if (isKnownGone(result.reason)) {
          this.retireRequest(result.reason, target.requestId);
          transition = true;
        } else {
          failure = result.reason;
          if (result.reason instanceof ChatApiError && result.reason.status === 410)
            this.holdUncertain(target, result.reason);
          else {
            transient = true;
            if (
              result.reason instanceof ChatApiError &&
              result.reason.status === 404 &&
              this.state.turns.some((turn) => identityKey(turn) === identityKey(target))
            )
              this.holdUncertain(target, result.reason);
            else this.fail(result.reason);
          }
          if (this.state.authenticationFailed) return;
        }
      }
    }
    this.failures = transient ? this.failures + 1 : 0;
    if (failure) this.fail(failure);
    if (this.failures >= 5 && this.hasActiveTurn())
      this.set({ error: 'Lost touch with the gateway. This request may still finish there.' });
    if (transition) {
      await this.refresh(generation);
      return;
    }
    this.schedule(generation);
  };
  refresh = (generation = this.generation): Promise<void> => {
    const conversationId = this.state.pending?.conversationId ?? this.state.conversationId;
    if (
      this.fullRead?.generation === generation &&
      this.fullRead.sequence === this.readSequence &&
      this.fullRead.conversationId === conversationId
    )
      return this.fullRead.promise;
    const sequence = ++this.readSequence;
    const promise = this.readFull(generation, sequence).finally(() => {
      if (this.fullRead?.sequence === sequence) this.fullRead = undefined;
    });
    this.fullRead = { generation, sequence, conversationId, promise };
    return promise;
  };
  private readFull = async (generation: number, sequence: number): Promise<void> => {
    clearTimeout(this.timer);
    if (!this.state.online || this.state.authenticationFailed) {
      this.set({ loading: false });
      return;
    }
    const current = () => generation === this.generation && sequence === this.readSequence;
    try {
      const [session, conversations] = await Promise.all([
        this.client.session(this.abort?.signal),
        this.client.conversations(this.abort?.signal),
      ]);
      if (!current()) return;
      const conversationId =
        this.state.pending?.conversationId ?? this.state.conversationId ?? conversations[0]?.id;
      if (this.fullRead?.sequence === sequence) this.fullRead.conversationId = conversationId;
      this.set({ session, conversations, conversationId });
      const pendingKey = this.state.pending
        ? `${this.state.pending.conversationId}/${this.state.pending.request.requestId}`
        : undefined;
      const recoveryTargets = this.pollTargets(true).filter(
        (target) => identityKey(target) === pendingKey || this.pausedPolls.has(identityKey(target)),
      );
      for (const target of recoveryTargets) {
        try {
          const turn = await this.client.request(
            target.conversationId,
            target.requestId,
            this.abort?.signal,
          );
          if (!current()) return;
          this.accept(turn, false);
        } catch (error) {
          if (!current()) return;
          if (isKnownGone(error)) this.retireRequest(error, target.requestId);
          else if (error instanceof ChatApiError && error.status === 410)
            this.holdUncertain(target, error);
          else if (error instanceof ChatApiError && error.status === 404) {
            if (identityKey(target) !== pendingKey) this.holdUncertain(target, error);
            else
              this.set({
                error:
                  'The gateway has not acknowledged this message. Check its status or explicitly retry the same request.',
              });
          } else throw error;
        }
      }
      if (conversationId) {
        const turns = await this.client.turns(conversationId, this.abort?.signal);
        if (!current()) return;
        const knownUncertain = this.state.turns.filter((turn) =>
          this.pausedPolls.has(identityKey(turn)),
        );
        const merged = new Map(turns.map((turn) => [turn.id, turn]));
        for (const turn of knownUncertain) merged.set(turn.id, turn);
        this.set({
          turns: [...merged.values()].sort((a, b) => a.turn - b.turn),
          historyPollingStopped: false,
          ...(this.state.cancellingTurnId &&
          !turns.some((turn) => turn.id === this.state.cancellingTurnId && isActiveTurn(turn))
            ? { cancellingTurnId: undefined }
            : {}),
        });
      }
      this.failures = 0;
      this.set({
        loading: false,
        ...(this.state.pending || this.state.retryBlocked ? {} : { error: undefined }),
      });
      try {
        this.persist();
      } catch {
        /* Read-only recovery still works without writable storage. */
      }
    } catch (error) {
      if (!current()) return;
      this.set({ loading: false });
      if (error instanceof ChatApiError && error.status === 410) {
        if (!this.state.recoveryNotice) this.fail(error);
        this.set({ historyPollingStopped: true });
        this.failures = 0;
        this.schedule(generation);
        return;
      }
      this.failures++;
      this.fail(error);
      if (this.failures >= 5 && this.hasActiveTurn() && !this.state.authenticationFailed)
        this.set({ error: 'Lost touch with the gateway. This request may still finish there.' });
    }
    this.schedule(generation);
  };
  selectConversation = async (conversationId: string): Promise<void> => {
    if (this.state.pending || this.state.sending || this.state.retryBlocked) return;
    this.set({
      conversationId,
      turns: [],
      loading: true,
      error: undefined,
      recoveryNotice: undefined,
      retiredRequestIds: [],
      historyPollingStopped: false,
    });
    try {
      this.persist();
    } catch {
      /* Sending will require durable pending storage. */
    }
    await this.refresh();
  };
  newConversation = async (): Promise<void> => {
    if (!this.state.online || this.state.pending || this.state.sending || this.state.retryBlocked)
      return;
    this.set({
      sending: true,
      error: undefined,
      recoveryNotice: undefined,
      historyPollingStopped: false,
    });
    try {
      const conversation = await this.client.createConversation();
      this.set({
        conversationId: conversation.id,
        conversations: [conversation, ...this.state.conversations],
        turns: [],
        recoveryNotice: undefined,
        retryBlocked: false,
        retiredRequestIds: [],
        historyPollingStopped: false,
      });
      this.persist();
    } catch (error) {
      this.fail(error);
    } finally {
      this.set({ sending: false });
    }
  };
  private accept(turn: ChatTurn, invalidateRead = true): void {
    if (invalidateRead) ++this.readSequence;
    if (this.state.cancellingTurnId === turn.id && !isActiveTurn(turn))
      this.set({ cancellingTurnId: undefined });
    const turns = this.state.turns.filter((item) => item.id !== turn.id);
    const matchesPending = this.state.pending?.request.requestId === turn.requestId;
    const retainPending = matchesPending && this.state.retryBlocked && isActiveTurn(turn);
    if (!isActiveTurn(turn)) this.pausedPolls.delete(identityKey(turn));
    this.set({
      retryBlocked:
        this.pausedPolls.size > 0 ||
        Boolean(
          this.state.retryBlocked && this.state.pending && (!matchesPending || retainPending),
        ),
      pending: matchesPending && !retainPending ? undefined : this.state.pending,
      turns: [...turns, turn].sort((a, b) => a.turn - b.turn),
      error: this.pausedPolls.size > 0 || retainPending ? this.state.error : undefined,
    });
    try {
      this.persist();
    } catch {
      /* A stale persisted request will be recovered with GET next time. */
    }
  }
  send = async (input: ChatSendInput): Promise<void> => {
    if (
      !this.state.online ||
      this.state.retryBlocked ||
      this.state.sending ||
      this.state.pending ||
      this.state.authenticationFailed ||
      this.hasActiveTurn()
    )
      return;
    const ready =
      input.kind === 'text'
        ? this.state.session?.readiness.text.ready
        : this.state.session?.readiness.audio.ready;
    if (!ready) return;
    this.set({
      sending: true,
      error: undefined,
      recoveryNotice: undefined,
      historyPollingStopped: false,
    });
    try {
      let conversationId = this.state.conversationId;
      if (!conversationId) {
        const conversation = await this.client.createConversation();
        conversationId = conversation.id;
        this.set({ conversationId, conversations: [conversation, ...this.state.conversations] });
      }
      const request = ChatSendRequestSchema.parse({ requestId: crypto.randomUUID(), input });
      const pending = { conversationId, request };
      // Persist before any turn mutation: a reload must never invent a new request identity.
      try {
        this.persist({ ...this.state, pending, draft: '' });
      } catch {
        throw new ChatApiError(
          0,
          'CHAT_STORAGE_UNAVAILABLE',
          'This browser cannot save the request for recovery. Enable browser storage before sending.',
        );
      }
      this.set({ pending, draft: '' });
      await this.post(pending);
    } catch (error) {
      this.set({
        error:
          error instanceof Error && error.name === 'QuotaExceededError'
            ? 'This browser cannot save the request for recovery. Free browser storage before sending.'
            : message(error),
      });
    } finally {
      this.set({ sending: false });
    }
  };
  private async post(pending: PendingChatRequest): Promise<void> {
    try {
      this.accept(await this.client.send(pending.conversationId, pending.request));
      this.schedule(this.generation);
    } catch (error) {
      // A definite refusal cannot have admitted a turn. Transport/5xx uncertainty retains identity.
      if (
        error instanceof ChatApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 410
      ) {
        this.set({ pending: undefined });
        try {
          this.persist();
        } catch {
          /* Recovery of an old identity remains GET-only. */
        }
      }
      if (isKnownGone(error)) {
        this.retireRequest(error, pending.request.requestId);
        await this.refresh();
      } else if (error instanceof ChatApiError && error.status === 410)
        this.holdUncertain(
          { conversationId: pending.conversationId, requestId: pending.request.requestId },
          error,
        );
      else this.fail(error);
      if (this.state.pending && !this.state.retryBlocked)
        this.set({
          error:
            'Acknowledgement is unknown. Check status before explicitly retrying this same message.',
        });
    }
  }
  retryPending = async (): Promise<void> => {
    const pending = this.state.pending;
    if (
      !pending ||
      !this.state.online ||
      this.state.sending ||
      this.state.authenticationFailed ||
      this.state.retryBlocked
    )
      return;
    this.set({ sending: true });
    await this.post(pending);
    this.set({ sending: false });
  };
  cancel = async (turnId: string): Promise<void> => {
    if (!this.state.online || this.state.authenticationFailed) return;
    const previous = this.state.turns.find((turn) => turn.id === turnId);
    if (previous && this.pausedPolls.has(identityKey(previous))) return;
    if (this.state.cancellingTurnId) return;
    this.set({ cancellingTurnId: turnId, error: undefined });
    try {
      const turn = await this.client.cancel(turnId);
      this.accept(turn);
      if (previous && isActiveTurn(previous) && !isActiveTurn(turn)) await this.refresh();
      else this.schedule(this.generation);
    } catch (error) {
      this.set({ cancellingTurnId: undefined });
      if (isKnownGone(error)) {
        this.retireRequest(error, this.state.turns.find((turn) => turn.id === turnId)?.requestId);
        await this.refresh();
      } else if (error instanceof ChatApiError && error.status === 410) {
        const turn = this.state.turns.find((item) => item.id === turnId);
        if (turn) this.holdUncertain(turn, error);
        else this.fail(error);
        await this.refresh();
      } else this.fail(error);
    }
  };
}
