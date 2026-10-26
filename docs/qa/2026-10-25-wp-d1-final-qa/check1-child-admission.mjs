// Check 1 (#320): child admission and completion across hard kills of the built API.
// Run: node --expose-gc check1-child-admission.mjs
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiStore, chain, countType, eventually, exitNode, gateParent, logger, makeDataDir, removeDir,
  scriptNode, sleep, subNode, TERMINAL, visitAccounting, worktree, writeJson,
} from './lib.mjs';

const { openReadOnlyDatabaseClient } = await import(
  pathToFileURL(join(worktree, 'packages/infrastructure/dist/sqlite/db.js')).href
);
const log = logger('check1-child-admission');
const PORT = 6390;
const violations = [];
const results = { phases: {} };
const violate = (where, what, extra) => {
  violations.push({ where, what, ...(extra ? { extra } : {}) });
  log('VIOLATION', where, what, extra ?? '');
};

async function durableSnapshot(dataDir) {
  const client = openReadOnlyDatabaseClient(join(dataDir, 'graphgoblin.db'));
  try {
    const r = await client.execute(`SELECT
      (SELECT count(*) FROM runs WHERE parent_run_id IS NOT NULL) AS children,
      (SELECT count(*) FROM runs WHERE parent_run_id IS NOT NULL AND status IN ('succeeded','failed','cancelled','exhausted')) AS terminalChildren,
      (SELECT count(*) FROM run_events WHERE type='child_run.started') AS links,
      (SELECT count(*) FROM run_events WHERE type='child_run.finished') AS finishes,
      (SELECT count(*) FROM runs c WHERE c.parent_run_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM run_events e WHERE e.run_id = c.parent_run_id AND e.type = 'child_run.started'
           AND json_extract(e.payload, '$.childRunId') = c.id)) AS unlinked,
      (SELECT count(*) FROM runs c WHERE c.parent_run_id IS NOT NULL
         AND c.status IN ('succeeded','failed','cancelled','exhausted') AND NOT EXISTS (
         SELECT 1 FROM run_events e WHERE e.run_id = c.parent_run_id AND e.type = 'child_run.finished'
           AND json_extract(e.payload, '$.childRunId') = c.id)) AS terminalChildNotYetConsumed,
      (SELECT count(*) FROM runs WHERE status = 'running') AS running,
      (SELECT count(*) FROM runs WHERE status = 'waiting') AS waiting,
      (SELECT count(*) FROM runs WHERE status = 'queued') AS queued,
      (SELECT count(*) FROM runs WHERE parent_run_id IS NULL AND status = 'succeeded') AS topSucceeded`);
    return Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]));
  } finally {
    client.close();
    globalThis.gc?.();
  }
}

/** This trial's share of the cumulative counters; statuses are absolute at the kill. */
function delta(now, base) {
  const out = { ...now };
  for (const k of ['children', 'terminalChildren', 'links', 'finishes', 'topSucceeded']) out[k] = now[k] - base[k];
  return out;
}

