// #362 independent QA, tier E: built RunManager public methods + @graphgoblin/engine/testing
// in-memory ports, with the scripts port replaced by the REAL built ProcessScripts (real spawn).
// Usage: node e-engine-composition.mjs <repoRoot> <qaRoot> <workDir> <outJson>
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const [repoArg, qaRootArg, workArg, outArg] = process.argv.slice(2);
if (!repoArg || !qaRootArg || !workArg || !outArg) throw new Error('usage: <repo> <qaRoot> <work> <out>');
const repo = path.resolve(repoArg);
const qaRoot = path.resolve(qaRootArg);
const work = path.resolve(workArg);
const inside = (p) => {
  const rel = path.relative(qaRoot, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
if (!inside(work) || !inside(outArg)) throw new Error(`refusing paths outside ${qaRoot}`);
if (fs.existsSync(work)) throw new Error(`work dir already exists: ${work}`);
fs.mkdirSync(work, { recursive: true });

const dist = (p) => pathToFileURL(path.join(repo, p)).href;
const { RunManager } = await import(dist('packages/engine/dist/index.js'));
const { createTestEngine, singleNodeLoop } = await import(dist('packages/engine/dist/testing/index.js'));
const { ProcessScripts } = await import(dist('packages/infrastructure/dist/process/index.js'));
const { RunRecordSchema, RunSnapshotSchema, RunEventSchema } = await import(dist('packages/contracts/dist/index.js'));
const cmdExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
const owner = { kind: 'user', id: 'owner' };

function caseDir(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  return dir;
}
function batch(dir, file, marker) {
  const full = path.join(dir, file);
  fs.writeFileSync(full, `@echo effect>"${marker}"\r\n@exit /b 0\r\n`);
  return full;
}
const scriptNode = (config) => ({ id: 'script', kind: 'script', label: 'Script under test', config });

async function observe(e, manager, runId, marker) {
  const run = await e.ports.runs.get(runId);
  const snapshot = await manager.getSnapshot(runId);
  const events = e.events(runId);
  return {
    run,
    runSchemaValid: RunRecordSchema.safeParse(run).success,
    snapshotSchemaValid: RunSnapshotSchema.safeParse(snapshot).success,
    eventsSchemaValid: events.every((ev) => RunEventSchema.safeParse(ev).success),
    recovery: snapshot.recovery,
    eventTypes: events.map((ev) => `${ev.seq}:${ev.type}${ev.nodeId ? `(${ev.nodeId})` : ''}`),
    dispatches: events.filter((ev) => ev.type === 'script.dispatched'),
    scriptProgress: events.filter((ev) => ev.type === 'node.progress' && ev.nodeId === 'script'),
    scriptFinished: events.filter((ev) => ev.type === 'node.finished' && ev.nodeId === 'script'),
    failures: events.filter((ev) => ev.type === 'run.failed').map((ev) => ({ seq: ev.seq, failure: ev.failure })),
    cancelled: events.filter((ev) => ev.type === 'run.cancelled' || ev.type === 'run.cancel_requested').map((ev) => ev.type),
    markerExists: fs.existsSync(marker),
    markerContent: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null,
    loggerLines: e.ports.logger.lines.map((l) => ({ level: l.level, msg: l.msg, obj: JSON.parse(JSON.stringify(l.obj, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v))) })),
  };
}

async function scenario(name, config, marker, { resume = false, restart = false, seam } = {}) {
  const e = await createTestEngine();
  e.manager.stop();
  const v = e.publish(singleNodeLoop(`e-${name}`, scriptNode(config)));
  const queued = await e.start(v.loopId);
  const real = new ProcessScripts();
  const runnerCalls = [];
  let manager;
  const scripts = {
    async run(request) {
      const call = { command: request.command, args: request.args, signalAbortedOnEntry: request.signal.aborted };
      runnerCalls.push(call);
      const result = await real.run(request);
      call.result = result;
      if (seam === 'cancel-after-refusal') {
        await manager.cancel(queued.id, owner);
        call.signalAbortedAfterCancel = request.signal.aborted;
      }
      return result;
    },
  };
  manager = new RunManager({ ...e.ports, scripts }, e.settings);
  const out = { name, config, runId: queued.id, steps: [] };
  try {
    await manager.start();
    await manager.waitForIdle();
    await sleep(1500);
    out.steps.push({ step: 'first-attempt', runnerCalls: runnerCalls.length, ...(await observe(e, manager, queued.id, marker)) });
    if (restart) {
      manager.stop();
      const before = runnerCalls.length;
      manager = new RunManager({ ...e.ports, scripts }, e.settings);
      await manager.start();
      await manager.waitForIdle();
      await sleep(500);
      out.steps.push({ step: 'after-manager-restart', runnerCallsDuringRestart: runnerCalls.length - before, ...(await observe(e, manager, queued.id, marker)) });
    }
    if (resume) {
      const snap = await manager.getSnapshot(queued.id);
      const before = runnerCalls.length;
      let resumeResult;
      try {
        const r = await manager.resume(queued.id, owner, { observedSeq: snap.recovery.observedSeq });
        resumeResult = { ok: true, status: r.status };
      } catch (error) {
        resumeResult = { ok: false, name: error?.name, code: error?.code, message: error?.message };
      }
      await manager.waitForIdle();
      await sleep(1500);
      out.steps.push({ step: 'after-plain-resume', resumeResult, runnerCallsDuringResume: runnerCalls.length - before, ...(await observe(e, manager, queued.id, marker)) });
      // A stale observation must be refused rather than re-dispatching.
      const stale = snap.recovery.observedSeq;
      const before2 = runnerCalls.length;
      try {
        await manager.resume(queued.id, owner, { observedSeq: stale });
        out.staleResume = { ok: true };
      } catch (error) {
        out.staleResume = { ok: false, code: error?.code, message: error?.message };
      }
      await manager.waitForIdle();
      out.staleResume.runnerCallsDuringStaleResume = runnerCalls.length - before2;
    }
  } finally {
    manager.stop();
  }
  out.runnerCalls = runnerCalls;
  return out;
}

const results = [];
const meta = { tier: 'E-built-engine-composition-real-ProcessScripts', node: process.version, startedAt: new Date().toISOString(), work };

{
  const d = caseDir('cmd'); const m = path.join(d, 'marker.txt');
  results.push(await scenario('E1-cmd', { command: batch(d, 'refused.cmd', m), cwd: d }, m, { resume: true, restart: true }));
}
{
  const d = caseDir('bat'); const m = path.join(d, 'marker.txt');
  results.push(await scenario('E2-bat', { command: batch(d, 'refused.bat', m), cwd: d }, m, { resume: true }));
}
{
  const d = caseDir('missing-exe'); const m = path.join(d, 'marker.txt');
  results.push(await scenario('E3-missing-exe', { command: path.join(d, 'gg362-missing.exe'), cwd: d }, m));
}
{
  const d = caseDir('node-marker'); const m = path.join(d, 'marker.txt');
  results.push(await scenario('E4-node-marker', { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "effect\\r\\n")', m], cwd: d }, m));
}
{
  const d = caseDir('cmdexe-cmd'); const m = path.join(d, 'marker.txt');
  const f = batch(d, 'refused.cmd', m);
  results.push(await scenario('E5-cmdexe-explicit-shell', { command: cmdExe, args: ['/d', '/c', f], cwd: d }, m));
}
{
  const d = caseDir('cancel-seam'); const m = path.join(d, 'marker.txt');
  results.push(await scenario('E6-cmd-cancel-after-refusal-seam', { command: batch(d, 'refused.cmd', m), cwd: d }, m, { seam: 'cancel-after-refusal' }));
}

meta.finishedAt = new Date().toISOString();
meta.finalActiveResources = process.getActiveResourcesInfo();
fs.writeFileSync(outArg, `${JSON.stringify({ meta, results }, null, 2)}\n`);
for (const r of results) {
  for (const s of r.steps) {
    const f = s.run?.failure;
    console.log(
      `${r.name} [${s.step}] status=${s.run?.status} code=${f?.code ?? '-'} resumable=${f?.resumable ?? '-'} node=${f?.nodeId ?? '-'} script=${JSON.stringify(f?.script ?? null)} msg=${JSON.stringify(f?.message ?? null)} details=${f?.details !== undefined} dispatches=${s.dispatches.length} progress=${s.scriptProgress.length} scriptFinished=${s.scriptFinished.length} runFailed=${s.failures.length} cancel=${JSON.stringify(s.cancelled)} marker=${s.markerExists} resume=${JSON.stringify(s.recovery.resume)} consent=${JSON.stringify(s.recovery.scriptConsent ?? null)} replay(script)=${JSON.stringify(s.recovery.replay.find((n) => n.nodeId === 'script')?.action)} schemas=${s.runSchemaValid}/${s.snapshotSchemaValid}/${s.eventsSchemaValid}${s.resumeResult ? ` resumeResult=${JSON.stringify(s.resumeResult)} callsDuringResume=${s.runnerCallsDuringResume}` : ''}${s.runnerCallsDuringRestart !== undefined ? ` callsDuringRestart=${s.runnerCallsDuringRestart}` : ''}`,
    );
  }
  if (r.staleResume) console.log(`${r.name} staleResume=${JSON.stringify(r.staleResume)}`);
}
console.log(`final active resources: ${JSON.stringify(meta.finalActiveResources)}`);
