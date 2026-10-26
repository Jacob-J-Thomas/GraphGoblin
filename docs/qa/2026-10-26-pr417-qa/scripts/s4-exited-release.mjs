// Check 3 (#319, exited-process release).
//  O1: acceptance group A observation O1 re-run. A Claude resume-own node's second visit gets a
//      wrong-identity reply from a fake CLI that exits right after answering (no linger). The run
//      must report the identity error, not HARNESS_TERMINATION_UNCONFIRMED. The race is sampled
//      eight times; one control run keeps the process alive 3 s (linger); one Codex control.
//  E:  acceptance group C scenario E re-run. A script root exits after 0.5 s while a detached
//      grandchild keeps its output pipe open, so tree termination really cannot be confirmed:
//      browser force must end in force-failed, Force exit exits 1 with the lock kept, and the run
//      records SCRIPT_TERMINATION_UNCONFIRMED after restart.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s4-exited-release');
const gateways = [];
const dirs = [];
let browser;
const posts = [];

function holdLoop(name, harness) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'worker',
        kind: 'inference',
        label: 'worker',
        config: {
          harness,
          model: harness === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
          effort: 'medium',
          session: { policy: 'resume-own' },
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: 'WORKER run={{ run.id }} visit={{ counters.nodeVisits.worker }} authored task.' },
        },
      },
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue', exposeTo: ['api'] } },
      {
        id: 'again',
        kind: 'decision',
        label: 'again',
        config: {
          kind: 'expression',
          jsonata: '"repeat"',
          maxPasses: 3,
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'finish', label: 'Finish' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 's-w', from: { node: 'start', port: 'out' }, to: { node: 'worker' } },
      { id: 'w-h', from: { node: 'worker', port: 'out' }, to: { node: 'hold' } },
      { id: 'h-g', from: { node: 'hold', port: 'out' }, to: { node: 'again' } },
      { id: 'g-w', from: { node: 'again', port: 'repeat' }, to: { node: 'worker' } },
      { id: 'g-l', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
      { id: 'g-f', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
    ],
  };
}