/** Verify one parent tree: each visit one child, one finish per observed outcome, one continuation. */
async function verifyTree(store, runId, where, { visits, depth, finishesPerVisit = 1, gate = true }) {
  const run = await store.run(runId);
  const events = await store.events(runId);
  const summary = { runId, status: run.status };
  if (depth === 0) {
    summary.runFinished = countType(events, 'run.finished');
    if (summary.runFinished !== 1) violate(where, `leaf ${runId} has ${summary.runFinished} run.finished`);
    return summary;
  }
  const accounting = visitAccounting(events);
  const children = await store.children(runId);
  summary.visits = accounting.length;
  summary.children = children.length;
  summary.perVisit = accounting.map((v) => ({
    childStarts: v.childStarts.length,
    childFinishes: v.childFinishes.map((f) => f.status).join('+'),
    nodeFinished: v.nodeFinished,
    attempts: v.attempts,
    wokenChild: v.wokenChild,
  }));
  if (accounting.length !== visits) violate(where, `${runId}: ${accounting.length} visits, expected ${visits}`);
  const linked = new Set();
  accounting.forEach((v, i) => {
    if (v.childStarts.length !== 1) violate(where, `${runId} visit ${i + 1}: ${v.childStarts.length} child_run.started`);
    if (v.childFinishes.length !== finishesPerVisit)
      violate(where, `${runId} visit ${i + 1}: ${v.childFinishes.length} child_run.finished, expected ${finishesPerVisit}`);
    if (v.nodeFinished !== 1) violate(where, `${runId} visit ${i + 1}: subloop node.finished ${v.nodeFinished}`);
    for (const f of v.childFinishes)
      if (f.childRunId !== v.childStarts[0]) violate(where, `${runId} visit ${i + 1}: finish names another child`);
    v.childStarts.forEach((id) => linked.add(id));
  });
  const listed = new Set(children.map((c) => c.id));
  for (const id of listed) if (!linked.has(id)) violate(where, `${runId}: orphan child ${id} (no link)`);
  for (const id of linked) if (!listed.has(id)) violate(where, `${runId}: link to missing child ${id}`);
  summary.runFinished = countType(events, 'run.finished');
  if (summary.runFinished !== 1) violate(where, `${runId} has ${summary.runFinished} run.finished`);
  if (gate) {
    summary.decisions = countType(events, 'decision.made');
    summary.gateStarts = countType(events, 'node.started', (e) => e.nodeId === 'gate' && e.attempt === 1);
    if (summary.decisions !== visits) violate(where, `${runId}: ${summary.decisions} decision.made for ${visits} visits`);
    if (summary.gateStarts !== visits) violate(where, `${runId}: gate entered ${summary.gateStarts} times for ${visits} visits`);
  }
  summary.recoveredStarts = countType(events, 'run.started', (e) => e.attempt > 1);
  summary.kids = [];
  for (const child of children)
    summary.kids.push(await verifyTree(store, child.id, where, { visits: 1, depth: depth - 1, finishesPerVisit, gate: false }));
  return summary;
}

async function globalOrphanCheck(store, where) {
  const all = await store.runs();
  const byId = new Map(all.map((r) => [r.id, r]));
  let children = 0;
  const linkCache = new Map();
  for (const r of all) {
    if (!r.parentRunId) continue;
    children += 1;
    if (!byId.has(r.parentRunId)) violate(where, `child ${r.id} names missing parent`);
    if (!linkCache.has(r.parentRunId))
      linkCache.set(
        r.parentRunId,
        new Set((await store.events(r.parentRunId)).filter((e) => e.type === 'child_run.started').map((e) => e.childRunId)),
      );
    if (!linkCache.get(r.parentRunId).has(r.id)) violate(where, `orphan child ${r.id} under ${r.parentRunId}`);
  }
  return { runs: all.length, children };
}

const leafFast = chain('QA leaf fast', [exitNode('"leaf"')]);
const middleOf = (child, name = 'QA middle') => chain(name, [subNode(child), exitNode('outputs.sub.value.result')]);

