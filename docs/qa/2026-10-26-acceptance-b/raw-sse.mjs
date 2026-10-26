// A raw TCP SSE reader that can stop reading from the kernel (true backpressure), then resume.
import net from 'node:net';
import { SseCollector } from './lib.mjs';

/** Decode an HTTP/1.1 response that may use chunked transfer encoding; tolerate truncation. */
export function decodeHttp(buffer) {
  const head = buffer.indexOf('\r\n\r\n');
  if (head < 0) return { status: undefined, headers: '', body: '' };
  const headers = buffer.subarray(0, head).toString('latin1');
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(headers)?.[1]);
  let rest = buffer.subarray(head + 4);
  if (!/transfer-encoding:\s*chunked/i.test(headers)) return { status, headers, body: rest.toString('utf8') };
  const parts = [];
  let terminated = false;
  for (;;) {
    const line = rest.indexOf('\r\n');
    if (line < 0) break;
    const size = parseInt(rest.subarray(0, line).toString('latin1'), 16);
    if (Number.isNaN(size)) break;
    if (size === 0) {
      terminated = true;
      break;
    }
    const start = line + 2;
    const chunk = rest.subarray(start, start + size);
    parts.push(chunk);
    if (chunk.length < size) break; // truncated by a severed connection
    rest = rest.subarray(start + size + 2);
  }
  return { status, headers, body: Buffer.concat(parts).toString('utf8'), terminated };
}

/**
 * Open `GET /runs/{id}/events` as SSE, stop reading for `pauseMs` (the kernel receive buffer
 * fills and the server sees backpressure), then read everything until the server closes.
 * `onPaused` is awaited while paused (used to sample server memory).
 */
export function pausedReader({ port, runId, after = 0, lastEventId, pauseMs, onPaused }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    const timeline = { connectedAt: undefined, resumedAt: undefined, endedAt: undefined, how: undefined };
    socket.on('connect', () => {
      timeline.connectedAt = Date.now();
      socket.write(
        `GET /runs/${runId}/events?after=${after} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAccept: text/event-stream\r\n` +
          (lastEventId === undefined ? '' : `Last-Event-ID: ${lastEventId}\r\n`) +
          'Connection: close\r\n\r\n',
      );
      socket.pause();
      Promise.resolve(onPaused?.())
        .catch(() => {})
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, pauseMs - (Date.now() - timeline.connectedAt)))))
        .then(() => {
          timeline.resumedAt = Date.now();
          socket.resume();
        });
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    const finish = (how) => {
      if (timeline.how) return;
      timeline.how = how;
      timeline.endedAt = Date.now();
      const raw = Buffer.concat(chunks);
      const decoded = decodeHttp(raw);
      const collector = new SseCollector();
      collector.push(decoded.body);
      resolve({ ...timeline, status: decoded.status, rawBytes: raw.length, frames: collector.frames, tail: collector.buffer, terminated: decoded.terminated });
    };
    socket.on('end', () => finish('end'));
    socket.on('close', (hadError) => finish(hadError ? 'close-error' : 'close'));
    socket.on('error', (error) => finish(`error:${error.code}`));
    setTimeout(() => {
      if (!timeline.how) {
        socket.destroy();
        reject(new Error('paused reader did not finish within 180 s'));
      }
    }, 180_000);
  });
}
