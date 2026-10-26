// #33 restart, reset-after-N, no hidden reset and interrupted own-session turns, through the built
// API process (hard-killed and restarted on the same store) and the recording fake CLIs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import {
  CLI,
  ROOT,
  byMarker,
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
import { setTimeout as delay } from 'node:timers/promises';

const checks = [];
function check(id, description, pass, detail) {
  checks.push({ id, description, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${description}`);
  if (!pass) console.log('  detail: ' + JSON.stringify(detail));
}
const evidence = {};
const dataDir = join(ROOT, 'data-s2');
const PORT = 6441;
let api = await startApi({ name: 's2', port: PORT, dataDir });
const restart = async (label) => {
  await api.kill();
  api = await startApi({ name: 's2-' + label, port: PORT, dataDir });
};
const runs = (all, runId, role) => byMarker(all, `${role} run=${runId} `).map(summarize);
const holdLoop = (name, harness) =>
  loop(
    name,
    [
      inference(
        'worker',
        harness,
        { policy: 'resume-own' },
        'WORKER run={{ run.id }} visit={{ counters.nodeVisits.worker }} task.',
      ),
      {
        id: 'hold',
        kind: 'wait',
        label: 'Hold',
        config: { mode: 'input', prompt: 'Continue', exposeTo: ['api'] },
      },
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
async function answer(runId) {
  const run = await waitRun(api.base, runId, ['waiting', 'failed', 'succeeded']);
  if (run.status !== 'waiting') return run;
  await post(api.base, `/runs/${runId}/input`, { waitId: run.waiting.waitId, input: 'go' });
  return run;
}
try {
  await resetCli();

  // A. Restart between visits keeps a usable reference (hard kill, same store, both families).
  for (const harness of ['codex', 'claude']) {
    const loopId = await createPublished(api.base, holdLoop(`restart ${harness}`, harness));
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['waiting']);
    const before = await get(api.base, `/runs/${run.id}/sessions`);
    await restart(`a-${harness}`);
    const after = await get(api.base, `/runs/${run.id}/sessions`);
    await answer(run.id); // visit 2 after the restart
    await waitRun(api.base, run.id, ['waiting']);
    await restart(`a2-${harness}`);
    await answer(run.id); // visit 3 after a second restart
    await answer(run.id); // final hold -> gate limit -> done
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const w = runs(await requests(), run.id, 'WORKER');
    evidence[`restart-${harness}`] = { sessionsBefore: before.items, sessionsAfter: after.items, worker: w, status: finished.status };
    check(
      `33-restart-${harness}`,
      `${harness}: after hard kills and restarts, visits 2 and 3 resume the worker's visit-1 conversation`,
      finished.status === 'succeeded' &&
        w.length === 3 &&
        w[0].mode === 'fresh' &&
        w.slice(1).every((x) => x.mode === 'resume' && x.resumeId === w[0].sessionId) &&
        JSON.stringify(before.items) === JSON.stringify(after.items),
      evidence[`restart-${harness}`],
    );
  }

  // B. Optional authored reset after N visits: only that node's conversation resets.
  for (const [harness, reset, passes] of [
    ['codex', 2, 5],
    ['claude', 3, 4],
  ]) {
    const def = loop(
      `reset ${harness} ${reset}`,
      [
        inference(
          'worker',
          harness,
          { policy: 'resume-own', resetAfterVisits: reset },
          'WORKER run={{ run.id }} task. Loop messages so far: {{ messages | size }}. Last loop message: {{ lastMessage.content }}',
        ),
        inference('reviewer', harness, { policy: 'resume-own' }, 'REVIEWER run={{ run.id }} task.'),
        gate('again', passes),
      ],
      [
        edge('s-w', 'start', 'worker'),
        edge('w-r', 'worker', 'reviewer'),
        edge('r-g', 'reviewer', 'again'),
        edge('g-w', 'again', 'worker', 'repeat'),
        edge('g-limit', 'again', 'done', 'limit-reached'),
        edge('g-finish', 'again', 'done', 'finish'),
      ],
    );
    const loopId = await createPublished(api.base, def);
    const run = await startRun(api.base, loopId);
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const all = await requests();
    const w = runs(all, run.id, 'WORKER');
    const r = runs(all, run.id, 'REVIEWER');
    const thread = await get(api.base, `/runs/${run.id}/thread`);
    evidence[`reset-${harness}`] = {
      reset,
      passes,
      status: finished.status,
      worker: w,
      reviewer: r,
      finalMessages: thread.messages.length,
      finalNodeVisits: thread.counters.nodeVisits,
    };
    const expected = w.map((_, i) => (i % reset === 0 ? 'fresh' : 'resume'));
    const anchors = w.map((x, i) => (i % reset === 0 ? x.sessionId : undefined));
    let ok = w.length === passes && w.every((x, i) => x.mode === expected[i]);
    for (let i = 0; i < w.length; i += 1)
      if (i % reset !== 0) ok &&= w[i].resumeId === anchors[i - (i % reset)];
    const counts = w.map((x) => Number(/messages so far: (\d+)/.exec(x.prompt)?.[1]));
    check(
      `33-reset-${harness}-${reset}`,
      `${harness} resetAfterVisits=${reset}: visits ${expected.map((m, i) => `${i + 1}:${m}`).join(' ')}; each block resumes its own first visit`,
      finished.status === 'succeeded' && ok && new Set(anchors.filter(Boolean)).size === Math.ceil(passes / reset),
      { w },
    );
    check(
      `33-reset-${harness}-others`,
      `${harness}: the reviewer's conversation is never reset; the loop context in the worker's prompt keeps growing across the reset boundary`,
      r.length === passes &&
        r[0].mode === 'fresh' &&
        r.slice(1).every((x) => x.resumeId === r[0].sessionId) &&
        counts.every((count, i) => count === i * 2) &&
        w.slice(1).every((x) => x.prompt.includes('Last loop message: Synthetic reply conversation=' + r[0].sessionId)) &&
        thread.messages.length === passes * 2,
      { counts, finalMessages: thread.messages.length },
    );
  }

  // C. No unconfigured reset: 12 visits with Unlimited node visits share one conversation.
  {
    const def = loop(
      'no hidden reset',
      [
        inference('worker', 'codex', { policy: 'resume-own' }, 'WORKER run={{ run.id }} task.'),
        gate('again', 12),
      ],
      [
        edge('s-w', 'start', 'worker'),
        edge('w-g', 'worker', 'again'),
        edge('g-w', 'again', 'worker', 'repeat'),
        edge('g-limit', 'again', 'done', 'limit-reached'),
        edge('g-finish', 'again', 'done', 'finish'),
      ],
      { maxNodeVisits: null },
    );
    const loopId = await createPublished(api.base, def);
    const run = await startRun(api.base, loopId);
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const w = runs(await requests(), run.id, 'WORKER');
    const pinned = (await get(api.base, `/runs/${run.id}`)).pinned;
    evidence['no-hidden-reset'] = { status: finished.status, worker: w, pinnedLimits: pinned?.limits };
    check(
      '33-no-hidden-reset',
      'without resetAfterVisits, 12 visits (past the old ten-visit proposal) share one conversation',
      finished.status === 'succeeded' &&
        w.length === 12 &&
        w[0].mode === 'fresh' &&
        w.slice(1).every((x) => x.resumeId === w[0].sessionId) &&
        w[11].conversationTurn === 12,
      w.map((x) => `${x.mode}:${x.conversationTurn}`),
    );
  }

  // D. Interrupted own-session turns follow #244: accepted Codex work continues on its own
  // conversation; Claude work interrupted after init but before acceptance stops non-resumably.
  for (const harness of ['codex', 'claude']) {
    const loopId = await createPublished(api.base, holdLoop(`interrupted ${harness}`, harness));
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['waiting']);
    await control('hold.txt', `run=${run.id} visit=2 `);
    await answer(run.id);
    // Wait until the fixture has recorded visit 2's invocation, then hard-kill the gateway.
    let held;
    for (let i = 0; i < 200 && !held; i += 1) {
      held = (await requests()).find((x) => x.prompt.includes(`run=${run.id} visit=2 `));
      if (!held) await delay(100);
    }
    if (!held) throw new Error('visit 2 was not invoked with the expected marker');
    await delay(1500);
    const eventsBefore = await events(api.base, run.id);
    await api.kill();
    // Only the held fixture process is ended, by its recorded PID (never by image name).
    try {
      process.kill(held.pid);
    } catch {
      // already gone
    }
    await control('hold.txt');
    api = await startApi({ name: `s2-d-${harness}`, port: PORT, dataDir });
    const settled = await waitRun(api.base, run.id, ['waiting', 'failed', 'succeeded'], 60_000);
    const all = await requests();
    const w = runs(all, run.id, 'WORKER');
    const continuation = all.filter(
      (x) => x.harness === harness && x.resumeId === w[0].sessionId && !x.prompt.includes('WORKER run='),
    );
    const evs = await events(api.base, run.id);
    evidence[`interrupted-${harness}`] = {
      status: settled.status,
      failure: settled.failure,
      worker: w,
      continuation: continuation.map(summarize),
      submissionEventsBeforeKill: eventsBefore.filter((e) => e.type === 'harness.submission' || e.type === 'harness.turn'),
      lastEvents: evs.slice(-6),
    };
    if (harness === 'codex')
      check(
        '33-interrupted-codex-accepted',
        'Codex visit 2 accepted (turn.started) then gateway killed: recovery continues on the worker\'s own conversation, without resending the authored task',
        settled.status === 'waiting' &&
          w.length === 2 &&
          continuation.length === 1 &&
          continuation[0].mode === 'resume' &&
          continuation[0].resumeId === w[0].sessionId,
        evidence[`interrupted-${harness}`],
      );
    else
      check(
        '33-interrupted-claude-unaccepted',
        'Claude visit 2 initialized but not accepted, gateway killed: the run stops non-resumably (HARNESS_DELIVERY_UNCERTAIN), no blind resend or continuation',
        settled.status === 'failed' &&
          settled.failure?.code === 'HARNESS_DELIVERY_UNCERTAIN' &&
          settled.failure?.resumable === false &&
          w.length === 2 &&
          continuation.length === 0,
        evidence[`interrupted-${harness}`],
      );
    if (settled.status === 'waiting') await post(api.base, `/runs/${run.id}/cancel`, {});
  }
} finally {
  await api.kill();
  await saveJson('s2-restart-reset-results.json', { checks, evidence });
  console.log('cli dir', CLI.replace(/\\/g, '/').replace(/.*Temp/, '%TEMP%'));
}
const failed = checks.filter((c) => !c.pass);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
void readFile;