// ---------------------------------------------------------------------------------------------
async function phaseCreation(store) {
  const where = '1A creation kills';
  if (!store.server || store.server.exitInfo) await store.start({ GG_MAX_CONCURRENT_RUNS: '8' });
  const leaf = await store.publish(leafFast);
  const middle = await store.publish(middleOf(leaf));
  const top = await store.publish(gateParent('QA top creation', middle, 3));
  const trials = [];
  for (const delay of [0, 3, 8, 15, 30, 60, 120, 250, 500]) {
    if (!store.server || store.server.exitInfo) await store.start({ GG_MAX_CONCURRENT_RUNS: '8' });
    const base = await durableSnapshot(store.dataDir);
    const roots = await Promise.all(Array.from({ length: 10 }, () => store.startRun(top)));
    await sleep(delay);
    await store.kill();
    const atKill = delta(await durableSnapshot(store.dataDir), base);
    await store.start({ GG_MAX_CONCURRENT_RUNS: '8' });
    await eventually(async () => {
      const runs = await Promise.all(roots.map((r) => store.run(r.id)));
      return runs.every((r) => TERMINAL.includes(r.status));
    }, 90_000, `${where} delay ${delay} terminal`);
    const trees = [];
    for (const r of roots) {
      const t = await verifyTree(store, r.id, `${where} d=${delay}`, { visits: 3, depth: 2 });
      if (t.status !== 'succeeded') violate(where, `top ${r.id} ended ${t.status}`);
      trees.push(t);
    }
    const trial = {
      delayMs: delay,
      atKill,
      tops: trees.length,
      topStatuses: [...new Set(trees.map((t) => t.status))],
      recoveredTopStarts: trees.reduce((n, t) => n + t.recoveredStarts, 0),
      childrenPerTop: trees.map((t) => t.children),
      grandchildrenPerMiddle: trees.flatMap((t) => t.kids.map((k) => k.children)),
    };
    trials.push(trial);
    log(where, JSON.stringify(trial));
  }
  results.phases.creation = { trials, global: await globalOrphanCheck(store, where) };
}

// ---------------------------------------------------------------------------------------------
async function phaseTimerCompletion(store) {
  const where = '1B completion kills (timer leaf)';
  if (!store.server || store.server.exitInfo) await store.start({ GG_TIMER_POLL_MS: '50', GG_MAX_CONCURRENT_RUNS: '8' });
  const leaf = await store.publish(
    chain('QA leaf timer', [
      { id: 'pause', kind: 'wait', label: 'Pause', config: { mode: 'duration', seconds: 1 } },
      exitNode('"timer leaf"'),
    ]),
  );
  const middle = await store.publish(middleOf(leaf, 'QA middle timer'));
  const top = await store.publish(gateParent('QA top timer', middle, 3));
  const trials = [];
  for (const delay of [1000, 1080, 1160, 1250, 1400, 2250, 2400, 3450]) {
    if (!store.server || store.server.exitInfo) await store.start({ GG_TIMER_POLL_MS: '50', GG_MAX_CONCURRENT_RUNS: '8' });
    const base = await durableSnapshot(store.dataDir);
    const t0 = Date.now();
    const roots = [];
    for (let i = 0; i < 8; i++) {
      roots.push(await store.startRun(top));
      await sleep(30);
    }
    await sleep(Math.max(0, delay - (Date.now() - t0)));
    await store.kill();
    const atKill = delta(await durableSnapshot(store.dataDir), base);
    await store.start({ GG_TIMER_POLL_MS: '50', GG_MAX_CONCURRENT_RUNS: '8' });
    await eventually(async () => {
      const runs = await Promise.all(roots.map((r) => store.run(r.id)));
      return runs.every((r) => TERMINAL.includes(r.status));
    }, 120_000, `${where} delay ${delay} terminal`);
    const trees = [];
    for (const r of roots) {
      const t = await verifyTree(store, r.id, `${where} d=${delay}`, { visits: 3, depth: 2 });
      if (t.status !== 'succeeded') violate(where, `top ${r.id} ended ${t.status}`);
      trees.push(t);
    }
    const trial = {
      killAfterFirstStartMs: delay,
      atKill,
      topStatuses: [...new Set(trees.map((t) => t.status))],
      recoveredTopStarts: trees.reduce((n, t) => n + t.recoveredStarts, 0),
      recoveredMiddleStarts: trees.reduce((n, t) => n + t.kids.reduce((m, k) => m + k.recoveredStarts, 0), 0),
      wokenPerTopVisit: trees.flatMap((t) => t.perVisit.map((v) => v.wokenChild)).join(''),
    };
    trials.push(trial);
    log(where, JSON.stringify(trial));
  }
  results.phases.timerCompletion = { trials, global: await globalOrphanCheck(store, where) };
}

