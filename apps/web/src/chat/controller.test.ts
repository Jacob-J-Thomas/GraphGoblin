import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatApiError } from './client.js';
import { ChatController, isActiveTurn } from './controller.js';
import { conversation, mockChatClient, session, turn } from './__fixtures__/chat.js';
const key = 'test-chat';
const pending = {
  conversationId: conversation.id,
  request: { requestId: turn.requestId, input: turn.input },
};
const missing = new ChatApiError(404, 'NOT_FOUND', 'Not found.');
const controllers: ChatController[] = [];
function create(storage?: Storage) {
  const client = mockChatClient();
  const auth = vi.fn();
  const controller = new ChatController(client, key, auth, storage);
  controllers.push(controller);
  return { controller, client, auth };
}
afterEach(() => {
  controllers.forEach((controller) => controller.stop());
  controllers.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('durable chat request recovery', () => {
  it('persists request identity and canonical input before mutation, preserving a newer draft', async () => {
    const { controller, client } = create();
    await controller.refresh();
    controller.setDraft('Hello');
    client.send.mockImplementation((_id, request) => {
      expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ pending: { request } });
      expect(request.input).toEqual(turn.input);
      controller.setDraft('Next message');
      return Promise.resolve({ ...turn, requestId: request.requestId });
    });
    await controller.send(turn.input);
    expect(client.createConversation).toHaveBeenCalledOnce();
    expect(client.send).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Next message',
      pending: undefined,
      sending: false,
      turns: [expect.objectContaining({ response: turn.response })],
    });
    expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
  });
  it('reload and reconnect look up the same request without sending; explicit retry preserves its ID', async () => {
    sessionStorage.setItem(key, JSON.stringify({ draft: 'new draft', pending }));
    const { controller, client } = create();
    client.request.mockRejectedValue(missing);
    controller.start();
    await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
    expect(client.request).toHaveBeenCalledWith(
      conversation.id,
      turn.requestId,
      expect.any(AbortSignal),
    );
    expect(client.send).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledTimes(2));
    expect(client.send).not.toHaveBeenCalled();
    client.send.mockResolvedValue(turn);
    await controller.retryPending();
    expect(client.send).toHaveBeenCalledWith(conversation.id, pending.request);
    expect(controller.getSnapshot()).toMatchObject({ pending: undefined, draft: 'new draft' });
  });
  it('lost acknowledgement stays recoverable and an acknowledged lookup clears it', async () => {
    const { controller, client } = create();
    await controller.refresh();
    client.send.mockRejectedValue(new TypeError('network'));
    await controller.send(turn.input);
    const saved = controller.getSnapshot().pending!;
    expect(saved.request.requestId).toBeTruthy();
    expect(controller.getSnapshot().error).toMatch(/Acknowledgement is unknown/);
    client.request.mockResolvedValue({ ...turn, requestId: saved.request.requestId });
    client.turns.mockResolvedValue([{ ...turn, requestId: saved.request.requestId }]);
    await controller.refresh();
    expect(client.send).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ pending: undefined, error: undefined });
  });
  it.each([409, 413])(
    'a definite %s refusal removes pending identity without retrying',
    async (status) => {
      const { controller, client } = create();
      await controller.refresh();
      client.send.mockRejectedValue(new ChatApiError(status, 'CHAT_REFUSED', 'Not sent.'));
      await controller.send(turn.input);
      expect(controller.getSnapshot()).toMatchObject({ pending: undefined, error: 'Not sent.' });
      await controller.retryPending();
      expect(client.send).toHaveBeenCalledOnce();
    },
  );
  it('a server acknowledgement error retains the pending identity', async () => {
    const { controller, client } = create();
    await controller.refresh();
    client.send.mockRejectedValue(new ChatApiError(503, 'UNAVAILABLE', 'Unavailable'));
    await controller.send(turn.input);
    expect(controller.getSnapshot().pending).toBeDefined();
    await controller.send({ kind: 'text', text: 'Different' });
    expect(client.send).toHaveBeenCalledOnce();
    await controller.newConversation();
    await controller.selectConversation(conversation.id);
    expect(client.createConversation).toHaveBeenCalledOnce();
  });
  it('storage failure prevents any turn request and corrupt stored input is ignored', async () => {
    sessionStorage.setItem(key, '{bad json');
    const { controller, client } = create();
    await controller.refresh();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    controller.setDraft('preserved');
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      pending: undefined,
      draft: 'preserved',
      error: expect.stringMatching(/browser.*storage/i),
    });
  });
  it('invalid stored shape and inaccessible storage do not prevent reading the session', async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ draft: 'hello', pending: { input: 'untrusted' } }),
    );
    const { controller } = create();
    await controller.refresh();
    expect(controller.getSnapshot().draft).toBe('');
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
    } as unknown as Storage;
    const second = create(storage);
    await second.controller.refresh();
    expect(second.controller.getSnapshot().session).toEqual(session);
  });
  it('not-ready text/audio, offline, and active turn prevent mutation', async () => {
    const { controller, client } = create();
    await controller.refresh();
    await controller.send({ kind: 'audio', audioId: turn.id });
    expect(client.send).not.toHaveBeenCalled();
    client.session.mockResolvedValue({
      ...session,
      readiness: { ...session.readiness, text: { ready: false } },
    });
    await controller.refresh();
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    client.session.mockResolvedValue(session);
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'waiting', response: undefined }]);
    await controller.refresh();
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    controller.start();
    window.dispatchEvent(new Event('offline'));
    await controller.newConversation();
    await controller.cancel(turn.id);
    await controller.retryPending();
    await controller.refresh();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
    expect(controller.getSnapshot().online).toBe(false);
  });
  it('polls active runs with backoff, stops on auth failure, and notifies once', async () => {
    vi.useFakeTimers();
    const { controller, client, auth } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await controller.refresh();
    const first = client.session.mock.calls.length;
    client.session.mockRejectedValueOnce(new TypeError('offline'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.session).toHaveBeenCalledTimes(first + 1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.session).toHaveBeenCalledTimes(first + 1);
    client.session.mockRejectedValue(new ChatApiError(401, 'UNAUTHORIZED', 'Pair again.'));
    await vi.advanceTimersByTimeAsync(1);
    expect(auth).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().authenticationFailed).toBe(true);
    const calls = client.session.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.send(turn.input);
    await controller.cancel(turn.id);
    await controller.refresh();
    expect(client.session).toHaveBeenCalledTimes(calls);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('preserves existing history during a transient error and ignores reads after stop', async () => {
    const { controller, client } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([turn]);
    await controller.refresh();
    client.session.mockRejectedValueOnce(new Error('network'));
    await controller.refresh();
    expect(controller.getSnapshot().turns).toEqual([turn]);
    let resolve!: (value: typeof session) => void;
    client.session.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const refresh = controller.refresh();
    controller.stop();
    resolve(session);
    await refresh;
    expect(controller.getSnapshot().error).toMatch(/gateway could not be reached/);
  });
  it('creates/selects conversations, cancels through the native API, and reports failures', async () => {
    const { controller, client } = create();
    await controller.refresh();
    await controller.newConversation();
    expect(controller.getSnapshot().conversationId).toBe(conversation.id);
    await controller.selectConversation(conversation.id);
    expect(client.turns).toHaveBeenCalled();
    controller.setDraft('Keep drafting');
    await controller.cancel(turn.id);
    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Keep drafting',
      turns: [expect.objectContaining({ runStatus: 'cancelled' })],
    });
    client.cancel.mockRejectedValue(new Error('network'));
    await controller.cancel(turn.id);
    expect(controller.getSnapshot().error).toBeTruthy();
    client.createConversation.mockRejectedValue(new ChatApiError(403, 'FORBIDDEN', 'Not allowed.'));
    await controller.newConversation();
    expect(controller.getSnapshot().authenticationFailed).toBe(true);
  });
  it('does not duplicate a post while it is in flight and does not send if conversation creation fails', async () => {
    const { controller, client } = create();
    await controller.refresh();
    client.createConversation.mockRejectedValueOnce(new Error('network'));
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    let resolve!: (value: typeof turn) => void;
    client.send.mockImplementation(
      (_id, request) =>
        new Promise((done) => {
          resolve = (value) => done({ ...value, requestId: request.requestId });
        }),
    );
    const posting = controller.send(turn.input);
    await vi.waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    await controller.send(turn.input);
    await controller.retryPending();
    await controller.newConversation();
    expect(client.send).toHaveBeenCalledOnce();
    resolve(turn);
    await posting;
    expect(controller.getSnapshot().sending).toBe(false);
  });
  it('identifies only native nonterminal statuses as active', () => {
    for (const runStatus of ['queued', 'running', 'waiting', 'paused'] as const)
      expect(isActiveTurn({ ...turn, runStatus })).toBe(true);
    expect(isActiveTurn(turn)).toBe(false);
  });
});

