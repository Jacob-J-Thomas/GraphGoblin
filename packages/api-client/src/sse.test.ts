import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  createGraphGoblinClient,
  GraphGoblinApiError,
  RunEventParseError,
  SseParser,
  subscribeRunEvents,
  type FetchLike,
} from './index.js';
import { defaultSleep } from './sse.js';

const runId = FIXTURE_IDS.run;

function event(seq: number, type: 'run.queued' | 'run.cancelled' = 'run.queued'): RunEvent {
  return { runId, seq, ts: FIXTURE_TS, type };
}

function frame(e: RunEvent): string {
  return `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** A response whose body yields `chunks`, then ends (or errors when `fail` is set). */
function stream(chunks: string[], init: { fail?: boolean; status?: number } = {}): Response {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (init.fail) controller.error(new TypeError('terminated'));
      else controller.close();
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A fetch that answers each call with the next scripted response and records request URLs. */
function scripted(responses: Array<Response | Error | (() => Response)>): {
  fetch: FetchLike;
  urls: string[];
  requests: Request[];
} {
  const urls: string[] = [];
  const requests: Request[] = [];
  const fetch: FetchLike = (request) => {
    urls.push(request.url);
    requests.push(request);
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error('no more scripted responses'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(typeof next === 'function' ? next() : next);
  };
  return { fetch, urls, requests };
}

function recordingSleep(): {
  delays: number[];
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
} {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe('SseParser', () => {
  it('parses id, event, and multi-line data; ignores comments and unknown fields', () => {
    const parser = new SseParser();
    expect(
      parser.push(': connected\n\nid: 1\nevent: x\nretry: 10\ndata: a\ndata:b\ndata\n\n'),
    ).toEqual([{ id: '1', event: 'x', data: 'a\nb\n' }]);
  });

  it('handles CRLF and CR endings, including a CRLF split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: one\r')).toEqual([]);
    expect(parser.push('\n\r\ndata: two\r\r')).toEqual([{ data: 'one' }]);
    expect(parser.push('data: three\n\n')).toEqual([{ data: 'two' }, { data: 'three' }]);
  });

  it('buffers partial lines and drops frames without data', () => {
    const parser = new SseParser();
    expect(parser.push('id: 7\n\nda')).toEqual([]);
    expect(parser.push('ta: x\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ data: 'x' }]);
  });
});

describe('subscribeRunEvents', () => {
  it('delivers validated events in order, skips replays, and stops after a terminal event', async () => {
    const { fetch, urls, requests } = scripted([
      stream([
        frame(event(1)),
        frame(event(1)),
        frame(event(2)).slice(0, 10),
        frame(event(2)).slice(10),
      ]),
      stream([
        ': heartbeat\n\n',
        frame(event(2)),
        frame(event(3, 'run.cancelled')),
        frame(event(4)),
      ]),
    ]);
    const { delays, sleep } = recordingSleep();
    const errors: unknown[] = [];
    const seen: number[] = [];
    const client = createGraphGoblinClient({ baseUrl: 'http://api', apiKey: 'k', fetch });
    const subscription = subscribeRunEvents({
      client,
      runId,
      onEvent: async (e) => {
        await Promise.resolve();
        seen.push(e.seq);
      },
      onError: (error, attempt) => errors.push([attempt, (error as Error).message]),
      sleep,
    });
    await subscription.done;
    expect(seen).toEqual([1, 2, 3]);
    expect(subscription.lastSeq).toBe(3);
    expect(urls).toEqual([
      `http://api/runs/${runId}/events?after=0`,
      `http://api/runs/${runId}/events?after=2`,
    ]);
    expect(requests[0]?.headers.get('accept')).toBe('text/event-stream');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer k');
    expect(errors).toEqual([[1, 'the event stream closed before the run finished']]);
    expect(delays).toEqual([500]);
  });

  it('reports invalid frames, advances past their id, and keeps going', async () => {
    const { fetch, urls } = scripted([
      stream(['id: 1\ndata: {not json\n\n', 'data: {"type":"nope"}\n\n']),
      stream([frame(event(2, 'run.cancelled'))]),
    ]);
    const errors: unknown[] = [];
    const seen: number[] = [];
    await subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      onEvent: (e) => {
        seen.push(e.seq);
      },
      onError: (error) => errors.push(error),
      sleep: recordingSleep().sleep,
    }).done;
    expect(seen).toEqual([2]);
    expect(errors[0]).toBeInstanceOf(RunEventParseError);
    expect((errors[0] as RunEventParseError).message).toBe('invalid run event frame 1');
    expect((errors[1] as RunEventParseError).message).toBe('invalid run event frame');
    expect(urls[1]).toMatch(/after=1$/);
  });

  it('retries refused connections and retryable statuses with capped exponential backoff', async () => {
    const { fetch, urls } = scripted([
      new TypeError('fetch failed'),
      new Response('busy', { status: 503 }),
      new Response('{"status":429,"code":"RATE_LIMITED"}', { status: 429 }),
      new Response('', { status: 408 }),
      new Response('', { status: 425 }),
      stream([frame(event(5, 'run.cancelled'))]),
    ]);
    const { delays, sleep } = recordingSleep();
    const attempts: number[] = [];
    await subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      after: 4,
      onEvent: () => undefined,
      onError: (_e, attempt) => attempts.push(attempt),
      backoff: { initialMs: 100, factor: 3, maxMs: 1000 },
      sleep,
    }).done;
    expect(delays).toEqual([100, 300, 900, 1000, 1000]);
    expect(attempts).toEqual([1, 2, 3, 4, 5]);
    expect(urls.every((u) => u.endsWith('after=4'))).toBe(true);
  });

  it('gives up after maxAttempts consecutive failures', async () => {
    const { fetch } = scripted([new TypeError('down'), new TypeError('still down')]);
    const subscription = subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      onEvent: () => undefined,
      backoff: { maxAttempts: 2 },
      sleep: recordingSleep().sleep,
    });
    const error = await subscription.done.catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/gave up .* after 2 attempts/);
    expect((error as Error).cause).toMatchObject({ message: 'still down' });
  });

  it('rejects without retrying on non-retryable statuses and on a missing body', async () => {
    const notFound = scripted([
      new Response('{"status":404,"code":"RUN_NOT_FOUND"}', { status: 404 }),
    ]);
    await expect(
      subscribeRunEvents({
        client: createGraphGoblinClient({ baseUrl: 'http://api', fetch: notFound.fetch }),
        runId,
        onEvent: () => undefined,
      }).done,
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });

    const unauthorised = scripted([new Response('nope', { status: 401 })]);
    const error = await subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch: unauthorised.fetch }),
      runId,
      onEvent: () => undefined,
    }).done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphGoblinApiError);
    expect(error).toMatchObject({ code: 'HTTP_401', detail: 'nope' });

    const bodiless = scripted([new Response(null, { status: 200 })]);
    await expect(
      subscribeRunEvents({
        client: createGraphGoblinClient({ baseUrl: 'http://api', fetch: bodiless.fetch }),
        runId,
        onEvent: () => undefined,
      }).done,
    ).rejects.toThrow('the event stream response has no body');
  });

  it('tolerates an unreadable error body', async () => {
    const broken = new Response(stream([], { fail: true }).body, { status: 500 });
    const { fetch } = scripted([broken]);
    const error = await subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      onEvent: () => undefined,
      backoff: { maxAttempts: 1 },
    }).done.catch((e: unknown) => e);
    expect((error as Error).cause).toMatchObject({ code: 'HTTP_500' });
  });

  it('rejects when onEvent throws', async () => {
    const { fetch } = scripted([stream([frame(event(1))])]);
    await expect(
      subscribeRunEvents({
        client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
        runId,
        onEvent: () => {
          throw new Error('handler broke');
        },
      }).done,
    ).rejects.toThrow('handler broke');
  });

  it('reconnects after a stream error mid-read and resets backoff after progress', async () => {
    const { fetch, urls } = scripted([
      new TypeError('refused'),
      stream([frame(event(1))], { fail: true }),
      stream([frame(event(2, 'run.cancelled'))]),
    ]);
    const { delays, sleep } = recordingSleep();
    await subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      onEvent: () => undefined,
      backoff: { initialMs: 10 },
      sleep,
    }).done;
    expect(delays).toEqual([10, 10]);
    expect(urls[2]).toMatch(/after=1$/);
  });

  it('stops quietly when closed or aborted, including before it starts', async () => {
    const hanging: FetchLike = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      });
    const client = createGraphGoblinClient({ baseUrl: 'http://api', fetch: hanging });

    const closed = subscribeRunEvents({ client, runId, onEvent: () => undefined });
    closed.close();
    closed.close();
    await expect(closed.done).resolves.toBeUndefined();

    const controller = new AbortController();
    const aborted = subscribeRunEvents({
      client,
      runId,
      onEvent: () => undefined,
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted.done).resolves.toBeUndefined();

    const already = subscribeRunEvents({
      client,
      runId,
      onEvent: () => undefined,
      signal: AbortSignal.abort(),
    });
    await expect(already.done).resolves.toBeUndefined();
  });

  it('stops when closed from inside onEvent or while waiting to retry', async () => {
    const first = scripted([stream([frame(event(1)), frame(event(2))])]);
    const seen: number[] = [];
    const subscription = subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch: first.fetch }),
      runId,
      onEvent: (e) => {
        seen.push(e.seq);
        subscription.close();
      },
    });
    await subscription.done;
    expect(seen).toEqual([1]);

    const second = scripted([new TypeError('down')]);
    const waiting = subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch: second.fetch }),
      runId,
      onEvent: () => undefined,
      onError: () => setTimeout(() => waiting.close(), 5),
      backoff: { initialMs: 60_000 },
    });
    await expect(waiting.done).resolves.toBeUndefined();
  });

  it('ends quietly when the stream finishes after close() aborts the read', async () => {
    let enqueue: ((chunk: string) => void) | undefined;
    let end: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        enqueue = (chunk) => controller.enqueue(encoder.encode(chunk));
        end = () => controller.close();
      },
    });
    const errors: unknown[] = [];
    const { fetch } = scripted([new Response(body, { status: 200 })]);
    const subscription = subscribeRunEvents({
      client: createGraphGoblinClient({ baseUrl: 'http://api', fetch }),
      runId,
      onEvent: () => {
        subscription.close();
        end!();
      },
      onError: (e) => errors.push(e),
    });
    enqueue!(frame(event(1)));
    await subscription.done;
    expect(errors).toEqual([]);
  });

  it('reconnects over real HTTP after the server drops the connection', async () => {
    const afters: string[] = [];
    const server: Server = createServer((req, res) => {
      const after = new URL(req.url!, 'http://x').searchParams.get('after')!;
      afters.push(after);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (after === '0') {
        res.write(': connected\n\n');
        res.write(frame(event(1)));
        res.write(frame(event(2)), () => setTimeout(() => res.destroy(), 20));
      } else {
        res.end(frame(event(3, 'run.cancelled')));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const seen: number[] = [];
      await subscribeRunEvents({
        client: createGraphGoblinClient({ baseUrl }),
        runId,
        onEvent: (e) => {
          seen.push(e.seq);
        },
        backoff: { initialMs: 1 },
      }).done;
      expect(seen).toEqual([1, 2, 3]);
      expect(afters).toEqual(['0', '2']);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('defaultSleep', () => {
  it('waits, and resolves early on abort', async () => {
    const controller = new AbortController();
    const started = Date.now();
    await defaultSleep(5, controller.signal);
    const pending = defaultSleep(60_000, controller.signal);
    controller.abort();
    await pending;
    await defaultSleep(60_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
