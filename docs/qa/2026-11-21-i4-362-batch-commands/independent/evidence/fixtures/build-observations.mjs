// Builds observations.json mechanically from the raw evidence. Expected predicates are explicit;
// pass/fail is computed, never hand-entered. Usage: node build-observations.mjs <evidenceRoot>
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const rel = (p) => path.relative(root, p).replaceAll('\\', '/');
const raw = (f) => path.join(root, 'raw', f);
const J = (f) => JSON.parse(fs.readFileSync(raw(f), 'utf8'));
const T = (f) => fs.readFileSync(raw(f), 'utf8');
const exitOf = (f) => Number(/exit=(\d+)/.exec(T(f))?.[1]);

const START_MSG = 'The script process could not start. Resume tries to start it again.';
const TOKEN = 'spawn failed: PROCESS_START_FAILED';
const cases = [];
function add(id, tier, evidenceTier, title, expected, actual, pass, evidence, kind = 'acceptance') {
  cases.push({ id, tier, evidenceTier, kind, title, expected, actual, result: pass ? 'PASS' : 'FAIL', evidence });
}

// ---------------- N0 native Node spawn shape ----------------
const n0 = J('n0-node-spawn-shape.json');
const n0ev = ['raw/n0-node-spawn-shape.json', 'raw/n0-node-spawn-shape.stdout.txt', 'raw/n0-node-spawn-shape.exit.txt', 'fixtures/n0-node-spawn-shape.mjs'];
const n0exit = exitOf('n0-node-spawn-shape.exit.txt');
for (const r of n0.results) {
  const facts = { syncThrow: r.syncThrow, spawnEvent: r.spawnEvent, errorEvent: r.errorEvent?.code ?? null, exit: r.exit, markerExists: r.markerExists, markerContent: r.markerContent, activeResourcesAfter: r.activeResourcesAfter, elapsedMs: r.elapsedMs };
  if (['N0-shim-extensionless', 'N0-missing-exe'].includes(r.name))
    add(r.name, 'N0', 'native-os-process', `raw spawn shell:false: ${r.name}`, 'no synchronous throw; async error ENOENT; no spawn event; no marker', facts, !r.syncThrow && r.errorEvent?.code === 'ENOENT' && !r.spawnEvent && r.markerExists === false, n0ev, 'control');
  else if (['N0-cmdexe-cmd', 'N0-cmdexe-bat', 'N0-node-marker'].includes(r.name))
    add(r.name, 'N0', 'native-os-process', `positive control: ${r.name}`, 'spawn event; exit 0; marker created with "effect\\r\\n" (fixture body is effective when actually executed)', facts, r.spawnEvent && r.exit?.code === 0 && r.markerExists && r.markerContent === 'effect\r\n', n0ev, 'control');
  else
    add(r.name, 'N0', 'native-os-process', `raw spawn shell:false of batch file: ${r.name}`, 'synchronous throw code EINVAL syscall spawn (errno -4071); no spawn event; marker never created', facts, r.syncThrow?.code === 'EINVAL' && r.syncThrow?.syscall === 'spawn' && r.syncThrow?.errno === -4071 && !r.spawnEvent && r.markerExists === false, n0ev);
}
add('N0-resources', 'N0', 'native-os-process', 'no active resources retained after any N0 case; fixture exits on its own', 'every activeResourcesAfter == []; final == []; process exit 0', { exit: n0exit, final: n0.meta.finalActiveResources, perCaseNonEmpty: n0.results.filter((r) => r.activeResourcesAfter.length).map((r) => r.name) }, n0exit === 0 && n0.meta.finalActiveResources.length === 0 && n0.results.every((r) => r.activeResourcesAfter.length === 0), n0ev, 'control');

