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
  it('polls active requests with backoff, stops on auth failure, and never repeats readiness or history', async () => {
    vi.useFakeTimers();
    const { controller, client, auth } = create();
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([{ ...turn, runStatus: 'running', response: undefined }]);
    await controller.refresh();
    const sessionCalls = client.session.mock.calls.length;
    const historyCalls = client.turns.mock.calls.length;
    client.request.mockRejectedValueOnce(new TypeError('offline'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.request).toHaveBeenCalledOnce();
    client.request.mockRejectedValue(new ChatApiError(401, 'UNAUTHORIZED', 'Pair again.'));
    await vi.advanceTimersByTimeAsync(1);
    expect(auth).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().authenticationFailed).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await controller.send(turn.input);
    await controller.cancel(turn.id);
    await controller.refresh();
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.session).toHaveBeenCalledTimes(sessionCalls);
    expect(client.turns).toHaveBeenCalledTimes(historyCalls);
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
      pending: undefined,
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

const activeProjection = (index: number) => ({
  ...turn,
  id: String(index).padStart(26, '0'),
  runId: String(index + 100).padStart(26, '0'),
  requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  turn: index + 1,
  runStatus: 'running' as const,
  response: undefined,
});
describe('bounded direct request polling', () => {
  it('prioritizes pending recovery, limits each tick to eight and four concurrent reads, and rotates active rows fairly', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
    const { controller, client } = create();
    const rows = Array.from({ length: 10 }, (_, index) => activeProjection(index));
    const byRequest = new Map(rows.map((row) => [row.requestId, row]));
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    client.request.mockRejectedValue(missing);
    await controller.refresh();
    client.request.mockClear();
    let inFlight = 0;
    let maximum = 0;
    const finish: (() => void)[] = [];
    client.request.mockImplementation(
      (_conversationId, requestId) =>
        new Promise((resolve, reject) => {
          inFlight++;
          maximum = Math.max(maximum, inFlight);
          finish.push(() => {
            inFlight--;
            if (requestId === pending.request.requestId) reject(missing);
            else resolve(byRequest.get(requestId)!);
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(4);
    expect(client.request.mock.calls[0]![1]).toBe(pending.request.requestId);
    finish.splice(0).forEach((done) => done());
    await vi.advanceTimersByTimeAsync(0);
    expect(client.request).toHaveBeenCalledTimes(8);
    finish.splice(0).forEach((done) => done());
    await vi.advanceTimersByTimeAsync(0);
    expect(maximum).toBe(4);
    client.request.mockImplementation((_conversationId, requestId) =>
      requestId === pending.request.requestId
        ? Promise.reject(missing)
        : Promise.resolve(byRequest.get(requestId)!),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(16);
    expect(client.request.mock.calls[8]![1]).toBe(pending.request.requestId);
    for (const row of rows)
      expect(client.request.mock.calls.some((call) => call[1] === row.requestId)).toBe(true);
    expect(client.session).toHaveBeenCalledOnce();
    expect(client.conversations).toHaveBeenCalledOnce();
    expect(client.turns).toHaveBeenCalledOnce();
    expect(client.send).not.toHaveBeenCalled();
    expect(controller.getSnapshot().draft).toBe('Keep draft');
  });
  it('coalesces multiple terminal transitions into one full readiness/index/history refresh', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const rows = Array.from({ length: 4 }, (_, index) => activeProjection(index));
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    await controller.refresh();
    client.request.mockImplementation((_id, requestId) =>
      Promise.resolve({
        ...rows.find((row) => row.requestId === requestId)!,
        runStatus: 'succeeded',
        response: turn.response,
      }),
    );
    client.turns.mockResolvedValue(
      rows.map((row) => ({ ...row, runStatus: 'succeeded', response: turn.response })),
    );
    client.session.mockResolvedValue({
      ...session,
      readiness: { ...session.readiness, text: { ready: false, message: 'Changed model.' } },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(4);
    expect(client.session).toHaveBeenCalledTimes(2);
    expect(client.conversations).toHaveBeenCalledTimes(2);
    expect(client.turns).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().session?.readiness.text.message).toBe('Changed model.');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.request).toHaveBeenCalledTimes(4);
  });
  it('coalesces focus, visibility return and reconnect while refreshing and removes all listeners on stop', async () => {
    const { controller, client } = create();
    controller.start();
    await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
    let finish!: (value: typeof session) => void;
    client.session.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(client.session).toHaveBeenCalledTimes(2);
    finish(session);
    await vi.waitFor(() => expect(client.conversations).toHaveBeenCalledTimes(2));
    controller.stop();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(client.session).toHaveBeenCalledTimes(2);
  });
  it('ignores an old direct poll after conversation selection and does not replace the new transcript', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const row = activeProjection(0);
    client.conversations.mockResolvedValue([conversation, { ...conversation, id: turn.runId }]);
    client.turns.mockResolvedValue([row]);
    await controller.refresh();
    let finish!: (value: typeof row) => void;
    client.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    client.turns.mockResolvedValue([]);
    await controller.selectConversation(turn.runId);
    finish(row);
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()).toMatchObject({ conversationId: turn.runId, turns: [] });
  });
  it('stops only unknown-410 identities, never overwrites pending recovery, and resolves each by canonical reads', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
    const { controller, client } = create();
    const rows = [activeProjection(0), activeProjection(1)];
    const unknown = new ChatApiError(410, 'UNKNOWN', 'Unresolved.');
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    client.request.mockRejectedValue(unknown);
    await controller.refresh();
    client.request.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().pending).toEqual(pending);
    expect(controller.getSnapshot().turns).toEqual(rows);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.request).toHaveBeenCalledTimes(2);
    await controller.retryPending();
    await controller.send(turn.input);
    await controller.newConversation();
    expect(client.send).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
    client.request.mockImplementation((_id, requestId) =>
      requestId === pending.request.requestId
        ? Promise.resolve({ ...turn, runStatus: 'running', response: undefined })
        : requestId === rows[0]!.requestId
          ? Promise.resolve({ ...rows[0]!, runStatus: 'succeeded', response: turn.response })
          : Promise.reject(new ChatApiError(410, 'CHAT_HISTORY_DELETED', 'Deleted.')),
    );
    client.turns.mockResolvedValue([]);
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      pending,
      retryBlocked: true,
      draft: 'Keep draft',
    });
    expect(controller.getSnapshot().turns).toEqual([
      expect.objectContaining({ requestId: pending.request.requestId, runStatus: 'running' }),
    ]);
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    client.request.mockResolvedValue(turn);
    client.turns.mockResolvedValue([turn]);
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      pending: undefined,
      retryBlocked: false,
      turns: [turn],
      draft: 'Keep draft',
    });
  });
  it('keeps an acknowledged unknown-410 row separate from the send/retry identity while other active rows continue', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const rows = [activeProjection(0), activeProjection(1)];
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    await controller.refresh();
    client.request.mockImplementation((_id, requestId) =>
      requestId === rows[0]!.requestId
        ? Promise.reject(new ChatApiError(410, 'UNKNOWN', 'Unresolved.'))
        : Promise.resolve(rows[1]!),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot()).toMatchObject({
      pending: undefined,
      retryBlocked: true,
      turns: rows,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.request.mock.calls.filter((call) => call[1] === rows[0]!.requestId)).toHaveLength(
      1,
    );
    expect(
      client.request.mock.calls.filter((call) => call[1] === rows[1]!.requestId).length,
    ).toBeGreaterThan(1);
    await controller.newConversation();
    await controller.send(turn.input);
    expect(client.send).not.toHaveBeenCalled();
    expect(client.createConversation).not.toHaveBeenCalled();
  });
  it('stops authenticated polling before dispatching another batch when one read loses access', async () => {
    vi.useFakeTimers();
    const { controller, client, auth } = create();
    const rows = Array.from({ length: 10 }, (_, index) => activeProjection(index));
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    await controller.refresh();
    client.request.mockRejectedValue(new ChatApiError(403, 'FORBIDDEN', 'Denied.'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(4);
    expect(auth).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.request).toHaveBeenCalledTimes(4);
  });
  it('a failed history-list refresh does not stop independent direct active polling', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const row = activeProjection(0);
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([row]);
    await controller.refresh();
    client.turns.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Unresolved list.'));
    await controller.refresh();
    client.request.mockResolvedValue(row);
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.turns).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().turns).toEqual([row]);
  });
});

