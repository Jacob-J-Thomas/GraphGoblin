// Check 9 (F1-B1): successful native force of a script tree, outside any sandbox, no provider.
// A parent run awaits a child run whose real script (Node) starts a live descendant process.
// Drain through the API, then explicit force. Verify by PID and process listing that the script
// root and its descendant die; the interruption is recorded truthfully; SSE streams close; the
// gateway exits and releases its lock; after restart Resume is refused and one deliberate parent
// Replay admits exactly one fork while the source history stays unchanged.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('f1b1-native-force');
const PORT = 6640;
const dir = L.makeStore('f1b1');
const fake = L.fakeCli(dir); // no inference node runs; keeps any provider call impossible
const env = { ...fake.env };
const gateways = [];
const marker = path.join(dir, 'effects.jsonl');
const release = path.join(dir, 'release');
const js = (v) => JSON.stringify(v);
const effects = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// The script root records one effect line, starts one descendant that also records its PID, then
// waits for the release file. The descendant also exits on release (and after 10 minutes at most).
const scriptSource = [
  `const fs=require('node:fs'),cp=require('node:child_process');`,
  `fs.appendFileSync(${js(marker)},JSON.stringify({role:'root',pid:process.pid,at:Date.now()})+'\\n');`,
  `const d=cp.spawn(process.execPath,['-e',"const fs=require('node:fs');fs.appendFileSync(process.argv[1],JSON.stringify({role:'descendant',pid:process.pid,at:Date.now()})+'\\\\n');setInterval(()=>{if(fs.existsSync(process.argv[2]))process.exit(0)},200);setTimeout(()=>process.exit(0),600000)",${js(marker)},${js(release)}],{stdio:'ignore'});`,
  `setInterval(()=>{if(fs.existsSync(${js(release)})){process.stdout.write(JSON.stringify({released:true}));process.exit(0)}},200);`,
  `setTimeout(()=>process.exit(0),600000);`,
].join('');

function sse(g, runId) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const state = { runId, open: true, endedAt: null, bytes: 0, error: null, text: '' };
  state.done = fetch(`${g.origin}/runs/${runId}/events?after=0`, {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  })
    .then(async (r) => {
      state.status = r.status;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        state.bytes += value.length;
        state.text += Buffer.from(value).toString('utf8');
      }
    })
    .catch((e) => {
      state.error = String(e?.cause?.code ?? e?.name ?? e);
    })
    .finally(() => {
      state.open = false;
      state.endedAt = Date.now();
      state.msOpen = state.endedAt - startedAt;
    });
  state.abort = () => controller.abort();
  return state;
}

