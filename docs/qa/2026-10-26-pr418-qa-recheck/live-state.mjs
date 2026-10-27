// Check 2 (correct live state): while the inspector follows a run live, the run record, the
// observation panels and the current thread must end up equal to the API after a burst of
// events and at every kind of ending, and must not stay stale after the last event.
// Scenarios: success, failure, exit with an outcome, a gate that reaches its pass limit, a wait
// for input, pause and resume through the UI, cancellation by another client, a parent and its
// child run (two inspectors), a replay fork, a second tab, and a gateway restart (reconnect).
// For each, after the API reports the end state, the page is polled every 100 ms until every
// panel equals the API (convergence time recorded) and must then stay equal for 3 s.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, edge_,
  recordRequests, countByKind, inspectorState, HERE,
} from './lib.mjs';

const PORT = 6611;
const log = logger('live-state.log.txt');
const data = await makeTemp('ls');
const results = { scenarios: [] };
let api;
let browser;
let rest;
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'exhausted'];

/** Differences between what the page shows and what the API says, for a settled run. */
async function differences(page, runId, { terminal }) {
  const [ui, run, thread, obs] = await Promise.all([
    inspectorState(page),
    rest.run(runId),
    rest('GET', `/runs/${runId}/thread`),
    rest('GET', `/runs/${runId}/observation`),
  ]);
  const diffs = [];
  if (ui.status !== run.status) diffs.push({ panel: 'status badge', ui: ui.status, api: run.status });
  if (ui.timeline.total !== run.lastEventSeq) diffs.push({ panel: 'Timeline count', ui: ui.timeline.total, api: run.lastEventSeq });
  const stream = terminal ? 'complete' : 'live';
  if (ui.timeline.stream !== stream) diffs.push({ panel: 'Timeline stream', ui: ui.timeline.stream, api: stream });
  if (ui.lastRow !== run.lastEventSeq) diffs.push({ panel: 'Timeline last row', ui: ui.lastRow, api: run.lastEventSeq });
  if (ui.threadHeading !== 'Current thread') diffs.push({ panel: 'thread heading', ui: ui.threadHeading, api: 'Current thread' });
  if (!isDeepStrictEqual(ui.vars, thread.vars)) diffs.push({ panel: 'current thread variables', ui: ui.vars, api: thread.vars });
  if (run.result !== undefined) {
    let shown;
    try {
      shown = JSON.parse(ui.result ?? '');
    } catch {
      shown = ui.result;
    }
    if (!isDeepStrictEqual(shown, run.result)) diffs.push({ panel: 'Result', ui: ui.result, api: run.result });
  }
  if (Boolean(obs.exit) !== Boolean(ui.exitCard)) diffs.push({ panel: 'Exit evaluation card', ui: ui.exitCard, api: obs.exit?.outcome });
  if (obs.exit && ui.exitCard && !ui.exitCard.includes(obs.exit.outcome))
    diffs.push({ panel: 'Exit evaluation outcome', ui: ui.exitCard, api: obs.exit.outcome });
  const cancelText = obs.cancelled
    ? obs.cancelRequested
      ? `Cancelled by ${obs.cancelRequested.actor.kind} ${obs.cancelRequested.actor.id} (request #${obs.cancelRequested.seq}; cancellation #${obs.cancelled.seq}).`
      : 'Cancelled; actor not recorded.'
    : undefined;
  if (cancelText && !(ui.executionContext ?? '').includes(cancelText))
    diffs.push({ panel: 'Execution context cancellation', ui: ui.executionContext, api: cancelText });
  if (run.status === 'failed' && run.failure && !ui.alerts.some((a) => a.includes(`Failed: ${run.failure.code}`)))
    diffs.push({ panel: 'failure alert', ui: ui.alerts, api: run.failure.code });
  if (run.status === 'waiting') {
    const body = await page.locator('body').innerText();
    if (!body.includes('Input requested')) diffs.push({ panel: 'Wait panel', ui: 'absent', api: 'waiting for input' });
  }
  return { diffs, ui, api: { status: run.status, lastEventSeq: run.lastEventSeq, vars: thread.vars, result: run.result } };
}

