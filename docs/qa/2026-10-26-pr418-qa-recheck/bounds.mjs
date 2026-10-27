// Re-check adaptation: executes only section A, the two-minute memory sample.
// Transport and browser stalls run separately in bounds-recheck.mjs.
// Original probe's scope (B and C below are omitted from this copy):
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

const PORT = 6613;
const log = logger('bounds.log.txt');
const data = await makeTemp('bnd');
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

  // A. Browser memory while following live for two minutes.
  {
    const loop = await rest.createLoop(cycle({ name: 'QA memory' }));
    const run = await rest.start(loop.loop.id);
    await until(async () => (await rest.run(run.id)).lastEventSeq >= 3000, { timeout: 120_000, what: '3,000 events' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const page = await context.newPage();
    await page.goto(`${api.url}/app/runs/${run.id}`);
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
    await delay(3000);
    const samples = [];
    const t0 = Date.now();
    for (let i = 0; i <= 4; i++) {
      const st = await inspectorState(page);
      samples.push({
        atSeconds: Math.round((Date.now() - t0) / 1000),
        apiLastEventSeq: (await rest.run(run.id)).lastEventSeq,
        timelineTotal: st.timeline.total,
        jsHeapMiB: await heapMiB(page),
        sessionStorageBytesUtf16: await sessionStorageBytes(page),
        rowsMounted: st.rowsMounted,
        contiguous: st.contiguous,
        apiPrivateMiB: (await processMemory(api.pid)).privateMiB,
      });
      if (i < 4) await delay(30_000);
    }
    results.memory = { samples, requests: countByKind(rec.since(t0, run.id)), sseRequestsAtOpen: rec.all.filter((r) => r.kind === 'events-sse').map((r) => r.url.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ':id')) };
    const first = samples[0];
    const lastS = samples.at(-1);
    check('following live for 2 minutes: heap within 25% + 2 MiB, session cache under 1.3 MB, at most 80 contiguous rows', samples.every((s) => s.rowsMounted <= 80 && s.contiguous && s.sessionStorageBytesUtf16 < 1_300_000) && lastS.jsHeapMiB < first.jsHeapMiB * 1.25 + 2 && lastS.apiLastEventSeq - first.apiLastEventSeq > 5000, { samples });
    await rest('POST', `/runs/${run.id}/cancel`, {});
    await context.close();
  }

} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  results.ok = !results.error && results.checks.every((c) => c.ok);
  await writeFile(join(HERE, 'bounds.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
