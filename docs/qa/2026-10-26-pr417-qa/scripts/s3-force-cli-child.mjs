// Check 2 (#319 D-2), acceptance scenario H re-run, plus the no-child control and an API variant.
//  A: fake Codex CLI that starts a "tool" child holding its stdout (QA_CODEX_TOOL_CHILD=1, the
//     shape of acceptance tree-codex.cs). API drain, Force stop + Confirm in Edge. Expect forcing to
//     end within the documented five-second acknowledgement as force-failed with the run listed,
//     Force exit offered behind its own confirmation, exit code 1, lock kept, and the failure
//     recorded truthfully after restart.
//  B: the repository's ordinary fake Codex (no child). Browser force concludes as a normal force:
//     exit 0, CLI gone, RUN_INTERRUPTED_BY_STOP, no false termination failure.
//  C: API-only: the child-holding Codex turn plus a held script. API drain, API force: force-failed
//     lists only the Codex run; a further API force exits 1 with the lock kept; restart records each.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s3-force-cli-child');
const gateways = [];
const dirs = [];
const strays = [];
let browser;
const posts = [];

async function phaseTimeline(g, fromMs, limitMs) {
  const timeline = [];
  for (;;) {
    const s = await L.shutdownState(g);
    timeline.push({ ms: Date.now() - fromMs, phase: s.phase, choices: s.choices, unconfirmed: s.unconfirmedRunIds, active: s.activeRunIds });
    if (!['forcing', 'awaiting-choice', 'draining'].includes(s.phase) || g.exitCode() !== null) break;
    if (Date.now() - fromMs > limitMs) break;
    await L.sleep(250);
  }
  return timeline;
}
const compact = (timeline) =>
  timeline.filter((x, i) => i === 0 || i === timeline.length - 1 || x.phase !== timeline[i - 1].phase);

