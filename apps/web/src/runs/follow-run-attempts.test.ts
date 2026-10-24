import type { RunFailure } from '@graphgoblin/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppClient } from '../api/context.js';
import { event, runRecord } from '../__fixtures__/fake-api.js';
import { followRunAttempts } from './follow-run-attempts.js';

afterEach(() => vi.useRealTimers());
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const failure: RunFailure = { code: 'SCRIPT_EXIT_CODE', message: 'failure', resumable: true };
const resumed = (seq: number) =>
  event(id, seq, 'run.resumed', { actor: { kind: 'user', id: 'test' } });
function observer(start = 0) {
  let cursor = start;
  const recorded: ReturnType<typeof resumed>[] = [];
  return {
    events: () => recorded,
    changed: vi.fn(),
    cursor: () => cursor,
    append: vi.fn((events: ReturnType<typeof resumed>[]) => {
      recorded.push(...events);
      cursor = events.at(-1)?.seq ?? cursor;
    }),
    running: vi.fn(),
    finished: vi.fn(),
    error: vi.fn(),
  };
}
it('catches up across historical terminals in pages and stops at the captured boundary', async () => {
  vi.useFakeTimers();
  const read = vi.fn((request: Request) => {
    const url = new URL(request.url);
    if (!url.pathname.endsWith('/events'))
      return Promise.resolve(
        Response.json(runRecord({ id, status: 'succeeded', lastEventSeq: 4 })),
      );
    const after = Number(url.searchParams.get('after'));
    const item =
      after === 1
        ? event(id, 2, 'run.failed', { failure })
        : after === 2
          ? resumed(3)
          : event(id, 4, 'run.finished', { status: 'succeeded', outcome: 'success' });
    return Promise.resolve(Response.json({ items: [item], nextAfter: after + 1, hasMore: true }));
  });
  const o = observer(1);
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  await vi.advanceTimersByTimeAsync(0);
  expect(o.cursor()).toBe(4);
  expect(read).toHaveBeenCalledTimes(4);
  expect(o.finished).toHaveBeenCalledOnce();
  expect(o.error).not.toHaveBeenCalled();
  stop();
});
it('checks a resumable failure, catches up, then opens a new live tail', async () => {
  vi.useFakeTimers();
  let running = false;
  const read = vi.fn((request: Request) =>
    Promise.resolve(
      Response.json(
        request.url.includes('/events')
          ? { items: [resumed(2)], nextAfter: 2, hasMore: false }
          : runRecord({
              id,
              status: running ? 'running' : 'failed',
              failure,
              lastEventSeq: running ? 2 : 1,
            }),
      ),
    ),
  );
  const o = observer(1);
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  await vi.advanceTimersByTimeAsync(0);
  expect(o.finished).toHaveBeenCalledOnce();
  running = true;
  await vi.advanceTimersByTimeAsync(2_000);
  expect(o.running).toHaveBeenCalledOnce();
  expect(o.cursor()).toBe(2);
  stop();
  await vi.advanceTimersByTimeAsync(2_000 * 2);
  expect(read).toHaveBeenCalledTimes(3);
});
it.each(['failed', 'cancelled'] as const)('does not poll non-resumable %s', async (status) => {
  vi.useFakeTimers();
  const read = vi.fn(() =>
    Promise.resolve(Response.json(runRecord({ id, status, lastEventSeq: 0 }))),
  );
  const o = observer();
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  await vi.advanceTimersByTimeAsync(2_000 * 2);
  expect(read).toHaveBeenCalledOnce();
  expect(o.finished).toHaveBeenCalledOnce();
  stop();
});
it('reports read errors and a non-advancing page', async () => {
  vi.useFakeTimers();
  for (const network of [true, false]) {
    const read = (request: Request) => {
      if (network) return Promise.reject(new Error('offline'));
      return Promise.resolve(
        Response.json(
          request.url.includes('/events')
            ? { items: [], hasMore: true, nextAfter: 0 }
            : runRecord({ id, lastEventSeq: 2 }),
        ),
      );
    };
    const o = observer();
    const stop = followRunAttempts(createAppClient('http://test', read), id, o);
    await vi.advanceTimersByTimeAsync(0);
    expect(o.error).toHaveBeenCalledOnce();
    expect(o.running).not.toHaveBeenCalled();
    stop();
  }
});
it.each([false, true])(
  'cancels an in-flight read (page=%s) without publishing or reporting an error',
  async (page) => {
    vi.useFakeTimers();
    let resolveRead!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveRead = resolve;
    });
    const read = (request: Request) =>
      page && !request.url.includes('/events')
        ? Promise.resolve(Response.json(runRecord({ id, lastEventSeq: 1 })))
        : pending;
    const o = observer();
    const stop = followRunAttempts(createAppClient('http://test', read), id, o);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolveRead(
      Response.json(
        page ? { items: [resumed(1)], hasMore: false, nextAfter: 1 } : runRecord({ id }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(o.append).not.toHaveBeenCalled();
    expect(o.running).not.toHaveBeenCalled();
    expect(o.error).not.toHaveBeenCalled();
  },
);

it('recovers observation after a transport loss with bounded backoff, preserving the cursor', async () => {
  vi.useFakeTimers();
  let offline = true;
  const read = vi.fn(() =>
    offline
      ? Promise.reject(new TypeError('offline'))
      : Promise.resolve(Response.json(runRecord({ id, status: 'running', lastEventSeq: 7 }))),
  );
  const o = observer(7);
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read.mock.calls.length).toBeLessThan(10);
  expect(o.error).toHaveBeenCalled();
  offline = false;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(o.running).toHaveBeenCalledOnce();
  expect(o.cursor()).toBe(7);
  stop();
});

