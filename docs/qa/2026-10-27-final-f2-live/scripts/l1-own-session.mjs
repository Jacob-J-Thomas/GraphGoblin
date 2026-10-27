// Check 5 (L1, #33): own-session continuity with the real Codex (gpt-6-luna, low) and Claude
// (claude-haiku-5-5, low) CLIs. One worker/reviewer/worker loop per harness:
//   start -> worker(resume-own, resetAfterVisits 2) -> gate(maxPasses 3) -repeat-> reviewer(resume-own) -> worker
// The worker learns a nonce only in its first visit's prompt; its second visit must recall it
// from its own resumed conversation; the reviewer must never see it; the third worker visit is
// past the reset boundary and must start a fresh conversation that cannot recall it.
//   node l1-own-session.mjs [codex|claude|both] [--fake]
import crypto from 'node:crypto';
import * as L from './lib.mjs';

const fakeMode = process.argv.includes('--fake');
const which = ['codex', 'claude'].includes(process.argv[2]) ? [process.argv[2]] : ['codex', 'claude'];
const rec = new L.Recorder(`l1-own-session${which.length === 1 ? '-' + which[0] : ''}${fakeMode ? '-dryrun' : ''}`);
const dir = L.makeStore('l1');
const fake = fakeMode ? L.fakeCli(dir) : null;
const env = fake ? { ...fake.env } : {};
const gateways = [];
const MODELS = { codex: 'gpt-6-luna', claude: 'claude-haiku-5-5' };
const words = ['ZEBRA', 'QUILL', 'MAPLE', 'ORBIT', 'CEDAR', 'TULIP', 'RAVEN', 'FJORD', 'COMET', 'BASIL'];
const nonceFor = () => `${words[crypto.randomInt(words.length)]}-${crypto.randomInt(1000, 9999)}-${words[crypto.randomInt(words.length)]}`;

function cycle(harness, nonce) {
  const worker =
    `{% if counters.nodeVisits.worker == 1 %}Remember this secret code for later in this conversation: ${nonce}. Reply with exactly the word STORED and nothing else.` +
    `{% else %}What secret code did I ask you to remember earlier in this conversation? Reply with only the code, or exactly NONE if no code was given in this conversation.{% endif %}`;
  const reviewer = 'You are a reviewer. If any secret code was mentioned earlier in this conversation, reply with only that code; otherwise reply with exactly NONE.';
  return L.loop(
    `F2 L1 own-session ${harness}`,
    [
      L.inferenceNode('worker', { harness, model: MODELS[harness], effort: 'low', template: worker, session: { policy: 'resume-own', resetAfterVisits: 2 } }),
      {
        id: 'again',
        kind: 'decision',
        label: 'Again',
        config: { kind: 'expression', jsonata: '"repeat"', maxPasses: 3, routes: [{ id: 'repeat', label: 'Repeat', repeat: true }, { id: 'finish', label: 'Finish' }] },
      },
      L.inferenceNode('reviewer', { harness, model: MODELS[harness], effort: 'low', template: reviewer, session: { policy: 'resume-own' } }),
    ],
    [
      L.edge('s-w', 'start', 'worker'),
      L.edge('w-g', 'worker', 'again'),
      L.edge('g-r', 'again', 'reviewer', 'repeat'),
      L.edge('r-w', 'reviewer', 'worker'),
      L.edge('g-limit', 'again', 'done', 'limit-reached'),
      L.edge('g-finish', 'again', 'done', 'finish'),
    ],
  );
}

