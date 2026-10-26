// #186 round 1 before/after on the server: the same ~23.8 MB history replayed to five readers that
// stop reading (kernel backpressure) for 15 s, then disconnect; plus one fetch reader that stalls
// 6 s and then reads. Builds: pre-#186 (c63db245, a disposable `git archive` build under %TEMP%)
// and the accepted main (d42e859f). Records API private memory and the reader-visible outcome.
import net from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, processMemory, delay, SseCollector, ROOT, HERE } from './lib.mjs';
import { cycle } from './defs.mjs';

const BASELINE = process.argv[2];
if (!BASELINE) throw new Error('usage: node p186-server-compare.mjs <pre-#186 build root>');
const PORT = 6451;
const log = logger('p186-server-compare.log.txt');
const results = {};

function stalledSocket(runId) {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.on('connect', () => {
    socket.write(`GET /runs/${runId}/events?after=0 HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\n\r\n`);
    socket.pause();
  });
  socket.on('error', () => {});
  return socket;
}

async function fetchStall(url, runId, stallMs) {
  const t0 = Date.now();
  const response = await fetch(`${url}/runs/${runId}/events?after=0`, { headers: { accept: 'text/event-stream' } });
  const reader = response.body.getReader();
  await delay(stallMs);
  const c = new SseCollector();
  const d = new TextDecoder();
  let how = 'end';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      c.push(d.decode(value, { stream: true }));
    }
  } catch (e) {
    how = `error:${e?.cause?.code ?? e?.message}`;
  }
  const events = c.frames.filter((f) => f.id !== undefined && f.data.startsWith('{'));
  return { ms: Date.now() - t0, how, delivered: events.length, error: c.frames.find((f) => f.event === 'stream.error')?.data, completed: c.frames.some((f) => f.event === 'stream.complete') };
}

for (const [label, root] of [['before (c63db245, pre-#186)', BASELINE], ['after (d42e859f, accepted main)', ROOT]]) {
  const data = await makeTemp('186srv');
  let api;
  const out = { samples: [] };
  results[label] = out;
  try {
    api = await startApi({ port: PORT, dataDir: data, log, root });
    const rest = restClient(api.url);
    const loop = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
    const run = await rest.start(loop.loop.id, {});
    await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
    out.lastEventSeq = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
    await delay(2000);
    out.idle = await processMemory(api.pid);
    const sockets = Array.from({ length: 5 }, () => stalledSocket(run.id));
    for (let i = 0; i < 16; i++) {
      await delay(1000);
      out.samples.push({ t: i + 1, ...(await processMemory(api.pid)) });
    }
    out.peakPrivateMiB = Math.max(...out.samples.map((s) => s.privateMiB));
    out.growthMiB = +(out.peakPrivateMiB - out.idle.privateMiB).toFixed(1);
    out.socketsStillOpenAfter16s = sockets.filter((s) => !s.destroyed && s.readyState === 'open').length;
    for (const s of sockets) s.destroy();
    await delay(3000);
    out.afterDisconnect = await processMemory(api.pid);
    out.fetchStall6s = await fetchStall(api.url, run.id, 6000);
    log(label, { idle: out.idle, peakPrivateMiB: out.peakPrivateMiB, growthMiB: out.growthMiB, socketsStillOpenAfter16s: out.socketsStillOpenAfter16s, afterDisconnect: out.afterDisconnect, fetchStall6s: out.fetchStall6s });
  } catch (error) {
    log('ERROR', label, String(error?.stack ?? error));
    out.error = String(error?.stack ?? error);
  } finally {
    await api?.kill();
    await removeTemp(data);
  }
}
await writeFile(join(HERE, 'p186-server-compare.json'), JSON.stringify(results, null, 2));
await log.flush();
