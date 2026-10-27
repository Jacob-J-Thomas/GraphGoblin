// Check 6 (L2, #265): a real Codex resume of an unknown conversation and a real Claude resume of an
// unknown session, then the explicit fresh-session choice.
//   start -> worker(resume-own) -> gate(maxPasses 2) -repeat-> hold(wait input) -> worker
// Visit 1 runs fresh for real. While the run is parked at `hold` the gateway is stopped and the
// worker's recorded native handle in this disposable store is replaced by a random UUID the
// provider has never issued (a deliberate test action: the provider no longer knows the
// conversation). After restart the wait is answered: visit 2 must resume that unknown handle for
// real, stop with HARNESS_SESSION_MISSING naming the handle and its origin, with exactly one
// invocation and no "resumed" record. The explicit fresh-session choice (Codex through the API,
// Claude through the inspector button in Edge) must then run one fresh turn with the original
// prompt, model and effort.
//   node l2-missing-session.mjs [codex|claude|both] [--fake]
import crypto from 'node:crypto';
import * as L from './lib.mjs';

const fakeMode = process.argv.includes('--fake');
const which = ['codex', 'claude'].includes(process.argv[2]) ? [process.argv[2]] : ['codex', 'claude'];
const rec = new L.Recorder(`l2-missing-session${which.length === 1 ? '-' + which[0] : ''}${fakeMode ? '-dryrun' : ''}`);
const dir = L.makeStore('l2');
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const PORT = 6645;
const MODELS = { codex: 'gpt-6-luna', claude: 'claude-haiku-5-5' };
let g;
let browser;

function loopFor(harness) {
  return L.loop(
    `F2 L2 missing session ${harness}`,
    [
      L.inferenceNode('worker', { harness, model: MODELS[harness], effort: 'low', template: 'Reply with exactly the word VISIT{{ counters.nodeVisits.worker }} and nothing else.', session: { policy: 'resume-own' } }),
      {
        id: 'again',
        kind: 'decision',
        label: 'Again',
        config: { kind: 'expression', jsonata: '"repeat"', maxPasses: 2, routes: [{ id: 'repeat', label: 'Repeat', repeat: true }, { id: 'finish', label: 'Finish' }] },
      },
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue the L2 check' } },
    ],
    [
      L.edge('s-w', 'start', 'worker'),
      L.edge('w-g', 'worker', 'again'),
      L.edge('g-h', 'again', 'hold', 'repeat'),
      L.edge('h-w', 'hold', 'worker'),
      L.edge('g-limit', 'again', 'done', 'limit-reached'),
      L.edge('g-finish', 'again', 'done', 'finish'),
    ],
  );
}

