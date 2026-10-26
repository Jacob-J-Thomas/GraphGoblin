// #116 (with #183/#239): failure, resume and success agree across REST run/thread reads, MCP,
// and existing, freshly opened, reconnected and reloaded Edge tabs; a delayed run snapshot seen
// by a tab; unfinished patches never applied; current-thread reads never mutate stored state;
// lagging stored checkpoints (storage fault injection on the disposable store) reconcile to the
// same thread.
import { DatabaseSync } from 'node:sqlite';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeTemp, removeTemp, startApi, restClient, logger, mcpClient, edge, delay, until, edge_, HERE,
} from './lib.mjs';
import { manual } from './defs.mjs';

const PORT = 6450;
const log = logger('p116.log.txt');
const data = await makeTemp('116');
const results = { checks: [], phases: {} };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let api;
let browser;

const storedRow = (runId) => {
  const db = new DatabaseSync(join(data, 'graphgoblin.db'), { readOnly: true });
  try {
    const row = db.prepare('select status, last_event_seq, thread_snapshot, thread_snapshot_seq, thread_snapshot_replay_state, finalized_at from runs where id = ?').get(runId);
    const events = db.prepare('select count(*) n from run_events where run_id = ?').get(runId).n;
    return { ...row, events };
  } finally {
    db.close();
  }
};
const headerStatus = async (page) => (await page.locator('header').filter({ has: page.locator('h1') }).first().innerText()).replace(/\s+/g, ' ');
const timeline = async (page) => {
  const t = await page.locator('h2').filter({ hasText: /^Timeline \(/ }).first().textContent();
  const m = /Timeline \((\d+) events, ([^)]+)\)/.exec(t ?? '');
  const rows = await page.$$eval('ol[aria-label="Timeline"] button[data-seq]', (b) => b.map((x) => `${x.dataset.seq}:${x.querySelector('code')?.textContent}`));
  return { total: m ? Number(m[1]) : NaN, status: m?.[2], rows };
};
async function browserThread(page) {
  const disclosure = page.getByRole('button', { name: 'Full thread JSON' });
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  const text = await page.getByTestId('thread-json').textContent();
  const heading = await page.locator('h2').filter({ hasText: /^(Current thread|Thread at event \d+)$/ }).first().textContent();
  return { heading, thread: JSON.parse(text) };
}

