// Checks 1 (API side), 3 and 4: explicit consent, pressure off by default, and the integrated
// "user-approved retention" scenario under simulated pressure, against one real API process
// over a file-backed store. Capacity is changed only through the public StorageCapacityPort file.
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  startServer,
  client,
  setCapacity,
  ADEQUATE,
  PRESSURE,
  GiB,
  workLoop,
  parentLoop,
  temp,
  join,
  Evidence,
  sleep,
} from './qa-lib.mjs';

const ev = new Evidence('04-integrated');
const base = join(temp, 'gg-qa-412f-a-int');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const userDir = join(base, 'user-owned');
const outside = join(base, 'outside');
fs.mkdirSync(userDir, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(join(userDir, 'sentinel.txt'), 'user-owned working directory');
fs.writeFileSync(join(outside, 'junction-target.txt'), 'outside target');
fs.writeFileSync(join(outside, 'hard-source.bin'), Buffer.alloc(4096, 65));
setCapacity(capacityFile, ADEQUATE);

// Webhook receiver that never answers: keeps a terminal run unfinalized for a while.
const hangingSockets = new Set();
const hanging = http.createServer(() => undefined);
hanging.on('connection', (s) => hangingSockets.add(s));
await new Promise((r) => hanging.listen(6629, '127.0.0.1', r));

const logFile = join(base, 'server.log.txt');
let server = await startServer({ dataDir, port: 6623, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
let api = client(server.url);
ev.log('server', server.url, 'pid', server.pid);

/** Snapshot of every file under a directory: relative path -> size (links reported, not followed). */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      const rel = p.slice(dir.length + 1).replaceAll('\\', '/');
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out[rel] = 'link';
      else if (st.isDirectory()) {
        out[rel + '/'] = 'dir';
        walk(p);
      } else out[rel] = st.size;
    }
  };
  walk(dir);
  return out;
}
const dbSize = () =>
  ['graphgoblin.db', 'graphgoblin.db-wal']
    .map((f) => {
      try {
        return fs.statSync(join(dataDir, f)).size;
      } catch {
        return 0;
      }
    })
    .reduce((a, b) => a + b, 0);

async function waitPass(previousCheckedAt, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== previousCheckedAt && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no storage pass observed');
    await sleep(500);
  }
}

