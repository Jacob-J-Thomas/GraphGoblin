import { createConnection } from 'node:net';
import { once } from 'node:events';
import { Frames, sleep } from './common.mjs';

/** Decode the HTTP/1.1 framing separately so socket and application byte counts stay distinct. */
export class HttpBody {
  buffer = Buffer.alloc(0);
  headers = false;
  chunked = false;
  remaining = null;
  done = false;
  push(raw) {
    this.buffer = Buffer.concat([this.buffer, raw]);
    const parts = [];
    if (!this.headers) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return parts;
      const header = this.buffer.subarray(0, end).toString('ascii');
      if (!/^HTTP\/1\.[01] 200\b/.test(header))
        throw new Error('Replay HTTP response: ' + header.split('\r\n')[0]);
      this.chunked = /transfer-encoding:\s*chunked/i.test(header);
      this.headers = true;
      this.buffer = this.buffer.subarray(end + 4);
    }
    if (!this.chunked) {
      parts.push(this.buffer);
      this.buffer = Buffer.alloc(0);
      return parts;
    }
    while (!this.done) {
      if (this.remaining === null) {
        const end = this.buffer.indexOf('\r\n');
        if (end < 0) break;
        const size = this.buffer.subarray(0, end).toString('ascii').split(';')[0];
        if (!/^[0-9a-f]+$/i.test(size)) throw new Error('Invalid HTTP chunk size');
        this.remaining = Number.parseInt(size, 16);
        this.buffer = this.buffer.subarray(end + 2);
        if (this.remaining === 0) {
          this.done = true;
          break;
        }
      }
      if (this.buffer.length < this.remaining + 2) break;
      if (this.buffer.toString('ascii', this.remaining, this.remaining + 2) !== '\r\n')
        throw new Error('Invalid HTTP chunk terminator');
      parts.push(this.buffer.subarray(0, this.remaining));
      this.buffer = this.buffer.subarray(this.remaining + 2);
      this.remaining = null;
    }
    return parts;
  }
}

export async function readReplay(base, runId, { after, pauseMs, stopAfter, hasher, progress }) {
  const url = new URL(base);
  const socket = createConnection({
    host: url.hostname,
    port: Number(url.port),
    highWaterMark: 64 * 1024,
  });
  // The iterator reads at most a bounded socket buffer ahead. No fetch/Undici body prebuffering.
  socket.pause();
  socket.setTimeout(3_600_000, () => socket.destroy(new Error('Replay socket timed out')));
  const closed = once(socket, 'close').catch(() => {});
  const frames = new Frames(after, hasher),
    body = new HttpBody(),
    decoder = new TextDecoder();
  let reads = 0,
    receivedBytes = 0,
    wireBytesConsumed = 0,
    firstMs = null;
  const start = performance.now();
  try {
    await once(socket, 'connect');
    socket.write(
      `GET /runs/${runId}/events HTTP/1.1\r\nHost: ${url.host}\r\nAccept: text/event-stream\r\nLast-Event-ID: ${after}\r\nConnection: close\r\n\r\n`,
    );
    // A one-second hold lets the server encounter TCP backpressure before consumption starts.
    if (pauseMs) await sleep(Math.max(1000, pauseMs));
    for await (const raw of socket) {
      reads++;
      wireBytesConsumed += raw.length;
      for (const part of body.push(raw)) {
        receivedBytes += part.length;
        frames.push(decoder.decode(part, { stream: true }));
      }
      if (firstMs === null && frames.count) firstMs = performance.now() - start;
      progress({ receivedBytes, wireBytesConsumed, receivedEvents: frames.count });
      if (frames.count >= stopAfter || body.done) break;
      if (pauseMs) await sleep(pauseMs);
    }
    if (!body.headers || (!body.done && body.chunked && frames.count < stopAfter))
      throw new Error('Incomplete replay response');
    return {
      after,
      pauseMs,
      initialPauseMs: pauseMs ? Math.max(1000, pauseMs) : 0,
      reader: 'raw HTTP/1.1 socket, 64 KiB high-water mark',
      firstMs,
      totalMs: performance.now() - start,
      sha256: frames.digest(),
      events: frames.count,
      lastSeq: frames.last,
      gaps: frames.gaps,
      receivedBytes,
      wireBytesConsumed,
      reads,
    };
  } finally {
    socket.destroy();
    await closed;
  }
}