try {
  // ---------------- O1 ----------------
  {
    const dir = L.makeStore('s4o1');
    dirs.push(dir);
    const cli = L.sessionCli(dir);
    const g = await L.startGateway({ dir, port: 6539, label: 'o1', env: { ...cli.env }, rec });
    gateways.push(g);
    const claudeLoop = await L.publishLoop(g.call, holdLoop('O1 claude wrong identity', 'claude'));
    const codexLoop = await L.publishLoop(g.call, holdLoop('O1 codex wrong identity', 'codex'));
    const outcomes = [];
    const cases = [
      ...Array.from({ length: 8 }, (_, i) => ({ label: `claude-fast-${i + 1}`, loop: claudeLoop, linger: undefined })),
      { label: 'claude-linger-control', loop: claudeLoop, linger: 3000 },
      { label: 'codex-control', loop: codexLoop, linger: undefined },
    ];
    for (const c of cases) {
      cli.control('resume-mode.txt');
      cli.control('linger-ms.txt');
      const run = await L.startRun(g.call, c.loop);
      const waiting = await L.waitRun(g.call, run, ['waiting', 'failed', 'succeeded']);
      if (waiting.status !== 'waiting') {
        outcomes.push({ label: c.label, run, firstVisit: waiting.status, failure: waiting.failure });
        continue;
      }
      cli.control('resume-mode.txt', 'different-id');
      if (c.linger) cli.control('linger-ms.txt', c.linger);
      await g.call(`/runs/${run}/input`, { method: 'POST', body: { waitId: waiting.waiting.waitId, input: 'go' } });
      const end = await L.waitRun(g.call, run, ['failed', 'succeeded'], 60_000);
      cli.control('resume-mode.txt');
      cli.control('linger-ms.txt');
      const evs = await L.events(g.call, run);
      const lastStart = evs.findLast((e) => e.type === 'node.started' && e.nodeId === 'worker').seq;
      const resumedClaims = evs.filter((e) => e.seq > lastStart && e.type === 'harness.session' && e.mode === 'resumed').length;
      const reqs = cli.requests().filter((q) => q.prompt.includes(`run=${run} `));
      outcomes.push({
        label: c.label,
        run,
        status: end.status,
        code: end.failure?.code,
        resumable: end.failure?.resumable,
        message: end.failure?.message,
        calls: reqs.length,
        secondCallOutcome: reqs[1]?.outcome,
        resumedClaims,
      });
    }
    rec.log('O1 outcomes', outcomes);
    const fast = outcomes.filter((o) => o.label.startsWith('claude-fast'));
    rec.check(
      'O1-1 every fast-exiting Claude wrong-identity reply reports the identity error, never HARNESS_TERMINATION_UNCONFIRMED (8 runs)',
      fast.length === 8 && fast.every((o) => o.status === 'failed' && o.code !== 'HARNESS_TERMINATION_UNCONFIRMED' && /does not match the requested session/.test(o.message ?? '')),
      fast.map((o) => ({ label: o.label, code: o.code })),
    );
    rec.check('O1-1 each is explicit and non-resumable, with no resumed-session claim and no fresh fallback turn', fast.every((o) => o.resumable === false && o.resumedClaims === 0 && o.calls === 2), fast.map((o) => ({ resumable: o.resumable, resumedClaims: o.resumedClaims, calls: o.calls })));
    const linger = outcomes.find((o) => o.label === 'claude-linger-control');
    rec.check('O1-2 control: the same reply with a live process gives the same outcome', linger?.code === fast[0]?.code && /does not match the requested session/.test(linger?.message ?? ''), linger);
    const codex = outcomes.find((o) => o.label === 'codex-control');
    rec.check('O1-3 control: Codex wrong identity still reports HARNESS_SESSION_MISSING', codex?.code === 'HARNESS_SESSION_MISSING', codex);
    const terminationLines = g.readLog().split(/\r?\n/).filter((l) => /TERMINATION_UNCONFIRMED/.test(l));
    rec.check('O1-4 the gateway log has no unconfirmed-termination line', terminationLines.length === 0, terminationLines.slice(0, 3).map(L.redact));
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('O1-5 gateway drains to exit 0', (await g.waitExit(30_000)) === 0, g.exitCode());
    g.copyLog('s4-gateway-o1.log.txt');
  }

  // ---------------- E ----------------
  {
    const dir = L.makeStore('s4e');
    dirs.push(dir);
    const GRACE = 5000;
    const env = { GG_SHUTDOWN_GRACE_MS: String(GRACE) };
    const g = await L.startGateway({ dir, port: 6530, label: 'e1', env, rec });
    gateways.push(g);
    const base = path.join(dir, 'orphan');
    const source = [
      `const fs=require('node:fs'),cp=require('node:child_process');`,
      `fs.writeFileSync(${JSON.stringify(base + '.pid')},String(process.pid));`,
      `cp.spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),240000)",${JSON.stringify(base + '.grandchild')}],{stdio:'inherit',detached:true});`,
      `setTimeout(()=>process.exit(0),500);`,
    ].join('');
    const loop = await L.publishLoop(g.call, L.scriptLoop('Orphaned pipe script', source));
    const run = await L.startRun(g.call, loop);
    const rootPid = Number(await L.waitFile(base + '.pid'));
    const grandPid = Number(await L.waitFile(base + '.grandchild'));
    await L.sleep(1500);
    const before = (await g.call(`/runs/${run}`)).json;
    rec.check('E0 root exited, grandchild holds the pipe, run still running', !L.tasklistAlive(rootPid) && L.tasklistAlive(grandPid) && before.status === 'running', { status: before.status });

    browser = await L.launchEdge();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    L.watchShutdownRequests(page, posts, 'e');
    await page.goto(g.origin + '/app/loops');
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    await L.waitFor(async () => (await L.shutdownState(g)).phase === 'awaiting-choice', { timeoutMs: GRACE + 10_000, intervalMs: 250 });
    await page.getByText(/The gateway grace period elapsed/).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Force stop', exact: true }).click({ timeout: 15_000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm force stop' }).click();
    const forcedAt = Date.now();
    await L.waitFor(async () => !['forcing', 'awaiting-choice'].includes((await L.shutdownState(g)).phase), { timeoutMs: 20_000, intervalMs: 200 });
    const failed = await L.shutdownState(g);
    rec.log('E state after force', { ...failed, msAfterConfirm: Date.now() - forcedAt });
    rec.check('E1 an unconfirmable script tree still ends in force-failed', failed.phase === 'force-failed', failed.phase);
    rec.check('E1 the run is listed as unconfirmed; only Force exit is offered', failed.unconfirmedRunIds?.includes(run) && JSON.stringify(failed.choices) === '["force"]', { unconfirmed: failed.unconfirmedRunIds, choices: failed.choices });
    rec.check('E1 the grandchild is really still alive (cleanup truly unconfirmed)', L.tasklistAlive(grandPid), null);
    await page.getByRole('heading', { name: 'Force stop failed' }).waitFor({ timeout: 15_000 });
    await L.shot(page, 's4-e-force-failed-notice');
    await L.sleep(3000);
    rec.check('E2 force-failed is stable, lock held', g.exitCode() === null && (await L.shutdownState(g)).phase === 'force-failed' && fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    await page.getByRole('button', { name: 'Force exit' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.waitFor({ timeout: 5000 });
    rec.check('E3 Force exit asks for its own confirmation', /Force exit after failed cleanup\?/.test(await dlg.innerText()), null);
    await dlg.getByRole('button', { name: 'Confirm force exit' }).click();
    const code = await g.waitExit(20_000);
    rec.check('E3 Force exit exits 1 and keeps the lock', code === 1 && fs.existsSync(path.join(dir, 'graphgoblin.lock')), code);
    await browser.close();
    browser = undefined;
    g.copyLog('s4-gateway-e1.log.txt');
    rec.log('E ending the orphaned grandchild by its PID', { grandPid, ended: L.endPid(grandPid) });
    const r = await L.startGateway({ dir, port: 6530, label: 'e2', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    rec.log('E run after restart', { status: after.status, failure: after.failure });
    rec.check('E4 the run records SCRIPT_TERMINATION_UNCONFIRMED after restart', after.status === 'failed' && after.failure?.code === 'SCRIPT_TERMINATION_UNCONFIRMED', after.failure);
    await r.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    rec.check('E5 restarted gateway drains to exit 0', (await r.waitExit(30_000)) === 0, r.exitCode());
  }
} catch (error) {
  rec.check('S4 completed without exception', false, String(error?.stack ?? error));
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
  rec.finish({ shutdownRequestsFromBrowser: posts });
  for (const d of dirs) L.cleanupStore(d, rec);
}