it('exposes a permanent HTTP refusal without retrying it', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() =>
    Promise.resolve(
      Response.json(
        {
          type: 'about:blank',
          title: 'RUN_NOT_FOUND',
          status: 404,
          code: 'RUN_NOT_FOUND',
        },
        { status: 404 },
      ),
    ),
  );
  const o = observer();
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledOnce();
  expect(o.error).toHaveBeenCalledOnce();
  stop();
});

it('settles completion that overtakes the captured run snapshot and refreshes the lagging snapshot', async () => {
  vi.useFakeTimers();
  const active = runRecord({ id, status: 'running', currentNodeId: 'done', lastEventSeq: 2 });
  let current = active;
  const tail = [
    event(id, 2, 'run.started', { attempt: 1 }),
    event(id, 3, 'node.started', {
      nodeId: 'done',
      kind: 'exit',
      attempt: 1,
      configHash: '0'.repeat(64),
    }),
    event(id, 4, 'exit.evaluated', { nodeId: 'done', outcome: 'success' }),
    event(id, 5, 'node.finished', { nodeId: 'done', patch: [], durationMs: 1 }),
    event(id, 6, 'run.finished', { status: 'succeeded', outcome: 'success' }),
  ];
  const read = vi.fn((request: Request) => {
    if (request.url.includes('/events')) {
      current = { ...active, status: 'succeeded', lastEventSeq: 6 };
      return Promise.resolve(Response.json({ items: tail, nextAfter: 6, hasMore: false }));
    }
    return Promise.resolve(Response.json(current));
  });
  const o = observer();
  o.append([event(id, 1, 'run.queued', { versionId: active.versionId, pinned: active.pinned })]);
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(o.finished).toHaveBeenCalledOnce();
    expect(o.running).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(o.changed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    stop();
  }
});

it('reports a final page that cannot reach the observed run cursor', async () => {
  vi.useFakeTimers();
  const read = (request: Request) =>
    Promise.resolve(
      Response.json(
        request.url.includes('/events')
          ? { items: [], nextAfter: 0, hasMore: false }
          : runRecord({ id, lastEventSeq: 3 }),
      ),
    );
  const o = observer();
  const stop = followRunAttempts(createAppClient('http://test', read), id, o);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(o.error).toHaveBeenCalledOnce();
    expect(o.running).not.toHaveBeenCalled();
    expect(o.finished).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});
