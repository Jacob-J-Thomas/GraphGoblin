// #33 scenarios through the built API, real Codex/Claude adapters and the recording fake CLIs:
// worker/reviewer/worker cycles, existing policies, parallel runs, replay forks and subloop children.
import { join } from 'node:path';
import {
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

const checks = [];
function check(id, description, pass, detail) {
  checks.push({ id, description, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${description}`);
  if (!pass) console.log('  detail: ' + JSON.stringify(detail));
}

const tpl = (role) =>
  `${role} run={{ run.id }} task. Loop messages so far: {{ messages | size }}.`;

function cycleLoop(name, harness, workerSession, reviewerSession, passes = 3) {
  return loop(
    name,
    [
      inference('worker', harness, workerSession, tpl('WORKER')),
      inference('reviewer', harness, reviewerSession, tpl('REVIEWER')),
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
}

/** Requests for one run and role, using the run id rendered into the authored prompt. */
function roleRequests(all, runId, role) {
  return byMarker(all, `${role} run=${runId} `);
}

const evidence = {};
const api = await startApi({ name: 's1', port: 6440, dataDir: join(ROOT, 'data-s1') });
try {
  await resetCli();
  const catalog = await get(api.base, '/model-catalog');
  evidence.preflight = await get(api.base, '/harness/preflight');
  evidence.catalogModels = catalog.items?.map((entry) => ({
    harness: entry.harness,
    model: entry.model,
    efforts: entry.efforts,
    enabled: entry.enabled,
  }));

  // 1. W(own) -> R(own) -> gate x3, both harness families.
  for (const harness of ['codex', 'claude']) {
    const loopId = await createPublished(
      api.base,
      cycleLoop(`own cycle ${harness}`, harness, { policy: 'resume-own' }, { policy: 'resume-own' }),
    );
    const run = await startRun(api.base, loopId);
    const done = await waitRun(api.base, run.id, ['succeeded', 'failed', 'cancelled']);
    const all = await requests();
    const w = roleRequests(all, run.id, 'WORKER').map(summarize);
    const r = roleRequests(all, run.id, 'REVIEWER').map(summarize);
    evidence[`cycle-${harness}`] = { run: done.status, worker: w, reviewer: r };
    check(`33-cycle-${harness}-status`, `${harness} own cycle succeeds`, done.status === 'succeeded', done.failure);
    check(
      `33-cycle-${harness}-worker`,
      `${harness} worker visit 1 fresh, visits 2-3 resume only the worker's visit-1 conversation`,
      w.length === 3 &&
        w[0].mode === 'fresh' &&
        w.slice(1).every((x) => x.mode === 'resume' && x.resumeId === w[0].sessionId) &&
        w.map((x) => x.conversationTurn).join() === '1,2,3',
      w,
    );
    check(
      `33-cycle-${harness}-reviewer`,
      `${harness} reviewer keeps its own separate conversation; worker never resumes a reviewer handle`,
      r.length === 3 &&
        r[0].mode === 'fresh' &&
        r.slice(1).every((x) => x.resumeId === r[0].sessionId) &&
        r[0].sessionId !== w[0].sessionId &&
        !w.some((x) => r.some((y) => y.sessionId === x.resumeId)),
      r,
    );
    const sessions = await get(api.base, `/runs/${run.id}/sessions`);
    evidence[`cycle-${harness}`].sessions = sessions.items;
  }

  // 2. W(own) with a fresh reviewer: the worker still resumes only its own handle.
  {
    const loopId = await createPublished(
      api.base,
      cycleLoop('own worker fresh reviewer', 'codex', { policy: 'resume-own' }, { policy: 'fresh' }),
    );
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const all = await requests();
    const w = roleRequests(all, run.id, 'WORKER').map(summarize);
    const r = roleRequests(all, run.id, 'REVIEWER').map(summarize);
    evidence['own-worker-fresh-reviewer'] = { worker: w, reviewer: r };
    check(
      '33-fresh-reviewer',
      'worker resumes its own handle; fresh reviewer starts a new conversation every visit',
      w[0].mode === 'fresh' &&
        w.slice(1).every((x) => x.resumeId === w[0].sessionId) &&
        r.every((x) => x.mode === 'fresh') &&
        new Set(r.map((x) => x.sessionId)).size === 3,
      { w, r },
    );
  }

  // 3. Existing policies keep their meanings (no silent change): default/fresh, previous, named.
  {
    const def = cycleLoop('existing default', 'codex', { policy: 'fresh' }, { policy: 'fresh' });
    delete def.nodes.find((n) => n.id === 'worker').config.session; // omitted -> contract default
    const loopId = await createPublished(api.base, def);
    const stored = await get(api.base, `/loops/${loopId}`);
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const w = roleRequests(await requests(), run.id, 'WORKER').map(summarize);
    const storedWorker = (stored.published ?? stored.loop?.published ?? stored)?.definition?.nodes?.find?.(
      (n) => n.id === 'worker',
    );
    evidence['existing-default'] = { worker: w, storedSession: storedWorker?.config?.session };
    check(
      '33-default-fresh',
      'an inference node with no authored session policy starts fresh on every visit',
      w.length === 3 && w.every((x) => x.mode === 'fresh'),
      w,
    );
  }
  {
    const loopId = await createPublished(
      api.base,
      cycleLoop('existing previous', 'codex', { policy: 'resume-previous' }, { policy: 'fresh' }),
    );
    const run = await startRun(api.base, loopId);
    await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const all = await requests();
    const w = roleRequests(all, run.id, 'WORKER').map(summarize);
    const r = roleRequests(all, run.id, 'REVIEWER').map(summarize);
    evidence['existing-previous'] = { worker: w, reviewer: r };
    check(
      '33-previous-unchanged',
      'resume-previous still resumes the latest session in the run (the reviewer\'s), as before #33',
      w[0].mode === 'fresh' && w[1].resumeId === r[0].sessionId && w[2].resumeId === r[1].sessionId,
      { w, r },
    );
  }
  {
    const named = { policy: 'resume-named', key: 'shared' };
    const loopId = await createPublished(api.base, cycleLoop('existing named', 'codex', named, named, 2));
    const first = await startRun(api.base, loopId);
    await waitRun(api.base, first.id, ['succeeded', 'failed']);
    const second = await startRun(api.base, loopId);
    await waitRun(api.base, second.id, ['succeeded', 'failed']);
    const all = await requests();
    const a = [...roleRequests(all, first.id, 'WORKER'), ...roleRequests(all, first.id, 'REVIEWER')];
    const b = [...roleRequests(all, second.id, 'WORKER'), ...roleRequests(all, second.id, 'REVIEWER')];
    const ids = new Set([...a, ...b].map((x) => x.sessionId));
    evidence['existing-named'] = { first: a.map(summarize), second: b.map(summarize) };
    check(
      '33-named-unchanged',
      'resume-named still shares one keyed conversation across nodes and across runs',
      ids.size === 1 && b.every((x) => x.mode === 'resume'),
      { ids: [...ids] },
    );
  }

  // 4. Parallel runs of the same own-session loop stay isolated.
  {
    await control('delay-ms.txt', 400);
    const loopId = await createPublished(
      api.base,
      cycleLoop('own parallel', 'codex', { policy: 'resume-own' }, { policy: 'resume-own' }),
    );
    const runs = await Promise.all([startRun(api.base, loopId), startRun(api.base, loopId), startRun(api.base, loopId)]);
    await Promise.all(runs.map((run) => waitRun(api.base, run.id, ['succeeded', 'failed'])));
    await control('delay-ms.txt');
    const all = await requests();
    const per = runs.map((run) => ({
      runId: run.id,
      worker: roleRequests(all, run.id, 'WORKER').map(summarize),
      reviewer: roleRequests(all, run.id, 'REVIEWER').map(summarize),
    }));
    const marked = all.filter((x) => runs.some((run) => x.prompt.includes(`run=${run.id} `)));
    const times = marked.map((x) => ({ ts: x.ts, run: runs.findIndex((run) => x.prompt.includes(`run=${run.id} `)), pid: x.pid }));
    let switches = 0;
    for (let i = 1; i < times.length; i += 1) if (times[i].run !== times[i - 1].run) switches += 1;
    evidence.parallel = { per, interleavingSwitches: switches, order: times };
    const workerIds = per.map((p) => p.worker[0].sessionId);
    check(
      '33-parallel',
      'three concurrent runs: each worker resumes only its own run\'s worker handle',
      per.every(
        (p) =>
          p.worker.length === 3 &&
          p.worker[0].mode === 'fresh' &&
          p.worker.slice(1).every((x) => x.resumeId === p.worker[0].sessionId),
      ) && new Set(workerIds).size === 3,
      { workerIds, switches },
    );
    check('33-parallel-interleaved', 'the three runs actually interleaved their turns', switches >= 4, { switches });
    evidence.parallelSourceRun = runs[0].id;
  }

  // 5. Replay forks: the fork never inherits the source run's own handles.
  {
    const source = evidence.parallelSourceRun;
    const all0 = await requests();
    const sourceIds = new Set(all0.filter((x) => x.prompt.includes(`run=${source} `)).map((x) => x.sessionId));
    for (const nodeId of ['worker', 'reviewer']) {
      const fork = (await post(api.base, `/runs/${source}/replay`, { nodeId }, 202)).run;
      const finished = await waitRun(api.base, fork.id, ['succeeded', 'failed']);
      const all = await requests();
      const w = roleRequests(all, fork.id, 'WORKER').map(summarize);
      const r = roleRequests(all, fork.id, 'REVIEWER').map(summarize);
      const forkEvents = await events(api.base, fork.id);
      const thread = await get(api.base, `/runs/${fork.id}/thread`);
      evidence[`replay-${nodeId}`] = {
        forkId: fork.id,
        status: finished.status,
        worker: w,
        reviewer: r,
        initialCounters: forkEvents.find((e) => e.type === 'run.queued')?.initialThread?.counters,
        finalCounters: thread.counters,
      };
      check(
        `33-replay-${nodeId}`,
        `replay at ${nodeId}: first worker and reviewer turns in the fork are fresh; no source handle is resumed`,
        finished.status === 'succeeded' &&
          w[0]?.mode === 'fresh' &&
          r[0]?.mode === 'fresh' &&
          ![...w, ...r].some((x) => x.resumeId && sourceIds.has(x.resumeId)) &&
          w.slice(1).every((x) => x.resumeId === w[0].sessionId),
        { w, r },
      );
    }
  }

  // 6. Subloop children: a child node with the same id never inherits the parent's handle.
  {
    const child = loop(
      'own child',
      [inference('worker', 'codex', { policy: 'resume-own' }, tpl('CHILDWORKER')), gate('again', 2)],
      [
        edge('s-w', 'start', 'worker'),
        edge('w-g', 'worker', 'again'),
        edge('g-w', 'again', 'worker', 'repeat'),
        edge('g-limit', 'again', 'done', 'limit-reached'),
        edge('g-finish', 'again', 'done', 'finish'),
      ],
    );
    const childId = await createPublished(api.base, child);
    const parent = loop(
      'own parent',
      [
        inference('worker', 'codex', { policy: 'resume-own' }, tpl('WORKER')),
        { id: 'sub', kind: 'subloop', label: 'sub', config: { loopRef: { loopId: childId, version: 'latest' } } },
        gate('again', 2),
      ],
      [
        edge('s-w', 'start', 'worker'),
        edge('w-s', 'worker', 'sub'),
        edge('s-g', 'sub', 'again'),
        edge('g-w', 'again', 'worker', 'repeat'),
        edge('g-limit', 'again', 'done', 'limit-reached'),
        edge('g-finish', 'again', 'done', 'finish'),
      ],
    );
    const parentId = await createPublished(api.base, parent);
    const run = await startRun(api.base, parentId);
    const finished = await waitRun(api.base, run.id, ['succeeded', 'failed']);
    const childRuns = (await get(api.base, `/runs?parent=${run.id}&limit=50`)).items ?? [];
    const all = await requests();
    const pw = roleRequests(all, run.id, 'WORKER').map(summarize);
    const children = childRuns.map((c) => ({ runId: c.id, worker: roleRequests(all, c.id, 'CHILDWORKER').map(summarize) }));
    evidence.children = { parent: run.id, status: finished.status, parentWorker: pw, children };
    const parentIds = new Set(pw.map((x) => x.sessionId));
    check(
      '33-children',
      'each child run starts its same-id worker fresh and resumes only within itself; the parent worker resumes only its own handle',
      finished.status === 'succeeded' &&
        children.length === 2 &&
        children.every(
          (c) =>
            c.worker[0]?.mode === 'fresh' &&
            c.worker.slice(1).every((x) => x.resumeId === c.worker[0].sessionId) &&
            !c.worker.some((x) => parentIds.has(x.sessionId) || parentIds.has(x.resumeId)),
        ) &&
        pw[0].mode === 'fresh' &&
        pw.slice(1).every((x) => x.resumeId === pw[0].sessionId),
      evidence.children,
    );
  }
} finally {
  await api.kill();
  await saveJson('s1-own-session-results.json', { checks, evidence });
}
const failed = checks.filter((c) => !c.pass);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