// ---------------------------------------------------------------------------------------------
async function phaseInputCompletion(store) {
  const where = '1B input-answer kills';
  if (!store.server || store.server.exitInfo) await store.start();
  const leaf = await store.publish(
    chain('QA leaf input', [
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'leaf?' } },
      exitNode('outputs.ask.value'),
    ]),
  );
  const middle = await store.publish(middleOf(leaf, 'QA middle input'));
  const top = await store.publish(gateParent('QA top input', middle, 2));
  const trials = [];
  for (const delay of [undefined, 0, 2, 5, 10, 20, 40, 80]) {
    if (!store.server || store.server.exitInfo) await store.start();
    const root = await store.startRun(top);
    const landing = [];
    let killed = false;
    // Answer every visit's leaf; the first answer races a hard kill.
    for (;;) {
      const topRun = await store.run(root.id);
      if (TERMINAL.includes(topRun.status)) break;
      const leafRun = await eventually(async () => {
        const mids = await store.children(root.id);
        for (const m of mids) {
          for (const l of await store.children(m.id)) if (l.status === 'waiting' && l.waiting?.kind === 'input') return l;
        }
        const now = await store.run(root.id);
        return TERMINAL.includes(now.status) ? { done: true } : false;
      }, 60_000, `${where} leaf waiting`);
      if (leafRun.done) break;
      const answer = store.call('POST', `/runs/${leafRun.id}/input`, { waitId: leafRun.waiting.waitId, input: `ans-${String(delay)}` }, { allowError: true });
      if (!killed) {
        if (delay === undefined) void answer.catch(() => undefined);
        else {
          landing.push(`answer ${(await answer.catch((e) => ({ status: String(e) }))).status}`);
          await sleep(delay);
        }
        await store.kill();
        killed = true;
        const atKill = await durableSnapshot(store.dataDir);
        landing.push(atKill);
        await store.start();
        const after = await store.run(leafRun.id);
        landing.push(`leaf after restart: ${after.status}`);
        if (after.status === 'waiting')
          await store.call('POST', `/runs/${leafRun.id}/input`, { waitId: after.waiting.waitId, input: `ans-${String(delay)}` });
      } else await answer;
    }
    await eventually(async () => TERMINAL.includes((await store.run(root.id)).status), 60_000, 'top terminal');
    const tree = await verifyTree(store, root.id, `${where} d=${String(delay)}`, { visits: 2, depth: 2 });
    const final = await store.run(root.id);
    if (final.status !== 'succeeded') violate(where, `top ended ${final.status}`);
    const trial = { delayMs: delay ?? 'no-await', landing, status: final.status, result: final.result, perVisit: tree.perVisit };
    trials.push(trial);
    log(where, JSON.stringify(trial));
  }
  results.phases.inputCompletion = { trials, global: await globalOrphanCheck(store, where) };
}

// ---------------------------------------------------------------------------------------------
// A leaf whose script appends one attempt line, then fails with exit 3 while a flag file exists.
function failingLeaf(name, attempts, flag) {
  const code = `const fs=require('node:fs');fs.appendFileSync(process.argv[1],'attempt\\n');process.exit(fs.existsSync(process.argv[2])?3:0)`;
  return chain(name, [scriptNode('work', ['-e', code, attempts, flag], { stdin: 'none', stdout: 'ignore' }), exitNode('"leaf ok"')]);
}
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);

