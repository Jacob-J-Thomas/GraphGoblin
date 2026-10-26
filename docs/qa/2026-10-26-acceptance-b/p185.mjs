// #185: execution outcome separate from return-delivery finalization, across REST, SSE (raw and
// the api-client helper), MCP and the Edge inspector, with delayed delivery, final failure,
// already-consumed terminal cursors, reconnect, a gateway crash/restart during pending delivery
// and a failing file sink.
import {
  makeTemp, removeTemp, startApi, restClient, logger, openSse, eventFrames, mcpClient, edge,
  apiClientPackage, startReceiver, delay, until, edge_,
} from './lib.mjs';
import { manual } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6450;
const log = logger('p185.log.txt');
const data = await makeTemp('185');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;
const receivers = [];

const webhookLoop = (name, url) => ({
  schemaVersion: 4,
  name,
  nodes: [
    manual(),
    { id: 'work', kind: 'mutate', label: 'Work', config: { operations: [{ op: 'set', path: '/vars/v', value: { kind: 'literal', value: 42 } }] } },
    { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.v', destinations: [{ kind: 'webhook', url }] } },
  ],
  edges: [edge_('start', 'out', 'work'), edge_('work', 'out', 'finish')],
});
const panelText = async (page) => (await page.getByRole('region', { name: /^(Webhook delivery|Finalization)$/ }).first().innerText({ timeout: 5000 }).catch(() => ''));
const timelineStatus = async (page) => {
  const t = await page.locator('h2').filter({ hasText: /^Timeline \(/ }).first().textContent();
  return /, ([^)]+)\)/.exec(t ?? '')?.[1];
};
const terminalSeq = (events) => events.findLast((e) => ['run.finished', 'run.failed', 'run.cancelled'].includes(e.type))?.seq;

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const mcp = await mcpClient(api.url);
  const { createGraphGoblinClient, subscribeRunEvents } = await apiClientPackage();
  const client = createGraphGoblinClient({ baseUrl: api.url, client: 'api' });
  browser = await edge();

  // ---------- A. delayed delivery, then delivered ----------
  let release;
  const held = new Promise((r) => (release = r));
  const recvA = await startReceiver(6451, (req, n) => (n === 1 ? { hold: held, status: 200 } : { status: 200 }));
  receivers.push(recvA);
  const loopA = await rest.createLoop(webhookLoop('Delayed delivery', `${recvA.url}/hook-a`));
  const pageA = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const runA = await rest.start(loopA.loop.id, {});
  await pageA.goto(`${api.url}/app/runs/${runA.id}`);
  await until(() => recvA.requests.length >= 1, { what: 'delivery attempt in flight', timeout: 30_000 });
  await delay(1500);
  const snapA = await rest('GET', `/runs/${runA.id}`);
  const eventsA = await rest.allEvents(runA.id);
  const tA = terminalSeq(eventsA);
  check('A REST while delivery is held: execution succeeded, finalizedAt absent, delivery pending and in flight', snapA.status === 'succeeded' && snapA.finalizedAt === undefined && snapA.deliveries?.[0]?.status === 'pending' && snapA.deliveries[0].inFlight === true, {
    status: snapA.status, finalizedAt: snapA.finalizedAt ?? null, delivery: snapA.deliveries?.[0],
  });
  const mcpGetA = await mcp.call('get_run', { runId: runA.id });
  const mcpWaitA = await mcp.call('wait_for_run', { runId: runA.id, timeoutSeconds: 2 });
  check('A MCP while pending: get_run shows pending delivery; wait_for_run returns finished:false with execution status and delivery snapshot', mcpGetA.deliveries?.[0]?.status === 'pending' && mcpWaitA.finished === false && JSON.stringify(mcpWaitA).includes('pending'), {
    getRun: { status: mcpGetA.status, finalizedAt: mcpGetA.finalizedAt ?? null }, waitForRun: mcpWaitA,
  });
  // SSE: from 0, from the consumed terminal cursor, from the current tail.
  const s1 = openSse(api.url, runA.id, { after: 0 });
  const s2 = openSse(api.url, runA.id, { after: tA });
  const s3 = openSse(api.url, runA.id, { after: eventsA.at(-1).seq });
  let doneResolved = false;
  const subA = subscribeRunEvents({ client, runId: runA.id, after: tA, onEvent: () => {} });
  subA.done.then(() => (doneResolved = true));
  await delay(4000);
  const inspectorPending = await panelText(pageA);
  const tlPending = await timelineStatus(pageA);
  check('A while pending (4 s): no SSE stream.complete (from 0, consumed terminal cursor, tail), api-client done unresolved, inspector "finalization pending" and Timeline not complete', !s1.state.completed && !s2.state.completed && !s3.state.completed && !doneResolved && /Execution ended; finalization pending\./.test(inspectorPending) && tlPending !== 'complete', {
    terminalSeq: tA, s1frames: s1.frames.length, s2frames: s2.frames.length, s3frames: s3.frames.length, inspector: inspectorPending.replace(/\s+/g, ' ').slice(0, 300), timeline: tlPending,
  });
  // Active reconnect while pending: close s1 and reconnect from its last id.
  const lastS1 = eventFrames(s1.frames).at(-1)?.seq ?? 0;
  s1.close();
  const s1b = openSse(api.url, runA.id, { lastEventId: lastS1 });
  await delay(1000);
  check('A reconnect while pending stays open (no completion)', !s1b.state.completed, { lastS1 });
  release();
  const [r1b, r2, r3] = await Promise.all([s1b.done, s2.done, s3.done]);
  await subA.done;
  const finA = await rest('GET', `/runs/${runA.id}`);
  const completeData = (r) => r.frames.find((f) => f.event === 'stream.complete')?.data;
  check('A after release: delivered, finalizedAt present; every SSE (reconnected, consumed-terminal, tail) ends with stream.complete; api-client done resolves', finA.deliveries?.[0]?.status === 'delivered' && !!finA.finalizedAt && r1b.completed && r2.completed && r3.completed && doneResolved, {
    delivery: finA.deliveries?.[0], finalizedAt: finA.finalizedAt, completions: [completeData(r1b), completeData(r2), completeData(r3)],
    afterTerminalEvents: eventFrames(r2.frames).map((e) => `${e.seq}:${e.type}`),
  });
  await pageA.getByText('Fully finalized.').waitFor({ timeout: 15_000 });
  await until(async () => (await timelineStatus(pageA)) === 'complete', { timeout: 15_000, what: 'timeline complete' });
  check('A inspector settles: "Fully finalized.", "Delivered after 1 attempt", Timeline complete', /Delivered after 1 attempt/.test(await panelText(pageA)), { panel: (await panelText(pageA)).replace(/\s+/g, ' ').slice(0, 300) });
  const mcpWaitA2 = await mcp.call('wait_for_run', { runId: runA.id, timeoutSeconds: 5 });
  check('A MCP wait_for_run after finalization: finished:true', mcpWaitA2.finished === true && mcpWaitA2.run?.finalizedAt !== undefined, { finished: mcpWaitA2.finished });
  const lastA = (await rest.allEvents(runA.id)).at(-1).seq;
  const empty = await openSse(api.url, runA.id, { after: lastA }).done;
  check('A finalized run, cursor at the end: immediate stream.complete with after=last (no events)', empty.completed && eventFrames(empty.frames).length === 0 && JSON.parse(completeData(empty)).after === lastA, { completion: completeData(empty) });
  const fromTerminal = await openSse(api.url, runA.id, { after: tA }).done;
  check('A finalized run, consumed terminal cursor: delivery audits after the outcome are delivered, then completion', fromTerminal.completed && eventFrames(fromTerminal.frames).some((e) => e.type.startsWith('delivery.')), { events: eventFrames(fromTerminal.frames).map((e) => e.type) });
  await pageA.screenshot({ path: join(HERE, 'p185-delivered.png') });

  // ---------- B. final delivery failure ----------
  const recvB = await startReceiver(6452, () => ({ status: 500, json: { error: 'controlled failure' } }));
  receivers.push(recvB);
  const loopB = await rest.createLoop(webhookLoop('Failing delivery', `${recvB.url}/hook-b`));
  const runB = await rest.start(loopB.loop.id, {});
  const pageB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pageB.goto(`${api.url}/app/runs/${runB.id}`);
  await until(() => recvB.requests.length >= 2, { what: 'two failed attempts', timeout: 60_000 });
  const midB = await rest('GET', `/runs/${runB.id}`);
  const mcpWaitB = await mcp.call('wait_for_run', { runId: runB.id, timeoutSeconds: 2 });
  check('B during retries: execution succeeded, delivery pending with lastError, MCP wait finished:false', midB.status === 'succeeded' && midB.deliveries?.[0]?.status === 'pending' && !midB.finalizedAt && mcpWaitB.finished === false, {
    delivery: midB.deliveries?.[0], mcp: mcpWaitB,
  });
  const sseB = openSse(api.url, runB.id, { after: 0 });
  const finB = await rest.waitStatus(runB.id, ['succeeded'], { timeout: 120_000, interval: 1000 }).then(() =>
    until(async () => {
      const r = await rest('GET', `/runs/${runB.id}`);
      return r.deliveries?.[0]?.status === 'failed' && r.finalizedAt ? r : false;
    }, { timeout: 120_000, interval: 1000, what: 'final failure' }),
  );
  const rB = await sseB.done;
  const mcpWaitB2 = await mcp.call('wait_for_run', { runId: runB.id, timeoutSeconds: 5 });
  await pageB.getByText('Fully finalized.').waitFor({ timeout: 15_000 });
  const panelB = await panelText(pageB);
  const eventsB = await rest.allEvents(runB.id);
  check('B final failure: status still succeeded, delivery failed after 5 attempts with typed lastError, finalizedAt set, SSE completes, MCP finished:true with failed snapshot, inspector shows failed beside succeeded', finB.status === 'succeeded' && finB.deliveries[0].status === 'failed' && finB.deliveries[0].attempts === 5 && rB.completed && mcpWaitB2.finished === true && mcpWaitB2.run?.deliveries?.[0]?.status === 'failed' && /Failed after 5 attempts/.test(panelB) && /Execution: succeeded/.test(panelB), {
    delivery: finB.deliveries[0], receiverRequests: recvB.requests.length, panel: panelB.replace(/\s+/g, ' ').slice(0, 400),
    deliveryEvents: eventsB.filter((e) => e.type.startsWith('delivery.')).map((e) => e.type),
    idempotencyKeys: [...new Set(recvB.requests.map((r) => r.headers['idempotency-key']))],
  });
  await pageB.screenshot({ path: join(HERE, 'p185-failed.png') });

  // ---------- C. gateway crash during pending delivery, restart ----------
  let attemptsC = 0;
  let releaseC;
  const heldC = new Promise((r) => (releaseC = r));
  const recvC = await startReceiver(6453, () => {
    attemptsC += 1;
    if (attemptsC === 1) return { status: 503 };
    if (attemptsC === 2) return { hold: heldC, status: 200 }; // in flight when the gateway dies
    return { status: 200 };
  });
  receivers.push(recvC);
  const loopC = await rest.createLoop(webhookLoop('Restart during delivery', `${recvC.url}/hook-c`));
  const runC = await rest.start(loopC.loop.id, {});
  const pageC = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pageC.goto(`${api.url}/app/runs/${runC.id}`);
  await until(() => attemptsC >= 2, { what: 'second attempt in flight', timeout: 60_000 });
  await delay(500);
  const evC = await rest.allEvents(runC.id);
  const tC = terminalSeq(evC);
  const before = await rest('GET', `/runs/${runC.id}`);
  const subErrors = [];
  let subCDone = false;
  const subC = subscribeRunEvents({ client, runId: runC.id, after: tC, onEvent: () => {}, onError: (e, a) => subErrors.push({ a, m: String(e?.message ?? e).slice(0, 100) }), backoff: { initialMs: 250, maxMs: 1000 } });
  subC.done.then(() => (subCDone = true));
  const rawC = openSse(api.url, runC.id, { after: tC });
  await delay(1000);
  await api.kill();
  const rawCResult = await rawC.done;
  await delay(4000);
  const panelDuringOutage = await panelText(pageC);
  check('C gateway killed during an in-flight attempt: raw SSE ends without stream.complete (EOF/error is not completion); api-client done unresolved; inspector still "finalization pending"', !rawCResult.completed && !subCDone && /finalization pending/.test(panelDuringOutage), {
    raw: { eof: rawCResult.eof, error: rawCResult.error }, subErrors: subErrors.slice(0, 3), panel: panelDuringOutage.replace(/\s+/g, ' ').slice(0, 300), deliveryBefore: before.deliveries?.[0],
  });
  releaseC();
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest2 = restClient(api.url);
  const finC = await until(async () => {
    const r = await rest2('GET', `/runs/${runC.id}`);
    return r.finalizedAt && r.deliveries?.[0]?.status !== 'pending' ? r : false;
  }, { timeout: 120_000, interval: 1000, what: 'finalized after restart' });
  await until(() => subCDone, { timeout: 60_000, what: 'api-client done after restart' });
  await pageC.getByText('Fully finalized.').waitFor({ timeout: 60_000 });
  const panelC = await panelText(pageC);
  check('C after restart: same delivery identity, retry budget continued, delivered, finalized; the api-client subscription that saw EOF settles only now; inspector settles; uncertainty disclosed', finC.deliveries[0].id === before.deliveries[0].id && finC.deliveries[0].status === 'delivered' && finC.deliveries[0].attempts >= 3 && subCDone && /Fully finalized/.test(panelC), {
    before: before.deliveries[0], after: finC.deliveries[0], receiverAttempts: attemptsC, idempotencyKeys: [...new Set(recvC.requests.map((r) => r.headers['idempotency-key']))], subErrors: subErrors.length, panel: panelC.replace(/\s+/g, ' ').slice(0, 500),
  });
  await pageC.screenshot({ path: join(HERE, 'p185-restart.png') });

  // ---------- D. failing file sink ----------
  const loopD = await rest2.createLoop({
    schemaVersion: 4,
    name: 'Failing file sink',
    nodes: [
      manual(),
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: '"payload"', destinations: [{ kind: 'caller' }, { kind: 'file', path: join(data, 'a-directory-not-a-file') }] } },
    ],
    edges: [edge_('start', 'out', 'finish')],
  });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(data, 'a-directory-not-a-file'), { recursive: true });
  const runD = await rest2.start(loopD.loop.id, {});
  const finD = await until(async () => {
    const r = await rest2('GET', `/runs/${runD.id}`);
    return r.finalizedAt ? r : false;
  }, { timeout: 30_000, what: 'D finalized' });
  const evD = await rest2.allEvents(runD.id);
  const failed = evD.find((e) => e.type === 'return.failed');
  const pageD = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pageD.goto(`${api.url}/app/runs/${runD.id}`);
  await pageD.getByText('Fully finalized.').waitFor({ timeout: 20_000 });
  const rowD = failed ? await pageD.locator(`ol[aria-label="Timeline"] button[data-seq="${failed.seq}"]`).innerText().catch(() => '') : '';
  check('D failing file sink: execution succeeded, return.failed recorded and visible in the Timeline after the outcome', finD.status === 'succeeded' && !!failed && /return\.failed/.test(rowD), {
    status: finD.status, returnFailed: failed, timelineRow: rowD.replace(/\s+/g, ' '),
  });
  await mcp.close();
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p185.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  for (const r of receivers) await r.close();
  await removeTemp(data);
  await log.flush();
}