// ---------------- N1 built ProcessScripts ----------------
const n1 = J('n1-process-scripts.json');
const n1ev = ['raw/n1-process-scripts.json', 'raw/n1-process-scripts.stdout.txt', 'raw/n1-process-scripts.exit.txt', 'fixtures/n1-process-scripts.mjs'];
const notStarted = (stderr) => ({ state: 'definitely-not-started', exitCode: null, stdout: '', stderr, stdoutBytes: 0, stderrBytes: 0, timedOut: false, stdoutOverflow: false, stderrOverflow: false });
const same = (a, b) => JSON.stringify(Object.keys(a).sort().reduce((o, k) => ((o[k] = a[k]), o), {})) === JSON.stringify(Object.keys(b).sort().reduce((o, k) => ((o[k] = b[k]), o), {}));
const n1r = Object.fromEntries(n1.results.map((r) => [r.name, r]));
for (const name of ['N1-cmd', 'N1-bat', 'N1-cmd-upper', 'N1-cmd-timeout30s-stdin']) {
  const r = n1r[name];
  add(name, 'N1', 'native-os-process+built-runner', `built ProcessScripts.run with native batch file: ${name}`, `promise resolves (never rejects/throws) to exactly ${JSON.stringify(notStarted(TOKEN))}; no terminationUnconfirmed; marker absent; no active resources (no leaked timer/pipe)`, { settled: r.settled, result: r.result, elapsedMs: r.elapsedMs, markerExists: r.markerExists, activeResourcesAfterSettle: r.activeResourcesAfterSettle }, r.settled === 'resolved' && same(r.result, notStarted(TOKEN)) && r.markerExists === false && r.activeResourcesAfterSettle.length === 0, n1ev);
}
{
  const r = n1r['N1-cmd-maxStderrBytes0'];
  add('N1-cmd-maxStderrBytes0', 'N1', 'native-os-process+built-runner', 'built runner, native .cmd, caller stderr cap 0', `resolves ${JSON.stringify(notStarted(''))}; marker absent`, { settled: r.settled, result: r.result, markerExists: r.markerExists }, r.settled === 'resolved' && same(r.result, notStarted('')) && r.markerExists === false, n1ev);
}
{
  const r = n1r['N1-missing-exe-timeout30s'];
  add('N1-missing-exe-timeout30s', 'N1', 'native-os-process+built-runner', 'built runner, missing executable control (async ENOENT path), 30 s timeout armed', `resolves ${JSON.stringify(notStarted(TOKEN))}; timeout timer cleared (no active resources)`, { settled: r.settled, result: r.result, activeResourcesAfterSettle: r.activeResourcesAfterSettle }, r.settled === 'resolved' && same(r.result, notStarted(TOKEN)) && r.activeResourcesAfterSettle.length === 0, n1ev, 'control');
}
for (const name of ['N1-cmdexe-cmd', 'N1-node-marker']) {
  const r = n1r[name];
  add(name, 'N1', 'native-os-process+built-runner', `built runner positive control: ${name}`, "state 'completed', exitCode 0, marker created", { result: r.result, markerExists: r.markerExists, markerContent: r.markerContent }, r.settled === 'resolved' && r.result.state === 'completed' && r.result.exitCode === 0 && r.markerExists, n1ev, 'control');
}
{
  const r = n1r['N1-preaborted-node-marker'];
  add('N1-preaborted-node-marker', 'N1', 'native-os-process+built-runner', 'already-aborted signal with an effective node command (cancellation before spawn)', "definitely-not-started without spawning; marker absent", { result: r.result, markerExists: r.markerExists, elapsedMs: r.elapsedMs }, r.result?.state === 'definitely-not-started' && r.markerExists === false, n1ev);
}
{
  const r = n1r['N1-cmd-repeat-200'];
  add('N1-cmd-repeat-200', 'N1', 'native-os-process+built-runner', '200 consecutive native .cmd refusals with 60 s timeout armed each time', 'exactly one distinct result shape (the not-started shape); no active resources afterwards; marker absent', { distinctShapes: r.distinctResultShapes.length, shape: r.distinctResultShapes[0], elapsedMs: r.elapsedMs, rssDeltaBytes: r.rssDeltaBytes, activeResourcesAfterSettle: r.activeResourcesAfterSettle, markerExists: r.markerExists }, r.distinctResultShapes.length === 1 && same(r.distinctResultShapes[0], notStarted(TOKEN)) && r.activeResourcesAfterSettle.length === 0 && r.markerExists === false, n1ev);
}
add('N1-process-exit', 'N1', 'native-os-process+built-runner', 'N1 fixture process exits on its own', 'exit 0; final active resources []', { exit: exitOf('n1-process-scripts.exit.txt'), final: n1.meta.finalActiveResources }, exitOf('n1-process-scripts.exit.txt') === 0 && n1.meta.finalActiveResources.length === 0, n1ev, 'control');

