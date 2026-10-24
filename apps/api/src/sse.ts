import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RunEvent } from '@graphgoblin/contracts';
import { UnreadableRunHistoryError, type EventStorePort } from '@graphgoblin/engine';

const TERMINAL_EVENTS = new Set<RunEvent['type']>(['run.finished', 'run.failed', 'run.cancelled']);
// The measured ~470-byte events make a page about 60 KiB: short reads/yields without a query
// per event. A page bounds event count, not the intrinsic size of a single stored payload.
const REPLAY_PAGE_SIZE = 128;
// Count bounds tiny events; bytes bound large ones. These are temporary handoff queues only.
const MAX_HELD_EVENTS = 256;
const MAX_HELD_BYTES = 1_048_576;
// Chunk large frames rather than capping supported event payloads. Await drain at Node's high
// water mark; the hard ceiling also protects composition roots with a larger high water mark.
const WRITE_CHUNK_BYTES = 16_384;
const MAX_WRITABLE_BYTES = 262_144;
const DRAIN_TIMEOUT_MS = 5_000;
const FAILURE_CLOSE_MS = 2_000;

export interface SseOptions {
  heartbeatMs?: number;
  /** Whether the run is already in a terminal status. Checked once, after the first page. */
  isTerminal?: () => Promise<boolean>;
  /** Defensive close for a terminal status with no terminal event. Default 2 s. */
  terminalGraceMs?: number;
  /** Maximum time without drain before explicit slow-consumer failure. Default 5 s. */
  drainTimeoutMs?: number;
}

interface StreamProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}
const slowConsumer = (): StreamProblem => ({
  type: 'urn:graphgoblin:problem:SSE_SLOW_CONSUMER',
  title: 'Event stream reader fell behind',
  status: 503,
  code: 'SSE_SLOW_CONSUMER',
  detail: 'The reader fell behind; reconnecting from the last received event.',
});