describe('chat recovery race and terminal boundaries', () => {
  it('forgets only the tombstoned request, reloads surviving history and preserves the draft and conversation', async () => {
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep typing', pending }));
    const { controller, client } = create();
    const survivor = { ...turn, requestId: '36bee35d-3ce7-43ab-87c1-a95952a069ed' };
    client.request.mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    client.turns.mockResolvedValue([survivor]);
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      recoveryNotice: expect.stringContaining('This request was deleted'),
      pending: undefined,
      turns: [survivor],
      draft: 'Keep typing',
      conversationId: conversation.id,
    });
    await controller.retryPending();
    expect(client.send).not.toHaveBeenCalled();
    expect(client.turns).toHaveBeenCalledWith(conversation.id, undefined);
    expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
    await controller.send({ kind: 'text', text: 'New message' });
    expect(client.send).toHaveBeenCalledOnce();
    expect(client.send.mock.calls[0]![1].requestId).not.toBe(pending.request.requestId);
  });
  it('handles a tombstone returned by explicit retry with reads only and distinguishes expired audio', async () => {
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Next message', pending }));
    const { controller, client } = create();
    client.request.mockRejectedValue(missing);
    await controller.refresh();
    client.send.mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    client.turns.mockResolvedValue([turn]);
    await controller.retryPending();
    expect(controller.getSnapshot()).toMatchObject({
      recoveryNotice: expect.stringContaining('This request was deleted'),
      pending: undefined,
      conversationId: conversation.id,
      draft: 'Next message',
      turns: [turn],
    });
    expect(client.send).toHaveBeenCalledOnce();
    await controller.selectConversation(conversation.id);
    client.send.mockRejectedValue(new ChatApiError(410, 'CHAT_AUDIO_EXPIRED', 'Audio expired.'));
    await controller.send(turn.input);
    expect(controller.getSnapshot()).toMatchObject({
      recoveryNotice: 'This voice message expired on the gateway.',
      error: undefined,
      turns: [turn],
    });
  });
  it('keeps cancelling visible until a native terminal projection arrives', async () => {
    const { controller, client } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await controller.refresh();
    client.cancel.mockResolvedValue({ ...turn, runStatus: 'running', response: undefined });
    await controller.cancel(turn.id);
    expect(controller.getSnapshot().cancellingTurnId).toBe(turn.id);
    await controller.cancel(turn.id);
    expect(client.cancel).toHaveBeenCalledOnce();
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'cancelled', response: undefined }]);
    await controller.refresh();
    expect(controller.getSnapshot().cancellingTurnId).toBeUndefined();
  });
  it('an obsolete conversation read cannot replace the newer selected conversation', async () => {
    const { controller, client } = create();
    const other = { ...conversation, id: turn.id };
    client.conversations.mockResolvedValue([conversation, other]);
    let finish!: (value: (typeof turn)[]) => void;
    client.turns.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = controller.refresh();
    await vi.waitFor(() => expect(client.turns).toHaveBeenCalledOnce());
    client.turns.mockResolvedValue([]);
    await controller.selectConversation(other.id);
    finish([turn]);
    await old;
    expect(controller.getSnapshot()).toMatchObject({ conversationId: other.id, turns: [] });
  });
  it('five failed reads retain admitted work and state that it may still finish', async () => {
    const { controller, client } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await controller.refresh();
    client.session.mockRejectedValue(new TypeError('offline'));
    for (let index = 0; index < 5; index++) await controller.refresh();
    expect(controller.getSnapshot().error).toBe(
      'Lost touch with the gateway. This request may still finish there.',
    );
    expect(controller.getSnapshot().turns).toHaveLength(1);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('allows an audio-ready workflow to admit audio independently of text readiness', async () => {
    const { controller, client } = create();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: false }, audio: { ready: true } },
    });
    await controller.refresh();
    await controller.send({ kind: 'audio', audioId: turn.id });
    expect(client.send).toHaveBeenCalledOnce();
  });
});