// ---------------- E engine composition ----------------
const e = J('e-engine-composition.json');
const eev = ['raw/e-engine-composition.json', 'raw/e-engine-composition.stdout.txt', 'raw/e-engine-composition.exit.txt', 'fixtures/e-engine-composition.mjs'];
const er = Object.fromEntries(e.results.map((r) => [r.name, r]));
const step = (r, s) => r.steps.find((x) => x.step === s);
function startFailed(s, nDispatch) {
  const f = s.run.failure;
  const d = s.dispatches[nDispatch - 1];
  return s.run.status === 'failed' && f.code === 'SCRIPT_START_FAILED' && f.message === START_MSG && f.resumable === true && f.nodeId === 'script' && f.details === undefined && f.script.state === 'definitely-not-started' && !('exitCode' in f.script) && f.script.visitId === d.visitId && f.script.dispatchId === d.dispatchId && s.dispatches.length === nDispatch && s.scriptProgress.length === 0 && s.scriptFinished.length === 0 && s.markerExists === false && s.recovery.resume.allowed === true && s.recovery.scriptConsent === undefined && s.recovery.replay.find((n) => n.nodeId === 'script')?.action.allowed === true && s.runSchemaValid && s.snapshotSchemaValid && s.eventsSchemaValid;
}
const eFacts = (s) => ({ status: s.run.status, failure: s.run.failure ?? null, dispatches: s.dispatches.map((d) => ({ seq: d.seq, visitId: d.visitId, dispatchId: d.dispatchId })), scriptProgress: s.scriptProgress.length, scriptFinished: s.scriptFinished.length, runFailed: s.failures.length, eventTypes: s.eventTypes, recoveryResume: s.recovery.resume, scriptConsent: s.recovery.scriptConsent ?? null, replayScript: s.recovery.replay.find((n) => n.nodeId === 'script')?.action, markerExists: s.markerExists, schemasValid: [s.runSchemaValid, s.snapshotSchemaValid, s.eventsSchemaValid] });
const EXP_FIRST = `run failed with {code SCRIPT_START_FAILED, message "${START_MSG}", resumable true, nodeId script, script {visitId, dispatchId of the single script.dispatched, state definitely-not-started}, no exitCode, no details}; no node.progress/node.finished for script; recovery.resume allowed, no scriptConsent, replay(script) allowed; marker absent; schemas valid`;
for (const [id, name] of [['E1-cmd-first', 'E1-cmd'], ['E2-bat-first', 'E2-bat'], ['E3-missing-exe-first', 'E3-missing-exe']]) {
  const s = step(er[name], 'first-attempt');
  add(id, 'E', 'engine-public-methods+native-runner', `built RunManager, real runner: ${name} first attempt`, EXP_FIRST, eFacts(s), startFailed(s, 1), eev, name === 'E3-missing-exe' ? 'control' : 'acceptance');
}
{
  const r = er['E1-cmd']; const s = step(r, 'after-manager-restart');
  add('E1-cmd-manager-restart', 'E', 'engine-public-methods+native-runner', 'new RunManager.start() over the failed run (recovery)', 'no runner call; same single dispatch and failure; still SCRIPT_START_FAILED', { runnerCallsDuringRestart: s.runnerCallsDuringRestart, ...eFacts(s) }, s.runnerCallsDuringRestart === 0 && startFailed(s, 1), eev);
}
for (const [id, name] of [['E1-cmd-plain-resume', 'E1-cmd'], ['E2-bat-plain-resume', 'E2-bat']]) {
  const r = er[name]; const s = step(r, 'after-plain-resume');
  add(id, 'E', 'engine-public-methods+native-runner', `${name}: explicit plain Resume (no retryUncertainScript)`, 'resume accepted; exactly 1 runner call; second dispatch keeps visitId with new dispatchId; fails SCRIPT_START_FAILED again with the new dispatchId; marker absent', { resumeResult: s.resumeResult, runnerCallsDuringResume: s.runnerCallsDuringResume, ...eFacts(s) }, s.resumeResult.ok && s.runnerCallsDuringResume === 1 && startFailed(s, 2) && s.dispatches[0].visitId === s.dispatches[1].visitId && s.dispatches[0].dispatchId !== s.dispatches[1].dispatchId && s.failures.length === 2, eev);
  add(`${id.replace('plain-resume', 'stale-resume')}`, 'E', 'engine-public-methods+native-runner', `${name}: Resume with the stale first observation`, 'refused RECOVERY_STALE; no runner call', r.staleResume, r.staleResume.ok === false && r.staleResume.code === 'RECOVERY_STALE' && r.staleResume.runnerCallsDuringStaleResume === 0, eev);
}
for (const [id, name] of [['E4-node-marker', 'E4-node-marker'], ['E5-cmdexe-explicit-shell', 'E5-cmdexe-explicit-shell']]) {
  const s = step(er[name], 'first-attempt');
  add(id, 'E', 'engine-public-methods+native-runner', `positive control ${name}`, 'run succeeded; script node.progress exitCode 0 and node.finished; marker created', eFacts(s), s.run.status === 'succeeded' && s.scriptProgress.length === 1 && s.scriptProgress[0].progress.exitCode === 0 && s.scriptFinished.length === 1 && s.markerExists, eev, 'control');
}
{
  const r = er['E6-cmd-cancel-after-refusal-seam']; const s = step(r, 'first-attempt'); const c = r.runnerCalls[0];
  add('E6-cancel-precedence-seam', 'E-seam', 'engine-public-methods+native-runner+timing-seam', 'real runner refuses natively, then RunManager.cancel() lands before the handler reads the result', 'runner result definitely-not-started (real EINVAL, not injected); run ends cancelled (run.cancel_requested, run.cancelled); no run.failed/SCRIPT_START_FAILED; marker absent', { runnerResult: c.result, signalAbortedOnEntry: c.signalAbortedOnEntry, signalAbortedAfterCancel: c.signalAbortedAfterCancel, ...eFacts(s), cancelEvents: s.cancelled }, c.result.state === 'definitely-not-started' && c.signalAbortedOnEntry === false && c.signalAbortedAfterCancel === true && s.run.status === 'cancelled' && s.failures.length === 0 && s.cancelled.includes('run.cancelled') && s.markerExists === false, eev);
}
{
  const all = e.results.flatMap((r) => r.steps.flatMap((s) => s.loggerLines));
  const steps = JSON.stringify(e.results.map((r) => r.steps));
  add('E-no-internal-error', 'E', 'engine-public-methods+native-runner', 'no INTERNAL_ERROR, raw EINVAL or runner token in any engine-recorded run/event/recovery/log for E cases', 'counts 0; node failed log lines carry SCRIPT_START_FAILED only', { INTERNAL_ERROR: (steps.match(/INTERNAL_ERROR/g) || []).length, EINVAL: (steps.match(/EINVAL/g) || []).length, PROCESS_START_FAILED_inEngineRecords: (steps.match(/PROCESS_START_FAILED/g) || []).length, nodeFailedCodes: [...new Set(all.filter((l) => l.msg === 'node failed').map((l) => l.obj.failure?.code))], exit: exitOf('e-engine-composition.exit.txt') }, !/INTERNAL_ERROR|EINVAL|PROCESS_START_FAILED/.test(steps) && exitOf('e-engine-composition.exit.txt') === 0, eev);
}

