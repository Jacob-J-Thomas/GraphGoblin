// Checks 1-3 (LP-1, LP-2, LP-3, #319) with the real, logged-in Codex CLI (the SDK-bundled 0.160.0,
// the product default) on gpt-6-luna at low effort and the default workspace-write sandbox.
//   node lp-shutdown.mjs lp1 [--fake]   real console Ctrl+C during a real Codex turn
//   node lp-shutdown.mjs lp2 [--fake]   API drain then explicit force during a real Codex turn
//                                       that runs a long command; LP-3 provider-side history
// --fake uses acceptance A's recording CLI (no provider call) to dry-run the driver only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const which = process.argv[2];
const fakeMode = process.argv.includes('--fake');
if (!['lp1', 'lp2'].includes(which)) throw new Error('usage: lp-shutdown.mjs lp1|lp2 [--fake]');
const rec = new L.Recorder(`${which}${fakeMode ? '-dryrun' : ''}`);
const gateways = [];
const dir = L.makeStore(which);
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const marker = `ggf2${which}${Date.now().toString(36)}`;
const seconds = which === 'lp1' ? 15 : 600;
const template =
  `Run exactly this shell command and wait for it to finish: powershell -NoProfile -Command "Start-Sleep -Seconds ${seconds}; Write-Output ${marker}". ` +
  `Then reply with exactly the word DONE and nothing else.`;
const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');

if (fake) {
  fake.control('delay-ms.txt', which === 'lp1' ? 8000 : undefined);
  if (which === 'lp2') fake.control('hold.txt', marker);
}

