// Re-check of bounds.mjs sections B and C. bounds.mjs took `last` from the run record at the
// moment the run reported `succeeded`, before finalization appended its last audit event (the
// stream and every reader delivered 609 events against a recorded 608), so its B and C checks
// compared with a stale count; its 7 s stall also ended exactly at the server's 5 s drain plus
// 2 s close window, so the explicit control was cut by the close. This re-check waits for the
// run's finalization marker, then uses stalls of 2 s, 6 s (explicit control expected) and 15 s
// (severed connection expected), each recovered from Last-Event-ID. Section A is not repeated.
//
// Original header of bounds.mjs:
// Check 4 (round-2 guarantees intact):
//  A. bounded browser memory while following a long run live: JS heap, session cache and
//     mounted Timeline rows sampled over two minutes of following an endless cycle;
//  B. paged SSE replay of a large history (about 24 MB) to a fetch reader that stalls for 7 s:
//     explicit SSE_SLOW_CONSUMER, then recovery from Last-Event-ID with no gap or duplicate;
//     a normal reader completes; a 2 s stall completes without a failure;
//  C. the inspector itself as the stalled reader (Edge, download throttled, JavaScript paused
//     for 9 s through the DevTools debugger): it reopens from its cursor and completes, and its
//     panels then equal the API.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, processMemory,
  recordRequests, countByKind, inspectorState, heapMiB, sessionStorageBytes, HERE,
} from './lib.mjs';

const PORT = 6569;
const log = logger('bounds-recheck.log.txt');
const data = await makeTemp('bnd2');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;

/** Parse SSE frames from text. */
function frames(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const frame = { event: 'message', data: '' };
    let any = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      any = true;
      if (field === 'id') frame.id = value;
      else if (field === 'event') frame.event = value;
      else if (field === 'data') frame.data += (frame.data ? '\n' : '') + value;
    }
    if (any) out.push(frame);
  }
  return out;
}

/** A fetch SSE reader that stops reading after its first chunk for `stallMs`, then drains. */
async function stalledReader(url, runId, { stallMs, lastEventId } = {}) {
  const response = await fetch(`${url}/runs/${runId}/events`, {
    headers: { accept: 'text/event-stream', ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }) },
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let stalled = !stallMs;
  let error;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!stalled) {
        stalled = true;
        await delay(stallMs);
      }
    }
  } catch (e) {
    error = String(e?.cause?.code ?? e);
  }
  // A frame cut by the server's close is incomplete: keep only blocks terminated by a blank line.
  const complete = text.slice(0, Math.max(text.lastIndexOf('\n\n'), text.lastIndexOf('\r\n\r\n')) + 2);
  const parsed = frames(complete);
  const events = [];
  for (const f of parsed) {
    if (f.id === undefined || f.event.startsWith('stream.')) continue;
    try {
      events.push(JSON.parse(f.data));
    } catch {
      /* an interrupted frame */
    }
  }
  return { status: response.status, events, controls: parsed.filter((f) => f.event.startsWith('stream.')).map((f) => ({ event: f.event, data: f.data.slice(0, 300) })), error, bytes: text.length };
}

