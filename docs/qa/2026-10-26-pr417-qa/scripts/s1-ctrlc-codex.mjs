// Check 1 (#319 D-1), acceptance scenario J extended. The gateway runs attached to a console of its
// own (like a terminal window) with one running fake Codex turn; a real console Ctrl+C
// (CTRL_C_EVENT) is delivered to that console.
//  A: one Ctrl+C -> normal drain, the turn keeps running; after the grace the Edge notice lists it
//     and offers Keep waiting and Force stop; releasing the turn lets it succeed and the gateway
//     exit 0; after restart the run is succeeded.
//  B: one Ctrl+C -> drain; a later Ctrl+C (outside the 1 s coalescing window) forces; exit 0; the
//     CLI is gone; after restart RUN_INTERRUPTED_BY_STOP.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s1-ctrlc-codex');
const GRACE = 8_000;
const gateways = [];
const dirs = [];
let browser;
const posts = [];

async function sample(g, run, cliPid, seconds) {
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < seconds * 2; i++) {
    await L.sleep(500);
    const s = await L.shutdownState(g);
    let r = {};
    try {
      r = (await g.call(`/runs/${run}`)).json;
    } catch {
      /* gateway gone */
    }
    samples.push({
      msSinceSignal: Date.now() - t0,
      phase: s.phase,
      active: s.activeRunIds,
      gatewayExit: g.exitCode(),
      cliAlive: L.tasklistAlive(cliPid),
      status: r.status,
      code: r.failure?.code,
    });
  }
  return samples;
}

