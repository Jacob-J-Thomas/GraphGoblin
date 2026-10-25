import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_IDS, FIXTURE_TS, samplePin } from '@graphgoblin/contracts/testing';
import { createGraphGoblinClient, observeRun, waitForRun, type FetchLike } from './index.js';

function snapshot(status: string) {
  return {
    id: FIXTURE_IDS.run,
    ownerId: 'local',
    loopId: FIXTURE_IDS.loop,
    versionId: FIXTURE_IDS.version,
    pinned: samplePin(),
    invocationId: FIXTURE_IDS.invocation,
    status,
    ...(['succeeded', 'failed', 'cancelled', 'exhausted'].includes(status)
      ? { finalizedAt: FIXTURE_TS }
      : {}),
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 1,
  };
}

/** Answers `GET /runs/{id}` with each status in turn, repeating the last one. */
function statuses(...sequence: string[]): { fetch: FetchLike; calls: () => number } {
  let calls = 0;
  const fetch: FetchLike = () => {
    const status = sequence[Math.min(calls, sequence.length - 1)]!;
    calls += 1;
    return Promise.resolve(Response.json(snapshot(status)));
  };
  return { fetch, calls: () => calls };
}

describe('waitForRun', () => {
  afterEach(() => vi.useRealTimers());

  it('interrupts a stalled request on caller abort with the exact reason before any timer fires', async () => {
    vi.useFakeTimers();
    const requests: Request[] = [];
    const controller = new AbortController();
    const reason = { stop: 'observation only' };
    let requested!: (request: Request) => void;
    const entered = new Promise<Request>((resolve) => {
      requested = resolve;
    });
    let respond!: (response: Response) => void;
    const pending = waitForRun(
      createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: (request) => {
          requests.push(request);
          requested(request);
          return new Promise<Response>((resolve) => {
            respond = resolve;
          });
        },
      }),
      FIXTURE_IDS.run,
      { timeoutMs: 60_000, signal: controller.signal },
    );
    let outcome: unknown = 'pending';
    const settled = pending.then(
      () => {
        outcome = 'resolved';
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    const request = await entered;
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 0);
    controller.abort(reason);
    await settled;
    expect(request.signal.aborted).toBe(true);
    expect(outcome).toBe(reason);
    expect(timerFired).toBe(false);
    respond(Response.json(snapshot('succeeded')));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe(reason);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('resolves at the deadline without a snapshot and ignores a late success', async () => {
    vi.useFakeTimers();
    const requests: Request[] = [];
    let respond!: (response: Response) => void;
    const pending = waitForRun(
      createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: (request) => {
          requests.push(request);
          return new Promise<Response>((resolve) => {
            respond = resolve;
          });
        },
      }),
      FIXTURE_IDS.run,
      { timeoutMs: 100, now: Date.now },
    );
    let outcome: unknown = 'pending';
    const settled = pending.then((result) => {
      outcome = result;
    });
    await vi.advanceTimersByTimeAsync(100);
    const atDeadline = outcome;
    const requestAborted = requests[0]!.signal.aborted;
    respond(Response.json(snapshot('succeeded')));
    await settled;
    expect(atDeadline).toEqual({ finished: false });
    expect(requestAborted).toBe(true);
    expect(outcome).toEqual({ finished: false });
    expect(requests).toHaveLength(1);
  });

  it('polls until a terminal status', async () => {
    const { fetch, calls } = statuses('queued', 'running', 'failed');
    const delays: number[] = [];
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 10_000,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(result.finished).toBe(true);
    expect(result.run?.status).toBe('failed');
    expect(calls()).toBe(3);
    expect(delays).toEqual([1000, 1000]);
  });

  it('returns the latest snapshot when the timeout elapses, never sleeping past it', async () => {
    const { fetch } = statuses('waiting');
    let clock = 0;
    const delays: number[] = [];
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 250,
        pollMs: 100,
        now: () => clock,
        sleep: (ms) => {
          delays.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      },
    );
    expect(result).toMatchObject({ finished: false, run: { status: 'waiting' } });
    expect(delays).toEqual([100, 100, 50]);
  });

  it('uses the real clock and timer by default', async () => {
    const { fetch } = statuses('running');
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 20, pollMs: 5 },
    );
    expect(result.finished).toBe(false);
  });

  it('rejects with the abort reason when the signal fires', async () => {
    const { fetch } = statuses('running');
    const controller = new AbortController();
    const pending = waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 60_000, pollMs: 60_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('stop waiting')), 5);
    await expect(pending).rejects.toThrow('stop waiting');
  });
});

