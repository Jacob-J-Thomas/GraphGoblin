import { RunEventSchema, type RunEvent } from '@graphgoblin/contracts';
import type { GraphGoblinClient } from './client.js';
import { GraphGoblinApiError } from './errors.js';

/** Event types after which the API closes the stream and no further events can arrive. */
export const TERMINAL_RUN_EVENT_TYPES: ReadonlySet<RunEvent['type']> = new Set([
  'run.finished',
  'run.failed',
  'run.cancelled',
]);

/** One Server-Sent Events message. */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser (the subset of the WHATWG algorithm the API uses): `id`, `event`, and
 * multi-line `data` fields; comment lines starting with `:` are ignored; LF, CRLF, and CR line
 * endings are accepted. Feed decoded text in arbitrary chunks; complete frames are returned.
 */
export class SseParser {
  private buffer = '';
  private frame: { id?: string; event?: string; data: string[] } = { data: [] };

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      // A lone trailing CR may be the first half of a CRLF split across chunks.
      if (!match || (match[0] === '\r' && match.index === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private line(line: string): SseFrame | undefined {
    if (line === '') {
      const { id, event, data } = this.frame;
      this.frame = { data: [] };
      if (data.length === 0) return undefined;
      return {
        ...(id !== undefined ? { id } : {}),
        ...(event !== undefined ? { event } : {}),
        data: data.join('\n'),
      };
    }
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.frame.data.push(value);
    else if (field === 'id') this.frame.id = value;
    else if (field === 'event') this.frame.event = value;
    return undefined;
  }
}

/** A frame whose data was not a valid `RunEvent`. It is reported and skipped. */
export class RunEventParseError extends Error {
  override readonly name = 'RunEventParseError';
  constructor(
    readonly frame: SseFrame,
    cause: unknown,
  ) {
    super(`invalid run event frame${frame.id ? ` ${frame.id}` : ''}`, { cause });
  }
}

export interface BackoffOptions {
  /** First retry delay. Default 500 ms. */
  initialMs?: number;
  /** Cap on any single delay. Default 30 s. */
  maxMs?: number;
  /** Multiplier per consecutive failure. Default 2. */
  factor?: number;
  /** Give up after this many consecutive failed connections. Default: never. */
  maxAttempts?: number;
}

export interface SubscribeRunEventsOptions {
  client: GraphGoblinClient;
  runId: string;
  /** Start after this sequence number (exclusive). Default 0: the whole log. */
  after?: number;
  /** Called once per event, in `seq` order, never twice for one `seq`. Awaited before the next. */
  onEvent: (event: RunEvent) => void | Promise<void>;
  /**
   * Called for recoverable problems: a dropped or refused connection before each retry (with the
   * 1-based attempt number), or a frame that failed `RunEventSchema` validation (attempt 0).
   */
  onError?: (error: unknown, attempt: number) => void;
  /**
   * Called each time a connection is accepted (2xx), before any event on it: a stream resumed at
   * a cursor with nothing new to send is open even though no event arrives.
   */
  onOpen?: () => void;
  /** Stops the subscription; `done` then resolves. */
  signal?: AbortSignal;
  backoff?: BackoffOptions;
  /** Injectable delay, for tests. Must resolve early (or reject) when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface RunEventSubscription {
  /** Stop streaming. Idempotent; `done` resolves. */
  close(): void;
  /**
   * Resolves after a terminal event or when closed or aborted. Rejects when the API answers with
   * a non-retryable error (for example 404 or 401), when `onEvent` throws, or when `maxAttempts`
   * consecutive connections fail.
   */
  done: Promise<void>;
  /** The highest `seq` delivered so far. */
  readonly lastSeq: number;
}

/** 408, 425, 429, and 5xx are worth retrying; other statuses will not change on their own. */
function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class Fatal extends Error {
  constructor(readonly error: unknown) {
    super('fatal');
  }
}

/**
 * Stream a run's events over `GET /runs/{id}/events` with `Accept: text/event-stream`, using
 * `fetch` and a streaming body reader so it works in browsers and Node 18+.
 *
 * Resume: the helper tracks the last delivered `seq`. If the connection drops before a terminal
 * event, it reconnects with `after=<lastSeq>` after an exponential backoff (reset once a
 * connection delivers an event), and drops any replayed event whose `seq` it has already seen.
 */
export function subscribeRunEvents(options: SubscribeRunEventsOptions): RunEventSubscription {
  const { client, runId, onEvent, onError, onOpen } = options;
  const initialMs = options.backoff?.initialMs ?? 500;
  const maxMs = options.backoff?.maxMs ?? 30_000;
  const factor = options.backoff?.factor ?? 2;
  const maxAttempts = options.backoff?.maxAttempts ?? Number.POSITIVE_INFINITY;
  const sleep = options.sleep ?? defaultSleep;

  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();

  let lastSeq = options.after ?? 0;

  /** Read one connection to its end. Returns true after a terminal event or a close. */
  async function connect(): Promise<boolean> {
    const { baseUrl, headers, fetch } = client.config;
    const url = `${baseUrl}/runs/${encodeURIComponent(runId)}/events?after=${lastSeq}`;
    const response = await fetch(
      new Request(url, {
        headers: { ...headers, accept: 'text/event-stream' },
        signal: controller.signal,
      }),
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON; keep the text
      }
      const error = GraphGoblinApiError.fromResponse(response, body);
      throw retryable(response.status) ? error : new Fatal(error);
    }
    if (!response.body) throw new Fatal(new Error('the event stream response has no body'));
    onOpen?.();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        for (const frame of parser.push(value)) {
          if (controller.signal.aborted) return true;
          let event: RunEvent;
          try {
            event = RunEventSchema.parse(JSON.parse(frame.data));
          } catch (cause) {
            onError?.(new RunEventParseError(frame, cause), 0);
            const seq = Number(frame.id);
            if (Number.isInteger(seq) && seq > lastSeq) lastSeq = seq;
            continue;
          }
          if (event.seq <= lastSeq) continue;
          try {
            await onEvent(event);
          } catch (error) {
            throw new Fatal(error);
          }
          lastSeq = event.seq;
          if (TERMINAL_RUN_EVENT_TYPES.has(event.type)) return true;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async function run(): Promise<void> {
    let failures = 0;
    while (!controller.signal.aborted) {
      let lastError: unknown;
      const seqBefore = lastSeq;
      try {
        if ((await connect()) || controller.signal.aborted) return;
        lastError = new Error('the event stream closed before the run finished');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Fatal) throw error.error;
        lastError = error;
      }
      // A connection that made progress resets the backoff.
      failures = lastSeq > seqBefore ? 1 : failures + 1;
      onError?.(lastError, failures);
      if (failures >= maxAttempts) {
        throw new Error(`gave up on the event stream for run ${runId} after ${failures} attempts`, {
          cause: lastError,
        });
      }
      await sleep(Math.min(maxMs, initialMs * factor ** (failures - 1)), controller.signal);
    }
  }

  const done = run().finally(() => {
    options.signal?.removeEventListener('abort', stop);
    controller.abort();
  });

  return {
    close: stop,
    done,
    get lastSeq() {
      return lastSeq;
    },
  };
}