const contiguousFrom = (seqs, from) => seqs.every((s, i) => s === from + i);

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  browser = await edge();
  results.edgeVersion = browser.version();

  // B. A large history and stalled raw readers.
  const heavy = await rest.createLoop(cycle({ name: 'QA heavy', passes: 120, blobChars: 196_608 }));
  const heavyRun = await rest.start(heavy.loop.id);
  await rest.waitStatus(heavyRun.id, ['succeeded', 'failed'], { timeout: 600_000, interval: 500 });
  // Finalization appends audit events after the terminal one: wait for its marker.
  const finished = await until(async () => {
    const r = await rest.run(heavyRun.id);
    return r.finalizedAt ? r : false;
  }, { timeout: 60_000, what: 'finalization' });
  const last = finished.lastEventSeq;
  {
    const normal = await stalledReader(api.url, heavyRun.id, {});
    const seqs = normal.events.map((e) => e.seq);
    check('normal reader: paged replay delivers 1..last in order, then stream.complete', seqs.length === last && contiguousFrom(seqs, 1) && normal.controls.some((c) => c.event === 'stream.complete'), {
      last, delivered: seqs.length, bytes: normal.bytes, controls: normal.controls.map((c) => c.event),
    });
    results.history = { last, bytes: normal.bytes };
    const short = await stalledReader(api.url, heavyRun.id, { stallMs: 2000 });
    const shortSeqs = short.events.map((e) => e.seq);
    check('reader stalled 2 s (under the 5 s drain limit): completes with no failure control', shortSeqs.length === last && contiguousFrom(shortSeqs, 1) && !short.controls.some((c) => c.event === 'stream.error'), {
      delivered: shortSeqs.length, controls: short.controls.map((c) => c.event),
    });
    for (const [stallMs, expectExplicit] of [[6000, true], [15_000, false]]) {
      const memBefore = await processMemory(api.pid);
      const stalled = await stalledReader(api.url, heavyRun.id, { stallMs });
      const memAfter = await processMemory(api.pid);
      const sSeqs = stalled.events.map((e) => e.seq);
      const errorControl = stalled.controls.find((c) => c.event === 'stream.error');
      const lastGood = sSeqs.at(-1) ?? 0;
      const resumed = await stalledReader(api.url, heavyRun.id, { lastEventId: lastGood });
      const rSeqs = resumed.events.map((e) => e.seq);
      const combined = [...sSeqs, ...rSeqs];
      const explicit = Boolean(errorControl?.data.includes('SSE_SLOW_CONSUMER'));
      check(`reader stalled ${stallMs / 1000} s: ${expectExplicit ? 'explicit SSE_SLOW_CONSUMER' : 'explicit failure or severed connection'}, no completion; Last-Event-ID resume completes 1..last with no gap or duplicate`, (expectExplicit ? explicit : explicit || Boolean(stalled.error)) && !stalled.controls.some((c) => c.event === 'stream.complete') && contiguousFrom(sSeqs, 1) && sSeqs.length < last && combined.length === last && contiguousFrom(combined, 1) && resumed.controls.some((c) => c.event === 'stream.complete'), {
        beforeFailure: sSeqs.length, explicit, errorControl, fetchError: stalled.error, resumedFrom: lastGood, afterResume: rSeqs.length, last, apiPrivateMiB: { before: memBefore.privateMiB, after: memAfter.privateMiB },
      });
    }
  }

  // C. The inspector itself as the stalled reader.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 1_500_000, uploadThroughput: -1 });
    await page.goto(`${api.url}/app/runs/${heavyRun.id}`);
    await until(async () => ((await inspectorState(page)).timeline.total ?? 0) > 10, { timeout: 120_000, what: 'replay in progress' });
    const atPause = (await inspectorState(page)).timeline;
    await cdp.send('Debugger.enable');
    await cdp.send('Debugger.pause');
    await delay(9000);
    await cdp.send('Debugger.resume');
    await cdp.send('Debugger.disable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const sawFellBehind = [];
    const end = Date.now() + 120_000;
    let st;
    while (Date.now() < end) {
      st = await inspectorState(page);
      if (st.bodyHasFellBehind) sawFellBehind.push(st.timeline);
      if (st.timeline.total === last && st.timeline.stream === 'complete') break;
      await delay(250);
    }
    await delay(2000);
    st = await inspectorState(page);
    const sse = rec.all.filter((r) => r.kind === 'events-sse');
    const counts = countByKind(rec.all);
    check('inspector stalled 9 s during replay: reopens from its cursor, completes, contiguous rows, status and count equal the API', st.timeline.total === last && st.timeline.stream === 'complete' && st.contiguous && st.lastRow === last && st.status === 'succeeded' && sse.length >= 2 && st.threadHeading === 'Current thread' && !counts['thread?at'], {
      atPause, final: { timeline: st.timeline, lastRow: st.lastRow, rows: st.rowsMounted, status: st.status, threadHeading: st.threadHeading }, sseRequests: sse.map((r) => r.search ?? r.url), sawFellBehind: sawFellBehind.slice(0, 3), requests: counts,
    });
    await page.screenshot({ path: join(HERE, 'bounds-recheck-stall-final.png') });
    await context.close();
  }
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  results.ok = !results.error && results.checks.every((c) => c.ok);
  await writeFile(join(HERE, 'bounds-recheck.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
