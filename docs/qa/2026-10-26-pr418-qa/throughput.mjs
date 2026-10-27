// Check 1 (D1 fixed): acceptance B's throughput comparison repeated on the PR head's build.
// Two endless cyclic runs on one gateway: A is followed live in Edge, B is the unrelated
// neighbour. Phases alternate "no inspector" samples with "inspector following A live" windows
// that start at about 5,000, 10,000 and 20,000 events of A. Each window records both runs'
// events/s, every API request the inspector issued (by kind, per minute, with latency and body
// size), the page's JS heap, its session cache and mounted Timeline rows, and the API's private
// memory. The opening catch-up (the SSE replay of the history) is measured separately.
// A final control phase replays the OLD inspector's boundary-read pattern from a script
// (thread?at=N and N-1 per 100 ms) to show the probe detects a history-scaling reader.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, processMemory, cycle,
  recordRequests, countByKind, latencyByKind, inspectorState, heapMiB, sessionStorageBytes, HERE,
} from './lib.mjs';

const PORT = 6560;
const log = logger('throughput.log.txt');
const data = await makeTemp('tp');
const results = { phases: [], openings: [] };
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loopA = await rest.createLoop(cycle({ name: 'Observed A' }));
  const loopB = await rest.createLoop(cycle({ name: 'Neighbour B' }));
  const a = await rest.start(loopA.loop.id);
  const b = await rest.start(loopB.loop.id);
  results.runs = { A: a.id, B: b.id };
  const seqOf = async (run) => (await rest.run(run.id)).lastEventSeq;

  browser = await edge();
  results.edgeVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = recordRequests(context);

  const phase = async (name, seconds, page, extra) => {
    const t0 = Date.now();
    const a0 = await seqOf(a);
    const b0 = await seqOf(b);
    await (extra ? extra(seconds) : delay(seconds * 1000));
    const a1 = await seqOf(a);
    const b1 = await seqOf(b);
    const t1 = Date.now();
    const s = (t1 - t0) / 1000;
    const reqs = rec.all.filter((r) => r.t >= t0 && r.t < t1 && r.kind !== 'system');
    const counts = countByKind(reqs);
    const perMinute = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, +((n * 60) / s).toFixed(1)]));
    const threadBytes = reqs.filter((r) => r.kind === 'thread' && r.bytes !== undefined).map((r) => r.bytes);
    const entry = {
      name,
      seconds: +s.toFixed(1),
      A: { from: a0, to: a1, eventsPerSecond: +((a1 - a0) / s).toFixed(1) },
      B: { from: b0, to: b1, eventsPerSecond: +((b1 - b0) / s).toFixed(1) },
      inspectorRequests: counts,
      inspectorRequestsPerMinute: perMinute,
      latency: latencyByKind(reqs),
      currentThreadBodyBytes: threadBytes.length ? { min: Math.min(...threadBytes), max: Math.max(...threadBytes) } : undefined,
      apiMemory: await processMemory(api.pid),
    };
    if (page) {
      entry.jsHeapMiB = await heapMiB(page);
      entry.sessionStorageBytesUtf16 = await sessionStorageBytes(page);
      const state = await inspectorState(page);
      const apiThread = await rest('GET', `/runs/${a.id}/thread`);
      entry.view = {
        threadHeading: state.threadHeading,
        rowsMounted: state.rowsMounted,
        contiguous: state.contiguous,
        timeline: state.timeline,
        uiVarsN: state.vars?.n,
        apiVarsNAfter: apiThread.vars.n,
        followLiveEnabled: state.followLiveEnabled,
        patchDiffShown: Boolean(state.patchDiff),
      };
    }
    results.phases.push(entry);
    log(entry);
    return entry;
  };

  const open = async (label) => {
    const page = await context.newPage();
    const t0 = Date.now();
    const a0 = await seqOf(a);
    const b0 = await seqOf(b);
    await page.goto(`${api.url}/app/runs/${a.id}`);
    // Caught up: the Timeline heading counts at least the events A had when the page opened.
    await until(
      async () => {
        const s = await inspectorState(page);
        return s.timeline.total >= a0 && s.timeline.stream === 'live' && s.threadHeading === 'Current thread';
      },
      { timeout: 300_000, interval: 100, what: 'inspector caught up' },
    );
    const t1 = Date.now();
    const a1 = await seqOf(a);
    const b1 = await seqOf(b);
    const s = (t1 - t0) / 1000;
    const reqs = rec.all.filter((r) => r.t >= t0 && r.t < t1 && r.kind !== 'system');
    const opening = {
      label,
      historyAtOpen: a0,
      catchUpSeconds: +s.toFixed(2),
      A: { eventsPerSecond: +((a1 - a0) / s).toFixed(1) },
      B: { eventsPerSecond: +((b1 - b0) / s).toFixed(1) },
      inspectorRequests: countByKind(reqs),
      latency: latencyByKind(reqs),
    };
    results.openings.push(opening);
    log('opening', opening);
    return page;
  };
  const reach = (n) => until(async () => (await seqOf(a)) >= n, { timeout: 900_000, interval: 250, what: `A at ${n} events` });

  await reach(4_000);
  await phase('no inspector (from about 4,000)', 10);
  let page = await open('about 5,000');
  await phase('inspector following A live (from about 5,000)', 30, page);
  await page.close();
  await phase('no inspector (after the 5,000 window)', 15);
  page = await open('about 10,000');
  await phase('inspector following A live (from about 10,000)', 30, page);
  await page.close();
  await phase('no inspector (after the 10,000 window)', 15);
  await reach(18_500);
  await phase('no inspector (before 20,000)', 15);
  page = await open('about 20,000');
  await phase('inspector following A live (from about 20,000)', 30, page);
  await page.close();
  await phase('inspector closed', 15);

  // Control: the old inspector's per-batch boundary reads, issued by a script.
  let controlReads = 0;
  await phase('control: scripted old-pattern boundary reads (thread?at=N and N-1 every 100 ms)', 30, undefined, async (seconds) => {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const n = await seqOf(a);
      await Promise.all([rest('GET', `/runs/${a.id}/thread?at=${n}`), rest('GET', `/runs/${a.id}/thread?at=${n - 1}`)]);
      controlReads += 2;
      await delay(100);
    }
  });
  results.phases.at(-1).controlReads = controlReads;
  await phase('after the control (no reader)', 20);
  await rest('POST', `/runs/${a.id}/cancel`, {});
  await rest('POST', `/runs/${b.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'throughput.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