try {
  // ---------------------------------------------------------------- setup
  const W = await api.createLoop(workLoop('QA work (temp workspace)'));
  const F = await api.createLoop(
    workLoop('QA work (fixed user directory)', { workingDirectory: { kind: 'fixed', path: userDir } }),
  );
  const C = await api.createLoop(workLoop('QA child'));
  const P = await api.createLoop(parentLoop('QA parent', C));
  // Exit with a return mapping delivered to the never-answering webhook: terminal but unfinalized.
  const hookDef = workLoop('QA webhook return');
  hookDef.nodes.find((n) => n.id === 'done').config = {
    outcome: 'success',
    returns: '{"ok": true}',
    destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:6629/hook' }],
  };
  const Hk = await api.createLoop(hookDef);
  const runs = {};
  const go = async (key, loop, input, extra) => {
    runs[key] = (await api.startRun(loop, input, extra)).id;
    return runs[key];
  };
  await go('w1', W, { text: 'w1 unique', files: 3, bytes: 1000 });
  await go('w2', W, { text: 'w2 unique', files: 2, bytes: 500 });
  await go('w3', W, { text: '[[fail]] w3 unique' });
  await go('s1', W, { text: 'shared transcript', files: 1, bytes: 10 });
  for (const k of ['w1', 'w2', 'w3', 's1']) await api.waitFinal(runs[k]);
  await go('s2', W, { text: 'shared transcript', files: 1, bytes: 10 });
  await go('f1', F, { text: 'f1 unique', files: 2, bytes: 100 });
  await go('k1', W, { text: 'k1 unique', files: 1, bytes: 50, mode: 'junction', target: outside });
  await go('h1', W, { text: 'h1 unique', files: 1, bytes: 50, mode: 'hardlink', target: join(outside, 'hard-source.bin') });
  await go('p1', P, {});
  await go('r1', W, { text: 'r1 unique', files: 1, bytes: 200 });
  await go('r2', W, { text: 'r2 unique', files: 1, bytes: 200 });
  await go('e1', W, { text: '[[fail]] e1 unique' });
  for (const k of ['s2', 'f1', 'k1', 'h1', 'p1', 'r1', 'r2', 'e1']) await api.waitFinal(runs[k]);
  const children = (await api.get(`/runs?parent=${runs.p1}`)).json.items;
  runs.c1 = children[0]?.id;
  const replay = await api.post(`/runs/${runs.r1}/replay`, { nodeId: 'files' });
  runs.r1f = replay.json.run.id;
  await api.waitFinal(runs.r1f);
  await go('a1', W, { text: '[[delay=900000]] a1 active' });
  await go('pz1', W, { text: '[[delay=900000]] pz1 to pause' });
  await go('u1', Hk, { text: 'u1 unique' });
  await api.waitFor(runs.a1, (r) => r.status === 'running');
  await api.waitFor(runs.pz1, (r) => r.status === 'running');
  const pause = await api.post(`/runs/${runs.pz1}/pause`);
  ev.log('pause pz1', pause.status);
  await api.waitFor(runs.u1, (r) => r.status === 'succeeded');
  ev.log('runs', runs);
  for (const [k, id] of Object.entries(runs)) {
    const r = await api.run(id);
    ev.log(`  ${k} ${id} status=${r.status} finalized=${Boolean(r.finalizedAt)} parent=${r.parentRunId ?? '-'} failure=${r.failure?.code ?? '-'}`);
  }

  // Unrelated and look-alike files that no run created.
  fs.mkdirSync(join(dataDir, 'workspaces', 'unrelated'), { recursive: true });
  fs.writeFileSync(join(dataDir, 'workspaces', 'unrelated', 'note.txt'), 'unrelated');
  fs.mkdirSync(join(dataDir, 'workspaces', '01AAAAAAAAAAAAAAAAAAAAAAAA'), { recursive: true });
  fs.writeFileSync(join(dataDir, 'workspaces', '01AAAAAAAAAAAAAAAAAAAAAAAA', 'run-shaped.txt'), 'not a run');
  const fakeHash = createHash('sha256').update('unproven').digest('hex');
  fs.writeFileSync(join(dataDir, 'artifacts', 'transcript', fakeHash), 'unproven');
  fs.writeFileSync(join(dataDir, 'operator-notes.txt'), 'unrelated file in data dir');

  // ---------------------------------------------------------------- check 1 (API)
  const failedStatus = (await api.run(runs.w3)).status;
  ev.check('w3 is a failed run, e1 is a failed run', failedStatus === 'failed' && (await api.run(runs.e1)).status === 'failed', failedStatus);

  const pActive = await api.preview([runs.a1]);
  ev.check('preview of an active run lists a protection reason', pActive.json.items[0].reasons.some((r) => /running/.test(r)), pActive.json.items);
  const pPaused = await api.preview([runs.pz1]);
  ev.log('preview paused', pPaused.json.items, 'status', (await api.run(runs.pz1)).status);
  const pUnfinal = await api.preview([runs.u1]);
  ev.check('preview of a terminal unfinalized run lists finalization reason', pUnfinal.json.items[0].reasons.some((r) => /finalization/i.test(r)), pUnfinal.json.items);

  // A bulk selection with one protected record is refused whole.
  const bulkBad = await api.mark([runs.w2, runs.a1]);
  ev.check('bulk selection including an active run refused 409 PROTECTED', bulkBad.status === 409 && bulkBad.json.code === 'DELETION_SELECTION_PROTECTED', { status: bulkBad.status, code: bulkBad.json.code, errors: bulkBad.json.errors });
  ev.check('w2 not marked by the refused bulk selection', !(await api.run(runs.w2)).deletionApproval);
  const bulkUnfinal = await api.mark([runs.w2, runs.u1]);
  ev.check('bulk selection including unfinalized run refused', bulkUnfinal.status === 409, bulkUnfinal.json.code);
  const bulkPaused = await api.mark([runs.w2, runs.pz1]);
  ev.check('bulk selection including paused run refused', bulkPaused.status === 409, { code: bulkPaused.json.code, status: (await api.run(runs.pz1)).status });

  // Parent/child dependency.
  const parentOnly = await api.mark([runs.p1]);
  ev.check('parent alone refused: child required', parentOnly.status === 409 && JSON.stringify(parentOnly.json.errors).includes(runs.c1), parentOnly.json.errors);
  const childOnly = await api.mark([runs.c1]);
  ev.check('child alone refused: parent required', childOnly.status === 409 && JSON.stringify(childOnly.json.errors).includes(runs.p1), childOnly.json.errors);
  // Replay dependency.
  const sourceOnly = await api.mark([runs.r1]);
  ev.check('replay source alone refused: fork required', sourceOnly.status === 409 && JSON.stringify(sourceOnly.json.errors).includes(runs.r1f), sourceOnly.json.errors);

  // Stale preview: another confirmation changes state between preview and confirm.
  const stalePreview = await api.preview([runs.w1]);
  const competing = await api.mark([runs.w1]);
  ev.check('competing confirmation succeeds', competing.status === 200, competing.status);
  const stale = await api.confirm([runs.w1], stalePreview.json.token);
  ev.check('stale token refused 409 STALE', stale.status === 409 && stale.json.code === 'DELETION_SELECTION_STALE', stale.json.code);
  // Stale after withdraw/re-mark cycle with the same selection.
  const t1 = (await api.preview([runs.w1])).json.token;
  await api.mark([runs.w1], 'withdraw');
  await api.mark([runs.w1]);
  const revived = await api.confirm([runs.w1], t1);
  ev.check('token from before an approve/withdraw cycle stays stale', revived.status === 409 && revived.json.code === 'DELETION_SELECTION_STALE', revived.json.code);
  // Missing and malformed selections.
  const missing = await api.mark(['01ZZZZZZZZZZZZZZZZZZZZZZZZ']);
  ev.check('unknown run refused', missing.status === 409 && missing.json.code === 'DELETION_SELECTION_MISSING', missing.json.code);
  const dup = await api.preview([runs.w1, runs.w1]);
  ev.check('duplicate ids refused 400', dup.status === 400, dup.status);
  const empty = await api.preview([]);
  ev.check('empty selection refused 400', empty.status === 400, empty.status);
  const unconfirmed = await api.call('POST', '/runs/deletion-eligibility', { runIds: [runs.w2], token: t1, action: 'mark' });
  ev.check('confirmation without confirmed:true refused 400', unconfirmed.status === 400, unconfirmed.status);
  ev.check('preview alone marks nothing', !(await api.run(runs.w2)).deletionApproval);

  // Mark the intended eligible set (successful and failed alike).
  const markSet = [runs.w1, runs.w3, runs.s1, runs.f1, runs.k1, runs.h1, runs.p1, runs.c1, runs.r1, runs.r1f, runs.r2, runs.e1];
  const marked = await api.mark(markSet);
  ev.check('bulk mark of eligible selection (succeeded + failed, components complete)', marked.status === 200, marked.json.code ?? marked.status);
  const sample = await api.run(runs.w3);
  ev.check('approval records who and when (API)', Boolean(sample.deletionApproval?.confirmedAt && sample.deletionApproval?.confirmedBy?.id), sample.deletionApproval);
  for (const k of ['w1', 'w3', 'c1']) ev.log(`approval ${k}`, (await api.run(runs[k])).deletionApproval);
  ev.check('w2 (unselected) still retained', !(await api.run(runs.w2)).deletionApproval);

  // Withdrawal.
  const mw = await api.mark([runs.w2]);
  const wd = await api.mark([runs.w2], 'withdraw');
  ev.check('mark then withdraw w2 leaves it retained', mw.status === 200 && wd.status === 200 && !(await api.run(runs.w2)).deletionApproval);

  // Resume of an approved failed run withdraws consent.
  ev.log('e1 before resume', (await api.run(runs.e1)).deletionApproval ? 'approved' : 'retained');
  const resume = await api.post(`/runs/${runs.e1}/resume`);
  ev.log('resume e1', resume.status, resume.json?.code ?? '');
  const e1After = await api.waitFinal(runs.e1);
  ev.check('resuming an approved run withdraws its approval', !e1After.deletionApproval, { status: e1After.status, approval: e1After.deletionApproval ?? null });

  // Replay from an approved run withdraws consent; the fork starts without consent.
  const r2Fork = await api.post(`/runs/${runs.r2}/replay`, { nodeId: 'files' });
  runs.r2f = r2Fork.json.run.id;
  await api.waitFinal(runs.r2f);
  ev.check('replay from an approved run withdraws the source approval', !(await api.run(runs.r2)).deletionApproval);
  ev.check('replay fork starts without consent', !(await api.run(runs.r2f)).deletionApproval);

  // New runs start without consent.
  runs.n1 = (await api.startRun(W, { text: 'n1 new after approvals', files: 1, bytes: 20 })).id;
  await api.waitFinal(runs.n1);
  ev.check('new run starts without consent', !(await api.run(runs.n1)).deletionApproval);

  const approvedIds = [];
  for (const [k, id] of Object.entries(runs)) if ((await api.run(id)).deletionApproval) approvedIds.push(k);
  ev.log('approved before pressure', approvedIds.join(','));

  // ---------------------------------------------------------------- check 3 (adequate)
  const filesBefore = tree(base);
  let s = await api.storage();
  ev.log('storage at start', s);
  s = await waitPass(s.checkedAt);
  ev.log('storage after a natural timer pass (adequate)', s);
  setCapacity(capacityFile, { mode: 'real' });
  s = await waitPass(s.checkedAt);
  ev.log('storage with production fs.statfs reading', s);
  let stillThere = 0;
  for (const k of approvedIds) if ((await api.get(`/runs/${runs[k]}`)).status === 200) stillThere++;
  ev.check('adequate storage: every approved run still present', stillThere === approvedIds.length, { stillThere, approved: approvedIds.length });
  const filesAfterAdequate = tree(base);
  const changed = Object.keys({ ...filesBefore, ...filesAfterAdequate }).filter((k) => filesBefore[k] !== filesAfterAdequate[k]);
  const ignorable = (k) => k.startsWith('data/graphgoblin.db') || k === 'capacity.json' || k === 'server.log.txt';
  ev.check('adequate storage: no file under the QA root changed', changed.filter((k) => !ignorable(k)).length === 0, changed);
  ev.check('adequate storage state reported, no deletion counters', s.state === 'adequate' && s.deletedRuns === 0 && s.removedFileBytes === 0, s);

  // Hysteresis: 1.5 GiB of 100 GiB is not pressure from adequate.
  setCapacity(capacityFile, { mode: 'fixed', totalBytes: 100 * GiB, availableBytes: Math.floor(1.5 * GiB) });
  s = await waitPass(s.checkedAt);
  ev.check('1.5 GiB free of 100 GiB stays adequate (enter threshold 1 GiB)', s.state === 'adequate', s.state);

  // ---------------------------------------------------------------- check 4 (pressure)
  const retainedKeys = Object.keys(runs).filter((k) => !approvedIds.includes(k));
  const retainedArtifacts = {};
  for (const k of retainedKeys) {
    const th = (await api.get(`/runs/${runs[k]}/thread`)).json;
    const arts = th.artifacts ?? [];
    retainedArtifacts[k] = [];
    for (const a of arts) {
      const got = await api.get(`/runs/${runs[k]}/artifacts/${a.id}`);
      retainedArtifacts[k].push({ id: a.id, ref: a.ref, status: got.status, sha: createHash('sha256').update(got.text).digest('hex') });
    }
  }
  const dbBefore = dbSize();
  const before = tree(base);
  // Page continuously while the pass runs.
  let paging = true;
  const pagingReport = { traversals: 0, problems: [] };
  const pagingLoop = (async () => {
    while (paging) {
      const pages = await api.listAll(3);
      const ids = pages.flat();
      pagingReport.traversals++;
      if (new Set(ids).size !== ids.length) pagingReport.problems.push({ duplicate: ids });
      for (const k of retainedKeys) if (!ids.includes(runs[k])) pagingReport.problems.push({ missingRetained: k });
      for (const id of ids) if (!Object.values(runs).includes(id)) pagingReport.problems.push({ unknown: id });
    }
  })();
  setCapacity(capacityFile, PRESSURE);
  const pass1Start = Date.now();
  s = await waitPass(s.checkedAt);
  ev.log(`pressure pass 1 observed after ${Date.now() - pass1Start} ms`, s);
  paging = false;
  await pagingLoop;
  ev.check('paging stayed consistent during cleanup (limit 3, continuous traversals)', pagingReport.problems.length === 0, pagingReport);
  const after = tree(base);
  const removed = Object.keys(before).filter((k) => !(k in after));
  const added = Object.keys(after).filter((k) => !(k in before));
  ev.log('removed paths', removed);
  ev.log('added paths', added);
  const removedBytes = removed.filter((k) => typeof before[k] === 'number' && !k.startsWith('data/graphgoblin.db')).reduce((a, k) => a + before[k], 0);
  ev.check('reported removedFileBytes equals bytes of files that disappeared', s.removedFileBytes === removedBytes, { reported: s.removedFileBytes, observed: removedBytes });
  ev.log('db file+wal bytes before/after', dbBefore, dbSize(), 'reusableDatabaseBytes', s.reusableDatabaseBytes);
  for (const k of Object.keys(runs)) {
    const st = (await api.get(`/runs/${runs[k]}`)).status;
    const expectGone = approvedIds.includes(k);
    ev.check(`${k} ${expectGone ? 'approved -> deleted' : 'retained -> present'}`, expectGone ? st === 404 : st === 200, st);
  }
  for (const k of retainedKeys) {
    for (const a of retainedArtifacts[k]) {
      const got = await api.get(`/runs/${runs[k]}/artifacts/${a.id}`);
      const sha = createHash('sha256').update(got.text).digest('hex');
      ev.check(`retained ${k} artifact ${a.ref.slice(0, 30)}… still retrievable and identical`, got.status === 200 && sha === a.sha, { status: got.status });
    }
  }
  ev.check('user-owned fixed directory and its files untouched', fs.readFileSync(join(userDir, 'sentinel.txt'), 'utf8') === 'user-owned working directory' && fs.existsSync(join(userDir, 'f0.bin')) && fs.existsSync(join(userDir, 'f1.bin')));
  ev.check('junction target untouched', fs.readFileSync(join(outside, 'junction-target.txt'), 'utf8') === 'outside target');
  ev.check('hard-link source untouched', fs.statSync(join(outside, 'hard-source.bin')).size === 4096);
  ev.check('k1 workspace with a junction preserved', fs.existsSync(join(dataDir, 'workspaces', runs.k1)) || added.some((p) => p.includes('cleanup-pending')), { k1: fs.existsSync(join(dataDir, 'workspaces', runs.k1)) });
  ev.check('h1 workspace with a hard link preserved', fs.existsSync(join(dataDir, 'workspaces', runs.h1)));
  ev.check('unrelated and run-shaped files untouched', fs.existsSync(join(dataDir, 'workspaces', 'unrelated', 'note.txt')) && fs.existsSync(join(dataDir, 'workspaces', '01AAAAAAAAAAAAAAAAAAAAAAAA', 'run-shaped.txt')) && fs.existsSync(join(dataDir, 'artifacts', 'transcript', fakeHash)) && fs.existsSync(join(dataDir, 'operator-notes.txt')));
  ev.check('retained workspaces untouched (w2, s2, n1, r2, r2f, e1)', ['w2', 's2', 'n1', 'r2', 'r2f', 'e1'].every((k) => fs.existsSync(join(dataDir, 'workspaces', runs[k]))));

  // Approve an OLDER retained run right after the pass, then watch the next pass.
  const lateMark = await api.mark([runs.w2]);
  ev.log('late mark of older run w2 after pass 1', lateMark.status);
  s = await waitPass(s.checkedAt);
  ev.log('pressure pass 2', s);
  const w2After2 = (await api.get(`/runs/${runs.w2}`)).status;
  ev.log('w2 status after pass 2', w2After2);
  if (w2After2 === 200)
    ev.check('pass 2 notice state with an approved, eligible run still present (expect not "no-eligible")', s.state !== 'no-eligible', { state: s.state, deletedRuns: s.deletedRuns });
  s = await waitPass(s.checkedAt);
  ev.log('pressure pass 3', s);
  ev.log('w2 status after pass 3', (await api.get(`/runs/${runs.w2}`)).status);
  s = await waitPass(s.checkedAt);
  ev.log('pressure pass 4 (nothing left eligible)', s);
  ev.check('nothing eligible -> no-eligible state, nothing deleted', s.state === 'no-eligible' && s.deletedRuns === 0, s);
  for (const k of retainedKeys.filter((k) => k !== 'w2')) ev.check(`after no-eligible pass ${k} still present`, (await api.get(`/runs/${runs[k]}`)).status === 200);
  const finalPages = await api.listAll(4);
  ev.log('final paging (limit 4)', finalPages);

  // Hysteresis: leaving pressure needs >= 2 GiB of 100 GiB.
  setCapacity(capacityFile, { mode: 'fixed', totalBytes: 100 * GiB, availableBytes: Math.floor(1.5 * GiB) });
  s = await waitPass(s.checkedAt);
  ev.check('1.5 GiB free stays in pressure (leave threshold 2 GiB)', s.state !== 'adequate', s.state);
  setCapacity(capacityFile, { mode: 'fail' });
  // First QA (O5): a failed reading kept the last observation's checkedAt; wait on the state.
  const lastGoodCheckedAt = s.checkedAt;
  for (let i = 0; i < 80 && s.state !== 'unavailable'; i++) {
    await sleep(1000);
    s = await api.storage();
  }
  ev.check('unavailable reading -> unavailable state', s.state === 'unavailable', s);
  ev.check('O5 re-check: an unavailable reading reports its own checkedAt and no old volumes', s.checkedAt !== lastGoodCheckedAt && Array.isArray(s.volumes) && s.volumes.length === 0, { lastGoodCheckedAt, checkedAt: s.checkedAt, volumes: s.volumes });
  setCapacity(capacityFile, ADEQUATE);
  s = await waitPass(s.checkedAt);
  ev.check('adequate again -> adequate', s.state === 'adequate', s.state);
  fs.writeFileSync(join(base, 'runs.json'), JSON.stringify({ runs, approvedIds, userDir, outside }, null, 2));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
} finally {
  try {
    const active = (await api.get('/runs?status=queued,running,waiting,paused&limit=50')).json.items;
    for (const r of active) ev.log('cancel', r.id, (await api.post(`/runs/${r.id}/cancel`)).status);
  } catch (error) {
    ev.log('cancel failed', String(error));
  }
  for (const sock of hangingSockets) sock.destroy();
  hanging.close();
  const stopped = await Promise.race([server.stop(), sleep(60_000).then(() => 'timeout')]);
  ev.log('server stop', stopped);
  if (stopped === 'timeout') ev.log('server kill after stop timeout', await server.kill());
  ev.log('failures', ev.failures ?? 0);
}
