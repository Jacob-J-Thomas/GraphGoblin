// Check 1 (#319), acceptance scenario D repeated with a Claude fake alongside. The gateway runs in
// its own console; real console Ctrl+C events.
//  D1: script tree + held fake Codex turn + held fake Claude turn. Ctrl+C, a duplicate ~300 ms later
//      (coalesced), every process survives, the Edge expiry notice lists all three, a later Ctrl+C
//      forces, everything is gone, and after restart all three record RUN_INTERRUPTED_BY_STOP.
//  D2: Ctrl+C drain over a held script only, then normal completion (exit 0, run succeeded).
//  D3: Ctrl+C drain over a Claude turn and a Codex turn that each answer ~15 s after they start:
//      both finish, both runs succeed, the gateway exits 0.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s2-ctrlc-mixed');
const GRACE = 10_000;
const gateways = [];
const dirs = [];
let browser;
const posts = [];

try {
  // ---------------- D1 ----------------
  {
    const dir = L.makeStore('s2d1');
    dirs.push(dir);
    const codex = L.qaCodex(dir);
    const claude = L.sessionCli(dir);
    claude.control('hold.txt', 'HOLDCLAUDE');
    const env = {
      ...codex.env,
      GG_CLAUDE_BINARY: claude.env.GG_CLAUDE_BINARY,
      GG_SHUTDOWN_GRACE_MS: String(GRACE),
      GG_MAX_CONCURRENT_RUNS: '4',
    };
    const g = await L.startGateway({ dir, port: 6533, label: 'd1', env, viaConsole: true, rec });
    gateways.push(g);
    const treeLoop = await L.publishLoop(g.call, L.scriptLoop('Ctrl+C script tree', L.heldScriptSource({ dir, name: 'tree', tree: true })));
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('Ctrl+C Codex turn'));
    const claudeLoop = await L.publishLoop(
      g.call,
      L.inferenceLoop('Ctrl+C Claude turn', { harness: 'claude', model: 'claude-opus-5-5', prompt: 'HOLDCLAUDE run={{ run.id }} held turn' }),
    );
    const treeRun = await L.startRun(g.call, treeLoop);
    const codexRun = await L.startRun(g.call, codexLoop);
    const claudeRun = await L.startRun(g.call, claudeLoop);
    const treePid = Number(await L.waitFile(path.join(dir, 'tree.pid')));
    const grandPid = Number(await L.waitFile(path.join(dir, 'tree.grandchild')));
    const codexPid = Number(await L.waitFile(codex.pidFile));
    const claudeReq = await L.waitFor(() => claude.requests().find((r) => r.harness === 'claude' && r.prompt.includes(claudeRun)), { timeoutMs: 30_000 });
    const claudePid = claudeReq?.pid;
    await L.sleep(1500);
    const runsBefore = await Promise.all([treeRun, codexRun, claudeRun].map(async (id) => (await g.call(`/runs/${id}`)).json.status));
    const cons = L.consoleList(g.pid, dir);
    rec.log('D1 work started', { treeRun, codexRun, claudeRun, treePid, grandPid, codexPid, claudePid, runsBefore, gatewayConsole: cons, tree: L.descendants(g.pid) });
    rec.check('D1-0 all three runs running before the Ctrl+C', runsBefore.every((s) => s === 'running'), runsBefore);
    rec.check(
      'D1-0 none of the script, Codex CLI or Claude CLI is attached to the gateway console',
      cons.status === 0 && ![treePid, grandPid, codexPid, claudePid].some((p) => cons.entries.some((e) => e.startsWith(`${p}:`))),
      cons,
    );

    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    L.watchShutdownRequests(page, posts, 'd1');
    await page.goto(g.origin + '/app/loops');

    const c1 = L.ctrlC(g.pid);
    const firstAt = Date.now();
    rec.log('D1 Ctrl+C #1', c1);
    rec.log('D1 Ctrl+C #2 right after #1 (duplicate forwarding)', { ...L.ctrlC(g.pid), sinceFirstMs: Date.now() - firstAt });
    await L.sleep(1500);
    const s1 = await L.shutdownState(g);
    rec.log('D1 state after #1 and #2', s1);
    rec.check('D1-1 the first Ctrl+C starts a normal drain; the duplicate is coalesced (not force)', s1.phase === 'draining' && g.exitCode() === null, s1.phase);
    rec.check('D1-1 all three runs are active work', [treeRun, codexRun, claudeRun].every((id) => s1.activeRunIds?.includes(id)), s1.activeRunIds);
    const alive = { treeRoot: L.tasklistAlive(treePid), grandchild: L.tasklistAlive(grandPid), codex: L.tasklistAlive(codexPid), claude: L.tasklistAlive(claudePid) };
    rec.check('D1-1 the script tree, the Codex CLI and the Claude CLI all survive', Object.values(alive).every(Boolean), alive);
    const statuses = await Promise.all([treeRun, codexRun, claudeRun].map(async (id) => (await g.call(`/runs/${id}`)).json));
    rec.check('D1-1 all three runs still running', statuses.every((r) => r.status === 'running'), statuses.map((r) => ({ status: r.status, failure: r.failure })));
    rec.check('D1-1 no turn failure in the gateway log', !/turn failed|3221225786/i.test(g.readLog()), null);

    await page.getByRole('heading', { name: 'Gateway is draining' }).waitFor({ timeout: 15_000 });
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    await page.getByText(/The gateway grace period elapsed/).waitFor({ timeout: 15_000 });
    for (const id of [treeRun, codexRun, claudeRun]) await page.getByRole('link', { name: new RegExp(id) }).first().waitFor({ timeout: 15_000 });
    const text = await L.noticeText(page);
    const buttons = await L.noticeButtons(page);
    rec.log('D1 notice at expiry', { text, buttons });
    await L.shot(page, 's2-d1-expiry-notice');
    rec.check(
      'D1-2 the expiry notice lists the script, Codex and Claude runs with their loop names',
      text.includes(`Ctrl+C script tree — ${treeRun}`) && text.includes(`Ctrl+C Codex turn — ${codexRun}`) && text.includes(`Ctrl+C Claude turn — ${claudeRun}`),
      null,
    );
    rec.check('D1-2 Keep waiting and Force stop are offered', buttons.includes('Keep waiting') && buttons.includes('Force stop'), buttons);
    const alive2 = { treeRoot: L.tasklistAlive(treePid), grandchild: L.tasklistAlive(grandPid), codex: L.tasklistAlive(codexPid), claude: L.tasklistAlive(claudePid) };
    rec.check('D1-2 everything still alive at expiry', Object.values(alive2).every(Boolean), alive2);

    const c3 = L.ctrlC(g.pid);
    const forcedAt = Date.now();
    rec.log('D1 Ctrl+C #3 (later)', { ...c3, sinceFirstMs: forcedAt - firstAt });
    const code = await g.waitExit(60_000);
    rec.log('D1 gateway exit after Ctrl+C #3', { code, ms: Date.now() - forcedAt });
    rec.check('D1-3 a later Ctrl+C forces and the gateway exits 0', code === 0, code);
    rec.check('D1-3 lock released', !fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    const gone = { treeRoot: L.tasklistAlive(treePid), grandchild: L.tasklistAlive(grandPid), codex: L.tasklistAlive(codexPid), claude: L.tasklistAlive(claudePid), gateway: L.tasklistAlive(g.pid) };
    rec.check('D1-3 no script, grandchild, Codex CLI, Claude CLI or gateway process remains (tasklist)', Object.values(gone).every((v) => !v), gone);
    rec.check('D1-3 the browser sent no shutdown POST', posts.filter((p) => p.method === 'POST').length === 0, posts.filter((p) => p.method === 'POST'));
    await page.getByText('Gateway stopped or disconnected', { exact: true }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await L.shot(page, 's2-d1-after-force');
    await browser.close();
    browser = undefined;
    g.copyLog('s2-gateway-d1.log.txt');

    const r = await L.startGateway({ dir, port: 6533, label: 'd1r', env, rec });
    gateways.push(r);
    const after = {};
    for (const [k, id, node] of [['script', treeRun, 'hold'], ['codex', codexRun, 'infer'], ['claude', claudeRun, 'infer']]) {
      const x = (await r.call(`/runs/${id}`)).json;
      after[k] = { status: x.status, failure: x.failure };
      rec.check(
        `D1-4 ${k} run records RUN_INTERRUPTED_BY_STOP at node ${node}, non-resumable, effects may have happened`,
        x.status === 'failed' && x.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && x.failure?.nodeId === node && x.failure?.resumable === false && x.failure?.details?.effectMayHaveHappened === true,
        x.failure,
      );
    }
    rec.log('D1 runs after restart', after);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('D1-5 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
    r.copyLog('s2-gateway-d1r.log.txt');
  }

  // ---------------- D2 ----------------
  {
    const dir = L.makeStore('s2d2');
    dirs.push(dir);
    const env = { GG_SHUTDOWN_GRACE_MS: String(GRACE) };
    const g = await L.startGateway({ dir, port: 6534, label: 'd2', env, viaConsole: true, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.scriptLoop('Ctrl+C drain completes', L.heldScriptSource({ dir, name: 'held' })));
    const run = await L.startRun(g.call, loop);
    const pid = Number(await L.waitFile(path.join(dir, 'held.pid')));
    rec.log('D2 Ctrl+C', L.ctrlC(g.pid));
    await L.sleep(1500);
    const s = await L.shutdownState(g);
    rec.check('D2-1 Ctrl+C drain keeps the script running', s.phase === 'draining' && L.tasklistAlive(pid), s.phase);
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    await L.sleep(3000);
    rec.check('D2-2 after expiry with no choice the script still runs', L.tasklistAlive(pid) && (await L.shutdownState(g)).phase === 'awaiting-choice', null);
    fs.writeFileSync(path.join(dir, 'held.release'), 'go');
    const code = await g.waitExit(60_000);
    rec.check('D2-3 the Ctrl+C drain completes normally with exit 0', code === 0, code);
    g.copyLog('s2-gateway-d2.log.txt');
    const r = await L.startGateway({ dir, port: 6534, label: 'd2r', rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    rec.check('D2-4 the run succeeded', after.status === 'succeeded', { status: after.status, failure: after.failure });
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('D2-5 restarted gateway exits 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }

  // ---------------- D3 ----------------
  {
    const dir = L.makeStore('s2d3');
    dirs.push(dir);
    const cli = L.sessionCli(dir);
    cli.control('delay-ms.txt', 15000);
    const env = { ...cli.env, GG_SHUTDOWN_GRACE_MS: '300000' };
    const g = await L.startGateway({ dir, port: 6535, label: 'd3', env, viaConsole: true, rec });
    gateways.push(g);
    const claudeLoop = await L.publishLoop(g.call, L.inferenceLoop('Ctrl+C Claude finishes', { harness: 'claude', model: 'claude-opus-5-5', prompt: 'D3CLAUDE run={{ run.id }} slow turn' }));
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('Ctrl+C Codex finishes', { harness: 'codex', model: 'gpt-6-luna', prompt: 'D3CODEX run={{ run.id }} slow turn' }));
    const claudeRun = await L.startRun(g.call, claudeLoop);
    const codexRun = await L.startRun(g.call, codexLoop);
    const procs = await L.waitFor(
      () => {
        const list = L.storeProcesses(dir).filter((p) => /claude\.exe|codex\.exe/i.test(p.name));
        return list.length >= 2 ? list : null;
      },
      { timeoutMs: 30_000, intervalMs: 500 },
    );
    const startedAt = Date.now();
    rec.log('D3 both turns started', { claudeRun, codexRun, procs });
    rec.log('D3 Ctrl+C', L.ctrlC(g.pid));
    await L.sleep(1500);
    const s = await L.shutdownState(g);
    const alive = (procs ?? []).map((p) => ({ ...p, alive: L.tasklistAlive(p.pid) }));
    rec.check('D3-1 Ctrl+C drains with both CLI turns alive', s.phase === 'draining' && alive.length === 2 && alive.every((p) => p.alive), { phase: s.phase, alive });
    const code = await g.waitExit(60_000);
    rec.log('D3 gateway exit', { code, msSinceTurnsStarted: Date.now() - startedAt });
    rec.check('D3-2 both turns finish and the drain exits 0', code === 0, code);
    g.copyLog('s2-gateway-d3.log.txt');
    const r = await L.startGateway({ dir, port: 6535, label: 'd3r', env, rec });
    gateways.push(r);
    const cr = (await r.call(`/runs/${claudeRun}`)).json;
    const xr = (await r.call(`/runs/${codexRun}`)).json;
    rec.check('D3-3 the Claude and Codex runs both succeeded', cr.status === 'succeeded' && xr.status === 'succeeded', { claude: { status: cr.status, failure: cr.failure }, codex: { status: xr.status, failure: xr.failure } });
    const reqs = cli.requests();
    rec.check('D3-3 each CLI ran exactly one turn', reqs.filter((q) => q.prompt.includes(claudeRun)).length === 1 && reqs.filter((q) => q.prompt.includes(codexRun)).length === 1, reqs.map((q) => ({ harness: q.harness, outcome: q.outcome })));
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('D3-4 restarted gateway exits 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }
} catch (error) {
  rec.check('S2 completed without exception', false, String(error?.stack ?? error));
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