it.each(['CHAT_HISTORY_DELETED', 'CHAT_AUDIO_EXPIRED'])(
  'a typed %s on the direct poll refreshes once and does not retire another active identity',
  async (code) => {
    vi.useFakeTimers();
    const { controller, client } = create();
    const rows = [activeProjection(0), activeProjection(1)];
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue(rows);
    await controller.refresh();
    client.request.mockImplementation((_id, requestId) =>
      requestId === rows[0]!.requestId
        ? Promise.reject(new ChatApiError(410, code, 'Gone.'))
        : Promise.resolve(rows[1]!),
    );
    client.turns.mockResolvedValue([rows[1]!]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot()).toMatchObject({
      turns: [rows[1]],
      retiredRequestIds: [rows[0]!.requestId],
    });
    expect(client.session).toHaveBeenCalledTimes(2);
    expect(client.turns).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request.mock.calls.filter((call) => call[1] === rows[0]!.requestId)).toHaveLength(
      1,
    );
    expect(client.request.mock.calls.filter((call) => call[1] === rows[1]!.requestId)).toHaveLength(
      2,
    );
    expect(client.send).not.toHaveBeenCalled();
  },
);
it('a direct nonterminal acknowledgement clears ordinary pending recovery and leaves readiness/history untouched until terminal', async () => {
  vi.useFakeTimers();
  sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
  const { controller, client } = create();
  client.request.mockRejectedValue(missing);
  await controller.refresh();
  client.request.mockResolvedValue({ ...turn, runStatus: 'running', response: undefined });
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot()).toMatchObject({
    pending: undefined,
    retryBlocked: false,
    draft: 'Keep draft',
    turns: [expect.objectContaining({ runStatus: 'running' })],
  });
  expect(client.session).toHaveBeenCalledOnce();
  expect(client.turns).toHaveBeenCalledOnce();
  expect(client.send).not.toHaveBeenCalled();
});
it('keeps paused nonterminal rows and uncertainty visible through explicit refresh and refuses selection that would discard them', async () => {
  vi.useFakeTimers();
  const { controller, client } = create();
  const row = activeProjection(0);
  client.conversations.mockResolvedValue([conversation]);
  client.turns.mockResolvedValue([row]);
  await controller.refresh();
  client.request.mockRejectedValue(new ChatApiError(410, 'UNKNOWN', 'Unresolved.'));
  await vi.advanceTimersByTimeAsync(1000);
  client.request.mockResolvedValue({ ...row, runStatus: 'paused' });
  client.turns.mockResolvedValue([]);
  await controller.refresh();
  expect(controller.getSnapshot()).toMatchObject({
    pending: undefined,
    retryBlocked: true,
    error: expect.stringContaining('Unresolved.'),
    turns: [expect.objectContaining({ runStatus: 'paused' })],
  });
  await controller.selectConversation(turn.runId);
  expect(controller.getSnapshot().conversationId).toBe(conversation.id);
});