try {
  // ---- A: Ctrl+C drain, grace expiry notice, release, completion ----
  {
    const dir = L.makeStore('s1a');
    dirs.push(dir);
    const codex = L.qaCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: String(GRACE) };
    const g = await L.startGateway({ dir, port: 6531, label: 's1a', env, viaConsole: true, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Ctrl+C Codex turn A'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    await L.sleep(1000);
    const cons = L.consoleList(g.pid, dir);
    rec.log('A work started', { run, cliPid, gatewayPid: g.pid, tree: L.descendants(g.pid), gatewayConsole: cons });
    rec.check('A0 the Codex CLI is not attached to the gateway console (own hidden console)', cons.status === 0 && !cons.entries.some((e) => e.startsWith(`${cliPid}:`)), cons);
    const before = (await g.call(`/runs/${run}`)).json;
    rec.check('A0 run running before Ctrl+C', before.status === 'running', before.status);

    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    L.watchShutdownRequests(page, posts, 'a');
    await page.goto(g.origin + '/app/loops');
    await page.getByRole('heading', { name: 'Loops' }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);

    const c1 = L.ctrlC(g.pid);
    const ctrlAt = Date.now();
    rec.log('A Ctrl+C #1 delivered', c1);
    const samples = await sample(g, run, cliPid, 3);
    rec.log('A samples for 3 s after one Ctrl+C', samples);
    const last = samples.at(-1);
    rec.check('A1 one Ctrl+C starts a normal drain and the gateway keeps running', g.exitCode() === null && samples.every((s) => s.phase === 'draining'), samples.map((s) => s.phase));
    rec.check('A1 the Codex CLI survives the Ctrl+C (every sample)', samples.every((s) => s.cliAlive), samples.map((s) => s.cliAlive));
    rec.check('A1 the run stays running and listed as active work', samples.every((s) => s.status === 'running' && s.active?.includes(run)), last);
    const logAfter = g.readLog();
    rec.check('A1 the gateway log has no Codex turn failure (no 3221225786 / 0xC000013A)', !/3221225786|turn failed/i.test(logAfter), logAfter.split(/\r?\n/).filter((l) => /turn failed|3221225786/.test(l)).map(L.redact));

    await page.getByRole('heading', { name: 'Gateway is draining' }).waitFor({ timeout: 15_000 });
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    const expiredAt = Date.now();
    rec.log('A awaiting-choice reached', { msAfterCtrlC: expiredAt - ctrlAt, state: await L.shutdownState(g) });
    await page.getByText(/The gateway grace period elapsed/).waitFor({ timeout: 15_000 });
    await page.getByRole('link', { name: new RegExp(run) }).first().waitFor({ timeout: 15_000 });
    const text = await L.noticeText(page);
    const buttons = await L.noticeButtons(page);
    rec.log('A notice at expiry', { text, buttons });
    await L.shot(page, 's1-a-expiry-notice');
    rec.check('A2 after the grace the notice lists the Codex run with its loop name', text.includes(`Ctrl+C Codex turn A — ${run}`), null);
    rec.check('A2 the notice offers Keep waiting and Force stop', buttons.includes('Keep waiting') && buttons.includes('Force stop'), buttons);
    rec.check('A2 the turn is still alive at expiry', L.tasklistAlive(cliPid) && (await g.call(`/runs/${run}`)).json.status === 'running', null);

    codex.release();
    const releasedAt = Date.now();
    const code = await g.waitExit(30_000);
    rec.log('A gateway exit after release', { code, msAfterRelease: Date.now() - releasedAt });
    rec.check('A3 releasing the turn lets the drain complete: gateway exits 0', code === 0, code);
    rec.check('A3 lock released', !fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    rec.check('A3 the browser sent no shutdown POST', posts.filter((p) => p.method === 'POST').length === 0, posts);
    await page.getByText('Gateway stopped or disconnected', { exact: true }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await L.shot(page, 's1-a-after-exit');
    await browser.close();
    browser = undefined;
    g.copyLog('s1-gateway-a1.log.txt');

    const r = await L.startGateway({ dir, port: 6531, label: 's1a-r', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    rec.log('A run after restart', { status: after.status, failure: after.failure });
    rec.check('A4 after restart the run is succeeded (the turn reached its result)', after.status === 'succeeded', { status: after.status, failure: after.failure });
    const argv = fs.readFileSync(codex.pidFile + '.argv', 'utf8').trim().split(/\r?\n/);
    rec.check('A4 the fake CLI ran exactly one turn (no re-run after restart)', argv.length === 1, argv.length);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('A5 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
    r.copyLog('s1-gateway-a2.log.txt');
  }

  // ---- B: Ctrl+C drain, then a later Ctrl+C forces ----
  {
    const dir = L.makeStore('s1b');
    dirs.push(dir);
    const codex = L.qaCodex(dir);
    const env = { ...codex.env, GG_SHUTDOWN_GRACE_MS: '300000' };
    const g = await L.startGateway({ dir, port: 6532, label: 's1b', env, viaConsole: true, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Ctrl+C Codex turn B'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    await L.sleep(1000);
    rec.log('B work started', { run, cliPid, gatewayPid: g.pid });
    rec.log('B Ctrl+C #1', L.ctrlC(g.pid));
    const firstAt = Date.now();
    const samples = await sample(g, run, cliPid, 2);
    rec.log('B samples after Ctrl+C #1', samples);
    rec.check('B1 first Ctrl+C drains with the turn alive', samples.every((s) => s.phase === 'draining' && s.cliAlive && s.status === 'running'), samples.at(-1));
    await L.sleep(500);
    rec.log('B Ctrl+C #2 (later, outside the coalescing window)', { ...L.ctrlC(g.pid), sinceFirstMs: Date.now() - firstAt });
    const forcedAt = Date.now();
    const code = await g.waitExit(30_000);
    rec.log('B gateway exit after Ctrl+C #2', { code, ms: Date.now() - forcedAt });
    rec.check('B2 a later Ctrl+C forces and the gateway exits 0', code === 0, code);
    rec.check('B2 the Codex CLI is gone', !L.tasklistAlive(cliPid), null);
    rec.check('B2 lock released', !fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    g.copyLog('s1-gateway-b1.log.txt');
    const r = await L.startGateway({ dir, port: 6532, label: 's1b-r', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    rec.log('B run after restart', { status: after.status, failure: after.failure });
    rec.check(
      'B3 after restart the run records RUN_INTERRUPTED_BY_STOP, non-resumable, effects may have happened',
      after.status === 'failed' && after.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && after.failure?.resumable === false && after.failure?.details?.effectMayHaveHappened === true,
      after.failure,
    );
    const evs = await L.events(r.call, run);
    rec.check('B3 no HARNESS_TERMINATION_UNCONFIRMED or HARNESS_DELIVERY_UNCERTAIN in the run events', !/HARNESS_TERMINATION_UNCONFIRMED|HARNESS_DELIVERY_UNCERTAIN/.test(JSON.stringify(evs)), evs.filter((e) => /failed/.test(e.type)).map((e) => ({ type: e.type, code: e.failure?.code ?? e.code })));
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('B4 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
    r.copyLog('s1-gateway-b2.log.txt');
  }
} catch (error) {
  rec.check('S1 completed without exception', false, String(error?.stack ?? error));
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
