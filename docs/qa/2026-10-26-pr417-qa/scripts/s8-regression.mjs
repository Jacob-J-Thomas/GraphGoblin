// Check 5: no regression in the rest of acceptance group C's matrix that the change touches.
//  R1: API drain with a running Codex turn and a held script: both keep running; after the (short)
//      grace, Keep waiting in Edge; five more graces pass with no second expiry and no kill; one
//      browser POST; releasing both lets the drain exit 0; after restart both runs succeeded.
//  R2: acceptance scenario C: browser force over a script tree, a Codex turn, a parent waiting on a
//      running child, a durable wait and a queued independent run; OS process checks; restart
//      records; no blind replay; Resume refused; inspector text.
//  R3: API force over a Codex turn and a script; restart records; no automatic resume; Resume
//      refused; explicit Replay of each from the interrupted node starts a new run that succeeds,
//      and the source runs keep their interruption.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s8-regression');
const gateways = [];
const dirs = [];
let browser;
const posts = [];

try {
  // ---------------- R1 ----------------
  {
    const dir = L.makeStore('s8r1');
    dirs.push(dir);
    const GRACE = 5000;
    const codex = L.qaCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: String(GRACE) };
    const g = await L.startGateway({ dir, port: 6535, label: 'r1', env, rec });
    gateways.push(g);
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('Drain Codex turn'));
    const scriptLoopId = await L.publishLoop(g.call, L.scriptLoop('Drain script', L.heldScriptSource({ dir, name: 'held' })));
    const codexRun = await L.startRun(g.call, codexLoop);
    const scriptRun = await L.startRun(g.call, scriptLoopId);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const scriptPid = Number(await L.waitFile(path.join(dir, 'held.pid')));
    await L.sleep(1000);
    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    L.watchShutdownRequests(page, posts, 'r1');
    await page.goto(g.origin + '/app/loops');
    const drained = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    await L.sleep(1500);
    const s = await L.shutdownState(g);
    rec.check('R1-1 API drain: both runs active, the Codex CLI and the script alive', s.phase === 'draining' && [codexRun, scriptRun].every((id) => s.activeRunIds.includes(id)) && L.tasklistAlive(cliPid) && L.tasklistAlive(scriptPid), { drain: drained.status, phase: s.phase, active: s.activeRunIds });
    rec.check('R1-1 no Codex turn failure during the API drain', !/turn failed/i.test(g.readLog()) && (await g.call(`/runs/${codexRun}`)).json.status === 'running', null);
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    await page.getByText(/The gateway grace period elapsed/).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Keep waiting' }).click();
    const keptAt = Date.now();
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'draining', { timeoutMs: 10_000, intervalMs: 200 });
    const samples = [];
    while (Date.now() - keptAt < GRACE * 5) {
      await L.sleep(2500);
      const x = await L.shutdownState(g);
      samples.push({ ms: Date.now() - keptAt, phase: x.phase, cli: L.tasklistAlive(cliPid), script: L.tasklistAlive(scriptPid) });
    }
    rec.log('R1 samples after Keep waiting (5 graces)', samples);
    rec.check('R1-2 after Keep waiting no second expiry and nothing is killed for 5 graces', samples.every((x) => x.phase === 'draining' && x.cli && x.script), samples.at(-1));
    const text = await L.noticeText(page);
    rec.log('R1 notice after Keep waiting', text);
    await L.shot(page, 's8-r1-after-keep-waiting');
    rec.check('R1-2 the browser sent exactly one POST (Keep waiting)', posts.filter((p) => p.method === 'POST').length === 1, posts.filter((p) => p.method === 'POST'));
    codex.release();
    fs.writeFileSync(path.join(dir, 'held.release'), 'go');
    const code = await g.waitExit(30_000);
    rec.check('R1-3 releasing the work completes the drain with exit 0', code === 0, code);
    await browser.close();
    browser = undefined;
    g.copyLog('s8-gateway-r1.log.txt');
    const r = await L.startGateway({ dir, port: 6535, label: 'r1r', env, rec });
    gateways.push(r);
    const cr = (await r.call(`/runs/${codexRun}`)).json;
    const sr = (await r.call(`/runs/${scriptRun}`)).json;
    rec.check('R1-4 both runs succeeded', cr.status === 'succeeded' && sr.status === 'succeeded', { codex: cr.status, script: sr.status, codexFailure: cr.failure, scriptFailure: sr.failure });
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('R1-5 restarted gateway exits 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }

  // ---------------- R2 ----------------
  {
    const dir = L.makeStore('s8r2');
    dirs.push(dir);
    const GRACE = 8000;
    const codex = L.qaCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: String(GRACE), GG_MAX_CONCURRENT_RUNS: '3' };
    const g = await L.startGateway({ dir, port: 6536, label: 'r2', env, rec });
    gateways.push(g);
    const treeLoop = await L.publishLoop(g.call, L.scriptLoop('Force tree script', L.heldScriptSource({ dir, name: 'tree', tree: true })));
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('Force Codex turn'));
    const childLoop = await L.publishLoop(g.call, L.scriptLoop('Force child', L.heldScriptSource({ dir, name: 'child' })));
    const parentLoopId = await L.publishLoop(g.call, L.parentLoop('Force parent', childLoop));
    const parkLoop = await L.publishLoop(g.call, L.waitLoop('Force parked wait', 3600));
    const quickLoop = await L.publishLoop(g.call, L.scriptLoop('Force queued independent', `process.stdout.write(JSON.stringify({ran:true}))`));
    const parkRun = await L.startRun(g.call, parkLoop);
    await L.waitFor(async () => (await g.call(`/runs/${parkRun}`)).json.status === 'waiting');
    const treeRun = await L.startRun(g.call, treeLoop);
    const codexRun = await L.startRun(g.call, codexLoop);
    const parentRun = await L.startRun(g.call, parentLoopId);
    const treePid = Number(await L.waitFile(path.join(dir, 'tree.pid')));
    const grandPid = Number(await L.waitFile(path.join(dir, 'tree.grandchild')));
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const childPid = Number(await L.waitFile(path.join(dir, 'child.pid')));
    const childRun = (await g.call(`/runs?parent=${parentRun}`)).json.items[0]?.id;
    const queuedRun = await L.startRun(g.call, quickLoop);
    await L.sleep(500);
    const queuedBefore = (await g.call(`/runs/${queuedRun}`)).json.status;
    const tree = L.descendants(g.pid).map((p) => p.pid);
    rec.log('R2 work started', { treeRun, codexRun, parentRun, childRun, parkRun, queuedRun, queuedBefore, pids: { treePid, grandPid, cliPid, childPid } });
    rec.check('R2-0 OS tree shows the script root, its grandchild, the Codex CLI and the child script under the gateway', [treePid, grandPid, cliPid, childPid].every((p) => tree.includes(p)), null);
    rec.check('R2-0 the independent run beyond capacity is queued', queuedBefore === 'queued', queuedBefore);

    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ctx.newPage();
    L.watchShutdownRequests(a, posts, 'r2');
    await a.goto(g.origin + `/app/runs/${codexRun}`);
    const drained = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    const active = drained.json.activeRunIds;
    rec.check('R2-1 active work lists the script, Codex and child runs; not the wait or the queued run', [treeRun, codexRun, childRun].every((id) => active.includes(id)) && !active.includes(parkRun) && !active.includes(queuedRun), active);
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    await a.getByText(/The gateway grace period elapsed/).waitFor({ timeout: 15_000 });
    for (const id of [treeRun, codexRun, childRun]) await a.getByRole('link', { name: new RegExp(id) }).first().waitFor({ timeout: 15_000 });
    const text = await L.noticeText(a);
    await L.shot(a, 's8-r2-expiry-notice');
    rec.check('R2-2 the notice names each active run with its loop name', text.includes(`Force tree script — ${treeRun}`) && text.includes(`Force Codex turn — ${codexRun}`) && text.includes(`Force child — ${childRun}`), null);
    await a.getByRole('button', { name: 'Force stop', exact: true }).click();
    const dialog = a.getByRole('dialog');
    await dialog.waitFor({ timeout: 5000 });
    const dialogText = await dialog.innerText();
    rec.log('R2 force confirmation', dialogText);
    await L.shot(a, 's8-r2-force-confirmation');
    await dialog.getByRole('button', { name: 'Go back' }).click();
    await L.sleep(800);
    rec.check('R2-3 Go back sends nothing', posts.filter((p) => p.method === 'POST' && p.tab === 'r2').length === 0 && (await L.shutdownState(g)).phase === 'awaiting-choice', null);
    await a.getByRole('button', { name: 'Force stop', exact: true }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Confirm force stop' }).click();
    const forcedAt = Date.now();
    const code = await g.waitExit(60_000);
    rec.log('R2 gateway exit after the browser force', { code, ms: Date.now() - forcedAt });
    rec.check('R2-4 force completes and the gateway exits 0', code === 0, code);
    const liveAfter = Object.fromEntries([['treeRoot', treePid], ['grandchild', grandPid], ['codexCli', cliPid], ['childScript', childPid], ['gateway', g.pid]].map(([k, p]) => [k, L.tasklistAlive(p)]));
    rec.check('R2-4 tasklist: script root, grandchild, Codex CLI, child script and gateway are gone; lock released', Object.values(liveAfter).every((v) => v === false) && !fs.existsSync(path.join(dir, 'graphgoblin.lock')), liveAfter);
    rec.check('R2-4 CIM: no process names the store', L.storeProcesses(dir).length === 0, L.storeProcesses(dir));
    await a.getByText('Gateway stopped or disconnected', { exact: true }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await browser.close();
    browser = undefined;
    g.copyLog('s8-gateway-r2.log.txt');
    const argvBefore = fs.readFileSync(codex.pidFile + '.argv', 'utf8');

    const r = await L.startGateway({ dir, port: 6536, label: 'r2r', env, rec });
    gateways.push(r);
    const get = async (id) => (await r.call(`/runs/${id}`)).json;
    const [tr, hr, cr, kr] = await Promise.all([treeRun, codexRun, childRun, parkRun].map(get));
    const interrupted = (x, node) => x.status === 'failed' && x.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && x.failure?.nodeId === node && x.failure?.resumable === false && x.failure?.details?.effectMayHaveHappened === true && x.failure?.details?.attempt === 1;
    rec.check('R2-5 script, Codex and child runs record RUN_INTERRUPTED_BY_STOP at their nodes (attempt 1, non-resumable, effects may have happened)', interrupted(tr, 'hold') && interrupted(hr, 'infer') && interrupted(cr, 'hold'), { tree: tr.failure, codex: hr.failure, child: cr.failure });
    rec.check('R2-5 the durable wait is unchanged (waiting)', kr.status === 'waiting', kr.status);
    await L.waitFor(async () => ['succeeded', 'failed'].includes((await get(queuedRun)).status), { timeoutMs: 30_000 });
    rec.check('R2-6 the queued independent run was not interrupted and ran after restart', (await get(queuedRun)).status === 'succeeded', (await get(queuedRun)).status);
    await L.waitFor(async () => ['succeeded', 'failed', 'cancelled'].includes((await get(parentRun)).status), { timeoutMs: 20_000 });
    rec.check('R2-6 the parent did not succeed with fabricated child output', (await get(parentRun)).status !== 'succeeded', (await get(parentRun)).status);
    await L.sleep(2000);
    rec.check('R2-7 no blind replay: the Codex CLI did not run again and no script re-ran', fs.readFileSync(codex.pidFile + '.argv', 'utf8') === argvBefore && !L.storeProcesses(dir).some((p) => p.pid !== r.pid), L.storeProcesses(dir));
    const resume = await r.call(`/runs/${codexRun}/resume`, { method: 'POST', body: {} });
    rec.check('R2-7 Resume of the interrupted Codex run is refused', resume.status >= 400, { status: resume.status, code: resume.json?.code });
    browser = await L.launchEdge();
    const ins = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    await ins.goto(r.origin + `/app/runs/${codexRun}`);
    await ins.getByText(/force-stop interrupted/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const insText = await ins.locator('body').innerText();
    await L.shot(ins, 's8-r2-inspector-codex-after-restart');
    rec.check('R2-8 the inspector shows the interruption and possible external effects for the Codex run', /force-stop interrupted this run/i.test(insText) && /external effects may have happened/i.test(insText), null);
    await browser.close();
    browser = undefined;
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('R2-9 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }

  // ---------------- R3 ----------------
  {
    const dir = L.makeStore('s8r3');
    dirs.push(dir);
    const codex = L.qaCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: '300000' };
    const g = await L.startGateway({ dir, port: 6537, label: 'r3', env, rec });
    gateways.push(g);
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('Replay Codex after force'));
    const scriptLoopId = await L.publishLoop(g.call, L.scriptLoop('Replay script after force', L.heldScriptSource({ dir, name: 'held', maxMs: 120_000 })));
    const codexRun = await L.startRun(g.call, codexLoop);
    const scriptRun = await L.startRun(g.call, scriptLoopId);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const scriptPid = Number(await L.waitFile(path.join(dir, 'held.pid')));
    await L.sleep(1000);
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    const forced = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } });
    const code = await g.waitExit(30_000);
    rec.check('R3-1 API force exits 0; the Codex CLI and the script are gone', forced.status === 202 && code === 0 && !L.tasklistAlive(cliPid) && !L.tasklistAlive(scriptPid), { forced: forced.status, code });
    g.copyLog('s8-gateway-r3.log.txt');
    fs.rmSync(path.join(dir, 'held.pid'));
    fs.rmSync(codex.pidFile);
    const r = await L.startGateway({ dir, port: 6537, label: 'r3r', env, rec });
    gateways.push(r);
    await L.sleep(3000);
    const cr = (await r.call(`/runs/${codexRun}`)).json;
    const sr = (await r.call(`/runs/${scriptRun}`)).json;
    rec.check('R3-2 after restart both stay failed RUN_INTERRUPTED_BY_STOP and nothing re-ran', cr.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && sr.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && !fs.existsSync(codex.pidFile) && !fs.existsSync(path.join(dir, 'held.pid')), { codex: cr.failure?.code, script: sr.failure?.code });
    const resumes = await Promise.all([codexRun, scriptRun].map(async (id) => (await r.call(`/runs/${id}/resume`, { method: 'POST', body: {} })).status));
    rec.check('R3-3 Resume is refused for both', resumes.every((s) => s >= 400), resumes);
    const rc = await r.call(`/runs/${codexRun}/replay`, { method: 'POST', body: { nodeId: 'infer' } });
    const rs = await r.call(`/runs/${scriptRun}/replay`, { method: 'POST', body: { nodeId: 'hold' } });
    rec.log('R3 explicit replays', { codex: { status: rc.status, run: rc.json?.run?.id }, script: { status: rs.status, run: rs.json?.run?.id } });
    rec.check('R3-4 explicit Replay from the interrupted node is accepted for both (202, new runs)', rc.status === 202 && rs.status === 202 && rc.json.run.id !== codexRun && rs.json.run.id !== scriptRun, { codex: rc.status, script: rs.status });
    await L.waitFile(codex.pidFile);
    await L.waitFile(path.join(dir, 'held.pid'));
    codex.release();
    fs.writeFileSync(path.join(dir, 'held.release'), 'go');
    const nc = await L.waitRun(r.call, rc.json.run.id, ['succeeded', 'failed'], 30_000);
    const ns = await L.waitRun(r.call, rs.json.run.id, ['succeeded', 'failed'], 30_000);
    rec.check('R3-5 both replayed runs succeed', nc.status === 'succeeded' && ns.status === 'succeeded', { codex: nc.status, script: ns.status, codexFailure: nc.failure, scriptFailure: ns.failure });
    rec.check('R3-5 the source runs keep their interruption record', (await r.call(`/runs/${codexRun}`)).json.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && (await r.call(`/runs/${scriptRun}`)).json.failure?.code === 'RUN_INTERRUPTED_BY_STOP', null);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('R3-6 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }
} catch (error) {
  rec.check('S8 completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) {
    if (x.exitCode() === null) {
      await x.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
      await x.waitExit(20_000);
    }
  }
  rec.finish({ shutdownRequestsFromBrowser: posts });
  for (const d of dirs) L.cleanupStore(d, rec);
}