try {
  const g = await L.startGateway({ dir, port: PORT, label: 'f1b1-a', env, rec });
  gateways.push(g);
  const childLoop = await L.publishLoop(
    g.call,
    L.line('F2 force child', [
      { id: 'script', kind: 'script', label: 'Tree script', config: { command: L.NODE, args: ['-e', scriptSource], stdin: 'none', cwd: dir } },
    ]),
  );
  const parentLoop = await L.publishLoop(
    g.call,
    L.line('F2 force parent', [{ id: 'sub', kind: 'subloop', label: 'Await child', config: { loopRef: { loopId: childLoop, version: 'latest' } } }]),
  );
  const parent = await L.startRun(g.call, parentLoop);
  const child = await L.waitFor(async () => (await g.call(`/runs?parent=${parent}`)).json.items?.[0]?.id, { timeoutMs: 30_000 });
  await L.waitFor(() => effects().length === 2, { timeoutMs: 30_000 });
  const fx = effects();
  const rootPid = fx.find((e) => e.role === 'root').pid;
  const descPid = fx.find((e) => e.role === 'descendant').pid;
  const tree = L.descendants(g.pid);
  rec.log('work started', { parent, child, rootPid, descPid, gatewayPid: g.pid, gatewayTree: tree });
  rec.check('B1-0 the script root and its live descendant run under the gateway', tree.some((p) => p.pid === rootPid) && tree.some((p) => p.pid === descPid) && L.tasklistAlive(rootPid) && L.tasklistAlive(descPid), tree.map(({ pid, ppid, name }) => ({ pid, ppid, name })));
  const parentBefore = (await g.call(`/runs/${parent}`)).json;
  const childBefore = (await g.call(`/runs/${child}`)).json;
  rec.log('statuses before drain', { parent: parentBefore.status, child: childBefore.status });

  const streams = [sse(g, parent), sse(g, child)];
  await L.sleep(800);
  rec.check('B1-0 SSE streams are open for parent and child', streams.every((s) => s.open && s.status === 200), streams.map((s) => ({ runId: s.runId, status: s.status, open: s.open })));

  const drain = await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  await L.sleep(1500);
  const draining = await L.shutdownState(g);
  rec.log('after drain', { drain: drain.status, state: draining });
  rec.check('B1-1 API drain starts a normal drain; the script tree keeps running', drain.status === 202 && draining.phase === 'draining' && L.tasklistAlive(rootPid) && L.tasklistAlive(descPid), { phase: draining.phase, active: draining.activeRunIds });
  rec.check('B1-1 active work lists the child run', (draining.activeRunIds ?? []).includes(child), draining.activeRunIds);

  const forceAt = Date.now();
  const force = await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } });
  const phases = [];
  let last;
  for (let i = 0; i < 100; i++) {
    last = await L.shutdownState(g);
    phases.push({ ms: Date.now() - forceAt, phase: last.phase, unconfirmed: last.unconfirmedRunIds });
    if (last.phase === 'gone' || last.phase === 'force-failed') break;
    await L.sleep(100);
  }
  const code = await g.waitExit(20_000);
  const exitMs = Date.now() - forceAt;
  rec.log('force', { force: force.status, phases: phases.filter((p, i, a) => i === 0 || p.phase !== a[i - 1].phase), code, exitMs });
  rec.check('B1-2 explicit force never reaches force-failed', !phases.some((p) => p.phase === 'force-failed'), phases.map((p) => p.phase));
  rec.check('B1-2 the gateway exits 0 after a successful force', code === 0, { code, exitMs });
  await L.sleep(500);
  const all = L.processes();
  const rootAlive = L.tasklistAlive(rootPid);
  const descAlive = L.tasklistAlive(descPid);
  rec.log('process listing after force', {
    root: L.tasklistLine(rootPid),
    descendant: L.tasklistLine(descPid),
    gateway: L.tasklistLine(g.pid),
    storeProcesses: L.storeProcesses(dir, all),
    gatewayDescendants: L.descendants(g.pid, all),
  });
  rec.check('B1-3 the script root is gone (tasklist and CIM)', !rootAlive && !all.some((p) => p.ProcessId === rootPid), L.tasklistLine(rootPid));
  rec.check('B1-3 the live descendant is gone (tasklist and CIM)', !descAlive && !all.some((p) => p.ProcessId === descPid), L.tasklistLine(descPid));
  rec.check('B1-3 no process names the store any more', L.storeProcesses(dir, all).length === 0, L.storeProcesses(dir, all));
  rec.check('B1-4 the gateway released its lock', !fs.existsSync(path.join(dir, 'graphgoblin.lock')), fs.readdirSync(dir));
  await Promise.race([Promise.all(streams.map((s) => s.done)), L.sleep(5000)]);
  rec.check(
    'B1-5 both SSE streams closed by the time the gateway exited',
    streams.every((s) => !s.open && s.endedAt !== null && s.endedAt <= forceAt + exitMs + 1000),
    streams.map((s) => ({ runId: s.runId, open: s.open, msOpen: s.msOpen, closedMsAfterForce: s.endedAt ? s.endedAt - forceAt : null, error: s.error, bytes: s.bytes, lastEvent: (s.text.match(/event: [^\n]+/g) ?? []).at(-1) })),
  );
  g.copyLog('f1b1-gateway-a.log.txt');

  // Restart on the same store.
  const r = await L.startGateway({ dir, port: PORT, label: 'f1b1-b', env, rec });
  gateways.push(r);
  const childAfter = await L.waitRun(r.call, child, ['failed', 'succeeded', 'cancelled'], 30_000);
  const parentAfter = await L.waitRun(r.call, parent, ['failed', 'succeeded', 'cancelled'], 30_000);
  rec.log('after restart', {
    child: { status: childAfter.status, failure: childAfter.failure, recovery: childAfter.recovery },
    parent: { status: parentAfter.status, failure: parentAfter.failure, recovery: { resume: parentAfter.recovery?.resume, replay: parentAfter.recovery?.replay } },
  });
  const f = childAfter.failure ?? {};
  rec.check(
    'B1-6 the child records RUN_INTERRUPTED_BY_STOP, non-resumable, effects may have happened, at the script node',
    childAfter.status === 'failed' && f.code === 'RUN_INTERRUPTED_BY_STOP' && f.resumable === false && f.details?.effectMayHaveHappened === true && (f.nodeId === 'script' || f.details?.nodeId === 'script'),
    f,
  );
  const childEvents = await L.events(r.call, child);
  rec.check('B1-6 no SCRIPT_TERMINATION_UNCONFIRMED anywhere in the child history', !JSON.stringify(childEvents).includes('SCRIPT_TERMINATION_UNCONFIRMED'), childEvents.filter((e) => /failed/.test(e.type)).map((e) => e.failure?.code));
  rec.check('B1-6 the script ran exactly once (one root, one descendant effect line)', effects().length === 2, effects());
  rec.check('B1-7 the parent records the child interruption and is not resumable', parentAfter.status === 'failed' && parentAfter.recovery?.resume?.allowed === false, { failure: parentAfter.failure, resume: parentAfter.recovery?.resume });
  const resumeParent = await r.call(`/runs/${parent}/resume`, { method: 'POST', body: { observedSeq: parentAfter.recovery.observedSeq } });
  const resumeChild = await r.call(`/runs/${child}/resume`, { method: 'POST', body: { observedSeq: childAfter.recovery.observedSeq } });
  rec.log('resume attempts', { resumeParent, resumeChild });
  rec.check('B1-7 parent Resume is refused (409)', resumeParent.status === 409, resumeParent.json);
  rec.check('B1-7 child Resume is refused (409)', resumeChild.status === 409, resumeChild.json);
  const replayChild = await r.call(`/runs/${child}/replay`, { method: 'POST', body: { nodeId: 'script', observedSeq: childAfter.recovery.observedSeq, retryUncertainScript: true } });
  rec.check('B1-8 direct child Replay is refused: recovery belongs to the parent', replayChild.status === 409 && replayChild.json?.code === 'PARENT_RECOVERY_REQUIRED', replayChild.json);

  // One deliberate parent Replay, sent twice at once with the same observed intent.
  fs.writeFileSync(release, 'the fork may finish');
  const sourceEventsBefore = await L.events(r.call, parent);
  const childEventsBefore = await L.events(r.call, child);
  const subReplay = parentAfter.recovery.replay.find((x) => x.nodeId === 'sub');
  rec.log('parent replay decision for sub', subReplay);
  // Attempt 1 showed the server offers parent Replay at `sub` only with explicit script consent
  // (ADR-0061: the path re-runs the child's current uncertain script). Check that refusal first.
  const noConsent = await r.call(`/runs/${parent}/replay`, { method: 'POST', body: { nodeId: 'sub', observedSeq: parentAfter.recovery.observedSeq } });
  rec.check(
    'B1-8 parent Replay without script consent is refused SCRIPT_CONSENT_REQUIRED, as the read offered',
    subReplay?.action?.code === 'SCRIPT_CONSENT_REQUIRED' && noConsent.status === 409 && noConsent.json?.code === 'SCRIPT_CONSENT_REQUIRED',
    noConsent.json,
  );
  const body = { nodeId: 'sub', observedSeq: parentAfter.recovery.observedSeq, retryUncertainScript: true };
  const replies = await Promise.all([
    r.call(`/runs/${parent}/replay`, { method: 'POST', body }),
    r.call(`/runs/${parent}/replay`, { method: 'POST', body }),
  ]);
  rec.log('parent replay replies', replies);
  const statuses = replies.map((x) => x.status).sort();
  const fork = replies.find((x) => x.status === 202)?.json?.run;
  rec.check('B1-8 two identical parent Replay requests admit exactly one fork (202 + 409)', statuses.join() === '202,409' && Boolean(fork), statuses);
  const loser = replies.find((x) => x.status === 409)?.json;
  rec.check('B1-8 the second request names the existing fork', loser?.code === 'RECOVERY_STALE' && (loser?.replayRunId === fork?.id || JSON.stringify(loser).includes(fork?.id ?? '-')), loser);
  if (fork) {
    const forkDone = await L.waitRun(r.call, fork.id, ['succeeded', 'failed', 'cancelled'], 60_000);
    const forkChildren = (await r.call(`/runs?parent=${fork.id}`)).json.items ?? [];
    rec.log('fork', { id: fork.id, status: forkDone.status, failure: forkDone.failure, replayOf: forkDone.replayOf ?? forkDone.recovery?.replayOf, children: forkChildren.map((c) => ({ id: c.id, status: c.status })) });
    rec.check('B1-9 the fork succeeds with one new child run', forkDone.status === 'succeeded' && forkChildren.length === 1 && forkChildren[0].id !== child, { status: forkDone.status, children: forkChildren.map((c) => c.id) });
    rec.check('B1-9 only the fork repeated the script (4 effect lines: 2 source + 2 fork)', effects().length === 4, effects().map((e) => e.role));
  }
  const runsAfter = (await r.call(`/runs?limit=50`)).json.items ?? [];
  const forks = [];
  for (const x of runsAfter) {
    const snap = (await r.call(`/runs/${x.id}`)).json;
    if (snap.recovery?.replayOf?.runId === parent) forks.push({ id: x.id, replayOf: snap.recovery.replayOf });
  }
  rec.check('B1-9 exactly one Replay fork of the parent exists in the store', forks.length === 1 && forks[0].id === fork?.id, { forks, runs: runsAfter.map((x) => x.id) });
  const sourceEventsAfter = await L.events(r.call, parent);
  const childEventsAfter = await L.events(r.call, child);
  rec.check('B1-10 the source parent history is unchanged by the Replay', JSON.stringify(sourceEventsBefore) === JSON.stringify(sourceEventsAfter), { before: sourceEventsBefore.length, after: sourceEventsAfter.length });
  rec.check('B1-10 the source child history is unchanged by the Replay', JSON.stringify(childEventsBefore) === JSON.stringify(childEventsAfter), { before: childEventsBefore.length, after: childEventsAfter.length });
  const parentFinal = (await r.call(`/runs/${parent}`)).json;
  rec.check('B1-10 the source parent stays failed with its interruption', parentFinal.status === 'failed' && parentFinal.failure?.code === parentAfter.failure?.code, parentFinal.failure);
  const code2 = await r.stop();
  rec.check('B1-11 the restarted gateway drains to exit 0 and releases its lock', code2 === 0 && !fs.existsSync(path.join(dir, 'graphgoblin.lock')), code2);
  r.copyLog('f1b1-gateway-b.log.txt');
} catch (error) {
  rec.check('F1-B1 driver completed without exception', false, String(error?.stack ?? error));
} finally {
  fs.writeFileSync(release, 'cleanup');
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