const goneCases = [
  {
    code: 'CHAT_HISTORY_DELETED',
    notice: 'This request was deleted on the gateway. The rest of this conversation is still here.',
  },
  { code: 'CHAT_AUDIO_EXPIRED', notice: 'This voice message expired on the gateway.' },
];
describe('turn-scoped unavailable recovery', () => {
  it.each(goneCases)(
    'forgets only the pending $code request and fetches history exactly once',
    async ({ code, notice }) => {
      sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep my draft', pending }));
      const { controller, client } = create();
      const survivor = { ...turn, requestId: '36bee35d-3ce7-43ab-87c1-a95952a069ed' };
      client.request.mockRejectedValue(new ChatApiError(410, code, 'Bounded reason.'));
      client.turns.mockResolvedValue([survivor]);
      await controller.refresh();
      await controller.retryPending();
      expect(controller.getSnapshot()).toMatchObject({
        pending: undefined,
        draft: 'Keep my draft',
        conversationId: conversation.id,
        turns: [survivor],
        recoveryNotice: notice,
      });
      expect(client.turns).toHaveBeenCalledOnce();
      expect(client.send).not.toHaveBeenCalled();
      expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
    },
  );
  it.each(goneCases)(
    'a $code send refusal never reuses its request or clears a newer draft',
    async ({ code, notice }) => {
      const { controller, client } = create();
      client.conversations.mockResolvedValue([conversation]);
      client.turns.mockResolvedValue([turn]);
      await controller.refresh();
      client.turns.mockClear();
      client.send.mockImplementation(() => {
        controller.setDraft('Keep next draft');
        return Promise.reject(new ChatApiError(410, code, 'Bounded reason.'));
      });
      await controller.send(turn.input);
      await controller.retryPending();
      expect(controller.getSnapshot()).toMatchObject({
        pending: undefined,
        draft: 'Keep next draft',
        conversationId: conversation.id,
        turns: [turn],
        recoveryNotice: notice,
      });
      expect(client.send).toHaveBeenCalledOnce();
      expect(client.turns).toHaveBeenCalledOnce();
    },
  );
  it.each(goneCases)(
    'a $code cancellation refreshes once and stops polling only that request',
    async ({ code, notice }) => {
      const { controller, client } = create();
      const active = { ...turn, runStatus: 'running' as const, response: undefined };
      client.conversations.mockResolvedValue([conversation]);
      client.turns.mockResolvedValue([active]);
      await controller.refresh();
      client.turns.mockClear();
      controller.setDraft('Keep my draft');
      client.cancel.mockRejectedValue(new ChatApiError(410, code, 'Bounded reason.'));
      client.turns.mockResolvedValue([]);
      await controller.cancel(turn.id);
      expect(controller.getSnapshot()).toMatchObject({
        pending: undefined,
        draft: 'Keep my draft',
        conversationId: conversation.id,
        turns: [],
        recoveryNotice: notice,
        retiredRequestIds: [turn.requestId],
      });
      expect(client.turns).toHaveBeenCalledOnce();
      expect(client.send).not.toHaveBeenCalled();
      await controller.newConversation();
      expect(controller.getSnapshot().recoveryNotice).toBeUndefined();
    },
  );
  it('retains visible history when its one recovery GET is also gone, without automatic retries', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const active = { ...turn, runStatus: 'running' as const, response: undefined };
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([active]);
    await controller.refresh();
    controller.setDraft('Unsent');
    client.turns.mockClear();
    client.cancel.mockRejectedValue(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Gone.'));
    client.turns.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Gone history.'));
    await controller.cancel(turn.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.turns).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      turns: [active],
      draft: 'Unsent',
      historyPollingStopped: true,
      recoveryNotice: goneCases[0]!.notice,
    });
    client.send.mockResolvedValue(turn);
    await controller.send(turn.input);
    expect(client.send).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().recoveryNotice).toBeUndefined();
  });
  it('expired uploads use the audio notice only when published audio remains available', async () => {
    const { controller, client } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    await controller.refresh();
    client.turns.mockClear();
    controller.setDraft('Keep draft');
    await controller.unavailable(new ChatApiError(410, 'CHAT_AUDIO_EXPIRED', 'Expired.'));
    expect(controller.getSnapshot()).toMatchObject({
      draft: 'Keep draft',
      recoveryNotice:
        'This voice message expired on the gateway. Record a new one or attach the file again.',
    });
    expect(client.turns).toHaveBeenCalledOnce();
  });
});