// ---------------- A built API ----------------
const a = J('a-api.json');
const aev = ['raw/a-api.json', 'raw/a-api.stdout.txt', 'raw/a-api.exit.txt', 'raw/a-api-server.log', 'fixtures/a-api.mjs'];
const ar = Object.fromEntries(a.results.map((r) => [r.name, r]));
function apiStartFailed(s, n) {
  const f = s.failure;
  const d = s.dispatches[n - 1];
  return s.status === 'failed' && f.code === 'SCRIPT_START_FAILED' && f.message === START_MSG && f.resumable === true && f.nodeId === 'script' && f.details === undefined && f.script.state === 'definitely-not-started' && !('exitCode' in f.script) && f.script.visitId === d.visitId && f.script.dispatchId === d.dispatchId && s.dispatches.length === n && s.scriptProgress.length === 0 && s.scriptFinished === 0 && s.markerExists === false && s.recoveryResume.allowed === true && s.scriptConsent === null && s.replayScript?.allowed === true;
}
const aFacts = (s) => ({ status: s.status, failure: s.failure, dispatches: s.dispatches, scriptProgress: s.scriptProgress.length, scriptFinished: s.scriptFinished, runFailed: s.runFailed.length, eventTypes: s.eventTypes, recoveryResume: s.recoveryResume, scriptConsent: s.scriptConsent, replayScript: s.replayScript, markerExists: s.markerExists, markerContent: s.markerContent });
const http3 = (r) => r.statuses.create === 201 && r.statuses.publish === 200 && r.statuses.run === 202;
for (const [id, name] of [['A1-cmd-first', 'A1-cmd'], ['A2-bat-first', 'A2-bat'], ['A3-missing-exe-first', 'A3-missing-then-repaired-resume']]) {
  const r = ar[name];
  add(id, 'A', 'public-api-http+sqlite+native-runner', `built API POST /loops, /publish, /runs then GET /runs/:id and /events: ${name}`, `HTTP 201/200/202; ${EXP_FIRST}`, { http: r.statuses, command: r.command, ...aFacts(r.first) }, http3(r) && apiStartFailed(r.first, 1), aev, name.startsWith('A3') ? 'control' : 'acceptance');
}
for (const [id, name] of [['A1-cmd-plain-resume', 'A1-cmd'], ['A2-bat-plain-resume', 'A2-bat']]) {
  const r = ar[name]; const s = r.afterResume;
  add(id, 'A', 'public-api-http+sqlite+native-runner', `${name}: POST /runs/:id/resume {observedSeq} without consent flag`, 'HTTP 200; second dispatch same visitId new dispatchId; SCRIPT_START_FAILED again with new dispatchId; 2 run.failed; marker absent', { resumeStatus: r.resumeStatus, ...aFacts(s) }, r.resumeStatus === 200 && apiStartFailed(s, 2) && s.dispatches[0].visitId === s.dispatches[1].visitId && s.dispatches[0].dispatchId !== s.dispatches[1].dispatchId && s.runFailed.length === 2, aev);
}
{
  const r = ar['A1-cmd'];
  add('A1-cmd-stale-resume', 'A', 'public-api-http+sqlite+native-runner', 'POST /runs/:id/resume with the stale first observedSeq', 'HTTP 409 RECOVERY_STALE; lastEventSeq unchanged (no dispatch)', r.staleResume, r.staleResume.status === 409 && r.staleResume.body.code === 'RECOVERY_STALE' && r.staleResume.lastEventSeqAfter === r.afterResume.lastEventSeq, aev);
  const p = r.replay;
  add('A1-cmd-replay-no-consent', 'A', 'public-api-http+sqlite+native-runner', 'POST /runs/:id/replay {nodeId script, observedSeq} without retryUncertainScript', 'HTTP 202; new run records replayOf; it fails SCRIPT_START_FAILED (definitely-not-started) with its own single dispatch; marker absent', { status: p.status, replayOf: p.replayOf, ...aFacts(p.result) }, p.status === 202 && p.replayOf?.runId === r.runId && p.replayOf?.nodeId === 'script' && apiStartFailed(p.result, 1), aev);
}
{
  const r = ar['A3-missing-then-repaired-resume']; const s = r.afterResume;
  add('A3-repaired-explicit-resume', 'A', 'public-api-http+sqlite+native-runner', 'missing executable failed SCRIPT_START_FAILED; owner places a real executable at that path; explicit POST resume', 'HTTP 200; run succeeds; effect happens exactly once, only after the explicit Resume; same visitId, new dispatch', { resumeStatus: r.resumeStatus, ...aFacts(s), copiedExecutableRemoved: r.copiedExecutableRemoved }, r.resumeStatus === 200 && s.status === 'succeeded' && s.markerContent === 'effect\r\n' && r.first.markerExists === false && s.dispatches.length === 2 && s.dispatches[0].visitId === s.dispatches[1].visitId && s.dispatches[0].dispatchId !== s.dispatches[1].dispatchId, aev, 'control');
}
for (const [id, name] of [['A4-node-marker', 'A4-node-marker'], ['A5-cmdexe-explicit-shell', 'A5-cmdexe-explicit-shell']]) {
  const r = ar[name]; const s = r.first;
  add(id, 'A', 'public-api-http+sqlite+native-runner', `positive control ${name}`, 'HTTP 201/200/202; run succeeded; script progress exitCode 0; marker created once', { http: r.statuses, ...aFacts(s) }, http3(r) && s.status === 'succeeded' && s.scriptProgress.length === 1 && s.scriptProgress[0].progress.exitCode === 0 && s.markerContent === 'effect\r\n', aev, 'control');
}
{
  const log = T('a-api-server.log');
  const lines = log.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { nonJson: l }; } });
  const nodeFailed = lines.filter((l) => l.msg === 'node failed');
  add('A-server-log', 'A', 'public-api-http+sqlite+native-runner', 'API process log for all A cases', 'no INTERNAL_ERROR, EINVAL, runner token, stack frames, batch paths or provider activity; every node failed line is SCRIPT_START_FAILED with provenance', { lines: lines.length, nonJson: lines.filter((l) => l.nonJson).length, INTERNAL_ERROR: (log.match(/INTERNAL_ERROR/g) || []).length, EINVAL: (log.match(/EINVAL/g) || []).length, PROCESS_START_FAILED: (log.match(/PROCESS_START_FAILED/g) || []).length, stackFrames: (log.match(/\n\s+at /g) || []).length, batchPaths: (log.match(/refused\.(cmd|bat)/gi) || []).length, provider: (log.match(/codex|claude|ollama/gi) || []).length, nodeFailed: nodeFailed.length, nodeFailedCodes: [...new Set(nodeFailed.map((l) => l.failure?.code))] }, !/INTERNAL_ERROR|EINVAL|PROCESS_START_FAILED|refused\.(cmd|bat)|codex|claude|ollama/i.test(log) && !/\n\s+at /.test(log) && nodeFailed.length === 6 && nodeFailed.every((l) => l.failure?.code === 'SCRIPT_START_FAILED' && l.failure?.script?.state === 'definitely-not-started'), aev);
  add('A-cleanup', 'A', 'public-api-http+sqlite+native-runner', 'API drained via POST /system/shutdown and released its port', 'shutdown 202 draining; exit code 0 without forced kill; port free; /healthz unreachable', { shutdown: a.meta.shutdownRequest, exit: a.meta.exit, forcedKill: a.meta.forcedKillOfExactPid ?? null, portFreeAfterExit: a.meta.portFreeAfterExit, healthAfterExit: a.meta.healthAfterExit, port: a.meta.port, apiPid: a.meta.apiPid, fixtureExit: exitOf('a-api.exit.txt') }, a.meta.shutdownRequest.status === 202 && a.meta.exit.code === 0 && !a.meta.forcedKillOfExactPid && a.meta.portFreeAfterExit === true && String(a.meta.healthAfterExit).startsWith('unreachable') && exitOf('a-api.exit.txt') === 0, [...aev, 'raw/90-cleanup-proof.txt'], 'control');
}