try {
  g = await L.startGateway({ dir, port: PORT, label: 'l2-1', env, rec });
  const plan = [];
  for (const harness of which) {
    const loopId = await L.publishLoop(g.call, loopFor(harness));
    const run = await L.startRun(g.call, loopId);
    const parked = await L.waitRun(g.call, run, ['waiting', 'failed', 'succeeded'], 240_000);
    rec.check(`L2-${harness}-0 visit 1 ran fresh and the run parked at the input wait`, parked.status === 'waiting' && parked.waiting?.nodeId === 'hold', { status: parked.status, failure: parked.failure, waiting: parked.waiting?.nodeId });
    plan.push({ harness, run });
  }
  // Stop the gateway (durable parks do not hold drain), replace the handles, restart.
  const code1 = await g.stop();
  rec.check('L2-1 the gateway drains to exit 0 with both runs parked', code1 === 0, code1);
  g.copyLog(`${rec.name}-gateway-1.log.txt`);
  await L.withDb(dir, async (db) => {
    for (const p of plan) {
      const before = (await db.execute({ sql: 'SELECT node_id, attempt, harness, session_id, status FROM harness_sessions WHERE run_id = ?', args: [p.run] })).rows;
      p.originalHandle = before.find((r) => r.node_id === 'worker')?.session_id;
      p.unknown = crypto.randomUUID();
      const res = await db.execute({ sql: "UPDATE harness_sessions SET session_id = ? WHERE run_id = ? AND node_id = 'worker'", args: [p.unknown, p.run] });
      rec.log(`${p.harness} handle replaced in the stopped disposable store (test action)`, { run: p.run, rows: before.map((r) => ({ node: r.node_id, attempt: r.attempt, status: r.status })), originalHandle: p.originalHandle, unknownHandle: p.unknown, updated: res.rowsAffected });
    }
  });
  g = await L.startGateway({ dir, port: PORT, label: 'l2-2', env, rec });
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  for (const p of plan) {
    const { harness, run } = p;
    const snap = (await g.call(`/runs/${run}`)).json;
    const before = await L.events(g.call, run);
    const input = await g.call(`/runs/${run}/input`, { method: 'POST', body: { waitId: snap.waiting.waitId, input: { go: true } } });
    rec.log(`${harness} wait answered`, { status: input.status });
    const failed = await L.waitRun(g.call, run, ['failed', 'succeeded', 'cancelled'], 240_000);
    const evs = await L.events(g.call, run);
    const visit2Start = evs.filter((e) => e.type === 'node.started' && e.nodeId === 'worker').at(-1);
    const after2 = evs.filter((e) => e.seq >= visit2Start.seq);
    const turns2 = after2.filter((e) => e.type === 'harness.turn');
    const resumed2 = after2.filter((e) => e.type === 'harness.session' && e.mode === 'resumed');
    const f = failed.failure ?? {};
    rec.log(`${harness} after the unknown resume`, {
      status: failed.status,
      failure: f,
      recovery: { resume: failed.recovery?.resume, replayDefault: failed.recovery?.replayDefault },
      visit2Events: after2.map((e) => e.type),
      turns2: turns2.map((t) => ({ seq: t.seq, resume: t.resumeSessionId ?? null, prompt: t.prompt, promptKind: t.promptKind })),
    });
    rec.check(`L2-${harness}-2 the run stops with HARNESS_SESSION_MISSING`, failed.status === 'failed' && f.code === 'HARNESS_SESSION_MISSING' && f.resumable === false, f);
    rec.check(
      `L2-${harness}-3 the failure names the unknown handle and its origin (resume-own) with model and effort`,
      f.missingSession?.sessionId === p.unknown && f.missingSession?.origin === 'resume-own' && f.missingSession?.harness === harness && f.missingSession?.model === MODELS[harness] && f.missingSession?.effort === 'low' && String(f.message).includes(p.unknown) && String(f.message).includes('resume-own'),
      f.missingSession,
    );
    rec.check(`L2-${harness}-4 exactly one provider invocation for the refused visit, resuming the unknown handle`, turns2.length === 1 && turns2[0].resumeSessionId === p.unknown, turns2.map((t) => t.resumeSessionId));
    rec.check(`L2-${harness}-5 no "resumed" session record for the refused visit`, resumed2.length === 0, resumed2);
    const plain = await g.call(`/runs/${run}/resume`, { method: 'POST', body: { observedSeq: failed.recovery.observedSeq } });
    rec.check(`L2-${harness}-6 plain Resume is refused (SESSION_RECOVERY_REQUIRED)`, plain.status === 409 && failed.recovery?.resume?.code === 'SESSION_RECOVERY_REQUIRED', { status: plain.status, code: plain.json?.code, read: failed.recovery?.resume?.code });
    await page.goto(`${g.origin}/app/runs/${run}`);
    await page.getByText('Failed: HARNESS_SESSION_MISSING').waitFor({ timeout: 20_000 });
    const alert = (await page.locator('body').innerText()).split('Execution limits')[0].slice(0, 2500);
    rec.log(`${harness} inspector before the choice`, alert);
    await L.shot(page, `${rec.name}-${harness}-missing`);
    rec.check(`L2-${harness}-7 the inspector names the handle and origin and offers the fresh-session choice`, alert.includes(p.unknown) && alert.includes('resume-own') && (await page.getByRole('button', { name: 'Start fresh session for worker' }).count()) === 1, null);
    const failureSeq = evs.filter((e) => e.type === 'run.failed').at(-1).seq;
    if (harness === 'codex') {
      const chosen = await g.call(`/runs/${run}/recover-session`, { method: 'POST', body: { nodeId: 'worker', failureSeq } });
      rec.log('codex fresh-session choice through the API', { status: chosen.status });
      rec.check('L2-codex-8 the explicit fresh-session choice is accepted (API)', chosen.status === 200 || chosen.status === 202, chosen.json);
    } else {
      await page.getByRole('button', { name: 'Start fresh session for worker' }).click();
      rec.log('claude fresh-session choice through the inspector button');
    }
    const done = await L.waitRun(g.call, run, ['succeeded', 'failed', 'cancelled'], 240_000);
    const all = await L.events(g.call, run);
    for (const t of L.providerCalls(all)) rec.turn({ check: 'L2', provider: harness, model: MODELS[harness], effort: 'low', run, ...t, fake: fakeMode });
    const resumedEv = all.filter((e) => e.type === 'run.resumed').at(-1);
    const turnsAll = all.filter((e) => e.type === 'harness.turn' && e.nodeId === 'worker');
    const freshTurn = turnsAll.at(-1);
    const refused = turnsAll.at(-2);
    const freshSession = all.filter((e) => e.type === 'harness.session' && e.nodeId === 'worker').at(-1);
    rec.log(`${harness} after the fresh-session choice`, {
      status: done.status,
      failure: done.failure,
      runResumed: resumedEv,
      workerTurns: turnsAll.map((t) => ({ seq: t.seq, resume: t.resumeSessionId ?? null, prompt: t.prompt })),
      lastWorkerSession: freshSession,
      replies: L.nodeReplies(all, 'worker'),
      sessionRows: ((await g.call(`/runs/${run}/sessions`)).json.items ?? []).map((r) => ({ nodeId: r.nodeId, attempt: r.attempt, sessionId: r.sessionId, status: r.status, model: r.model, effort: r.effort })),
    });
    const fs_ = resumedEv?.freshSession ?? resumedEv?.recovery?.freshSession ?? null;
    rec.check(`L2-${harness}-9 one durable run.resumed records the fresh-session choice (node, prior handle, origin, model, effort, no carried context)`, Boolean(resumedEv) && JSON.stringify(resumedEv).includes(p.unknown) && JSON.stringify(resumedEv).includes('"priorContextCarried":false') && JSON.stringify(resumedEv).includes('resume-own'), fs_ ?? resumedEv);
    rec.check(`L2-${harness}-10 exactly one fresh turn followed, with the original prompt, model and effort`, turnsAll.length === 3 && !freshTurn.resumeSessionId && freshTurn.prompt === refused.prompt && freshSession?.mode === 'fresh' && freshSession?.sessionId !== p.unknown && freshSession?.model === MODELS[harness] && freshSession?.effort === 'low', { refused: refused?.prompt, fresh: freshTurn?.prompt, freshSession });
    rec.check(`L2-${harness}-11 the run completes after the fresh turn`, done.status === 'succeeded', { status: done.status, failure: done.failure });
    if (!fake) rec.check(`L2-${harness}-12 the fresh turn answered the visit-2 task`, L.nodeReplies(all, 'worker').at(-1)?.includes('VISIT2'), L.nodeReplies(all, 'worker'));
    await page.goto(`${g.origin}/app/runs/${run}`);
    await page.getByText(/chose a fresh session for worker/).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const note = (await page.locator('body').innerText()).match(/[^\n]*chose a fresh session for worker[^\n]*/)?.[0] ?? null;
    rec.log(`${harness} inspector after the choice`, note);
    await L.shot(page, `${rec.name}-${harness}-recovered`);
    rec.check(`L2-${harness}-13 the inspector keeps a durable note of the choice`, Boolean(note) && note.includes('prior provider context was not carried over'), note);
    void before;
  }
  await browser.close();
  browser = undefined;
  const code2 = await g.stop();
  rec.check('L2-14 gateway drains to exit 0', code2 === 0, code2);
  g.copyLog(`${rec.name}-gateway-2.log.txt`);
} catch (error) {
  rec.check('l2 completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) await g.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