it('uncertainty forbids a repeated cancel of that turn while an unrelated acknowledged turn can cancel', async () => {
  vi.useFakeTimers();
  const { controller, client } = create();
  const rows = [activeProjection(0), activeProjection(1)];
  client.conversations.mockResolvedValue([conversation]);
  client.turns.mockResolvedValue(rows);
  await controller.refresh();
  client.request.mockImplementation((_id, requestId) =>
    requestId === rows[0]!.requestId
      ? Promise.reject(new ChatApiError(410, 'UNKNOWN', 'Unresolved.'))
      : Promise.resolve(rows[1]!),
  );
  await vi.advanceTimersByTimeAsync(1000);
  await controller.cancel(rows[0]!.id);
  expect(client.cancel).not.toHaveBeenCalled();
  const cancelled = { ...rows[1]!, runStatus: 'cancelled' as const };
  client.cancel.mockResolvedValue(cancelled);
  client.turns.mockResolvedValue([rows[0]!, cancelled]);
  await controller.cancel(rows[1]!.id);
  expect(client.cancel).toHaveBeenCalledOnce();
  expect(client.cancel).toHaveBeenCalledWith(rows[1]!.id);
  expect(client.send).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({ retryBlocked: true, pending: undefined });
  expect(client.session).toHaveBeenCalledTimes(2);
});