describe('unrecognized 410 stays uncertain', () => {
  it.each(['send', 'lookup'] as const)(
    '%s preserves the exact pending identity and forbids mutation until canonical lookup resolves',
    async (phase) => {
      if (phase === 'lookup')
        sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
      const { controller, client } = create();
      client.conversations.mockResolvedValue([conversation]);
      const failure = new ChatApiError(410, 'UNKNOWN_GONE', 'Bounded reason.');
      client.request.mockRejectedValue(failure);
      if (phase === 'send') {
        await controller.refresh();
        client.send.mockRejectedValue(failure);
        await controller.send(turn.input);
        controller.setDraft('Keep draft');
      } else await controller.refresh();
      const identity = controller.getSnapshot().pending;
      expect(identity).toBeDefined();
      expect(controller.getSnapshot()).toMatchObject({
        retryBlocked: true,
        recoveryNotice: undefined,
        draft: 'Keep draft',
        conversationId: conversation.id,
      });
      const posts = client.send.mock.calls.length;
      await controller.retryPending();
      await controller.send(turn.input);
      await controller.newConversation();
      expect(client.send).toHaveBeenCalledTimes(posts);
      expect(controller.getSnapshot().pending).toEqual(identity);
      client.request.mockResolvedValue({ ...turn, requestId: identity!.request.requestId });
      client.turns.mockResolvedValue([turn]);
      await controller.refresh();
      expect(controller.getSnapshot()).toMatchObject({
        retryBlocked: false,
        pending: undefined,
        draft: 'Keep draft',
      });
    },
  );
  it('an unknown cancellation result resolves by canonical GET without another cancel or send', async () => {
    const { controller, client } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await controller.refresh();
    client.cancel.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Unresolved.'));
    client.request.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Unresolved.'));
    await controller.cancel(turn.id);
    expect(controller.getSnapshot()).toMatchObject({
      retryBlocked: true,
      pending: { request: { requestId: turn.requestId } },
    });
    await controller.retryPending();
    expect(client.cancel).toHaveBeenCalledOnce();
    expect(client.send).not.toHaveBeenCalled();
  });
});

it('an unrecognized history-list 410 retains visible active history and never invents a tombstone', async () => {
  const { controller, client } = create();
  client.conversations.mockResolvedValue([conversation]);
  const active = { ...turn, runStatus: 'running' as const, response: undefined };
  client.turns.mockResolvedValue([active]);
  await controller.refresh();
  client.turns.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Ambiguous list.'));
  await controller.refresh();
  expect(controller.getSnapshot()).toMatchObject({
    turns: [active],
    retiredRequestIds: [],
    recoveryNotice: undefined,
    historyPollingStopped: true,
  });
  await controller.send(turn.input);
  expect(client.send).not.toHaveBeenCalled();
});
