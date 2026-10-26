// Check 2 (#321): uncertain script outcomes across real kills, Resume, Cancel, Replay, forced
// shutdown, nested provenance and the MCP summary. Run: node --expose-gc check2-uncertain-scripts.mjs
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiStore, chain, countType, eventually, exitNode, logger, makeDataDir, markerScript, removeDir,
  scriptNode, sleep, subNode, TERMINAL, writeJson,
} from './lib.mjs';
import { mcpSession } from './mcp-client.mjs';

const log = logger('check2-uncertain-scripts');
const PORT = Number(process.env.QA_PORT ?? 6390);
const violations = [];
const results = { phases: {} };
const violate = (where, what, extra) => {
  violations.push({ where, what, ...(extra ? { extra } : {}) });
  log('VIOLATION', where, what, extra ?? '');
};
const expectEq = (where, label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) violate(where, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const effects = (marker) => (existsSync(marker) ? (readFileSync(marker, 'utf8').match(/effect\n/g)?.length ?? 0) : 0);
function markerAlive(dir) {
  return readdirSync(dir)
    .filter((n) => n.includes('.active-'))
    .some((n) => {
      try {
        process.kill(Number(n.split('.active-')[1]), 0);
        return true;
      } catch {
        return false;
      }
    });
}
const markerLoop = (name, marker, release) =>
  chain(name, [scriptNode('script', [markerScript, marker, release, '120000'], { stdin: 'none' }), exitNode()]);

async function killDuringScript(store, runId, marker, release) {
  await eventually(() => effects(marker) === 1, 60_000, 'marker effect');
  const before = await store.run(runId);
  await store.kill();
  // Let the orphaned marker process finish; its effect already happened.
  writeFileSync(release, 'done');
  return before;
}

function checkProvenance(where, run, events, { code = 'SCRIPT_OUTCOME_UNCERTAIN', resumable = true, dispatchIndex = -1 } = {}) {
  const dispatches = events.filter((e) => e.type === 'script.dispatched');
  const d = dispatches.at(dispatchIndex);
  expectEq(where, 'status', run.status, 'failed');
  expectEq(where, 'failure.code', run.failure?.code, code);
  expectEq(where, 'failure.resumable', run.failure?.resumable, resumable);
  expectEq(where, 'failure.script.state', run.failure?.script?.state, 'outcome-uncertain');
  expectEq(where, 'failure.script.visitId', run.failure?.script?.visitId, d?.visitId);
  expectEq(where, 'failure.script.dispatchId', run.failure?.script?.dispatchId, d?.dispatchId);
  return { failure: run.failure, dispatches: dispatches.map((x) => ({ seq: x.seq, visitId: x.visitId, dispatchId: x.dispatchId })) };
}

// ---------------------------------------------------------------------------------------------
async function phaseResumeCancel(store, mcp) {
  const where = '2A kill, restart, no rerun, Cancel, MCP, explicit Resume';
  const marker = join(store.dataDir, 'marker-a');
  const release = join(store.dataDir, 'release-a');
  const loop = await store.publish(markerLoop('QA marker resume', marker, release));
  const run = await store.startRun(loop);
  const atKill = await killDuringScript(store, run.id, marker, release);
  await store.start();
  await eventually(async () => TERMINAL.includes((await store.run(run.id)).status), 60_000, 'failed after restart');
  const failed = await store.run(run.id);
  const events = await store.events(run.id);
  const provenance = checkProvenance(where, failed, events);
  if (!/may already have produced its effect/.test(failed.failure?.message ?? '')) violate(where, 'failure message does not explain the possible effect');
  if (!String(failed.failure?.script?.visitId).startsWith(`${run.id}:`)) violate(where, 'visitId does not name this run');
  // Nothing reruns: wait, restart again, wait.
  await sleep(2500);
  await store.kill();
  await store.start();
  await sleep(2500);
  const still = await store.run(run.id);
  const stillEvents = await store.events(run.id);
  expectEq(where, 'effects before explicit Resume', effects(marker), 1);
  expectEq(where, 'dispatches before explicit Resume', countType(stillEvents, 'script.dispatched'), 1);
  expectEq(where, 'lastEventSeq unchanged across idle restart', still.lastEventSeq, failed.lastEventSeq);
  // API cancel of the failed run: refused, leaves it as is.
  const cancel = await store.call('POST', `/runs/${run.id}/cancel`, {}, { allowError: true });
  const afterCancel = await store.run(run.id);
  expectEq(where, 'status after cancel attempt', afterCancel.status, 'failed');
  expectEq(where, 'lastEventSeq after cancel attempt', afterCancel.lastEventSeq, failed.lastEventSeq);
  expectEq(where, 'effects after cancel attempt', effects(marker), 1);
  // MCP: get_run and list_runs summary carry the provenance.
  const getRun = await mcp.tool('get_run', { runId: run.id });
  const listRuns = await mcp.tool('list_runs', { loopId: loop });
  const summary = listRuns.structured?.items?.find((r) => r.id === run.id);
  expectEq(where, 'MCP get_run failure.script', getRun.structured?.failure?.script, failed.failure?.script);
  expectEq(where, 'MCP list_runs summary failure.script', summary?.failure?.script, failed.failure?.script);
  expectEq(where, 'MCP list_runs summary resumable', summary?.failure?.resumable, true);
  const waitFor = await mcp.tool('wait_for_run', { runId: run.id, timeoutSeconds: 5 });
  expectEq(where, 'MCP wait_for_run failure.script', waitFor.structured?.run?.failure?.script, failed.failure?.script);
  // Explicit Resume runs it exactly once more.
  const resumed = await store.call('POST', `/runs/${run.id}/resume`);
  await eventually(async () => TERMINAL.includes((await store.run(run.id)).status), 60_000, 'terminal after resume');
  const final = await store.run(run.id);
  const finalEvents = await store.events(run.id);
  const dispatches = finalEvents.filter((e) => e.type === 'script.dispatched');
  expectEq(where, 'status after Resume', final.status, 'succeeded');
  expectEq(where, 'effects after Resume', effects(marker), 2);
  expectEq(where, 'dispatches after Resume', dispatches.length, 2);
  if (dispatches[0]?.dispatchId === dispatches[1]?.dispatchId) violate(where, 'Resume reused the dispatch id');
  expectEq(where, 'Resume keeps the visit id', dispatches[1]?.visitId, dispatches[0]?.visitId);
  results.phases.resumeCancel = {
    runId: run.id,
    statusAtKill: atKill.status,
    provenance,
    message: failed.failure?.message,
    effectsBeforeResume: 1,
    cancelResponse: cancel,
    mcp: { getRunScript: getRun.structured?.failure?.script, summary, waitForRun: { finished: waitFor.structured?.finished, script: waitFor.structured?.run?.failure?.script } },
    resumeResponseStatus: resumed.status,
    final: { status: final.status, effects: effects(marker), dispatches: dispatches.map((d) => ({ visitId: d.visitId, dispatchId: d.dispatchId })) },
  };
  log(where, JSON.stringify(results.phases.resumeCancel));
}

// ---------------------------------------------------------------------------------------------
async function phaseReplay(store) {
  const where = '2B Replay forks at the node without rerunning the old dispatch';
  const marker = join(store.dataDir, 'marker-b');
  const release = join(store.dataDir, 'release-b');
  const loop = await store.publish(markerLoop('QA marker replay', marker, release));
  const run = await store.startRun(loop);
  await killDuringScript(store, run.id, marker, release);
  await store.start();
  await eventually(async () => (await store.run(run.id)).status === 'failed', 60_000, 'failed');
  const failed = await store.run(run.id);
  const before = await store.events(run.id);
  checkProvenance(where, failed, before);
  const replay = await store.call('POST', `/runs/${run.id}/replay`, { nodeId: 'script' });
  const fork = replay.run;
  await eventually(async () => TERMINAL.includes((await store.run(fork.id)).status), 60_000, 'fork terminal');
  const forkFinal = await store.run(fork.id);
  const forkEvents = await store.events(fork.id);
  const sourceAfter = await store.run(run.id);
  const sourceEventsAfter = await store.events(run.id);
  expectEq(where, 'fork status', forkFinal.status, 'succeeded');
  expectEq(where, 'effects (source once + fork once)', effects(marker), 2);
  expectEq(where, 'source still failed', sourceAfter.status, 'failed');
  expectEq(where, 'source log unchanged', sourceEventsAfter.length, before.length);
  expectEq(where, 'source dispatches', countType(sourceEventsAfter, 'script.dispatched'), 1);
  const forkDispatch = forkEvents.find((e) => e.type === 'script.dispatched');
  if (!String(forkDispatch?.visitId).startsWith(`${fork.id}:`)) violate(where, 'fork dispatch visit does not belong to the fork');
  const replayOf = forkEvents[0]?.replayOf ?? forkFinal.invocation?.replayOf;
  results.phases.replay = {
    source: run.id,
    fork: fork.id,
    forkStatus: forkFinal.status,
    effects: effects(marker),
    sourceEvents: { before: before.length, after: sourceEventsAfter.length },
    forkDispatch: forkDispatch && { visitId: forkDispatch.visitId, dispatchId: forkDispatch.dispatchId },
    replayOf,
    forkFirstNodeStarted: forkEvents.find((e) => e.type === 'node.started')?.nodeId,
  };
  log(where, JSON.stringify(results.phases.replay));
}

// ---------------------------------------------------------------------------------------------
async function phaseForcedStop(store) {
  const where = '2C forced shutdown during a script';
  const marker = join(store.dataDir, 'marker-c');
  const release = join(store.dataDir, 'release-c');
  const loop = await store.publish(markerLoop('QA marker forced stop', marker, release));
  const run = await store.startRun(loop);
  await eventually(() => effects(marker) === 1, 60_000, 'marker effect');
  const drain = await store.call('POST', '/system/shutdown', { action: 'drain' }, { allowError: true });
  await sleep(500);
  const during = await store.call('GET', '/system/shutdown');
  const runDuring = await store.run(run.id);
  const force = await store.call('POST', '/system/shutdown', { action: 'force' }, { allowError: true });
  const exit = await store.server.exited;
  const aliveAfterForce = markerAlive(store.dataDir);
  writeFileSync(release, 'done');
  await store.start();
  await sleep(1500);
  const failed = await store.run(run.id);
  const events = await store.events(run.id);
  const provenance = checkProvenance(where, failed, events, { code: 'RUN_INTERRUPTED_BY_STOP', resumable: false });
  const resume = await store.call('POST', `/runs/${run.id}/resume`, {}, { allowError: true });
  await sleep(1500);
  expectEq(where, 'resume refused', resume.status >= 400, true);
  expectEq(where, 'effects', effects(marker), 1);
  expectEq(where, 'still failed', (await store.run(run.id)).status, 'failed');
  expectEq(where, 'marker process terminated by force', aliveAfterForce, false);
  results.phases.forcedStop = {
    runId: run.id,
    drain: { status: drain.status, phase: drain.body?.phase },
    during: { phase: during.phase, activeRunIds: during.activeRunIds, runStatus: runDuring.status },
    force: { status: force.status, phase: force.body?.phase },
    processExit: exit,
    markerAliveAfterForce: aliveAfterForce,
    provenance,
    resumeResponse: resume,
    effects: effects(marker),
  };
  log(where, JSON.stringify(results.phases.forcedStop));
}

// ---------------------------------------------------------------------------------------------
async function phaseNested(store, mcpFactory) {
  const where = '2D child script uncertainty through the parent';
  const marker = join(store.dataDir, 'marker-d');
  const release = join(store.dataDir, 'release-d');
  const leaf = await store.publish(markerLoop('QA nested marker leaf', marker, release));
  const middle = await store.publish(chain('QA nested middle', [subNode(leaf), exitNode()]));
  const top = await store.publish(chain('QA nested top', [subNode(middle), exitNode()]));
  const root = await store.startRun(top);
  await eventually(() => effects(marker) === 1, 60_000, 'marker effect');
  await store.kill();
  writeFileSync(release, 'done');
  await store.start();
  await eventually(async () => (await store.run(root.id)).status === 'failed', 60_000, 'top failed');
  const [mid] = await store.children(root.id);
  const [lf] = await store.children(mid.id);
  const leafRun = await store.run(lf.id);
  const leafEvents = await store.events(lf.id);
  const leafProv = checkProvenance(`${where} leaf`, leafRun, leafEvents);
  const middleRun = await store.run(mid.id);
  const topRun = await store.run(root.id);
  for (const [label, r, childId] of [['middle', middleRun, lf.id], ['top', topRun, mid.id]]) {
    expectEq(where, `${label} failure.code`, r.failure?.code, 'SCRIPT_OUTCOME_UNCERTAIN');
    expectEq(where, `${label} failure.resumable`, r.failure?.resumable, true);
    expectEq(where, `${label} failure.script`, r.failure?.script, leafRun.failure?.script);
    expectEq(where, `${label} failure.details.childRunId`, r.failure?.details?.childRunId, childId);
  }
  const mcp = await mcpFactory();
  let mcpSummary;
  try {
    const listed = await mcp.tool('list_runs', { loopId: top });
    mcpSummary = listed.structured?.items?.find((r) => r.id === root.id);
    expectEq(where, 'MCP parent summary failure.script', mcpSummary?.failure?.script, leafRun.failure?.script);
  } finally {
    await mcp.close();
  }
  await sleep(2000);
  expectEq(where, 'effects before Resume', effects(marker), 1);
  await store.call('POST', `/runs/${root.id}/resume`);
  await eventually(async () => TERMINAL.includes((await store.run(root.id)).status), 60_000, 'top terminal');
  const final = await store.run(root.id);
  const topEvents = await store.events(root.id);
  expectEq(where, 'top after Resume', final.status, 'succeeded');
  expectEq(where, 'effects after Resume', effects(marker), 2);
  expectEq(where, 'top child_run.started', countType(topEvents, 'child_run.started'), 1);
  expectEq(where, 'top child_run.finished', topEvents.filter((e) => e.type === 'child_run.finished').map((e) => e.status), ['failed', 'succeeded']);
  expectEq(where, 'children of top', (await store.children(root.id)).length, 1);
  expectEq(where, 'children of middle', (await store.children(mid.id)).length, 1);
  results.phases.nested = {
    top: root.id,
    middle: mid.id,
    leaf: lf.id,
    leafProvenance: leafProv,
    middleFailure: middleRun.failure,
    topFailure: topRun.failure,
    mcpSummary,
    final: final.status,
    effects: effects(marker),
    topChildFinishes: topEvents.filter((e) => e.type === 'child_run.finished').map((e) => ({ status: e.status, seq: e.seq })),
  };
  log(where, JSON.stringify(results.phases.nested));
}

// ---------------------------------------------------------------------------------------------
const dirs = [];
try {
  const dir = await makeDataDir('c2');
  dirs.push(dir);
  const store = apiStore({ dataDir: dir, port: PORT, log });
  try {
    await store.start();
    const mcp = await mcpSession(store.origin);
    results.mcpServer = mcp.serverInfo;
    try {
      await phaseResumeCancel(store, mcp);
    } finally {
      await mcp.close();
    }
    await phaseReplay(store);
    await phaseForcedStop(store);
    await phaseNested(store, () => mcpSession(store.origin));
  } finally {
    await store.kill();
    await eventually(() => !markerAlive(dir), 30_000, 'markers exit').catch(() => undefined);
  }
} catch (error) {
  violate('harness', error instanceof Error ? error.stack : String(error));
} finally {
  results.violations = violations;
  results.verdict = violations.length ? 'FAIL' : 'PASS';
  writeJson('check2-uncertain-scripts.json', results);
  log('verdict', results.verdict, `${violations.length} violations`);
  for (const d of dirs) await removeDir(d);
  log('removed', dirs.map((d) => (existsSync(d) ? `${d} STILL PRESENT` : `${d} removed`)));
}