try {
  const g = await L.startGateway({ dir, port: 6644, label: 'l1', env, rec });
  gateways.push(g);
  rec.log('preflight', (await g.call('/harness/preflight')).json);
  for (const harness of which) {
    const nonce = nonceFor();
    const loopId = await L.publishLoop(g.call, cycle(harness, nonce));
    const run = await L.startRun(g.call, loopId);
    const done = await L.waitRun(g.call, run, ['succeeded', 'failed', 'cancelled'], 600_000);
    const evs = await L.events(g.call, run);
    for (const t of L.providerCalls(evs)) rec.turn({ check: 'L1', provider: harness, model: MODELS[harness], effort: 'low', run, ...t, fake: fakeMode });
    const turns = evs.filter((e) => e.type === 'harness.turn').map((e) => ({ seq: e.seq, nodeId: e.nodeId, promptKind: e.promptKind, resume: e.resumeSessionId ?? null, hasNonce: e.prompt.includes(nonce), prompt: e.prompt.replace(nonce, '<NONCE>') }));
    const sessions = evs.filter((e) => e.type === 'harness.session').map((e) => ({ seq: e.seq, nodeId: e.nodeId, sessionId: e.sessionId, mode: e.mode, model: e.model, effort: e.effort }));
    const replies = { worker: L.nodeReplies(evs, 'worker'), reviewer: L.nodeReplies(evs, 'reviewer') };
    const rows = (await g.call(`/runs/${run}/sessions`)).json.items ?? [];
    rec.log(`${harness} run`, {
      run,
      status: done.status,
      failure: done.failure,
      turns,
      sessions,
      replies: { worker: replies.worker.map((r) => r.replace(nonce, '<NONCE>')), reviewer: replies.reviewer.map((r) => r.replace(nonce, '<NONCE>')) },
      sessionRows: rows.map((r) => ({ nodeId: r.nodeId, attempt: r.attempt, sessionId: r.sessionId, status: r.status, model: r.model, effort: r.effort })),
    });
    const wt = turns.filter((t) => t.nodeId === 'worker');
    const rt = turns.filter((t) => t.nodeId === 'reviewer');
    const ws = sessions.filter((s) => s.nodeId === 'worker');
    const rs = sessions.filter((s) => s.nodeId === 'reviewer');
    const say = (v) => String(v ?? '');
    rec.check(`L1-${harness}-0 the run succeeds with 3 worker and 2 reviewer turns`, done.status === 'succeeded' && wt.length === 3 && rt.length === 2, { status: done.status, failure: done.failure, worker: wt.length, reviewer: rt.length });
    rec.check(`L1-${harness}-1 only the worker's first prompt carries the nonce`, wt[0]?.hasNonce === true && !wt.slice(1).some((t) => t.hasNonce) && !rt.some((t) => t.hasNonce), turns.map((t) => ({ node: t.nodeId, hasNonce: t.hasNonce })));
    rec.check(`L1-${harness}-2 worker visit 2 resumes the worker's own visit-1 conversation`, ws.length >= 2 && ws[0].mode === 'fresh' && wt[1]?.resume === ws[0].sessionId && ws[1]?.mode === 'resumed' && ws[1]?.sessionId === ws[0].sessionId, { ws, resume2: wt[1]?.resume });
    if (!fake) {
      rec.check(`L1-${harness}-3 worker visit 2 recalls the nonce from its own conversation`, say(replies.worker[1]).includes(nonce), replies.worker.map((r) => r.replace(nonce, '<NONCE>')));
      rec.check(`L1-${harness}-4 the reviewer never sees the nonce (both reviewer replies lack it)`, replies.reviewer.length === 2 && replies.reviewer.every((r) => !say(r).includes(nonce)), replies.reviewer);
    }
    rec.check(`L1-${harness}-5 the reviewer keeps its own separate conversation`, rs.length >= 2 && rs[0].mode === 'fresh' && rt[1]?.resume === rs[0].sessionId && rs[0].sessionId !== ws[0]?.sessionId && !rt.some((t) => ws.some((w) => w.sessionId === t.resume)), { rs, reviewerResumes: rt.map((t) => t.resume) });
    rec.check(`L1-${harness}-6 after 2 visits the reset starts a fresh worker conversation on visit 3`, wt[2]?.resume === null && ws.at(-1)?.mode === 'fresh' && ws.at(-1)?.sessionId !== ws[0]?.sessionId, { visit3: wt[2], lastWorkerSession: ws.at(-1) });
    if (!fake) rec.check(`L1-${harness}-7 the fresh visit-3 conversation cannot recall the nonce`, !say(replies.worker[2]).includes(nonce), replies.worker[2]);
    rec.check(`L1-${harness}-8 every turn used the selected model and effort`, sessions.every((s) => s.model === MODELS[harness] && s.effort === 'low'), sessions.map((s) => `${s.model}/${s.effort}`));
  }
  const code = await g.stop();
  rec.check('L1-9 gateway drains to exit 0', code === 0, code);
  g.copyLog(`${rec.name}-gateway.log.txt`);
} catch (error) {
  rec.check('l1 completed without exception', false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