describe('expected pending request absence', () => {
  it('keeps unacknowledged guidance and the independent one-second polling cadence through pending 404s', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
    const { controller, client } = create();
    const row = activeProjection(0);
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([row]);
    client.request.mockImplementation((_id, requestId) =>
      requestId === pending.request.requestId ? Promise.reject(missing) : Promise.resolve(row),
    );
    await controller.refresh();
    const guidance = controller.getSnapshot().error;
    expect(guidance).toBe(
      'The gateway has not acknowledged this message. Check its status or explicitly retry the same request.',
    );
    client.request.mockClear();
    for (let tick = 1; tick <= 6; tick++) {
      await vi.advanceTimersByTimeAsync(1000);
      expect(client.request).toHaveBeenCalledTimes(tick * 2);
      expect(controller.getSnapshot()).toMatchObject({
        error: guidance,
        pending,
        turns: [row],
        draft: 'Keep draft',
        retryBlocked: false,
      });
    }
    expect(client.session).toHaveBeenCalledOnce();
    expect(client.conversations).toHaveBeenCalledOnce();
    expect(client.turns).toHaveBeenCalledOnce();
    expect(client.send).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
      pending,
      draft: 'Keep draft',
    });
  });
  it('still reports and backs off a real active-target failure alongside a pending 404', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(key, JSON.stringify({ draft: 'Keep draft', pending }));
    const { controller, client } = create();
    const row = activeProjection(0);
    client.conversations.mockResolvedValue([conversation]);
    client.turns.mockResolvedValue([row]);
    client.request.mockRejectedValue(missing);
    await controller.refresh();
    client.request.mockClear();
    client.request.mockImplementation((_id, requestId) =>
      Promise.reject(
        requestId === pending.request.requestId
          ? missing
          : new ChatApiError(503, 'TEMPORARY', 'Temporary active read failure.'),
      ),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().error).toBe('Temporary active read failure.');
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.request).toHaveBeenCalledTimes(4);
    expect(controller.getSnapshot().pending).toEqual(pending);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('does not automatically retry an idle failed full refresh and recovers on explicit retry', async () => {
    vi.useFakeTimers();
    const { controller, client } = create();
    client.session.mockRejectedValueOnce(new TypeError('restarting'));
    await controller.refresh();
    expect(controller.getSnapshot().error).toBeDefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.session).toHaveBeenCalledOnce();
    expect(client.request).not.toHaveBeenCalled();
    await controller.refresh();
    expect(client.session).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      session,
      error: undefined,
      pending: undefined,
    });
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('definite text refusal preserves the draft (review4504383697)', () => {
  const refusals = [
    { status: 429, code: 'RATE_LIMITED' },
    { status: 409, code: 'CHAT_BUSY' },
  ];
  it.each(refusals)(
    'restores and persists text after $status $code; a later explicit send has a new identity',
    async ({ status, code }) => {
      const { controller, client } = create();
      await controller.refresh();
      controller.setDraft('Keep this exact text.');
      client.send.mockRejectedValue(new ChatApiError(status, code, 'Try later.'));
      await controller.send({ kind: 'text', text: 'Keep this exact text.' });
      expect(controller.getSnapshot()).toMatchObject({
        draft: 'Keep this exact text.',
        pending: undefined,
        error: 'Try later.',
        sending: false,
      });
      const refusedId = client.send.mock.calls[0]![1].requestId;
      expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
        draft: 'Keep this exact text.',
        conversationId: conversation.id,
      });
      expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
      await controller.retryPending();
      expect(client.send).toHaveBeenCalledOnce();
      const reload = create();
      await reload.controller.refresh();
      expect(reload.controller.getSnapshot().draft).toBe('Keep this exact text.');
      expect(reload.client.send).not.toHaveBeenCalled();
      expect(reload.client.request).not.toHaveBeenCalled();
      await reload.controller.send({ kind: 'text', text: reload.controller.getSnapshot().draft });
      expect(reload.client.send).toHaveBeenCalledOnce();
      expect(reload.client.send.mock.calls[0]![1].requestId).not.toBe(refusedId);
    },
  );
  it.each(refusals)(
    'preserves a newer draft when $status $code refuses the earlier text',
    async ({ status, code }) => {
      const { controller, client } = create();
      await controller.refresh();
      controller.setDraft('Earlier text');
      client.send.mockImplementation(() => {
        controller.setDraft('A newer draft');
        return Promise.reject(new ChatApiError(status, code, 'Try later.'));
      });
      await controller.send({ kind: 'text', text: 'Earlier text' });
      expect(controller.getSnapshot()).toMatchObject({
        pending: undefined,
        draft: 'A newer draft',
      });
      expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ draft: 'A newer draft' });
      expect(client.send).toHaveBeenCalledOnce();
    },
  );
  it('preserves a newer edit that the user subsequently cleared to empty', async () => {
    const { controller, client } = create();
    await controller.refresh();
    controller.setDraft('Earlier text');
    client.send.mockImplementation(() => {
      controller.setDraft('Newer');
      controller.setDraft('');
      return Promise.reject(new ChatApiError(429, 'RATE_LIMITED', 'Try later.'));
    });
    await controller.send({ kind: 'text', text: 'Earlier text' });
    expect(controller.getSnapshot()).toMatchObject({ pending: undefined, draft: '' });
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ draft: '' });
  });
  it('keeps the original restoration guard across an explicit same-identity retry', async () => {
    const { controller, client } = create();
    await controller.refresh();
    controller.setDraft('Earlier text');
    client.send
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockRejectedValueOnce(new ChatApiError(429, 'RATE_LIMITED', 'Try later.'));
    await controller.send({ kind: 'text', text: 'Earlier text' });
    const identity = controller.getSnapshot().pending!;
    expect(controller.getSnapshot()).toMatchObject({ draft: '', pending: identity });
    await controller.retryPending();
    expect(client.send.mock.calls[1]![1]).toEqual(identity.request);
    expect(controller.getSnapshot()).toMatchObject({ pending: undefined, draft: 'Earlier text' });
  });
  it('never resets the guard at retry after a newer edit was cleared', async () => {
    const { controller, client } = create();
    await controller.refresh();
    controller.setDraft('Earlier text');
    client.send
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockRejectedValueOnce(new ChatApiError(409, 'CHAT_BUSY', 'Busy.'));
    await controller.send({ kind: 'text', text: 'Earlier text' });
    controller.setDraft('Newer');
    controller.setDraft('');
    await controller.retryPending();
    expect(controller.getSnapshot()).toMatchObject({ pending: undefined, draft: '' });
    expect(client.send).toHaveBeenCalledTimes(2);
  });
  it.each(['', 'A saved newer draft'])(
    'initializes reload restoration only for an empty saved draft (%s)',
    async (draft) => {
      sessionStorage.setItem(key, JSON.stringify({ draft, pending }));
      const { controller, client } = create();
      client.request.mockRejectedValue(missing);
      await controller.refresh();
      if (draft) controller.setDraft('');
      client.send.mockRejectedValue(new ChatApiError(429, 'RATE_LIMITED', 'Try later.'));
      await controller.retryPending();
      expect(controller.getSnapshot()).toMatchObject({
        pending: undefined,
        draft: draft ? '' : 'Hello',
      });
      expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
    },
  );
  it('does not clear or replace a newer draft written while conversation creation is pending', async () => {
    const { controller, client } = create();
    await controller.refresh();
    controller.setDraft('Earlier text');
    let finish!: (value: typeof conversation) => void;
    client.createConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    client.send.mockRejectedValue(new ChatApiError(409, 'CHAT_BUSY', 'Busy.'));
    const posting = controller.send({ kind: 'text', text: 'Earlier text' });
    controller.setDraft('Newer while creating');
    finish(conversation);
    await posting;
    expect(controller.getSnapshot()).toMatchObject({
      pending: undefined,
      draft: 'Newer while creating',
    });
    expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
      draft: 'Newer while creating',
    });
  });
  it('keeps audio refusal and uncertain transport semantics separate from restored text', async () => {
    const { controller, client } = create();
    client.session.mockResolvedValue({
      ...session,
      readiness: { text: { ready: true }, audio: { ready: true } },
    });
    await controller.refresh();
    client.send.mockRejectedValueOnce(new ChatApiError(429, 'RATE_LIMITED', 'Try later.'));
    await controller.send({ kind: 'audio', audioId: turn.id });
    expect(controller.getSnapshot()).toMatchObject({ draft: '', pending: undefined });
    client.send.mockRejectedValueOnce(new ChatApiError(503, 'UNAVAILABLE', 'Unknown admission.'));
    await controller.send({ kind: 'text', text: 'Uncertain text' });
    expect(controller.getSnapshot()).toMatchObject({
      draft: '',
      pending: { request: { input: { kind: 'text', text: 'Uncertain text' } } },
    });
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});

it('retires an exactly matched refused request without restoring into another selected conversation (review4504383697)', async () => {
  const { controller, client } = create();
  await controller.refresh();
  controller.setDraft('Refused text');
  const otherConversationId = '01J00000000000000000000009';
  client.send.mockImplementation(() => {
    // Defensive state injection: ordinary UI guards prevent selection while a send is pending.
    controller.getSnapshot().conversationId = otherConversationId;
    return Promise.reject(new ChatApiError(429, 'RATE_LIMITED', 'Try later.'));
  });
  await controller.send({ kind: 'text', text: 'Refused text' });
  expect(controller.getSnapshot()).toMatchObject({
    pending: undefined,
    conversationId: otherConversationId,
    draft: '',
  });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({
    conversationId: otherConversationId,
    draft: '',
  });
  expect(JSON.parse(sessionStorage.getItem(key)!)).not.toHaveProperty('pending');
  await controller.retryPending();
  expect(client.send).toHaveBeenCalledOnce();
});
