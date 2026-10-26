// #186 diagnostic 2: fetch-based readers (undici, as the api-client uses in Node) that stop
// pulling the body for a while, then read; and a raw socket with TCP_NODELAY set, to see whether
// slow replay after backpressure is a reader/TCP artefact or server pacing.
import net from 'node:net';
import { makeTemp, removeTemp, startApi, restClient, logger, SseCollector, eventFrames, assertContiguous, delay } from './lib.mjs';
import { decodeHttp } from './raw-sse.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6453;
const log = logger('p186-throughput2.log.txt');
const data = await makeTemp('186tp2');
const results = [];
let api;

async function fetchStall(url, runId, stallMs) {
  const t0 = Date.now();
  const response = await fetch(`${url}/runs/${runId}/events?after=0`, { headers: { accept: 'text/event-stream' } });
  const reader = response.body.getReader();
  await delay(stallMs);
  const collector = new SseCollector();
  const decoder = new TextDecoder();
  let firstAfterStall;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    firstAfterStall ??= Date.now();
    collector.push(decoder.decode(value, { stream: true }));
  }
  return { ms: Date.now() - t0, frames: collector.frames };
}

function rawNoDelay(port, runId) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = net.connect({ port, host: '127.0.0.1', noDelay: true });
    const chunks = [];
    socket.on('connect', () =>
      socket.write(`GET /runs/${runId}/events?after=0 HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n`),
    );
    socket.on('data', (c) => chunks.push(c));
    socket.on('close', () => {
      const decoded = decodeHttp(Buffer.concat(chunks));
      const c = new SseCollector();
      c.push(decoded.body);
      resolve({ ms: Date.now() - t0, frames: c.frames });
    });
  });
}

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const heavy = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
  const run = await rest.start(heavy.loop.id, {});
  await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
  const record = (label, r) => {
    const ev = eventFrames(r.frames);
    assertContiguous(ev, 1, label);
    const entry = { label, ms: r.ms, delivered: ev.length, completed: r.frames.some((f) => f.event === 'stream.complete'), error: r.frames.find((f) => f.event === 'stream.error')?.data };
    results.push(entry);
    log(entry);
  };
  record('fetch, stall 0 ms', await fetchStall(api.url, run.id, 0));
  record('fetch, stall 1000 ms', await fetchStall(api.url, run.id, 1000));
  record('fetch, stall 3000 ms', await fetchStall(api.url, run.id, 3000));
  record('raw socket with TCP_NODELAY, no stall', await rawNoDelay(PORT, run.id));
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
} finally {
  await writeFile(join(HERE, 'p186-throughput2.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
