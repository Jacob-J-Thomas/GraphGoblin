// Extra regression probe (my addition): the Codex harness now arms its five-second acknowledgement
// on every abort, not only on shutdown force, and cancel() now rethrows unconfirmed termination.
// Other abort paths therefore change too. This probe checks them through the public API:
//  C1: user cancel of an ordinary fake Codex turn -> the run is cancelled, the CLI is gone, no
//      unconfirmed-termination failure.
//  C2: user cancel of a Codex turn whose CLI child keeps its output open -> the run must not stay
//      running indefinitely; the outcome is recorded truthfully; a later normal drain still exits 0.
//  T1: node timeout (timeoutSeconds: 3) on an ordinary held Codex turn -> fails with the timeout,
//      not with unconfirmed termination; the CLI is gone.
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s9-cancel-timeout');
const gateways = [];
const dirs = [];

async function timeline(g, runId, fromMs, limitMs) {
  const out = [];
  for (;;) {
    const r = (await g.call(`/runs/${runId}`)).json;
    out.push({ ms: Date.now() - fromMs, status: r.status, code: r.failure?.code });
    if (!['running', 'cancelling', 'queued'].includes(r.status) || Date.now() - fromMs > limitMs) return { out, run: r };
    await L.sleep(250);
  }
}
const changes = (t) => t.filter((x, i) => i === 0 || i === t.length - 1 || x.status !== t[i - 1].status);

try {
  // ---------------- C1 and T1 ----------------
  {
    const dir = L.makeStore('s9a');
    dirs.push(dir);
    const codex = L.qaCodex(dir);
    const g = await L.startGateway({ dir, port: 6538, label: 's9a', env: { ...codex.env }, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Cancel ordinary Codex turn'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    await L.sleep(1000);
    const cancel = await g.call(`/runs/${run}/cancel`, { method: 'POST', body: {} });
    const at = Date.now();
    const { out, run: final } = await timeline(g, run, at, 20_000);
    rec.log('C1 user cancel of an ordinary Codex turn', { cancel: cancel.status, timeline: changes(out), failure: final.failure });
    rec.check('C1 the run is cancelled promptly; the CLI is gone; no unconfirmed termination', final.status === 'cancelled' && out.at(-1).ms < 6000 && !L.tasklistAlive(cliPid) && !JSON.stringify(final).includes('TERMINATION_UNCONFIRMED'), { status: final.status, ms: out.at(-1).ms, failure: final.failure });

    const fs = await import('node:fs');
    fs.rmSync(codex.pidFile);
    const def = L.inferenceLoop('Timeout ordinary Codex turn');
    def.nodes[1].config.timeoutSeconds = 3;
    const tloop = await L.publishLoop(g.call, def);
    const trun = await L.startRun(g.call, tloop);
    const tPid = Number(await L.waitFile(codex.pidFile));
    const tAt = Date.now();
    const { out: tout, run: tfinal } = await timeline(g, trun, tAt, 20_000);
    rec.log('T1 node timeout on an ordinary Codex turn', { timeline: changes(tout), failure: tfinal.failure });
    rec.check('T1 the run fails with its timeout (not unconfirmed termination) and the CLI is gone', tfinal.status === 'failed' && !/TERMINATION_UNCONFIRMED/.test(tfinal.failure?.code ?? '') && /TIMEOUT|TIMED_OUT/i.test(tfinal.failure?.code ?? '') && !L.tasklistAlive(tPid), tfinal.failure);
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('C1/T1 gateway drains to exit 0', (await g.waitExit(30_000)) === 0, g.exitCode());
    g.copyLog('s9-gateway-a.log.txt');
  }

  // ---------------- C2 ----------------
  {
    const dir = L.makeStore('s9b');
    dirs.push(dir);
    const codex = L.qaCodex(dir, { tool: true });
    const g = await L.startGateway({ dir, port: 6539, label: 's9b', env: { ...codex.env }, rec });
    gateways.push(g);
    const loop = await L.publishLoop(g.call, L.inferenceLoop('Cancel Codex turn with tool child'));
    const run = await L.startRun(g.call, loop);
    const cliPid = Number(await L.waitFile(codex.pidFile));
    const toolPid = Number(await L.waitFile(codex.pidFile + '.tool'));
    await L.sleep(1000);
    const cancel = await g.call(`/runs/${run}/cancel`, { method: 'POST', body: {} });
    const at = Date.now();
    const { out, run: final } = await timeline(g, run, at, 30_000);
    rec.log('C2 user cancel of a Codex turn whose CLI child keeps its output open', { cancel: cancel.status, timeline: changes(out), status: final.status, failure: final.failure, cli: L.tasklistAlive(cliPid), tool: L.tasklistAlive(toolPid) });
    rec.check('C2 the run leaves running within the acknowledgement bound (does not hang)', !['running', 'cancelling'].includes(final.status) && out.at(-1).ms <= 7000, { status: final.status, ms: out.at(-1).ms });
    rec.check('C2 the outcome is truthful: unconfirmed termination is reported (the tool child is really alive)', final.status === 'failed' && final.failure?.code === 'HARNESS_TERMINATION_UNCONFIRMED' && L.tasklistAlive(toolPid), final.failure);
    const drained = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    const code = await g.waitExit(30_000);
    rec.check('C2 an earlier unconfirmed cancel does not trap a later normal drain (exit 0)', code === 0, { drain: drained.status, code, unconfirmed: drained.json?.unconfirmedRunIds });
    g.copyLog('s9-gateway-b.log.txt');
    rec.log('C2 ending the surviving tool child by its PID', { toolPid, ended: L.endPid(toolPid) });
  }
} catch (error) {
  rec.check('S9 completed without exception', false, String(error?.stack ?? error));
} finally {
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
  rec.finish();
  for (const d of dirs) L.cleanupStore(d, rec);
}
void path;