describe('observation budgets', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects an already aborted caller without making any request', async () => {
    const { fetch, calls } = statuses('succeeded');
    const controller = new AbortController();
    const reason = new Error('already stopped');
    controller.abort(reason);
    await expect(
      waitForRun(createGraphGoblinClient({ baseUrl: 'http://api', fetch }), FIXTURE_IDS.run, {
        timeoutMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(calls()).toBe(0);
  });

  it('returns no snapshot and makes no request with a zero budget', async () => {
    const { fetch, calls } = statuses('succeeded');
    await expect(
      waitForRun(createGraphGoblinClient({ baseUrl: 'http://api', fetch }), FIXTURE_IDS.run, {
        timeoutMs: 0,
      }),
    ).resolves.toEqual({ finished: false });
    expect(calls()).toBe(0);
  });

  it('returns a fast success and disposes its deadline', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = statuses('succeeded');
    const result = await waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 100 },
    );
    expect(result).toMatchObject({ finished: true, run: { status: 'succeeded' } });
    expect(calls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a response at the clock deadline even before the timer callback runs', async () => {
    let clock = 0;
    const client = createGraphGoblinClient({
      baseUrl: 'http://api',
      fetch: () => {
        clock = 100;
        return Promise.resolve(Response.json(snapshot('succeeded')));
      },
    });
    await expect(
      waitForRun(client, FIXTURE_IDS.run, { timeoutMs: 100, now: () => clock }),
    ).resolves.toEqual({ finished: false });
  });

  it.each(['request', 'sleep', 'body', 'progress'] as const)(
    'keeps the last timely snapshot when a %s stalls past the deadline',
    async (stall) => {
      vi.useFakeTimers();
      const requests: Request[] = [];
      const delays: AbortSignal[] = [];
      const polls: number[] = [];
      const client = createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: (request) => {
          requests.push(request);
          if (requests.length === 1) return Promise.resolve(Response.json(snapshot('running')));
          if (stall === 'body')
            return Promise.resolve(
              new Response(new ReadableStream<Uint8Array>(), {
                headers: { 'content-type': 'application/json' },
              }),
            );
          return new Promise<Response>(() => undefined);
        },
      });
      const pending = observeRun(
        client,
        FIXTURE_IDS.run,
        {
          timeoutMs: 100,
          pollMs: 10,
          sleep: (_ms, signal) => {
            delays.push(signal);
            return stall === 'sleep' ? new Promise<void>(() => undefined) : Promise.resolve();
          },
        },
        {
          onPoll: (_run, poll) => {
            polls.push(poll);
            return stall === 'progress' ? new Promise<void>(() => undefined) : undefined;
          },
        },
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toMatchObject({ finished: false, run: { status: 'running' } });
      expect(polls).toEqual([1]);
      expect(requests.every((request) => request.signal.aborted)).toBe(true);
      expect(delays.every((signal) => signal.aborted)).toBe(true);
      expect(requests.map((request) => request.method)).toEqual(
        stall === 'request' || stall === 'body' ? ['GET', 'GET'] : ['GET'],
      );
    },
  );

  it('aborts a non-cooperating sleep with the caller reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stop sleeping');
    const { fetch, calls } = statuses('running');
    let entered!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = waitForRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 60_000,
        signal: controller.signal,
        sleep: () => {
          entered();
          return new Promise<void>(() => undefined);
        },
      },
    );
    await sleeping;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls()).toBe(1);
  });

  it('propagates ordinary request, sleep and observer failures', async () => {
    const client = createGraphGoblinClient({
      baseUrl: 'http://api',
      fetch: () => Promise.reject(new Error('network down')),
    });
    await expect(waitForRun(client, FIXTURE_IDS.run, { timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    const { fetch } = statuses('running');
    const running = createGraphGoblinClient({ baseUrl: 'http://api', fetch });
    const failure = new Error('observer failed');
    await expect(
      observeRun(
        running,
        FIXTURE_IDS.run,
        { timeoutMs: 1000 },
        {
          onPoll: () => {
            throw failure;
          },
        },
      ),
    ).rejects.toBe(failure);
    await expect(
      waitForRun(running, FIXTURE_IDS.run, {
        timeoutMs: 1000,
        sleep: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });

  it('stops for caller action before progress or another poll', async () => {
    const { fetch, calls } = statuses('paused');
    const polls: number[] = [];
    await expect(
      observeRun(
        createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
        FIXTURE_IDS.run,
        { timeoutMs: 1000 },
        {
          stopWhen: () => true,
          onPoll: (_run, poll) => {
            polls.push(poll);
          },
        },
      ),
    ).resolves.toMatchObject({ finished: false, run: { status: 'paused' } });
    expect(calls()).toBe(1);
    expect(polls).toEqual([]);
  });
});

it('keeps long deadlines within the JavaScript timer limit and cleans up after abort', async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const reason = new Error('done with long observation');
    const pending = waitForRun(
      createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: () => new Promise<Response>(() => undefined),
      }),
      FIXTURE_IDS.run,
      {
        timeoutMs: 2_147_483_747,
        signal: controller.signal,
      },
    );
    let settled = false;
    const observed = pending.catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(reason);
    expect(await observed).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('resolves a long deadline at timeoutMs rather than the timer chunk boundary', async () => {
  vi.useFakeTimers();
  try {
    const timeoutMs = 2_147_483_747;
    const started = Date.now();
    const requests: Request[] = [];
    const pending = waitForRun(
      createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: (request) => {
          requests.push(request);
          return new Promise<Response>(() => undefined);
        },
      }),
      FIXTURE_IDS.run,
      { timeoutMs },
    );
    let outcome: unknown = 'pending';
    const settled = pending.then((result) => {
      outcome = result;
    });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(99);
    expect(outcome).toBe('pending');
    expect(requests[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(Date.now() - started).toBe(timeoutMs);
    expect(outcome).toEqual({ finished: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('preserves a caller abort raised during observation before starting a sleep', async () => {
  const controller = new AbortController();
  const reason = new Error('stop in callback');
  const { fetch, calls } = statuses('running');
  await expect(
    observeRun(
      createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      FIXTURE_IDS.run,
      { timeoutMs: 1000, signal: controller.signal },
      {
        onPoll: () => {
          controller.abort(reason);
        },
      },
    ),
  ).rejects.toBe(reason);
  expect(calls()).toBe(1);
});

it('consumes a late transport rejection after the deadline', async () => {
  vi.useFakeTimers();
  try {
    let fail!: (error: Error) => void;
    const pending = waitForRun(
      createGraphGoblinClient({
        baseUrl: 'http://api',
        fetch: () =>
          new Promise<Response>((_resolve, reject) => {
            fail = reject;
          }),
      }),
      FIXTURE_IDS.run,
      { timeoutMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual({ finished: false });
    fail(new Error('late transport failure'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toEqual({ finished: false });
  } finally {
    vi.useRealTimers();
  }
});

it('keeps successful execution pending until the durable finalization acknowledgement', async () => {
  let polls = 0;
  const run = snapshot('succeeded');
  const client = createGraphGoblinClient({
    baseUrl: 'http://api',
    fetch: () => {
      polls += 1;
      const { finalizedAt: _finalizedAt, ...pending } = run;
      return Promise.resolve(Response.json(polls === 1 ? pending : run));
    },
  });
  const observed: string[] = [];
  const result = await waitForRun(client, FIXTURE_IDS.run, {
    timeoutMs: 1000,
    pollMs: 1,
    sleep: () => {
      observed.push('pending');
      return Promise.resolve();
    },
  });
  expect(observed).toEqual(['pending']);
  expect(polls).toBe(2);
  expect(result).toEqual({ finished: true, run });
});

it('does not hide pending delivery evidence behind a finalization acknowledgement', async () => {
  let polls = 0;
  const run = snapshot('succeeded');
  const client = createGraphGoblinClient({
    baseUrl: 'http://api',
    fetch: () => {
      polls++;
      return Promise.resolve(
        Response.json({
          ...run,
          deliveries: [
            {
              id: 'delivery-id',
              channel: { kind: 'webhook', url: 'https://example.test' },
              status: polls === 1 ? 'pending' : 'delivered',
              attempts: 1,
              maxAttempts: 5,
              inFlight: polls === 1,
              acknowledgement: polls === 1 ? 'unknown' : 'accepted',
              effectMayHaveHappened: true,
              acknowledgementUncertain: false,
            },
          ],
        }),
      );
    },
  });
  const result = await waitForRun(client, FIXTURE_IDS.run, { timeoutMs: 1000, pollMs: 1 });
  expect(result.finished).toBe(true);
  expect(polls).toBe(2);
});