/** The rollout file the Codex CLI writes for one thread (searched by thread id in the file name). */
function findRollout(threadId) {
  if (!threadId || !fs.existsSync(sessionsRoot)) return null;
  const stack = [sessionsRoot];
  const now = new Date();
  // Only the folders for today and yesterday (local), to keep the search small.
  const days = [0, 1].map((d) => {
    const t = new Date(now.getTime() - d * 86_400_000);
    return path.join(sessionsRoot, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
  });
  for (const day of days) {
    if (!fs.existsSync(day)) continue;
    for (const f of fs.readdirSync(day)) if (f.includes(threadId)) return path.join(day, f);
  }
  void stack;
  return null;
}

/** Size, mtime, line count and the type fields of the last entries; never the content. */
function rolloutFacts(file) {
  if (!file || !fs.existsSync(file)) return { exists: false };
  const st = fs.statSync(file);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kinds = lines.map((l) => {
    try {
      const j = JSON.parse(l);
      return [j.type, j.payload?.type].filter(Boolean).join('/');
    } catch {
      return 'unparsed';
    }
  });
  const contexts = lines
    .map((l) => {
      try {
        const j = JSON.parse(l);
        return j.type === 'turn_context' ? { model: j.payload?.model, effort: j.payload?.effort ?? j.payload?.reasoning_effort ?? null } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { exists: true, bytes: st.size, mtime: st.mtime.toISOString(), lines: lines.length, lastKinds: kinds.slice(-6), turnContexts: contexts };
}

async function waitMarkerProcess(g, timeoutMs = 120_000) {
  return L.waitFor(
    () => {
      const tree = L.descendants(g.pid);
      const hit = tree.find((p) => p.cmd.includes(marker) && !/Get-CimInstance/.test(p.cmd));
      return hit ? { hit, tree } : null;
    },
    { timeoutMs, intervalMs: 500 },
  );
}

async function sessionOf(call, run) {
  const evs = await L.events(call, run);
  return evs.find((e) => e.type === 'harness.session')?.sessionId ?? null;
}

try {
  if (which === 'lp1') {
    // ---- LP-1: real console Ctrl+C during a real Codex turn ----
    const g = await L.startGateway({ dir, port: 6641, label: 'lp1', env, viaConsole: true, rec });
    gateways.push(g);
    const loop = await L.publishLoop(
      g.call,
      L.line('F2 LP-1 Ctrl+C Codex turn', [L.inferenceNode('infer', { harness: 'codex', model: 'gpt-6-luna', effort: 'low', template, sandbox: 'workspace-write' })]),
    );
    const run = await L.startRun(g.call, loop);
    let hit = null;
    if (!fake) {
      const found = await waitMarkerProcess(g);
      hit = found?.hit ?? null;
      rec.log('turn in flight: the command runs under the Codex CLI', { run, marker, tree: found?.tree?.map(({ pid, ppid, name }) => ({ pid, ppid, name })) });
    } else await L.sleep(2500);
    const tree = L.descendants(g.pid);
    const cli = tree.find((p) => /codex/i.test(p.name));
    const cons = L.consoleList(g.pid, dir);
    rec.log('before Ctrl+C', { gatewayPid: g.pid, cliPid: cli?.pid, commandPid: hit?.pid, gatewayConsole: cons });
    rec.check('LP1-0 the run is running with a Codex CLI process in flight', (await g.call(`/runs/${run}`)).json.status === 'running' && Boolean(cli), { cli: cli?.pid });
    rec.check('LP1-0 the Codex CLI is not attached to the gateway console', cons.status === 0 && !cons.entries.some((e) => e.startsWith(`${cli?.pid}:`)), cons.entries);
    const c = L.ctrlC(g.pid);
    const ctrlAt = Date.now();
    rec.log('one real console Ctrl+C delivered to the gateway console', c);
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await L.sleep(500);
      const s = await L.shutdownState(g);
      let r = {};
      try {
        r = (await g.call(`/runs/${run}`)).json;
      } catch {
        /* gateway gone */
      }
      samples.push({ ms: Date.now() - ctrlAt, phase: s.phase, active: s.activeRunIds, cliAlive: L.tasklistAlive(cli?.pid), commandAlive: hit ? L.tasklistAlive(hit.pid) : null, status: r.status, gatewayExit: g.exitCode() });
    }
    rec.log('samples for 4 s after the Ctrl+C', samples);
    const inFlight = samples.filter((s) => s.status === 'running');
    rec.check('LP1-1 the Ctrl+C starts a normal drain (phase draining) and the gateway keeps serving', samples[0].phase === 'draining' && samples.filter((s) => s.phase !== 'gone').every((s) => s.phase === 'draining'), samples.map((s) => s.phase));
    rec.check('LP1-1 the turn keeps running after the Ctrl+C (CLI alive and run running/active while in flight)', inFlight.length > 0 && inFlight.every((s) => s.cliAlive && (s.active ?? []).includes(run)), inFlight.map((s) => ({ ms: s.ms, cli: s.cliAlive, cmd: s.commandAlive })));
    const logNow = g.readLog();
    rec.check('LP1-1 no Codex turn failure or STATUS_CONTROL_C_EXIT in the gateway log', !/3221225786|turn failed/i.test(logNow), logNow.split(/\r?\n/).filter((l) => /turn failed|3221225786/.test(l)));
    const code = await g.waitExit(240_000);
    const exitMs = Date.now() - ctrlAt;
    rec.log('gateway exit after the drain', { code, msAfterCtrlC: exitMs });
    rec.check('LP1-2 the drain completes when the turn finishes and the gateway exits 0', code === 0, { code, exitMs });
    rec.check('LP1-2 lock released', !fs.existsSync(path.join(dir, 'graphgoblin.lock')), null);
    if (!fake) {
      await L.sleep(1000);
      const left = tree.filter((p) => L.tasklistAlive(p.pid)).map((p) => ({ pid: p.pid, name: p.name, now: L.tasklistLine(p.pid) }));
      rec.check('LP1-2 no process of the Codex CLI tree seen in flight is left after the gateway exit', left.length === 0, { checked: tree.length, left });
    }
    g.copyLog(`${rec.name}-gateway-a.log.txt`);
    const r = await L.startGateway({ dir, port: 6641, label: 'lp1-r', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    const evs = await L.events(r.call, run);
    const calls = L.providerCalls(evs);
    for (const t of calls) rec.turn({ check: 'LP-1', provider: 'codex', model: 'gpt-6-luna', effort: 'low', run, ...t, fake: fakeMode });
    const outputs = L.nodeReplies(evs, 'infer');
    const commands = L.commandItems(evs);
    rec.log('run after restart', { status: after.status, failure: after.failure, outputs, commands, progressKinds: L.progressKinds(evs) });
    rec.check('LP1-3 the run completed successfully (the turn reached its result)', after.status === 'succeeded', { status: after.status, failure: after.failure });
    rec.check('LP1-3 exactly one provider turn (no re-run after restart)', calls.length === 1, calls);
    if (!fake) rec.check('LP1-3 the command itself ran to completion inside the turn', commands.some((x) => x.status === 'ok' && x.exitCode === 0), commands);
    const code2 = await r.stop();
    rec.check('LP1-4 the restarted gateway drains to exit 0', code2 === 0, code2);
    r.copyLog(`${rec.name}-gateway-b.log.txt`);
  } else {
    // ---- LP-2 / LP-3: API drain, explicit force over a real Codex turn running a long command ----
    const g = await L.startGateway({ dir, port: 6642, label: 'lp2', env, rec });
    gateways.push(g);
    const loop = await L.publishLoop(
      g.call,
      L.line('F2 LP-2 forced Codex turn', [L.inferenceNode('infer', { harness: 'codex', model: 'gpt-6-luna', effort: 'low', template, sandbox: 'workspace-write' })]),
    );
    const run = await L.startRun(g.call, loop);
    let hit = null;
    let tree = [];
    if (!fake) {
      const found = await waitMarkerProcess(g, 150_000);
      hit = found?.hit ?? null;
      tree = found?.tree ?? [];
    } else {
      await L.sleep(2500);
      tree = L.descendants(g.pid);
    }
    const cli = tree.find((p) => /codex/i.test(p.name));
    const threadId = await L.waitFor(() => sessionOf(g.call, run), { timeoutMs: 20_000, intervalMs: 300 });
    const rollout = fake ? null : findRollout(threadId);
    const before = rolloutFacts(rollout);
    rec.log('turn in flight', { run, threadId, cliPid: cli?.pid, command: hit ? { pid: hit.pid, name: hit.name } : null, tree: tree.map(({ pid, ppid, name }) => ({ pid, ppid, name })), rollout: before });
    rec.check('LP2-0 a real Codex turn is running its long command', fake || (Boolean(hit) && L.tasklistAlive(hit.pid)), hit?.pid);
    const drain = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
    await L.sleep(1500);
    const draining = await L.shutdownState(g);
    rec.check('LP2-1 API drain: phase draining with the Codex run active, command still running', drain.status === 202 && draining.phase === 'draining' && (draining.activeRunIds ?? []).includes(run) && (fake || L.tasklistAlive(hit.pid)), { phase: draining.phase, active: draining.activeRunIds });
    const forceAt = Date.now();
    const force = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } });
    const phases = [];
    let state;
    for (let i = 0; i < 300; i++) {
      state = await L.shutdownState(g);
      const prev = phases.at(-1);
      if (!prev || prev.phase !== state.phase) phases.push({ ms: Date.now() - forceAt, phase: state.phase, unconfirmed: state.unconfirmedRunIds, choices: state.choices });
      if (state.phase === 'gone' || state.phase === 'force-failed') break;
      await L.sleep(100);
    }
    const leftForcingMs = phases.find((p) => p.phase !== 'forcing' && p.ms > 0)?.ms ?? null;
    rec.log('force phases', { force: force.status, phases, leftForcingMs });
    rec.check('LP2-2 the phase leaves forcing within a few seconds (<= 7 s)', leftForcingMs !== null && leftForcingMs <= 7000, { leftForcingMs, phases: phases.map((p) => p.phase) });
    const outcome = state.phase === 'force-failed' ? 'force-failed' : 'released';
    rec.observe('LP2-2 force outcome', { outcome, state });
    if (outcome === 'force-failed') {
      rec.check('LP2-2 force-failed lists the run as unconfirmed and offers Force exit', (state.unconfirmedRunIds ?? []).includes(run) && (state.choices ?? []).includes('force'), state);
    }
    await L.sleep(1000);
    const cliAlive = L.tasklistAlive(cli?.pid);
    const cmdAlive = hit ? L.tasklistAlive(hit.pid) : null;
    const all = L.processes();
    const survivors = all.filter((p) => (p.CommandLine ?? '').includes(marker) && !/Get-CimInstance/.test(p.CommandLine ?? '')).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name }));
    rec.log('processes after force', { cli: cli ? L.tasklistLine(cli.pid) : null, command: hit ? L.tasklistLine(hit.pid) : null, markerProcesses: survivors });
    rec.check('LP2-3 the Codex CLI process is gone after force', !cliAlive, cli?.pid);
    rec.observe('LP2-3 did the command process survive the force?', { survived: cmdAlive, markerProcesses: survivors });
    if (outcome === 'force-failed') {
      const ack = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } });
      const code = await g.waitExit(20_000);
      rec.log('Force exit (acknowledge failed cleanup)', { ack: ack.status, code });
      rec.check('LP2-4 Force exit after force-failed exits 1 and keeps the lock', code === 1 && fs.existsSync(path.join(dir, 'graphgoblin.lock')), code);
    } else {
      const code = await g.waitExit(20_000);
      rec.check('LP2-4 the gateway exits 0 after a successful force and releases its lock', code === 0 && !fs.existsSync(path.join(dir, 'graphgoblin.lock')), code);
    }
    // End any surviving command process ourselves, by PID only.
    for (const s of survivors) rec.log('ending surviving command process by PID', { pid: s.pid, ended: L.endPid(s.pid) });
    if (survivors.length) {
      await L.sleep(500);
      rec.log('after ending survivors', survivors.map((s) => L.tasklistLine(s.pid)));
    }
    g.copyLog(`${rec.name}-gateway-a.log.txt`);

    // ---- LP-3: the provider-side history stops growing ----
    const watch = [];
    for (let i = 0; i < 12; i++) {
      watch.push({ s: (Date.now() - forceAt) / 1000, ...rolloutFacts(rollout) });
      await L.sleep(5000);
    }
    const firstAfter = watch[0];
    const lastAfter = watch.at(-1);
    rec.log('rollout watch after force (60 s)', { rollout: rollout ? path.basename(rollout) : null, before, watch: watch.map(({ s, bytes, mtime, lines }) => ({ s, bytes, mtime, lines })), lastKinds: lastAfter.lastKinds });
    if (!fake) {
      rec.check('LP3-1 the Codex session history (rollout) exists for this thread', before.exists === true, before);
      rec.check('LP3-1 the session history does not grow after the force (60 s)', lastAfter.bytes === firstAfter.bytes && lastAfter.mtime === firstAfter.mtime, { first: firstAfter.bytes, last: lastAfter.bytes });
      rec.observe('LP3-1 last recorded rollout entry kinds (types only)', { before: before.lastKinds, after: lastAfter.lastKinds, turnContexts: lastAfter.turnContexts });
      const codexLeft = L.processes().filter((p) => /codex/i.test(p.Name) && (p.CommandLine ?? '').toLowerCase().includes(dir.toLowerCase()));
      rec.check('LP3-1 no Codex process for this store remains', codexLeft.length === 0, codexLeft.map((p) => p.ProcessId));
    }
    const r = await L.startGateway({ dir, port: 6642, label: 'lp2-r', env, rec });
    gateways.push(r);
    const after = (await r.call(`/runs/${run}`)).json;
    const evs = await L.events(r.call, run);
    const calls = L.providerCalls(evs);
    for (const t of calls) rec.turn({ check: 'LP-2/LP-3', provider: 'codex', model: 'gpt-6-luna', effort: 'low', run, ...t, fake: fakeMode });
    const progressAfterForce = evs.filter((e) => e.type === 'node.progress' && Date.parse(e.ts) > forceAt).length;
    rec.log('run after restart', { status: after.status, failure: after.failure, resume: after.recovery?.resume, events: evs.map((e) => e.type) });
    const code = after.failure?.code;
    rec.check(
      'LP2-5 the run records the interruption truthfully (RUN_INTERRUPTED_BY_STOP if released, HARNESS_TERMINATION_UNCONFIRMED if force-failed), non-resumable',
      after.status === 'failed' && after.failure?.resumable === false && (outcome === 'released' ? code === 'RUN_INTERRUPTED_BY_STOP' : code === 'HARNESS_TERMINATION_UNCONFIRMED'),
      after.failure,
    );
    rec.check('LP3-2 no further output arrived for the run after the force', progressAfterForce === 0, progressAfterForce);
    rec.check('LP2-5 exactly one provider turn (nothing re-ran after restart)', calls.length === 1, calls);
    const code2 = await r.stop();
    rec.check('LP2-6 the restarted gateway drains to exit 0', code2 === 0, code2);
    r.copyLog(`${rec.name}-gateway-b.log.txt`);
  }
} catch (error) {
  rec.check(`${which} completed without exception`, false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish({ marker });
  L.cleanupStore(dir, rec);
}
