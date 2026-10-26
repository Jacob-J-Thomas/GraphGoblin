// Follow-up to s3: (a) Claude wrong-identity resume with a live CLI process (the s3 fixture exited
// immediately after its init line); (b) a child run's missing session, waiting for the parent's
// own outcome instead of accepting its parked state.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CLI,
  ROOT,
  byMarker,
  call,
  control,
  createPublished,
  edge,
  events,
  gate,
  get,
  inference,
  loop,
  post,
  requests,
  resetCli,
  saveJson,
  startApi,
  startRun,
  summarize,
  waitRun,
} from './lib.mjs';

const checks = [];
function check(id, description, pass, detail) {
  checks.push({ id, description, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${description}`);
  if (!pass) console.log('  detail: ' + JSON.stringify(detail));
}
const evidence = {};
const api = await startApi({ name: 's3b', port: 6443, dataDir: join(ROOT, 'data-s3b') });
const worker = (all, runId) => byMarker(all, `WORKER run=${runId} `).map(summarize);
function holdLoop(name, harness) {
  return loop(
    name,
    [
      inference('worker', harness, { policy: 'resume-own' }, 'WORKER run={{ run.id }} visit={{ counters.nodeVisits.worker }} authored task.'),
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue', exposeTo: ['api'] } },
      gate('again', 3),
    ],
    [
      edge('s-w', 'start', 'worker'),
      edge('w-h', 'worker', 'hold'),
      edge('h-g', 'hold', 'again'),
      edge('g-w', 'again', 'worker', 'repeat'),
      edge('g-limit', 'again', 'done', 'limit-reached'),
      edge('g-finish', 'again', 'done', 'finish'),
    ],
  );
}
async function answer(runId) {
  const run = await waitRun(api.base, runId, ['waiting', 'failed', 'succeeded']);
  if (run.status === 'waiting') await post(api.base, `/runs/${runId}/input`, { waitId: run.waiting.waitId, input: 'go' });
  return run;
}
try {
  await resetCli();
  // (a) Claude wrong-identity resume while the CLI process is still alive.
  {
    const loopId = await createPublished(api.base, holdLoop('different-id live claude', 'claude'));
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['waiting']);
    await control('resume-mode.txt', 'different-id');
    await control('linger-ms.txt', 3000);
    await answer(run.id);
    const end = await waitRun(api.base, run.id, ['failed', 'succeeded', 'waiting']);
    await control('resume-mode.txt');
    await control('linger-ms.txt');
    const evs = await events(api.base, run.id);
    const lastStart = evs.findLast((e) => e.type === 'node.started' && e.nodeId === 'worker').seq;
    const visit2 = evs.filter((e) => e.seq > lastStart && e.type.startsWith('harness.'));
    const reqs = worker(await requests(), run.id);
    evidence['different-id-live-claude'] = { status: end.status, failure: end.failure, visit2HarnessEvents: visit2, requests: reqs };
    check(
      '265-different-id-claude-live',
      // First expectation (HARNESS_PROTOCOL_ERROR) was wrong: the engine applies #244's inherited-handle
      // rule to the unaccepted turn, so the observed explicit outcome is HARNESS_DELIVERY_UNCERTAIN
      // carrying the identity-mismatch cause. Recorded as observed; see README.
      'claude wrong-identity resume (live process): explicit non-resumable failure naming the identity mismatch, no resumed-session claim, no fresh fallback',
      end.status === 'failed' &&
        end.failure.resumable === false &&
        /does not match the requested session/.test(end.failure.message) &&
        !visit2.some((e) => e.type === 'harness.session' && e.mode === 'resumed') &&
        reqs.length === 2,
      { code: end.failure?.code, message: end.failure?.message, resumable: end.failure?.resumable },
    );
  }
  // (b) Child run missing session.
  {
    const childId = await createPublished(api.base, holdLoop('missing child', 'codex'));
    const parentId = await createPublished(
      api.base,
      loop(
        'missing parent',
        [{ id: 'sub', kind: 'subloop', label: 'sub', config: { loopRef: { loopId: childId, version: 'latest' } } }],
        [edge('s-sub', 'start', 'sub'), edge('sub-done', 'sub', 'done')],
      ),
    );
    const parent = await startRun(api.base, parentId);
    let child;
    for (let i = 0; i < 200 && !child; i += 1) {
      child = (await get(api.base, `/runs?parent=${parent.id}`)).items[0];
      if (!child) await delay(100);
    }
    await waitRun(api.base, child.id, ['waiting']);
    const v1 = worker(await requests(), child.id)[0];
    await rm(join(CLI, 'sessions', v1.sessionId));
    await answer(child.id);
    const childFailed = await waitRun(api.base, child.id, ['failed']);
    let parentAfter;
    try {
      parentAfter = await waitRun(api.base, parent.id, ['failed', 'succeeded', 'cancelled'], 20_000);
    } catch {
      parentAfter = await get(api.base, `/runs/${parent.id}`);
    }
    const parentResumeEarly = await call(api.base, 'POST', `/runs/${parent.id}/resume`, {});
    const childFailedSeq = (await events(api.base, child.id)).findLast((e) => e.type === 'run.failed').seq;
    const choice = await call(api.base, 'POST', `/runs/${child.id}/recover-session`, { nodeId: 'worker', failureSeq: childFailedSeq });
    const childAfterChoice = await waitRun(api.base, child.id, ['waiting', 'succeeded', 'failed']);
    const parentBeforeResume = await get(api.base, `/runs/${parent.id}`);
    const parentResumeLater = await call(api.base, 'POST', `/runs/${parent.id}/resume`, {});
    for (let i = 0; i < 4; i += 1) {
      const state = await waitRun(api.base, child.id, ['waiting', 'succeeded', 'failed']);
      if (state.status !== 'waiting') break;
      await answer(child.id);
    }
    const parentEnd = await waitRun(api.base, parent.id, ['succeeded', 'failed'], 60_000);
    const children = (await get(api.base, `/runs?parent=${parent.id}`)).items.map((c) => ({ id: c.id, status: c.status }));
    const parentEvents = (await events(api.base, parent.id)).map((e) => ({ seq: e.seq, type: e.type, nodeId: e.nodeId, code: e.failure?.code }));
    evidence.child = {
      childFailure: childFailed.failure,
      parentAfterChildFailure: { status: parentAfter.status, failure: parentAfter.failure },
      parentResumeEarly: { status: parentResumeEarly.status, body: parentResumeEarly.body },
      choice: choice.status,
      childAfterChoice: childAfterChoice.status,
      parentBeforeResume: parentBeforeResume.status,
      parentResumeLater: { status: parentResumeLater.status, body: parentResumeLater.body?.status ?? parentResumeLater.body },
      parentEnd: { status: parentEnd.status, failure: parentEnd.failure },
      children,
      parentEvents,
      childRequests: worker(await requests(), child.id),
    };
    check(
      '265-child-parent-fails',
      'a child\'s missing session fails the parent with a cause that points at the child',
      parentAfter.status === 'failed' && parentAfter.failure?.code === 'HARNESS_SESSION_MISSING',
      evidence.child.parentAfterChildFailure,
    );
    check(
      '265-child-recovery-order',
      'parent Resume is refused before the child\'s explicit choice and accepted after it; the same child completes and the parent succeeds',
      parentResumeEarly.status === 409 &&
        choice.status === 200 &&
        parentResumeLater.status === 200 &&
        parentEnd.status === 'succeeded' &&
        children.length === 1,
      evidence.child,
    );
  }
} finally {
  await api.kill();
  await saveJson('s3b-missing-session-followup-results.json', { checks, evidence });
}
const failedChecks = checks.filter((c) => !c.pass);
console.log(`${checks.length - failedChecks.length}/${checks.length} checks passed`);
process.exitCode = failedChecks.length ? 1 : 0;
