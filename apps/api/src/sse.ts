import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RunEvent } from '@graphgoblin/contracts';
import type { EventStorePort } from '@graphgoblin/engine';

const TERMINAL_EVENTS = new Set<RunEvent['type']>(['run.finished', 'run.failed', 'run.cancelled']);

export interface SseOptions {
  heartbeatMs?: number;
  /** Whether the run is already in a terminal status. Checked once, after reading replay. */
  isTerminal?: () => Promise<boolean>;
  /**
   * Defensive timeout when a terminal status has no visible terminal event after re-reading the
   * log (for example an incomplete legacy log). Allows late subscription delivery, then closes
   * instead of idling forever. Current engine writes the event before status. Default 2 s.
   */
  terminalGraceMs?: number;
}

/**
 * Stream a run's event log as Server-Sent Events (docs/07). Replays from `after`, then tails live
 * events, closes after a terminal event, and sends a comment heartbeat so proxies keep the
 * connection open. `id:` carries the sequence number so `Last-Event-ID` resumes losslessly. When
 * the run is already terminal and the client already has its terminal event, the stream ends right
 * after the replay instead of idling.
 */
export async function streamRunEvents(
  _request: FastifyRequest,
  reply: FastifyReply,
  store: EventStorePort,
  runId: string,
  after: number,
  options: SseOptions = {},
): Promise<void> {
  // Subscribe before reading to avoid losing concurrent appends. Validate the complete replay
  // before committing SSE headers, so a corrupt page yields the same problem response as JSON.
  const buffered: RunEvent[] = [];
  let replaying = true;
  const unsubscribe = store.subscribe(runId, (event) => {
    if (replaying) buffered.push(event);
    else write(event);
  });
  const res = reply.raw;
  let closed = false;
  const disconnectDuringReplay = (): void => {
    closed = true;
    unsubscribe();
  };
  res.once('close', disconnectDuringReplay);
  let replay: RunEvent[];
  let terminal: boolean;
  let log: RunEvent[];
  try {
    replay = await store.read(runId, after);
    if (closed) return;
    terminal = (await options.isTerminal?.()) ?? false;
    if (closed) return;
    log =
      terminal && !replay.some((event) => TERMINAL_EVENTS.has(event.type))
        ? await store.read(runId)
        : [];
  } catch (error) {
    if (closed) return;
    unsubscribe();
    throw error;
  } finally {
    res.off('close', disconnectDuringReplay);
  }
  if (closed) return;
  reply.hijack();
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');

  let last = after;
  const write = (event: RunEvent): void => {
    if (closed || event.seq <= last) return;
    last = event.seq;
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (TERMINAL_EVENTS.has(event.type)) end();
  };
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, options.heartbeatMs ?? 15_000);
  let grace: ReturnType<typeof setTimeout> | undefined;
  const end = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(grace);
    unsubscribe();
    res.end();
  };
  res.once('close', end);

  for (const event of replay) write(event);
  replaying = false;
  for (const event of buffered.sort((a, b) => a.seq - b.seq)) write(event);

  if (closed || !terminal) return;
  // Terminal, and the replay held no terminal event: check whether the cursor already consumed
  // it or a second read can supply it. Event-before-status ordering means a healthy current log
  // already contains it; the grace below bounds idling for incomplete or inconsistent logs.
  if (log.some((event) => event.seq <= last && TERMINAL_EVENTS.has(event.type))) {
    end();
    return;
  }
  for (const event of log) write(event);
  if (!closed) grace = setTimeout(end, options.terminalGraceMs ?? 2_000);
}