// ---------------- A6 restart ----------------
const a6 = J('a6-api-restart.json');
const a6ev = ['raw/a6-api-restart.json', 'raw/a6-api-restart.stdout.txt', 'raw/a6-api-restart.exit.txt', 'raw/a6-api-restart-server.log', 'fixtures/a6-api-restart.mjs'];
for (const r of a6.results) {
  const refused = r.before.failureCode === 'SCRIPT_START_FAILED';
  add(`A6-${r.name}`, 'A6', 'public-api-http+sqlite+process-restart', `after real API restart on the same store: ${r.name}`, refused ? 'status/lastEventSeq/failure/dispatchId unchanged; no new dispatch or run.failed; resume allowed; no scriptConsent' : 'status/lastEventSeq unchanged', r, r.after.httpStatus === 200 && r.after.status === r.before.status && r.after.lastEventSeq === r.before.lastEventSeq && r.after.failureCode === r.before.failureCode && r.after.dispatchId === r.before.dispatchId && (!refused || (r.after.resume.allowed === true && r.after.scriptConsent === null && r.lastEventType === 'run.failed')), a6ev, refused ? 'acceptance' : 'control');
}
{
  const log = T('a6-api-restart-server.log');
  add('A6-markers-log-cleanup', 'A6', 'public-api-http+sqlite+process-restart', 'restart left effects, log and resources clean', 'markers unchanged (refused runs none; controls once); log has no error-level lines, node failed or dispatch; exit 0 after drain; port free', { markers: a6.meta.markers, errorLines: (log.match(/"level":50/g) || []).length, nodeFailed: (log.match(/node failed/g) || []).length, exit: a6.meta.exit, shutdown: a6.meta.shutdownRequest, portFreeAfterExit: a6.meta.portFreeAfterExit, forcedKill: a6.meta.forcedKillOfExactPid ?? null }, a6.meta.markers['a1-cmd'] === null && a6.meta.markers['a2-bat'] === null && ['a3-missing-then-repaired', 'a4-node-marker', 'a5-cmdexe-explicit-shell'].every((k) => a6.meta.markers[k] === 'effect\r\n') && !/"level":50|node failed/.test(log) && a6.meta.exit.code === 0 && a6.meta.portFreeAfterExit === true && !a6.meta.forcedKillOfExactPid, [...a6ev, 'raw/90-cleanup-proof.txt'], 'control');
}