/** Paged durable replay followed by a bounded, ordered live handoff. See docs/07 and ADR-0050. */
export async function streamRunEvents(
  _request: FastifyRequest,
  reply: FastifyReply,
  store: EventStorePort,
  runId: string,
  after: number,
  options: SseOptions = {},
): Promise<void> {
  const res = reply.raw;
  let closed = false;
  let started = false;
  let busy = true;
  let blocked = false;
  let partialFrame = false;
  let partialLineEnded = false;
  // Numeric header bounds are exclusive over integer seqs; negative bounds replay from 1.
  let last = Math.max(0, Math.floor(after));
  let heldBytes = 0;
  const held: { event: RunEvent; text: string; bytes: number }[] = [];
  let failure: StreamProblem | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let forceClose: ReturnType<typeof setTimeout> | undefined;
  let releaseDrain: (() => void) | undefined;
  let unsubscribe = () => {};

  const cleanup = (): void => {
    clearInterval(heartbeat);
    clearTimeout(grace);
    const stop = unsubscribe;
    unsubscribe = () => {};
    stop();
    held.length = 0;
    heldBytes = 0;
    releaseDrain?.();
  };
  const end = (problem?: StreamProblem): void => {
    if (closed) return;
    closed = true;
    cleanup();
    if (problem) {
      // Even complete JSON may precede an unfinished id line. Force any partial frame to be
      // unparseable and restore its id to the previous complete event before separating it.
      // A wholly accepted frame already has its separator; leave that client's id untouched.
      const boundary = partialFrame
        ? `${partialLineEnded ? '' : '\n'}data: [interrupted]\nid: ${last}\n\n`
        : '\n\n';
      res.end(`${boundary}event: stream.error\ndata: ${JSON.stringify(problem)}\n\n`);
      // A permanently stalled peer cannot retain this bounded response forever. Its helper
      // reports premature EOF/network failure and resumes from its own last complete id.
      forceClose = setTimeout(() => res.destroy(), FAILURE_CLOSE_MS);
      forceClose.unref();
    } else res.end();
  };
  const fail = (problem: StreamProblem): void => {
    failure ??= problem;
    held.length = 0;
    heldBytes = 0;
    if (started) end(failure);
  };
  res.once('close', () => {
    closed = true;
    cleanup();
    clearTimeout(forceClose);
  });

  const drain = (): Promise<void> =>
    new Promise((resolve) => {
      blocked = true;
      const finish = () => {
        blocked = false;
        clearTimeout(timeout);
        res.off('drain', finish);
        releaseDrain = undefined;
        resolve();
      };
      const timeout = setTimeout(
        () => fail(slowConsumer()),
        options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS,
      );
      releaseDrain = finish;
      res.once('drain', finish);
    });
  const writeText = async (text: string, eventFrame = false): Promise<void> => {
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length && !closed; offset += WRITE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + WRITE_CHUNK_BYTES);
      if (res.writableLength + chunk.length > MAX_WRITABLE_BYTES) {
        fail(slowConsumer());
        return;
      }
      const ready = res.write(chunk);
      if (eventFrame) {
        partialFrame = offset + chunk.length < bytes.length;
        partialLineEnded = chunk.at(-1) === 10;
      }
      if (!ready) await drain();
    }
  };
  const encode = (event: RunEvent): string =>
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\nid: ${event.seq}\n\n`;
  const write = async (event: RunEvent, text = encode(event)): Promise<void> => {
    if (closed || event.seq <= last) return;
    // A late/out-of-order notification must never move the cursor over unseen durable history.
    // Reconnect replays that history in repository order, even if the live notifier fell behind.
    if (event.seq !== last + 1) {
      fail(slowConsumer());
      return;
    }
    await writeText(text, true);
    if (closed) return;
    last = event.seq;
    if (TERMINAL_EVENTS.has(event.type)) end();
  };
  const flushLive = async (): Promise<void> => {
    if (busy || closed) return;
    busy = true;
    try {
      while (held.length && !closed) {
        held.sort((a, b) => a.event.seq - b.event.seq);
        const next = held.shift()!;
        heldBytes -= next.bytes;
        await write(next.event, next.text);
      }
    } finally {
      busy = false;
    }
  };
  // Subscribe before the first read; every held duplicate is skipped against the written cursor.
  unsubscribe = store.subscribe(runId, (event) => {
    if (closed || failure || event.seq <= last) return;
    const text = encode(event);
    const bytes = Buffer.byteLength(text);
    if (held.length >= MAX_HELD_EVENTS || heldBytes + bytes > MAX_HELD_BYTES) {
      fail(slowConsumer());
      return;
    }
    held.push({ event, text, bytes });
    heldBytes += bytes;
    void flushLive();
  });

  // The first page (and an empty terminal-cursor recheck) can still fail as HTTP Problem Details.
  // Later read failures must use an explicit control frame because headers are already sent.
  const hasConsumedTerminal = async (): Promise<boolean> => {
    let cursor = 0;
    let found = false;
    for (;;) {
      const page = await store.read(runId, cursor, REPLAY_PAGE_SIZE);
      if (closed) return false;
      found ||= page.some((event) => event.seq <= last && TERMINAL_EVENTS.has(event.type));
      if (page.length < REPLAY_PAGE_SIZE) return found;
      cursor = page.at(-1)!.seq;
      await yieldToLoop();
    }
  };
  try {
    let page = await store.read(runId, after, REPLAY_PAGE_SIZE);
    if (closed) return;
    const terminal = (await options.isTerminal?.()) ?? false;
    if (closed) return;
    const consumedTerminal = terminal && page.length === 0 ? await hasConsumedTerminal() : false;
    if (closed) return;
    reply.hijack();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    started = true;
    if (failure) {
      end(failure);
      return;
    }
    await writeText(': connected\n\n');
    if (closed) return;
    heartbeat = setInterval(() => {
      // A blocked writer already has pending bytes. Heartbeats must not bypass backpressure.
      if (!closed && !busy && !blocked) {
        busy = true;
        void writeText(': heartbeat\n\n').then(() => {
          busy = false;
          void flushLive();
        });
      }
    }, options.heartbeatMs ?? 15_000);
    for (;;) {
      for (const event of page) {
        await write(event);
        if (closed) return;
      }
      if (page.length < REPLAY_PAGE_SIZE) break;
      page = []; // Release the previous page before yielding/reading the next.
      await yieldToLoop();
      if (closed) return;
      page = await store.read(runId, last, REPLAY_PAGE_SIZE);
      if (closed) return;
    }
    busy = false;
    await flushLive();
    if (closed || !terminal) return;
    if (consumedTerminal || (await hasConsumedTerminal())) {
      end();
      return;
    }
    if (!closed) grace = setTimeout(() => end(), options.terminalGraceMs ?? 2_000);
  } catch (error) {
    if (closed) return;
    if (!started) {
      closed = true;
      cleanup();
      throw error;
    }
    fail({
      type: 'urn:graphgoblin:problem:SSE_REPLAY_FAILED',
      title: 'Event replay failed',
      status: 500,
      code:
        error instanceof UnreadableRunHistoryError ? 'STORED_EVENT_INVALID' : 'SSE_REPLAY_FAILED',
      detail: 'Stored history could not be read; retry after repairing the reported run history.',
    });
  }
}
