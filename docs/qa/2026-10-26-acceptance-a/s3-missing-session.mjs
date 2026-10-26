// #265 missing provider sessions through the built API, real adapters and the recording fake CLIs:
// removed sessions, declined recovery across restart, stale/concurrent choices, the explicit fresh
// choice, native init-then-refusal and wrong-identity replies, and a child run's missing session.
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
const dataDir = join(ROOT, 'data-s3');
const PORT = 6442;
let api = await startApi({ name: 's3', port: PORT, dataDir });
const restart = async (label) => {
  await api.kill();
  api = await startApi({ name: 's3-' + label, port: PORT, dataDir });
};
const worker = (all, runId) => byMarker(all, `WORKER run=${runId} `).map(summarize);

function holdLoop(name, harness, session, extraNodes = [], firstEdge = edge('s-w', 'start', 'worker')) {
  const node = inference(
    'worker',
    harness,
    session,
    'WORKER run={{ run.id }} visit={{ counters.nodeVisits.worker }} authored task.',
  );
  node.config.effort = 'medium';
  return loop(
    name,
    [
      node,
      ...extraNodes,
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue', exposeTo: ['api'] } },
      gate('again', 3),
    ],
    [
      firstEdge,
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
const removeSession = (id) => rm(join(CLI, 'sessions', id));

try {
  await resetCli();

  // A. resume-own, both families: removed session, declined recovery, restart, stale and
  // concurrent choices, then the explicit fresh-session choice.
  for (const harness of ['codex', 'claude']) {
    const loopId = await createPublished(api.base, holdLoop(`missing own ${harness}`, harness, { policy: 'resume-own' }));
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['waiting']);
    const v1 = worker(await requests(), run.id)[0];
    await removeSession(v1.sessionId);
    await answer(run.id);
    const failed = await waitRun(api.base, run.id, ['failed', 'succeeded']);
    await delay(2000);
    const afterFailure = worker(await requests(), run.id);
    const evs = await events(api.base, run.id);
    const failedEvent = evs.findLast((e) => e.type === 'run.failed');
    const visit2Sessions = evs.filter((e) => e.type === 'harness.session' && e.seq > evs.findLast((x) => x.type === 'node.started' && x.nodeId === 'worker').seq);
    const sessions = await get(api.base, `/runs/${run.id}/sessions`);
    const plainResume = await call(api.base, 'POST', `/runs/${run.id}/resume`, {});
    const ms = failed.failure?.missingSession;
    evidence[`own-${harness}-failure`] = {
      failure: failed.failure,
      requests: afterFailure,
      visit2HarnessSessionEvents: visit2Sessions,
      sessions: sessions.items,
      plainResume,
      failedEventSeq: failedEvent?.seq,
    };
    check(
      `265-own-${harness}-clear-cause`,
      `${harness}: removed own session stops the run with HARNESS_SESSION_MISSING naming the handle, its origin and the fresh-session choice`,
      failed.status === 'failed' &&
        failed.failure.code === 'HARNESS_SESSION_MISSING' &&
        failed.failure.resumable === false &&
        failed.failure.message.includes(v1.sessionId) &&
        /resume-own/.test(failed.failure.message) &&
        /Start fresh session/.test(failed.failure.message) &&
        ms?.sessionId === v1.sessionId &&
        ms?.origin === 'resume-own' &&
        ms?.harness === harness &&
        ms?.model === v1.model &&
        ms?.effort === 'medium',
      failed.failure,
    );
    check(
      `265-own-${harness}-no-silent-fallback`,
      `${harness}: exactly one refused resume of the old handle; no fresh fallback turn and no resumed-session claim`,
      afterFailure.length === 2 &&
        afterFailure[1].mode === 'resume' &&
        afterFailure[1].outcome === 'refused-missing' &&
        !visit2Sessions.some((e) => e.mode === 'resumed'),
      { afterFailure, visit2Sessions },
    );
    check(`265-own-${harness}-plain-resume-refused`, `${harness}: plain Resume is refused (409)`, plainResume.status === 409, plainResume.body);

    // Declined: leave it, restart the gateway, nothing runs and the failure is unchanged.
    await delay(1500);
    await restart(`decline-${harness}`);
    await delay(2500);
    const afterRestart = await get(api.base, `/runs/${run.id}`);
    const requestsAfterRestart = worker(await requests(), run.id);
    const resumeAfterRestart = await call(api.base, 'POST', `/runs/${run.id}/resume`, {});
    check(
      `265-own-${harness}-declined-restart`,
      `${harness}: a declined choice survives a hard restart unchanged: still failed, same failure, no provider call, Resume still refused`,
      afterRestart.status === 'failed' &&
        JSON.stringify(afterRestart.failure) === JSON.stringify(failed.failure) &&
        requestsAfterRestart.length === 2 &&
        resumeAfterRestart.status === 409,
      { status: afterRestart.status, calls: requestsAfterRestart.length, resume: resumeAfterRestart.status },
    );

    // Stale and wrong choices are refused.
    const wrongNode = await call(api.base, 'POST', `/runs/${run.id}/recover-session`, { nodeId: 'hold', failureSeq: failedEvent.seq });
    const staleSeq = await call(api.base, 'POST', `/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq: failedEvent.seq - 1 });
    // Two concurrent valid choices: exactly one wins.
    const [first, second] = await Promise.all([
      call(api.base, 'POST', `/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq: failedEvent.seq }),
      call(api.base, 'POST', `/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq: failedEvent.seq }),
    ]);
    const statuses = [first.status, second.status].sort();
    check(
      `265-own-${harness}-stale-concurrent`,
      `${harness}: wrong node and stale failure sequence are refused; of two concurrent choices one succeeds and one is refused`,
      wrongNode.status >= 400 && staleSeq.status === 409 && statuses.join() === '200,409',
      { wrongNode: [wrongNode.status, wrongNode.body?.code], staleSeq: [staleSeq.status, staleSeq.body?.code], concurrent: statuses },
    );

    // After the choice: a fresh conversation for this visit, the original authored task, model and effort.
    await waitRun(api.base, run.id, ['waiting']);
    await answer(run.id); // visit 3 resumes the recovered conversation normally
    await answer(run.id);
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const all = worker(await requests(), run.id);
    const evs2 = await events(api.base, run.id);
    const resumed = evs2.filter((e) => e.type === 'run.resumed');
    const repeat = await call(api.base, 'POST', `/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq: failedEvent.seq });
    evidence[`own-${harness}-recovered`] = { requests: all, resumedEvents: resumed, status: finished.status, repeat: repeat.status };
    const fs = resumed[0]?.freshSession;
    check(
      `265-own-${harness}-fresh-choice`,
      `${harness}: the explicit choice starts one fresh conversation with the original authored task, model and effort, records loss of the prior handle, and later visits resume the new conversation`,
      finished.status === 'succeeded' &&
        resumed.length === 1 &&
        fs?.nodeId === 'worker' &&
        fs?.sessionId === v1.sessionId &&
        fs?.priorContextCarried === false &&
        fs?.model === v1.model &&
        fs?.effort === 'medium' &&
        resumed[0].actor &&
        all.length === 4 &&
        all[2].mode === 'fresh' &&
        all[2].prompt === afterFailure[1].prompt &&
        all[2].model === v1.model &&
        all[2].effort === 'medium' &&
        all[3].mode === 'resume' &&
        all[3].resumeId === all[2].sessionId &&
        repeat.status === 409,
      { all, fs },
    );
  }

  // B. resume-previous (inherited handle) missing, Codex.
  {
    const warm = inference('warm', 'codex', { policy: 'fresh' }, 'WARM run={{ run.id }} earlier context.');
    const def = holdLoop('missing previous', 'codex', { policy: 'resume-previous' }, [warm], edge('s-warm', 'start', 'warm'));
    def.edges.push(edge('warm-w', 'warm', 'worker'));
    const loopId = await createPublished(api.base, def);
    const run = await startRun(api.base, loopId);
    const failed = await waitRun(api.base, run.id, ['waiting', 'failed']);
    // The worker's first visit resumes warm's session: remove the worker's (latest) session before visit 2.
    const before = worker(await requests(), run.id);
    let detail = { firstStatus: failed.status, before };
    if (failed.status === 'waiting') {
      await removeSession(before[0].sessionId);
      await answer(run.id);
      const end = await waitRun(api.base, run.id, ['failed', 'succeeded']);
      detail = { ...detail, failure: end.failure, after: worker(await requests(), run.id) };
    }
    evidence['previous-codex'] = detail;
    check(
      '265-previous-codex',
      'resume-previous: a missing inherited handle stops with HARNESS_SESSION_MISSING naming the handle and origin resume-previous; no fresh fallback',
      detail.failure?.code === 'HARNESS_SESSION_MISSING' &&
        detail.failure.missingSession?.origin === 'resume-previous' &&
        detail.failure.message.includes(before[0].sessionId) &&
        detail.after.length === 2 &&
        detail.after[1].outcome === 'refused-missing',
      detail,
    );
  }

  // C/D. Native replies that initialize the requested handle and then refuse it, or answer with a
  // different conversation id: neither may become a durable reuse claim.
  for (const mode of ['init-then-missing', 'different-id'])
    for (const harness of ['codex', 'claude']) {
      const loopId = await createPublished(api.base, holdLoop(`${mode} ${harness}`, harness, { policy: 'resume-own' }));
      const run = await startRun(api.base, loopId);
      await waitRun(api.base, run.id, ['waiting']);
      await control('resume-mode.txt', mode);
      await answer(run.id);
      const end = await waitRun(api.base, run.id, ['failed', 'succeeded', 'waiting']);
      await control('resume-mode.txt');
      const evs = await events(api.base, run.id);
      const lastStart = evs.findLast((e) => e.type === 'node.started' && e.nodeId === 'worker').seq;
      const visit2 = evs.filter((e) => e.seq > lastStart && e.type.startsWith('harness.'));
      const sessions = await get(api.base, `/runs/${run.id}/sessions`);
      const reqs = worker(await requests(), run.id);
      evidence[`${mode}-${harness}`] = {
        status: end.status,
        failure: end.failure,
        visit2HarnessEvents: visit2,
        sessions: sessions.items,
        requests: reqs,
      };
      const resumedClaims = visit2.filter((e) => e.type === 'harness.session' && e.mode === 'resumed');
      check(
        `265-${mode}-${harness}`,
        `${harness} ${mode}: the run stops explicitly without a resumed-session claim and without a fresh fallback turn`,
        end.status === 'failed' &&
          resumedClaims.length === 0 &&
          reqs.length === 2 &&
          (mode === 'different-id' && harness === 'claude'
            ? end.failure.code === 'HARNESS_PROTOCOL_ERROR' || end.failure.code === 'HARNESS_SESSION_MISSING'
            : end.failure.code === 'HARNESS_SESSION_MISSING'),
        { code: end.failure?.code, resumable: end.failure?.resumable, resumedClaims, calls: reqs.length },
      );
    }

  // E. A child run's missing session: recover the child, then explicitly Resume the parent.
  {
    const childDef = holdLoop('missing child', 'codex', { policy: 'resume-own' });
    const childId = await createPublished(api.base, childDef);
    const parentDef = loop(
      'missing parent',
      [{ id: 'sub', kind: 'subloop', label: 'sub', config: { loopRef: { loopId: childId, version: 'latest' } } }],
      [edge('s-sub', 'start', 'sub'), edge('sub-done', 'sub', 'done')],
    );
    const parentId = await createPublished(api.base, parentDef);
    const parent = await startRun(api.base, parentId);
    let child;
    for (let i = 0; i < 200 && !child; i += 1) {
      child = (await get(api.base, `/runs?parent=${parent.id}`)).items[0];
      if (!child) await delay(100);
    }
    await waitRun(api.base, child.id, ['waiting']);
    const v1 = worker(await requests(), child.id)[0];
    await removeSession(v1.sessionId);
    await answer(child.id);
    const childFailed = await waitRun(api.base, child.id, ['failed']);
    const parentFailed = await waitRun(api.base, parent.id, ['failed', 'waiting', 'running'], 30_000);
    const parentResumeEarly = await call(api.base, 'POST', `/runs/${parent.id}/resume`, {});
    const childFailedSeq = (await events(api.base, child.id)).findLast((e) => e.type === 'run.failed').seq;
    const choice = await call(api.base, 'POST', `/runs/${child.id}/recover-session`, { nodeId: 'worker', failureSeq: childFailedSeq });
    await waitRun(api.base, child.id, ['waiting', 'succeeded', 'failed']);
    const parentResumeLater = await call(api.base, 'POST', `/runs/${parent.id}/resume`, {});
    // Drive the child to completion and let the parent finish.
    for (let i = 0; i < 4; i += 1) {
      const state = await waitRun(api.base, child.id, ['waiting', 'succeeded', 'failed']);
      if (state.status !== 'waiting') break;
      await answer(child.id);
    }
    const parentEnd = await waitRun(api.base, parent.id, ['succeeded', 'failed'], 60_000);
    const childReqs = worker(await requests(), child.id);
    evidence.child = {
      childFailure: childFailed.failure,
      parentStatusAfterChildFailure: parentFailed.status,
      parentFailure: parentFailed.failure,
      parentResumeEarly,
      choice: choice.status,
      parentResumeLater: { status: parentResumeLater.status, body: parentResumeLater.body?.code ?? parentResumeLater.body?.status },
      parentEnd: parentEnd.status,
      parentEndFailure: parentEnd.failure,
      childRequests: childReqs,
    };
    check(
      '265-child',
      'a child\'s missing session fails the parent with a clear cause; parent Resume is refused until the child\'s explicit fresh choice, then the parent completes',
      childFailed.failure.code === 'HARNESS_SESSION_MISSING' &&
        parentFailed.status === 'failed' &&
        parentResumeEarly.status === 409 &&
        choice.status === 200 &&
        parentResumeLater.status === 200 &&
        parentEnd.status === 'succeeded' &&
        childReqs[2]?.mode === 'fresh',
      evidence.child,
    );
  }
} finally {
  await api.kill();
  await saveJson('s3-missing-session-results.json', { checks, evidence });
}
const failedChecks = checks.filter((c) => !c.pass);
console.log(`${checks.length - failedChecks.length}/${checks.length} checks passed`);
process.exitCode = failedChecks.length ? 1 : 0;
