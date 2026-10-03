import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RunEvent } from '@graphgoblin/contracts';
import type { EventStorePort } from '@graphgoblin/engine';

const TERMINAL_EVENTS = new Set<RunEvent['type']>(['run.finished', 'run.failed', 'run.cancelled']);

export interface SseOptions {
  heartbeatMs?: number;
  /** Whether the run is already in a terminal status. Checked once, after the replay. */
  isTerminal?: () => Promise<boolean>;
  /**
   * How long to wait for the terminal event of a run whose status is already terminal but whose
   * log has no terminal event yet (the status changes just before the event is appended).
   * Default 2 s.
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
  request: FastifyRequest,
  reply: FastifyReply,
  store: EventStorePort,
  runId: string,
  after: number,
  options: SseOptions = {},
): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');

  let last = after;
  let closed = false;
  const write = (event: RunEvent): void => {
    if (closed || event.seq <= last) return;
    last = event.seq;
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (TERMINAL_EVENTS.has(event.type)) end();
  };
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n');
  }, options.heartbeatMs ?? 15_000);
  let unsubscribe: () => void = () => undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const end = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(grace);
    unsubscribe();
    res.end();
  };
  request.raw.on('close', end);

  // Subscribe first, then replay, so nothing appended in between is lost; `write` de-duplicates by seq.
  const buffered: RunEvent[] = [];
  let replaying = true;
  unsubscribe = store.subscribe(runId, (event) => {
    if (replaying) buffered.push(event);
    else write(event);
  });
  for (const event of await store.read(runId, after)) write(event);
  replaying = false;
  for (const event of buffered.sort((a, b) => a.seq - b.seq)) write(event);

  if (closed || !options.isTerminal || !(await options.isTerminal())) return;
  // Terminal, and the replay held no terminal event: either the client is already past it, or the
  // status changed a moment before the event was appended and it will arrive through the
  // subscription. Only the log can tell which.
  const log = await store.read(runId);
  if (closed) return;
  if (log.some((event) => event.seq <= last && TERMINAL_EVENTS.has(event.type))) {
    end();
    return;
  }
  for (const event of log) write(event);
  if (!closed) grace = setTimeout(end, options.terminalGraceMs ?? 2_000);
}