async function phaseExplicitParentResume(store) {
  const where = '1C explicit parent resume after child failure';
  const attempts = join(store.dataDir, 'attempts-1c.txt');
  const flag = join(store.dataDir, 'flag-1c');
  writeFileSync(flag, 'fail');
  if (!store.server || store.server.exitInfo) await store.start();
  const leaf = await store.publish(failingLeaf('QA failing leaf 1C', attempts, flag));
  const middle = await store.publish(middleOf(leaf, 'QA middle 1C'));
  const top = await store.publish(chain('QA top 1C', [subNode(middle), exitNode('outputs.sub.value.result')]));
  if (!store.server || store.server.exitInfo) await store.start();
  const root = await store.startRun(top);
  await eventually(async () => (await store.run(root.id)).status === 'failed', 60_000, 'top failed');
  const [mid] = await store.children(root.id);
  const [lf] = await store.children(mid.id);
  const failed = { top: await store.run(root.id), middle: await store.run(mid.id), leaf: await store.run(lf.id) };
  const failures = Object.fromEntries(Object.entries(failed).map(([k, r]) => [k, r.failure]));
  log(where, 'failures', failures);
  if (failed.leaf.failure?.code !== 'SCRIPT_EXIT_CODE' || failed.leaf.failure?.resumable !== true) violate(where, 'leaf failure not resumable SCRIPT_EXIT_CODE');
  if (failed.middle.failure?.code !== 'SCRIPT_EXIT_CODE' || failed.middle.failure?.details?.childRunId !== lf.id) violate(where, 'middle failure does not carry child failure');
  if (failed.top.failure?.code !== 'SCRIPT_EXIT_CODE' || failed.top.failure?.details?.childRunId !== mid.id) violate(where, 'top failure does not carry child failure');
  // Restart: the failure stays, nothing is retried automatically.
  await store.kill();
  await store.start();
  await sleep(1500);
  if (lines(attempts) !== 1) violate(where, `attempts after restart ${lines(attempts)}, expected 1`);
  if ((await store.run(root.id)).status !== 'failed') violate(where, 'top no longer failed after restart');
  rmSync(flag);
  await store.call('POST', `/runs/${root.id}/resume`);
  await eventually(async () => TERMINAL.includes((await store.run(root.id)).status), 60_000, 'top terminal after resume');
  const final = await store.run(root.id);
  if (final.status !== 'succeeded') violate(where, `top after resume ${final.status}`);
  const topTree = await verifyTree(store, root.id, where, { visits: 1, depth: 2, finishesPerVisit: 2, gate: false });
  const midEvents = await store.events(mid.id);
  const leafEvents = await store.events(lf.id);
  const resumedBy = (events) => events.filter((e) => e.type === 'run.resumed').map((e) => e.actor);
  const out = {
    failures,
    attempts: lines(attempts),
    finalStatus: final.status,
    topPerVisit: topTree.perVisit,
    middlePerVisit: topTree.kids[0]?.perVisit,
    middleResumedBy: resumedBy(midEvents),
    leafResumedBy: resumedBy(leafEvents),
    leafDispatches: countType(leafEvents, 'script.dispatched'),
  };
  if (out.attempts !== 2) violate(where, `script attempts ${out.attempts}, expected 2`);
  if (!out.leafResumedBy.some((a) => a?.kind === 'run' && a.id === mid.id)) violate(where, 'leaf not resumed in place by its parent');
  if (!out.middleResumedBy.some((a) => a?.kind === 'run' && a.id === root.id)) violate(where, 'middle not resumed in place by top');
  results.phases.explicitParentResume = out;
  log(where, JSON.stringify(out));
}