// ---------------- M mutant control ----------------
const m = J('m-mutant-control.json');
const mev = ['raw/m-mutant-control.json', 'raw/m-mutant-control.stdout.txt', 'fixtures/m-mutant-control.mjs', 'work/m-mutant-scripts.mjs'];
{
  const [m1, m2] = m.results;
  add('M1-mutant-direct', 'M', 'mutant-control(non-production)+native-os-process', 'built runner copy WITHOUT the synchronous catch, native .cmd', 'promise REJECTS with real EINVAL (syscall spawn); marker absent: shows the native refusal is synchronous and the catch is what contains it', m1, m1.settled === 'rejected' && m1.rejection.code === 'EINVAL' && m1.rejection.syscall === 'spawn' && m1.markerExists === false, mev, 'discriminating-control');
  add('M2-mutant-through-current-engine', 'M', 'mutant-control(non-production)+engine-public-methods', 'same mutant through the current built engine', 'SCRIPT_OUTCOME_UNCERTAIN (outcome-uncertain) with SCRIPT_CONSENT_REQUIRED and scriptConsent: proves fixtures distinguish the fixed runner (SCRIPT_START_FAILED) from its absence', m2, m2.failure.code === 'SCRIPT_OUTCOME_UNCERTAIN' && m2.failure.script.state === 'outcome-uncertain' && m2.recoveryResume.code === 'SCRIPT_CONSENT_REQUIRED' && m2.scriptConsent !== null && m2.markerExists === false, mev, 'discriminating-control');
}