try {
  // ---------------- A ----------------
  {
    const dir = L.makeStore('s3a');
    dirs.push(dir);
    const codex = L.qaCodex(dir, { tool: true });
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: '600000' };
    const g = await L.startGateway({ dir, port: 6536, label: 'a1', env, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Codex CLI with tool child'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const toolPid = Number(await L.waitFile(codex.pidFile + '.tool'));
    strays.push(toolPid);
    await L.sleep(1000);
    rec.log('A work started', { run, cliPid, toolPid, gatewayPid: g.pid, tree: L.descendants(g.pid) });
    rec.check('A0 the CLI and its tool child are running; the run is running', L.tasklistAlive(cliPid) && L.tasklistAlive(toolPid) && (await g.call(`/runs/${run}`)).json.status === 'running', null);

    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    L.watchShutdownRequests(page, posts, 'a');
    await page.goto(g.origin + `/app/runs/${run}`);
    const drained = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.log('A API drain', drained);
    await page.getByRole('heading', { name: 'Gateway is draining' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Force stop', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm force stop' }).click();
    const forcedAt = Date.now();
    const timeline = await phaseTimeline(g, forcedAt, 30_000);
    const last = timeline.at(-1);
    const forcingEndedMs = timeline.find((x) => x.phase !== 'forcing' && x.phase !== 'draining' && x.phase !== 'awaiting-choice')?.ms;
    rec.log('A phase timeline after the confirmed force (phase changes)', compact(timeline));
    rec.check('A1 forcing ends within the documented bound (5 s acknowledgement; measured from the confirm click)', forcingEndedMs !== undefined && forcingEndedMs <= 7_000, { forcingEndedMs });
    rec.check('A1 force concludes as force-failed', last.phase === 'force-failed', last.phase);
    rec.check('A1 the run is listed in unconfirmedRunIds', Array.isArray(last.unconfirmed) && last.unconfirmed.includes(run), last.unconfirmed);
    rec.check('A1 only a further explicit force (Force exit) is offered', JSON.stringify(last.choices) === '["force"]', last.choices);
    const procs = { cli: L.tasklistAlive(cliPid), tool: L.tasklistAlive(toolPid) };
    rec.log('A processes in force-failed', procs);
    rec.check('A1 the Codex CLI itself is gone', procs.cli === false, procs);
    rec.log('A the tool child is still running (ADR-0049 N10: GraphGoblin cannot reach it)', procs);
    const runInFailed = (await g.call(`/runs/${run}`)).json;
    rec.log('A run while force-failed', { status: runInFailed.status, failure: runInFailed.failure });
    rec.check('A1 the run records HARNESS_TERMINATION_UNCONFIRMED (not a clean interruption)', runInFailed.status === 'failed' && runInFailed.failure?.code === 'HARNESS_TERMINATION_UNCONFIRMED', runInFailed.failure);

    await page.getByRole('heading', { name: 'Force stop failed' }).waitFor({ timeout: 15_000 });
    const text = await L.noticeText(page);
    const buttons = await L.noticeButtons(page);
    rec.log('A force-failed notice', { text, buttons });
    await L.shot(page, 's3-a-force-failed-notice');
    rec.check('A2 the notice says force failed and offers Force exit', buttons.includes('Force exit'), buttons);
    rec.check('A2 the notice names the unconfirmed run', text.includes(run), null);
    await L.sleep(4000);
    const stable = await L.shutdownState(g);
    rec.check('A2 force-failed is stable (no automatic exit), listener and lock held', g.exitCode() === null && stable.phase === 'force-failed' && fs.existsSync(path.join(dir, 'graphgoblin.lock')), stable.phase);

    await page.getByRole('button', { name: 'Force exit' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ timeout: 5000 });
    const dlgText = await dlg.innerText();
    rec.log('A Force exit confirmation', dlgText);
    await L.shot(page, 's3-a-force-exit-confirmation');
    const postsBeforeConfirm = posts.filter((p) => p.method === 'POST').length;
    rec.check('A3 Force exit needs its own confirmation (nothing sent before Confirm)', /Force exit after failed cleanup\?/.test(dlgText) && postsBeforeConfirm === 1, { postsBeforeConfirm });
    await dlg.getByRole('button', { name: 'Confirm force exit' }).click();
    const code = await g.waitExit(20_000);
    rec.check('A3 Force exit leaves with exit code 1', code === 1, code);
    rec.check('A3 the lock is kept for next-start reclamation', fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    rec.check('A3 the browser sent exactly two POSTs (confirmed force, confirmed force exit)', posts.filter((p) => p.method === 'POST').length === 2, posts.filter((p) => p.method === 'POST'));
    rec.log('A tool child after Force exit (expected to survive, N10)', { toolAlive: L.tasklistAlive(toolPid) });
    await browser.close();
    browser = undefined;
    g.copyLog('s3-gateway-a1.log.txt');
    rec.log('A ending the surviving tool child by its PID (operator cleanup, as guide 07 says)', { toolPid, ended: L.endPid(toolPid) });

    const r = await L.startGateway({ dir, port: 6536, label: 'a2', env, rec });
    gateways.push(r);
    rec.log('A restart log lines about the lock', r.readLog().split(/\r?\n/).filter((l) => /lock|reclaim/i.test(l)).map(L.redact).slice(0, 5));
    const after = (await r.call(`/runs/${run}`)).json;
    rec.log('A run after restart', { status: after.status, failure: after.failure });
    rec.check(
      'A4 after restart the run is failed HARNESS_TERMINATION_UNCONFIRMED, non-resumable (truthful: cleanup was not confirmed)',
      after.status === 'failed' && after.failure?.code === 'HARNESS_TERMINATION_UNCONFIRMED' && after.failure?.resumable === false,
      after.failure,
    );
    await L.sleep(2000);
    const argv = fs.readFileSync(codex.pidFile + '.argv', 'utf8').trim().split(/\r?\n/);
    rec.check('A4 no automatic re-run after restart (one CLI turn in total)', argv.length === 1, argv.length);
    const resume = await r.call(`/runs/${run}/resume`, { method: 'POST', body: {} });
    rec.check('A4 Resume is refused', resume.status >= 400, { status: resume.status, code: resume.json?.code });
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('A5 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
    r.copyLog('s3-gateway-a2.log.txt');
  }

  // ---------------- B ----------------
  {
    const dir = L.makeStore('s3b');
    dirs.push(dir);
    const codex = L.repoFakeCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: '600000' };
    const g = await L.startGateway({ dir, port: 6537, label: 'b1', env, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Codex CLI without child'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    await L.sleep(1000);
    rec.log('B work started', { run, cliPid, tree: L.descendants(g.pid) });
    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const bposts = [];
    L.watchShutdownRequests(page, bposts, 'b');
    await page.goto(g.origin + `/app/runs/${run}`);
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    await page.getByRole('heading', { name: 'Gateway is draining' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Force stop', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm force stop' }).click();
    const forcedAt = Date.now();
    const timeline = await phaseTimeline(g, forcedAt, 30_000);
    const code = await g.waitExit(30_000);
    rec.log('B phases after force', { phases: compact(timeline), code, ms: Date.now() - forcedAt });
    rec.check('B1 a force with an ordinary Codex turn never reports force-failed', !timeline.some((x) => x.phase === 'force-failed'), compact(timeline));
    rec.check('B1 the gateway exits 0', code === 0, code);
    rec.check('B1 the Codex CLI is gone and the lock released', !L.tasklistAlive(cliPid) && !fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    await browser.close();
    browser = undefined;
    g.copyLog('s3-gateway-b1.log.txt');
    const r = await L.startGateway({ dir, port: 6537, label: 'b2', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    const evs = await L.events(r.call, run);
    rec.log('B run after restart', { status: after.status, failure: after.failure });
    rec.check('B2 RUN_INTERRUPTED_BY_STOP, non-resumable', after.status === 'failed' && after.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && after.failure?.resumable === false, after.failure);
    rec.check('B2 no false HARNESS_TERMINATION_UNCONFIRMED in the run events or gateway log', !JSON.stringify(evs).includes('HARNESS_TERMINATION_UNCONFIRMED') && !g.readLog().includes('HARNESS_TERMINATION_UNCONFIRMED'), null);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('B3 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }

  // ---------------- C ----------------
  {
    const dir = L.makeStore('s3c');
    dirs.push(dir);
    const codex = L.qaCodex(dir, { tool: true });
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: '600000' };
    const g = await L.startGateway({ dir, port: 6538, label: 'c1', env, rec });
    gateways.push(g);
    const codexLoop = await L.publishLoop(g.call, L.inferenceLoop('API force Codex with child'));
    const scriptLoopId = await L.publishLoop(g.call, L.scriptLoop('API force script', L.heldScriptSource({ dir, name: 'held' })));
    const codexRun = await L.startRun(g.call, codexLoop);
    const scriptRun = await L.startRun(g.call, scriptLoopId);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const toolPid = Number(await L.waitFile(codex.pidFile + '.tool'));
    strays.push(toolPid);
    const scriptPid = Number(await L.waitFile(path.join(dir, 'held.pid')));
    await L.sleep(1000);
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    const forced = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } });
    const forcedAt = Date.now();
    rec.log('C API force response', { status: forced.status, phase: forced.json?.phase });
    const timeline = await phaseTimeline(g, forcedAt, 30_000);
    const last = timeline.at(-1);
    rec.log('C phases after API force', compact(timeline));
    rec.check('C1 API force concludes force-failed within the bound', last.phase === 'force-failed' && last.ms <= 7_000, { phase: last.phase, ms: last.ms });
    rec.check('C1 unconfirmedRunIds lists only the Codex run (the script was released)', JSON.stringify(last.unconfirmed) === JSON.stringify([codexRun]), last.unconfirmed);
    rec.check('C1 the script process and the Codex CLI are gone; the tool child survives', !L.tasklistAlive(scriptPid) && !L.tasklistAlive(cliPid) && L.tasklistAlive(toolPid), null);
    const again = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch((e) => ({ status: 'network-error', json: String(e) }));
    rec.log('C further API force in force-failed', { status: again.status, phase: again.json?.phase });
    const code = await g.waitExit(20_000);
    rec.check('C2 a further API force exits with code 1', code === 1, code);
    rec.check('C2 lock kept', fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    g.copyLog('s3-gateway-c1.log.txt');
    rec.log('C ending the surviving tool child by its PID', { toolPid, ended: L.endPid(toolPid) });
    const r = await L.startGateway({ dir, port: 6538, label: 'c2', env, rec });
    gateways.push(r);
    const cr = (await r.call(`/runs/${codexRun}`)).json;
    const sr = (await r.call(`/runs/${scriptRun}`)).json;
    rec.log('C runs after restart', { codex: { status: cr.status, failure: cr.failure }, script: { status: sr.status, failure: sr.failure } });
    rec.check('C3 the Codex run records HARNESS_TERMINATION_UNCONFIRMED', cr.status === 'failed' && cr.failure?.code === 'HARNESS_TERMINATION_UNCONFIRMED', cr.failure);
    rec.check('C3 the script run records RUN_INTERRUPTED_BY_STOP', sr.status === 'failed' && sr.failure?.code === 'RUN_INTERRUPTED_BY_STOP', sr.failure);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('C4 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }
} catch (error) {
  rec.check('S3 completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) {
    if (x.exitCode() === null) {
      await x.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
      await x.waitExit(20_000);
      if (x.exitCode() === null) {
        await x.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
        await x.waitExit(20_000);
      }
    }
  }
  // Leftover tool children run from the store directory; cleanupStore ends them by PID.
  rec.finish({ shutdownRequestsFromBrowser: posts });
  for (const d of dirs) L.cleanupStore(d, rec);
}