async function phaseIndependentChildRetry(store) {
  const where = '1D child retried independently while parent failed';
  const attempts = join(store.dataDir, 'attempts-1d.txt');
  const flag = join(store.dataDir, 'flag-1d');
  writeFileSync(flag, 'fail');
  if (!store.server || store.server.exitInfo) await store.start();
  const leaf = await store.publish(failingLeaf('QA failing leaf 1D', attempts, flag));
  const middle = await store.publish(middleOf(leaf, 'QA middle 1D'));
  const top = await store.publish(chain('QA top 1D', [subNode(middle), exitNode('outputs.sub.value.result')]));
  if (!store.server || store.server.exitInfo) await store.start();
  const root = await store.startRun(top);
  await eventually(async () => (await store.run(root.id)).status === 'failed', 60_000, 'top failed');
  const [mid] = await store.children(root.id);
  const [lf] = await store.children(mid.id);
  const seqBefore = { top: (await store.run(root.id)).lastEventSeq, middle: (await store.run(mid.id)).lastEventSeq };
  rmSync(flag);
  await store.call('POST', `/runs/${lf.id}/resume`);
  await eventually(async () => (await store.run(lf.id)).status === 'succeeded', 60_000, 'leaf succeeded');
  await sleep(1500);
  const parentsWhileDown = { top: await store.run(root.id), middle: await store.run(mid.id) };
  if (parentsWhileDown.top.status !== 'failed' || parentsWhileDown.middle.status !== 'failed') violate(where, 'parent woke after independent child retry');
  if (parentsWhileDown.top.lastEventSeq !== seqBefore.top || parentsWhileDown.middle.lastEventSeq !== seqBefore.middle)
    violate(where, 'parent log changed after independent child retry', { seqBefore, after: { top: parentsWhileDown.top.lastEventSeq, middle: parentsWhileDown.middle.lastEventSeq } });
  // Process death and restart while the parents stay failed.
  await store.kill();
  await store.start();
  await sleep(1500);
  const afterRestart = { top: await store.run(root.id), middle: await store.run(mid.id), leaf: await store.run(lf.id) };
  if (afterRestart.top.status !== 'failed' || afterRestart.middle.status !== 'failed' || afterRestart.leaf.status !== 'succeeded')
    violate(where, 'statuses changed across restart', Object.fromEntries(Object.entries(afterRestart).map(([k, r]) => [k, r.status])));
  await store.call('POST', `/runs/${root.id}/resume`);
  await eventually(async () => TERMINAL.includes((await store.run(root.id)).status), 60_000, 'top terminal');
  const final = await store.run(root.id);
  if (final.status !== 'succeeded') violate(where, `top after resume ${final.status}`, final.failure);
  const topTree = await verifyTree(store, root.id, where, { visits: 1, depth: 2, finishesPerVisit: 2, gate: false });
  const leafEvents = await store.events(lf.id);
  const out = {
    attempts: lines(attempts),
    finalStatus: final.status,
    result: final.result,
    seqBefore,
    seqWhileParentFailed: { top: parentsWhileDown.top.lastEventSeq, middle: parentsWhileDown.middle.lastEventSeq },
    topPerVisit: topTree.perVisit,
    middlePerVisit: topTree.kids[0]?.perVisit,
    leafResumes: leafEvents.filter((e) => e.type === 'run.resumed').map((e) => e.actor),
    leafRunFinished: countType(leafEvents, 'run.finished'),
  };
  if (out.attempts !== 2) violate(where, `script attempts ${out.attempts}, expected 2 (leaf must not rerun)`);
  if (out.leafResumes.length !== 1) violate(where, `leaf resumed ${out.leafResumes.length} times, expected 1 (operator)`);
  results.phases.independentChildRetry = out;
  log(where, JSON.stringify(out));
}

// ---------------------------------------------------------------------------------------------
const dirs = [];
try {
  const a = await makeDataDir('c1a');
  dirs.push(a);
  const storeA = apiStore({ dataDir: a, port: PORT, log });
  try {
    await phaseCreation(storeA);
    await storeA.kill();
    await phaseTimerCompletion(storeA);
    await storeA.kill();
    await phaseInputCompletion(storeA);
  } finally {
    await storeA.kill();
  }
  const c = await makeDataDir('c1c');
  dirs.push(c);
  const storeC = apiStore({ dataDir: c, port: PORT, log });
  try {
    await phaseExplicitParentResume(storeC);
    await phaseIndependentChildRetry(storeC);
    results.phases.globalC = await globalOrphanCheck(storeC, '1C/1D');
  } finally {
    await storeC.kill();
  }
} catch (error) {
  violate('harness', error instanceof Error ? error.stack : String(error));
} finally {
  results.violations = violations;
  results.verdict = violations.length ? 'FAIL' : 'PASS';
  writeJson('check1-child-admission.json', results);
  log('verdict', results.verdict, `${violations.length} violations`);
  for (const d of dirs) await removeDir(d);
  log('removed', dirs.map((d) => existsSync(d) ? `${d} STILL PRESENT` : `${d} removed`));
}