// ---------------- H adjacent heartbeat ----------------
{
  const h = J('h-heartbeat-probe.json').results[0];
  const probe = h.lastOutput?.value?.probe;
  cases.push({ id: 'H1-heartbeat-script-probe-cmd', tier: 'H', evidenceTier: 'engine-public-methods+native-runner', kind: 'adjacent-pre-existing-observation', title: 'heartbeat script probe whose command is a native .cmd (not the #362 script-node path)', expected: 'prediction: no INTERNAL_ERROR; run succeeds; probe data exposes exitCode null and the internal token; marker absent', actual: { status: h.status, failure: h.failure, beatResult: h.beats[0]?.result, lastOutputProbe: probe, markerExists: h.markerExists, eventTypes: h.eventTypes }, result: h.status === 'succeeded' && !h.failure && probe?.exitCode === null && probe?.stderr === TOKEN && h.markerExists === false ? 'OBSERVED-AS-PREDICTED' : 'PREDICTION-MISMATCH', evidence: ['raw/h-heartbeat-probe.json', 'raw/h-heartbeat-probe.stdout.txt', 'fixtures/h-heartbeat-probe.mjs'] });
}

// ---------------- U focused existing unit tests (supporting) ----------------
for (const [id, f] of [['U1-infra-scripts', 'u-infra-scripts.log'], ['U2-infra-script-recovery', 'u-infra-script-recovery.log'], ['U3-engine-script-recovery', 'u-engine-script-recovery.log'], ['U4-engine-run-recovery', 'u-engine-run-recovery.log'], ['U5-contracts-script-provenance', 'u-contracts-script-provenance.log'], ['U6-infra-native-verbose', 'u-infra-verbose.log']]) {
  const t = T(f);
  const exits = [...t.matchAll(/exit=(\d+)/g)].map((x) => Number(x[1]));
  const tests = [...t.matchAll(/Tests\s+(.*)/g)].map((x) => x[1].trim());
  const nativeLines = t.split(/\r?\n/).filter((l) => /✓.*(native|EINVAL|spawn failures|fixed spawn)/.test(l)).map((l) => l.trim());
  cases.push({ id, tier: 'U', evidenceTier: 'existing-unit-tests(supporting)', kind: 'supporting', title: t.split(/\r?\n/)[0].replace(/^# /, ''), expected: 'exit 0; all selected tests pass; native win32 tests executed (not skipped) where present', actual: { exits, tests, nativeLines }, result: exits.length > 0 && exits.every((x) => x === 0) && !/\d+ failed/.test(t) ? 'PASS' : 'FAIL', evidence: [`raw/${f}`] });
}

const summary = {};
for (const c of cases) {
  summary[c.kind] ??= {};
  summary[c.kind][c.result] = (summary[c.kind][c.result] ?? 0) + 1;
}
const out = {
  schema: 'gg-qa-observations/1',
  issue: 362,
  worker: 'i4_362_behavior_qa (Claude Opus 5.5, xhigh)',
  generatedAt: new Date().toISOString(),
  source: { repo: 'G:/ggq/gg-i4-362-qa/GraphGoblin', branch: 'codex/gg-i4-362-qa', head: '02351e2fb932b3be44e7cc3fb3943a61d568226c', tree: 'd289bb12b943557584c5659bc33447d1baebc2f6', statusAtStartAndEnd: 'clean', lockfileSha256: '3fda48ff6e5a65af5a280ede5364ea23ae21fb32c068e3e1cf8835c12a0916df' },
  runtime: { node: n0.meta.node, execPath: n0.meta.execPath, platform: n0.meta.platform, arch: n0.meta.arch, os: 'Windows 11 Pro 10.0.26300 (ver: 10.0.26300.9974)', pnpm: '12.8.1' },
  summary,
  cases,
};
fs.writeFileSync(path.join(root, 'observations.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(summary));
for (const c of cases) console.log(`${c.result.padEnd(22)} ${c.kind.padEnd(34)} ${c.id}`);
