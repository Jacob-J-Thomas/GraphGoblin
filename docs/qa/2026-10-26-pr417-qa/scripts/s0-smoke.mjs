// Smoke check of the QA harness: a console-hosted gateway with the fake Codex starts, a turn
// completes when released, the console membership is readable, and an API drain exits 0.
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s0-smoke');
const dir = L.makeStore('s0');
let g;
try {
  const codex = L.qaCodex(dir);
  g = await L.startGateway({ dir, port: 6530, label: 's0', env: { ...codex.env }, viaConsole: true, rec });
  rec.log('shutdown state', (await g.call('/system/shutdown')).json);
  const loop = await L.publishLoop(g.call, L.inferenceLoop('Smoke codex turn'));
  const run = await L.startRun(g.call, loop);
  const cliPid = Number(await L.waitFile(codex.pidFile));
  rec.log('turn started', { run, cliPid, gateway: g.pid, tree: L.descendants(g.pid) });
  rec.log('gateway console', L.consoleList(g.pid, dir));
  codex.release();
  const done = await L.waitRun(g.call, run, ['succeeded', 'failed']);
  rec.check('S0 released turn succeeds', done.status === 'succeeded', { status: done.status, failure: done.failure });
  await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('S0 API drain exits 0', (await g.waitExit(30_000)) === 0, g.exitCode());
  g.copyLog('s0-gateway.log.txt');
} catch (error) {
  rec.check('S0 completed without exception', false, String(error?.stack ?? error));
} finally {
  if (g && g.exitCode() === null) {
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
    await g.waitExit(15_000);
  }
  rec.finish();
  L.cleanupStore(dir, rec);
}
void path;