/** Poll until the page equals the API, then require it to stay equal for `holdMs`. */
async function settle(page, runId, { terminal = true, timeoutMs = 20_000, holdMs = 3_000 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await differences(page, runId, { terminal });
    if (last.diffs.length === 0) break;
    await delay(100);
  }
  const convergedMs = last.diffs.length === 0 ? Date.now() - t0 : undefined;
  if (convergedMs === undefined) return { ok: false, convergedMs, stale: last.diffs, ui: last.ui, api: last.api };
  const holdEnd = Date.now() + holdMs;
  while (Date.now() < holdEnd) {
    const again = await differences(page, runId, { terminal });
    if (again.diffs.length) return { ok: false, convergedMs, regressed: again.diffs };
    await delay(250);
  }
  return { ok: true, convergedMs, ui: last.ui, api: last.api };
}

async function openFollowing(context, runId) {
  const page = await context.newPage();
  await page.goto(`${api.url}/app/runs/${runId}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  return page;
}

function record(name, entry) {
  const ok = entry.checks.every((c) => c.ok);
  results.scenarios.push({ name, ok, ...entry });
  log(ok ? 'PASS' : 'FAIL', name, entry);
}

const atReads = (rec, t0) => rec.all.filter((r) => r.t >= t0 && r.kind === 'thread?at');

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  rest = restClient(api.url);
  browser = await edge();
  results.edgeVersion = browser.version();

  // 1. Success after a burst: 400 passes (about 2,000 events), the inspector following from the start.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA success', passes: 400 }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const s = await settle(page, run.id);
    record('success after a burst', {
      runId: run.id,
      end: end.status,
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'ended succeeded with result 400', ok: end.status === 'succeeded' && end.result === 400, detail: end.result },
        { what: 'every panel equals the API and stays equal', ok: s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    results.successRunId = run.id;
    await context.close();
  }

  // 2. Failure: the gate's expression throws at n = 250.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA failure', gateJsonata: 'vars.n < 250 ? "again" : $error("qa-418 boom")' }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const s = await settle(page, run.id);
    record('failure', {
      runId: run.id,
      end: { status: end.status, failure: end.failure && { code: end.failure.code, message: end.failure.message } },
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'ended failed', ok: end.status === 'failed' },
        { what: 'every panel equals the API (incl. failure alert) and stays equal', ok: s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 3. Exit with an outcome: exhausted, and failure.
  for (const outcome of ['exhausted', 'failure']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: `QA exit ${outcome}`, passes: 300, outcome }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const s = await settle(page, run.id);
    const expected = outcome === 'exhausted' ? 'exhausted' : 'failed';
    record(`exit with outcome ${outcome}`, {
      runId: run.id,
      end: { status: end.status, outcome: end.outcome, result: end.result },
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: `ended ${expected} with result 300`, ok: end.status === expected && end.result === 300 },
        { what: 'every panel (incl. Exit evaluation with the outcome) equals the API and stays equal', ok: s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 4. A decision gate that reaches its pass limit (maxPasses 150) and routes to the exit.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA gate limit', gateJsonata: '"again"', maxPasses: 150 }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const s = await settle(page, run.id);
    const obs = await rest('GET', `/runs/${run.id}/observation`);
    const ui = await inspectorState(page);
    const gateShown = ui.exitCard ?? '';
    const gateFinish = (await rest.allEvents(run.id)).filter(e => e.type === 'node.finished' && e.nodeId === 'gate').at(-1);
    record('decision gate reaches its pass limit', {
      runId: run.id,
      end: { status: end.status, result: end.result },
      gate: obs.gate && { seq: obs.gate.seq, route: obs.gate.route, gate: obs.gate.gate },
      exitCard: gateShown,
      threadGates: s.api?.vars && (await rest('GET', `/runs/${run.id}/thread`)).gates,
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'ended succeeded through the limit route', ok: end.status === 'succeeded' && gateFinish?.route === 'limit-reached' },
        { what: 'every panel equals the API and stays equal', ok: s.ok },
        { what: 'Exit evaluation card shows the last gate (pass count)', ok: gateShown.includes(String(obs.gate?.gate?.passes ?? '?')) },
      ],
    });
    await context.close();
  }

  // 5. A wait for input after a burst, answered by another client.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const def = cycle({ name: 'QA wait', passes: 200 });
    def.nodes.splice(3, 0, { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'qa-418 prompt' } });
    def.edges = def.edges.map((e) => (e.id === 'gate-done-finish' ? edge_('gate', 'done', 'ask') : e));
    def.edges.push(edge_('ask', 'out', 'finish'));
    const loop = await rest.createLoop(def);
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    const waiting = await rest.waitStatus(run.id, ['waiting'], { timeout: 120_000 });
    const sWait = await settle(page, run.id, { terminal: false });
    await rest('POST', `/runs/${run.id}/input`, { waitId: waiting.waiting.waitId, input: { answer: 'yes' } });
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 60_000 });
    const s = await settle(page, run.id);
    record('wait for input, answered by another client', {
      runId: run.id,
      settleWhileWaiting: sWait,
      end: { status: end.status, result: end.result },
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'waiting state (status, Wait panel, thread) equals the API and stays equal', ok: sWait.ok },
        { what: 'after the answer the run succeeded and every panel equals the API', ok: end.status === 'succeeded' && s.ok },
      ],
    });
    await context.close();
  }

  // 6. Pause and resume through the UI, then cancellation through the UI.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA pause' }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    await delay(3000);
    await page.getByRole('button', { name: 'Pause' }).click();
    await rest.waitStatus(run.id, ['paused'], { timeout: 30_000 });
    const sPaused = await settle(page, run.id, { terminal: false });
    const pausedSeq = (await rest.run(run.id)).lastEventSeq;
    await page.getByRole('button', { name: 'Resume' }).click();
    await rest.waitStatus(run.id, ['running'], { timeout: 30_000 });
    await until(async () => (await rest.run(run.id)).lastEventSeq > pausedSeq + 200, { timeout: 60_000, what: 'run advances after resume' });
    const uiAfterResume = await inspectorState(page);
    const apiAfterResume = await rest('GET', `/runs/${run.id}/thread`);
    await delay(1500);
    const uiLater = await inspectorState(page);
    await page.getByRole('button', { name: 'Cancel run' }).click();
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 60_000 });
    const s = await settle(page, run.id);
    record('pause and resume through the UI, then cancel through the UI', {
      runId: run.id,
      settleWhilePaused: sPaused,
      afterResume: { status: uiAfterResume.status, uiVarsN: uiAfterResume.vars?.n, apiVarsN: apiAfterResume.vars.n, uiVarsNLater: uiLater.vars?.n },
      end: end.status,
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'paused state equals the API and stays equal', ok: sPaused.ok },
        { what: 'after resume the badge says running and the current thread keeps advancing', ok: uiAfterResume.status === 'running' && uiLater.vars?.n > uiAfterResume.vars?.n },
        { what: 'cancelled; status, cancellation actor and thread equal the API', ok: end.status === 'cancelled' && s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 7. Cancellation by another client while the inspector follows.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA cancel' }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    await delay(4000);
    await rest('POST', `/runs/${run.id}/cancel`, {});
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 60_000 });
    const s = await settle(page, run.id);
    record('cancellation by another client', {
      runId: run.id,
      end: end.status,
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'cancelled; every panel equals the API and stays equal', ok: end.status === 'cancelled' && s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 8. A parent and its child run, each followed by its own inspector.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const child = await rest.createLoop(cycle({ name: 'QA child', passes: 400 }));
    const parentDef = {
      schemaVersion: 4,
      name: 'QA parent',
      settings: { maxNodeVisits: null },
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child.loop.id } } },
        { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.n' } },
      ],
      edges: [edge_('start', 'out', 'sub'), edge_('sub', 'out', 'finish')],
    };
    const parent = await rest.createLoop(parentDef);
    const run = await rest.start(parent.loop.id);
    const parentPage = await openFollowing(context, run.id);
    const childRun = await until(async () => (await rest('GET', `/runs?parent=${run.id}`)).items[0], { timeout: 30_000, what: 'child run' });
    const childPage = await openFollowing(context, childRun.id);
    const childEnd = await rest.waitStatus(childRun.id, TERMINAL, { timeout: 120_000 });
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const [sChild, sParent] = await Promise.all([settle(childPage, childRun.id), settle(parentPage, run.id)]);
    record('parent and child inspectors', {
      runId: run.id,
      childRunId: childRun.id,
      end: { parent: end.status, parentResult: end.result, child: childEnd.status, childResult: childEnd.result },
      settleChild: sChild,
      settleParent: sParent,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'child succeeded; child inspector equals the API and stays equal', ok: childEnd.status === 'succeeded' && sChild.ok },
        { what: 'parent succeeded with the child result; parent inspector equals the API and stays equal', ok: end.status === 'succeeded' && sParent.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 9. A replay fork of the success run, followed from its start.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const fork = (await rest('POST', `/runs/${results.successRunId}/replay`, { nodeId: 'gate' })).run;
    const page = await openFollowing(context, fork.id);
    const end = await rest.waitStatus(fork.id, TERMINAL, { timeout: 120_000 });
    const s = await settle(page, fork.id);
    record('replay fork', {
      runId: fork.id,
      source: results.successRunId,
      end: { status: end.status, result: end.result },
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'fork succeeded with result 400; every panel equals the API and stays equal', ok: end.status === 'succeeded' && end.result === 400 && s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 10. A second tab following the same run.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA two tabs', passes: 500 }));
    const run = await rest.start(loop.loop.id);
    const first = await openFollowing(context, run.id);
    await delay(2000);
    const second = await openFollowing(context, run.id);
    const end = await rest.waitStatus(run.id, TERMINAL, { timeout: 120_000 });
    const [s1, s2] = await Promise.all([settle(first, run.id), settle(second, run.id)]);
    record('second tab', {
      runId: run.id,
      end: end.status,
      settleFirst: s1,
      settleSecond: s2,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'both tabs equal the API and stay equal', ok: end.status === 'succeeded' && s1.ok && s2.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }

  // 11. A gateway restart while following (hard kill, restart on the same data directory).
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rec = recordRequests(context);
    const t0 = Date.now();
    const loop = await rest.createLoop(cycle({ name: 'QA restart', passes: 1500 }));
    const run = await rest.start(loop.loop.id);
    const page = await openFollowing(context, run.id);
    await delay(6000);
    const atKill = (await rest.run(run.id)).lastEventSeq;
    await api.kill();
    await delay(4000);
    const outage = await inspectorState(page);
    const outageBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600);
    api = await startApi({ port: PORT, dataDir: data, log });
    rest = restClient(api.url);
    const afterRestart = await rest.run(run.id);
    let end = afterRestart;
    if (!TERMINAL.includes(end.status)) end = await rest.waitStatus(run.id, TERMINAL, { timeout: 240_000 });
    const s = await settle(page, run.id, { timeoutMs: 40_000 });
    record('reconnect after a gateway restart', {
      runId: run.id,
      atKill,
      outage: { timeline: outage.timeline, alerts: outage.alerts, body: outageBody },
      afterRestart: { status: afterRestart.status, lastEventSeq: afterRestart.lastEventSeq },
      end: { status: end.status, result: end.result, failure: end.failure?.code },
      settle: s,
      requests: countByKind(rec.since(t0)),
      checks: [
        { what: 'after reconnect every panel equals the API and stays equal', ok: s.ok },
        { what: 'no thread?at read while following', ok: atReads(rec, t0).length === 0 },
      ],
    });
    await context.close();
  }
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  results.ok = !results.error && results.scenarios.every((s) => s.ok);
  await writeFile(join(HERE, 'live-state.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