try {
  const scripts = join(data, 'scripts');
  await mkdir(scripts, { recursive: true });
  const flag = join(scripts, 'allow.flag');
  const scriptFile = join(scripts, 'work.mjs');
  await writeFile(
    scriptFile,
    [
      "import { existsSync } from 'node:fs';",
      'await new Promise((r) => setTimeout(r, 3000));',
      "process.stdout.write(JSON.stringify([{ op: 'add', path: '/vars/items/-', value: 'from-script' }, { op: 'add', path: '/vars/scriptOk', value: true }]));",
      'process.exitCode = existsSync(process.argv[2]) ? 0 : 1;',
    ].join('\n'),
  );
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const mcp = await mcpClient(api.url);

  // ---------- #183: an expression failure exposes the failed node's start, never a patch ----------
  const exprLoop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Expression failure',
    nodes: [
      manual(),
      { id: 'prep', kind: 'mutate', label: 'Prep', config: { operations: [{ op: 'set', path: '/vars/a', value: { kind: 'literal', value: 1 } }] } },
      { id: 'bad', kind: 'mutate', label: 'Bad', config: { operations: [{ op: 'set', path: '/vars/b', value: { kind: 'expression', jsonata: '$error("deliberate expression failure")' } }] } },
      { id: 'finish', kind: 'exit', label: 'Finish', config: {} },
    ],
    edges: [edge_('start', 'out', 'prep'), edge_('prep', 'out', 'bad'), edge_('bad', 'out', 'finish')],
  });
  const exprRun = await rest.start(exprLoop.loop.id, {});
  const exprFailed = await rest.waitStatus(exprRun.id, ['failed']);
  const exprEvents = await rest.allEvents(exprRun.id);
  const exprThread = await rest('GET', `/runs/${exprRun.id}/thread`);
  const exprMcpThread = await mcp.call('get_run_thread', { runId: exprRun.id });
  check('#183 expression failure: current thread counts the failed node start (nodeVisits.bad = 1) and has no patch from it; MCP thread equals REST', exprThread.counters.nodeVisits.bad === 1 && exprThread.vars.b === undefined && exprThread.vars.a === 1 && same(exprThread, exprMcpThread) && exprEvents.some((e) => e.type === 'node.started' && e.nodeId === 'bad') && !exprEvents.some((e) => e.type === 'node.finished' && e.nodeId === 'bad'), {
    failure: exprFailed.failure, nodeVisits: exprThread.counters.nodeVisits, vars: exprThread.vars,
  });

  // ---------- failure -> resume -> success with tabs ----------
  const loop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Failure resume success',
    nodes: [
      manual(),
      { id: 'prep', kind: 'mutate', label: 'Prep', config: { operations: [{ op: 'set', path: '/vars/items', value: { kind: 'literal', value: ['seed'] } }] } },
      { id: 'work', kind: 'script', label: 'Work', config: { command: process.execPath, args: [scriptFile, flag], stdin: 'none', stdout: 'patch' } },
      { id: 'after', kind: 'mutate', label: 'After', config: { operations: [{ op: 'set', path: '/vars/done', value: { kind: 'literal', value: true } }] } },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars' } },
    ],
    edges: [edge_('start', 'out', 'prep'), edge_('prep', 'out', 'work'), edge_('work', 'out', 'after'), edge_('after', 'out', 'finish')],
  });
  browser = await edge();
  const ctxExisting = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxReconnect = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const run = await rest.start(loop.loop.id, {});
  const t1 = await ctxExisting.newPage();
  await t1.goto(`${api.url}/app/runs/${run.id}`);
  const t3 = await ctxReconnect.newPage();
  await t3.goto(`${api.url}/app/runs/${run.id}`);
  // While the script runs (3 s): the open visit is counted, its output is not applied.
  await until(async () => (await rest.allEvents(run.id)).some((e) => e.type === 'node.started' && e.nodeId === 'work'), { what: 'work started' });
  const during = await rest('GET', `/runs/${run.id}/thread`);
  const duringRow = storedRow(run.id);
  check('unfinished script visit: current thread counts the start (nodeVisits.work = 1) without its output', during.counters.nodeVisits.work === 1 && during.vars.scriptOk === undefined && same(during.vars.items, ['seed']), {
    nodeVisits: during.counters.nodeVisits, vars: during.vars, storedSnapshotSeq: duringRow.thread_snapshot_seq,
  });
  // Cut the reconnecting tab off before the failure and resume.
  await ctxReconnect.setOffline(true);
  const failed = await rest.waitStatus(run.id, ['failed'], { timeout: 30_000 });
  const evFailed = await rest.allEvents(run.id);
  // Read everything twice; stored state must not change because of reads.
  const rowBefore = storedRow(run.id);
  const threadFailed = await rest('GET', `/runs/${run.id}/thread`);
  const mcpRunFailed = await mcp.call('get_run', { runId: run.id });
  const mcpThreadFailed = await mcp.call('get_run_thread', { runId: run.id });
  await rest('GET', `/runs/${run.id}/thread`);
  const rowAfter = storedRow(run.id);
  results.phases.failed = { failure: failed.failure, thread: threadFailed, lastEventSeq: failed.lastEventSeq };
  check('failed: SCRIPT_EXIT_CODE resumable; the printed patch of the failed visit is not applied; REST run/thread equal MCP get_run/get_run_thread', failed.failure?.code === 'SCRIPT_EXIT_CODE' && failed.failure.resumable === true && threadFailed.vars.scriptOk === undefined && same(threadFailed.vars.items, ['seed']) && same(threadFailed, mcpThreadFailed) && mcpRunFailed.status === 'failed' && mcpRunFailed.failure?.code === 'SCRIPT_EXIT_CODE', {
    failure: failed.failure, vars: threadFailed.vars, nodeVisits: threadFailed.counters.nodeVisits,
  });
  check('reads do not mutate: stored status, last_event_seq, checkpoint (snapshot/seq/state) and event count identical before and after REST+MCP reads', same(rowBefore, rowAfter), { seq: rowAfter.last_event_seq, snapshotSeq: rowAfter.thread_snapshot_seq, state: rowAfter.thread_snapshot_replay_state, events: rowAfter.events });
  await t1.getByText('Failed: SCRIPT_EXIT_CODE').waitFor({ timeout: 20_000 });
  // A fresh tab whose first run-record reads are delayed (served the pre-failure snapshot) for 4 s.
  const ctxFresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const t2 = await ctxFresh.newPage();
  const staleRecord = { ...failed, status: 'running', failure: undefined, finishedAt: undefined, currentNodeId: 'work' };
  delete staleRecord.failure;
  delete staleRecord.finishedAt;
  const staleUntil = Date.now() + 4000;
  let staleServed = 0;
  await t2.route((url) => url.pathname === `/runs/${run.id}`, async (route) => {
    if (route.request().method() === 'GET' && Date.now() < staleUntil) {
      staleServed += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleRecord) });
    } else await route.continue();
  });
  await t2.goto(`${api.url}/app/runs/${run.id}`);
  await t2.getByText('Failed: SCRIPT_EXIT_CODE').waitFor({ timeout: 30_000 });
  const tl1 = await timeline(t1);
  const tl2 = await timeline(t2);
  check('failed: existing tab and a fresh tab served a delayed (stale running) run record both settle on Failed: SCRIPT_EXIT_CODE with the run.failed row', tl1.rows.some((r) => r.endsWith('run.failed')) && tl2.rows.some((r) => r.endsWith('run.failed')) && staleServed > 0, {
    t1: { total: tl1.total, status: tl1.status }, t2: { total: tl2.total, status: tl2.status, staleRecordResponses: staleServed }, apiLast: evFailed.at(-1).seq,
  });
  const bt1 = await browserThread(t1);
  check('failed: the existing tab\'s thread JSON matches the API thread at the same boundary', same(bt1.thread.vars, threadFailed.vars) && same(bt1.thread.counters.nodeVisits, threadFailed.counters.nodeVisits), { heading: bt1.heading, vars: bt1.thread.vars });

  // Resume from another client (MCP) once the external condition is fixed.
  await writeFile(flag, 'ok');
  const resumed = await mcp.call('resume_run', { runId: run.id });
  log('resume_run via MCP', { status: resumed.status ?? resumed.run?.status });
  const running = await rest('GET', `/runs/${run.id}`);
  const threadRunning = await rest('GET', `/runs/${run.id}/thread`);
  check('resumed (another client): run running again; current thread still has no unfinished patch', ['running', 'succeeded'].includes(running.status) && threadRunning.vars.scriptOk === undefined, { status: running.status, nodeVisits: threadRunning.counters.nodeVisits });
  const done = await rest.waitStatus(run.id, ['succeeded', 'failed'], { timeout: 60_000 });
  const evDone = await rest.allEvents(run.id);
  const threadDone = await rest('GET', `/runs/${run.id}/thread`);
  const mcpThreadDone = await mcp.call('get_run_thread', { runId: run.id });
  const mcpRunDone = await mcp.call('get_run', { runId: run.id });
  results.phases.succeeded = { thread: threadDone, lastEventSeq: evDone.at(-1).seq };
  check('succeeded: patch applied exactly once (items = [seed, from-script]), nodeVisits.work = 2, REST equals MCP', done.status === 'succeeded' && same(threadDone.vars.items, ['seed', 'from-script']) && threadDone.vars.scriptOk === true && threadDone.vars.done === true && threadDone.counters.nodeVisits.work === 2 && same(threadDone, mcpThreadDone) && mcpRunDone.status === 'succeeded', {
    vars: threadDone.vars, nodeVisits: threadDone.counters.nodeVisits, result: done.result,
  });
  for (const [name, page] of [['existing tab', t1], ['fresh tab', t2]]) {
    await page.getByText('Fully finalized.').waitFor({ timeout: 30_000 });
    await until(async () => (await timeline(page)).status === 'complete', { timeout: 30_000, what: `${name} complete` });
    const tl = await timeline(page);
    const hdr = await headerStatus(page);
    check(`succeeded: ${name} followed the resume without reload (failed -> resumed -> finished rows, Succeeded, complete, total = API last)`, tl.total === evDone.at(-1).seq && ['run.failed', 'run.resumed', 'run.finished'].every((t) => tl.rows.some((r) => r.endsWith(t))) && /Succeeded/i.test(hdr), {
      total: tl.total, status: tl.status, header: hdr.slice(0, 120), lastRows: tl.rows.slice(-6),
    });
  }
  // The reconnecting tab comes back online after the whole failure/resume/success sequence.
  await ctxReconnect.setOffline(false);
  await t3.getByText('Fully finalized.').waitFor({ timeout: 60_000 });
  await until(async () => (await timeline(t3)).status === 'complete', { timeout: 60_000, what: 'reconnected complete' });
  const tl3 = await timeline(t3);
  check('reconnected tab (offline through failure and resume): catches up to Succeeded with every row up to the API last', tl3.total === evDone.at(-1).seq && ['run.failed', 'run.resumed', 'run.finished'].every((t) => tl3.rows.some((r) => r.endsWith(t))) && /Succeeded/i.test(await headerStatus(t3)), {
    total: tl3.total, status: tl3.status,
  });
  await t1.reload();
  await t1.getByText('Fully finalized.').waitFor({ timeout: 30_000 });
  const bt1b = await browserThread(t1);
  check('reloaded tab: Succeeded and its thread JSON equals the API thread', /Succeeded/i.test(await headerStatus(t1)) && same(bt1b.thread.vars, threadDone.vars) && same(bt1b.thread.counters.nodeVisits, threadDone.counters.nodeVisits), { heading: bt1b.heading });
  await t1.screenshot({ path: join(HERE, 'p116-succeeded.png') });

  // ---------- delayed (lagging) stored checkpoints, injected into the disposable store ----------
  const prepFinished = evDone.find((e) => e.type === 'node.finished' && e.nodeId === 'prep').seq;
  const workStarted2 = evDone.filter((e) => e.type === 'node.started' && e.nodeId === 'work').at(-1).seq;
  const atPrep = await rest('GET', `/runs/${run.id}/thread?at=${prepFinished}`);
  const atWork2 = await rest('GET', `/runs/${run.id}/thread?at=${workStarted2}`);
  const original = storedRow(run.id);
  await mcp.close();
  await api.kill();
  const variants = [
    { label: 'checkpoint at prep completion, recorded state {strict:true}', seq: prepFinished, thread: atPrep, state: { strict: true } },
    { label: 'checkpoint at the resumed work start (open visit), state {strict:true, openNodeId:"work"}', seq: workStarted2, thread: atWork2, state: { strict: true, openNodeId: 'work' } },
    { label: 'checkpoint at prep completion without recorded state (NULL: full prefix)', seq: prepFinished, thread: atPrep, state: null },
  ];
  for (const variant of variants) {
    const db = new DatabaseSync(join(data, 'graphgoblin.db'));
    db.prepare('update runs set thread_snapshot = ?, thread_snapshot_seq = ?, thread_snapshot_replay_state = ? where id = ?').run(JSON.stringify(variant.thread), variant.seq, variant.state === null ? null : JSON.stringify(variant.state), run.id);
    db.close();
    const injected = storedRow(run.id);
    api = await startApi({ port: PORT, dataDir: data, log });
    const r = restClient(api.url);
    const m = await mcpClient(api.url);
    const restThread = await r('GET', `/runs/${run.id}/thread`);
    const mcpThread = await m.call('get_run_thread', { runId: run.id });
    const page = await ctxFresh.newPage();
    await page.goto(`${api.url}/app/runs/${run.id}`);
    await page.getByText('Fully finalized.').waitFor({ timeout: 30_000 });
    const bt = await browserThread(page);
    await page.close();
    await m.close();
    const after = storedRow(run.id);
    check(`lagging checkpoint (${variant.label}): REST, MCP and the inspector reconcile to the full thread; the lagging checkpoint is left untouched`, same(restThread, threadDone) && same(mcpThread, threadDone) && same(bt.thread.vars, threadDone.vars) && same(after, injected), {
      injectedSeq: variant.seq, storedAfterSeq: after.thread_snapshot_seq, storedState: after.thread_snapshot_replay_state, browserHeading: bt.heading,
    });
    await api.kill();
  }
  results.originalCheckpoint = { seq: original.thread_snapshot_seq, state: original.thread_snapshot_replay_state };
  await rm(flag, { force: true });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p116.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
