// Check 2: retention under pressure at a realistic size, through the built API only.
// Several hundred retained runs that used temp, template and fixed working directories (some
// reached through junctions and parent-directory aliases), shared and user-owned directories,
// hard links and junctions inside workspaces, aliases INTO approved workspaces, plus approved
// runs. Then two follow-up phases: a configured fixed directory that is a junction to the
// workspaces root (parent alias), and a template run that never resolved its working directory.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, parentLoop, temp, join, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('14-realistic');
const base = join(temp, 'gg-qa-e3r-real');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const user = join(base, 'user');
const shared = join(base, 'shared', 'common');
const alias = join(base, 'alias');
const outside = join(base, 'outside');
for (const d of [user, shared, alias, outside, join(user, 'tpl'), join(user, 'tpl-approved')]) fs.mkdirSync(d, { recursive: true });
for (let i = 0; i < 10; i++) {
  fs.mkdirSync(join(user, `proj0${i}`), { recursive: true });
  fs.writeFileSync(join(user, `proj0${i}`, 'sentinel.txt'), `user project ${i}`);
}
for (let k = 0; k < 40; k++) {
  fs.mkdirSync(join(user, 'tpl', String(k)), { recursive: true });
  fs.writeFileSync(join(user, 'tpl', String(k), 'sentinel.txt'), `template dir ${k}`);
}
fs.writeFileSync(join(shared, 'sentinel.txt'), 'shared directory');
fs.mkdirSync(join(outside, 'jt'), { recursive: true });
fs.writeFileSync(join(outside, 'jt', 'target.txt'), 'junction target');
fs.writeFileSync(join(outside, 'hard-source.bin'), Buffer.alloc(4096, 66));
fs.symlinkSync(join(user, 'proj03'), join(alias, 'j-proj03'), 'junction');
fs.symlinkSync(user, join(alias, 'j-up'), 'junction');
setCapacity(capacityFile, ADEQUATE);

const server = await startServer({ dataDir, port: 6588, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
ev.log('server', server.url, 'pid', server.pid);

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
      if (st.isSymbolicLink()) out[rel] = 'link:' + fs.readlinkSync(p);
      else if (st.isDirectory()) {
        out[rel + '/'] = 'dir';
        walk(p);
      } else out[rel] = `${st.size}:${createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)}`;
    }
  };
  walk(dir);
  return out;
}
const managedBytes = () => {
  let bytes = 0;
  const t = { ...tree(join(dataDir, 'workspaces')), ...Object.fromEntries(Object.entries(tree(join(dataDir, 'artifacts'))).map(([k, v]) => ['a/' + k, v])), ...Object.fromEntries(Object.entries(tree(join(dataDir, 'cleanup-pending'))).map(([k, v]) => ['q/' + k, v])) };
  for (const v of Object.values(t)) if (/^\d+:/.test(v)) bytes += Number(v.split(':')[0]);
  return bytes;
};
async function waitPass(prev, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no storage pass observed');
    await sleep(250);
  }
}
async function startAll(specs, batch = 24) {
  const ids = [];
  for (let i = 0; i < specs.length; i += batch) {
    const chunk = [];
    for (const [loop, input] of specs.slice(i, i + batch)) chunk.push((await api.startRun(loop, input)).id);
    for (const id of chunk) await api.waitFinal(id, 300_000);
    ids.push(...chunk);
  }
  return ids;
}
const ws = (id) => join(dataDir, 'workspaces', id);

try {
  // ------------------------------------------------------------------ loops
  const W = await api.createLoop(workLoop('Real temp'));
  const TL = await api.createLoop(workLoop('Real template', { workingDirectory: { kind: 'template', template: '{{ trigger.payload.dir }}' } }));
  const F = [];
  for (let i = 0; i < 10; i++) F.push(await api.createLoop(workLoop(`Real fixed ${i}`, { workingDirectory: { kind: 'fixed', path: join(user, `proj0${i}`) } })));
  const FS = await api.createLoop(workLoop('Real shared', { workingDirectory: { kind: 'fixed', path: shared } }));
  const FJ = await api.createLoop(workLoop('Real fixed via junction', { workingDirectory: { kind: 'fixed', path: join(alias, 'j-proj03') } }));
  const C = await api.createLoop(workLoop('Real child'));
  const P = await api.createLoop(parentLoop('Real parent', C));

  // ------------------------------------------------------------------ approved-to-be runs (created first: oldest IDs)
  const t0 = Date.now();
  const approvedSpecs = [];
  for (let i = 0; i < 36; i++) {
    const input = { text: `a-w-${i}`, files: 3, bytes: 1000 };
    if (i < 2) Object.assign(input, { mode: 'junction', target: join(outside, 'jt') });
    else if (i < 4) Object.assign(input, { mode: 'hardlink', target: join(outside, 'hard-source.bin') });
    approvedSpecs.push([W, input]);
  }
  const aw = await startAll(approvedSpecs);
  const [X, Y, Z] = await startAll([[W, { text: 'a-x', files: 2, bytes: 500 }], [W, { text: 'a-y', files: 2, bytes: 500 }], [W, { text: 'a-z', files: 2, bytes: 500 }]]);
  for (let k = 0; k < 4; k++) fs.mkdirSync(join(user, 'tpl-approved', String(k)), { recursive: true });
  const at = await startAll([0, 1, 2, 3].map((k) => [TL, { text: `a-t-${k}`, files: 1, bytes: 10, dir: join(user, 'tpl-approved', String(k)) }]));
  const af = await startAll([0, 1, 2, 3].map((k) => [F[8], { text: `a-f-${k}`, files: 1, bytes: 10 }]));
  const as = await startAll([0, 1].map((k) => [FS, { text: `a-s-${k}`, files: 1, bytes: 10 }]));
  const [P1] = await startAll([[P, {}]]);
  const C1 = (await api.get(`/runs?parent=${P1}`)).json.items[0].id;
  const [R1] = await startAll([[W, { text: 'a-r', files: 1, bytes: 300 }]]);
  const replay = await api.post(`/runs/${R1}/replay`, { nodeId: 'files' });
  const R1f = replay.json.run.id;
  await api.waitFinal(R1f);

  // Aliases INTO approved workspaces from retained configuration and history.
  fs.symlinkSync(ws(X), join(alias, 'j-x'), 'junction');
  fs.symlinkSync(ws(Y), join(alias, 'j-y'), 'junction');
  const FA = await api.createLoop(workLoop('Retained via junction into X', { workingDirectory: { kind: 'fixed', path: join(alias, 'j-x') } }));
  const FB = await api.createLoop(workLoop('Configured missing child under junction into Y', { workingDirectory: { kind: 'fixed', path: join(alias, 'j-y', 'future', 'child') } }));

  // ------------------------------------------------------------------ retained runs
  const retainedSpecs = [];
  for (let i = 0; i < 260; i++) retainedSpecs.push([W, { text: `r-w-${i}`, files: 2, bytes: 64 }]);
  for (let i = 0; i < 100; i++) {
    const k = i % 40;
    const dir = i % 10 === 0 ? join(alias, 'j-up', 'tpl', String(k)) : i % 10 === 1 ? join(user, 'proj06', '..', 'tpl', String(k)) : join(user, 'tpl', String(k));
    retainedSpecs.push([TL, { text: `r-t-${i}`, files: 1, bytes: 32, dir }]);
  }
  for (let i = 0; i < 50; i++) retainedSpecs.push([F[i % 10], { text: `r-f-${i}`, files: 1, bytes: 32 }]);
  for (let i = 0; i < 10; i++) retainedSpecs.push([FS, { text: `r-s-${i}`, files: 1, bytes: 32 }]);
  for (let i = 0; i < 10; i++) retainedSpecs.push([FJ, { text: `r-j-${i}`, files: 1, bytes: 32 }]);
  retainedSpecs.push([FA, { text: 'r-fa', files: 1, bytes: 32 }]);
  retainedSpecs.push([TL, { text: 'r-tz', files: 1, bytes: 32, dir: ws(Z) }]);
  // Shared transcripts: a retained run reuses an approved run's transcript text.
  for (let i = 4; i < 7; i++) retainedSpecs.push([W, { text: `a-w-${i}`, files: 1, bytes: 16 }]);
  const retained = await startAll(retainedSpecs);
  ev.log(`setup: ${retained.length} retained runs created in ${Math.round((Date.now() - t0) / 1000)} s (plus approved ones)`);

  const approved = [...aw, X, Y, Z, ...at, ...af, ...as, P1, C1, R1, R1f];
  const allRuns = new Set([...approved, ...retained]);
  let bad = 0;
  for (const id of allRuns) {
    const r = await api.run(id);
    if (!['succeeded'].includes(r.status) || !r.finalizedAt) {
      bad++;
      ev.log('unexpected run state', id, r.status, r.failure?.code ?? '');
    }
  }
  ev.check(`all ${allRuns.size} runs succeeded and finalized`, bad === 0, bad);

  // Unrelated and look-alike files that no run created.
  fs.mkdirSync(join(dataDir, 'workspaces', 'unrelated'), { recursive: true });
  fs.writeFileSync(join(dataDir, 'workspaces', 'unrelated', 'note.txt'), 'unrelated');
  fs.mkdirSync(join(dataDir, 'workspaces', '01AAAAAAAAAAAAAAAAAAAAAAAA'), { recursive: true });
  fs.writeFileSync(join(dataDir, 'workspaces', '01AAAAAAAAAAAAAAAAAAAAAAAA', 'run-shaped.txt'), 'not a run');
  const fakeHash = createHash('sha256').update('unproven').digest('hex');
  fs.writeFileSync(join(dataDir, 'artifacts', 'transcript', fakeHash), 'unproven');
  fs.writeFileSync(join(dataDir, 'operator-notes.txt'), 'unrelated file in data dir');

  for (let i = 0; i < approved.length; i += 100) {
    const r = await api.mark(approved.slice(i, i + 100));
    if (r.status !== 200) throw new Error('mark ' + r.text);
  }
  ev.check(`${approved.length} approved runs (temp, template, fixed, shared, parent/child, replay pair)`, true);

  // Retained artifacts before pressure.
  const artifacts = [];
  for (const id of retained) {
    const th = (await api.get(`/runs/${id}/thread`)).json;
    for (const a of th.artifacts ?? []) {
      const got = await api.get(`/runs/${id}/artifacts/${a.id}`);
      artifacts.push({ id, artifact: a.id, status: got.status, sha: createHash('sha256').update(got.text).digest('hex') });
    }
  }
  ev.check(`retained artifacts readable before pressure (${artifacts.length})`, artifacts.every((a) => a.status === 200), artifacts.filter((a) => a.status !== 200).length);

  // ------------------------------------------------------------------ phase A: pressure
  const expectedGone = [...aw.slice(4), C1, R1, R1f];
  const expectedKeptApprovedWs = [...aw.slice(0, 4), X, Y, Z];
  const before = tree(base);
  const bytesBefore = managedBytes();
  let s = await api.storage();
  ev.log('storage before pressure', s);
  let paging = true;
  const pagingReport = { traversals: 0, pages: 0, problems: [] };
  const retainedSet = new Set(retained);
  const pagingLoop = (async () => {
    while (paging) {
      const pages = await api.listAll(7);
      const ids = pages.flat();
      pagingReport.traversals++;
      pagingReport.pages += pages.length;
      if (new Set(ids).size !== ids.length) pagingReport.problems.push({ duplicate: ids.length - new Set(ids).size });
      const listed = new Set(ids);
      const missing = retained.filter((id) => !listed.has(id));
      if (missing.length) pagingReport.problems.push({ missingRetained: missing.length });
      const unknown = ids.filter((id) => !allRuns.has(id));
      if (unknown.length) pagingReport.problems.push({ unknown });
    }
  })();
  const latency = [];
  let probing = true;
  const probeLoop = (async () => {
    while (probing) {
      const t = performance.now();
      await api.get('/runs?limit=1');
      latency.push(performance.now() - t);
      await sleep(20);
    }
  })();
  setCapacity(capacityFile, PRESSURE);
  const passes = [];
  for (let i = 0; i < 8; i++) {
    s = await waitPass(s.checkedAt);
    const present = [];
    for (const id of approved) if ((await api.get(`/runs/${id}`)).status === 200) present.push(id);
    const row = { pass: i + 1, state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources, reusable: s.reusableDatabaseBytes, approvedPresent: present.length, expectedGoneStillOnDisk: expectedGone.filter((id) => fs.existsSync(ws(id))).length };
    passes.push(row);
    ev.log('phase A pass', row);
    ev.check(`phase A pass ${i + 1}: not "no-eligible" while approved runs or reclaimable workspaces remain`, !(s.state === 'no-eligible' && (row.approvedPresent > 0 || row.expectedGoneStillOnDisk > 0)), row);
    if (s.state === 'no-eligible' && passes.at(-2)?.state === 'no-eligible') break;
  }
  paging = false;
  probing = false;
  await pagingLoop;
  await probeLoop;
  const sorted = [...latency].sort((a, b) => a - b);
  ev.log('GET /runs?limit=1 during phase A (ms)', { n: sorted.length, p50: +sorted[Math.floor(sorted.length / 2)].toFixed(1), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), max: +sorted.at(-1).toFixed(1), over1s: sorted.filter((x) => x > 1000).length });
  ev.check(`paging consistent during cleanup (limit 7, ${pagingReport.traversals} full traversals, ${pagingReport.pages} pages)`, pagingReport.problems.length === 0, pagingReport.problems.slice(0, 5));

  for (const id of approved) if ((await api.get(`/runs/${id}`)).status !== 404) ev.check(`approved ${id} deleted`, false);
  ev.check('every approved run record deleted', true);
  let retainedPresent = 0;
  for (const id of retained) if ((await api.get(`/runs/${id}`)).status === 200) retainedPresent++;
  ev.check(`every retained run still present (${retainedPresent}/${retained.length})`, retainedPresent === retained.length);
  const gone = expectedGone.filter((id) => !fs.existsSync(ws(id)));
  ev.check(`approved unshared temp workspaces reclaimed (${gone.length}/${expectedGone.length})`, gone.length === expectedGone.length, expectedGone.filter((id) => fs.existsSync(ws(id))));
  ev.check('approved workspaces with a junction or hard link inside, or aliased by retained configuration/history (X junction, Y missing child, Z template use), kept', expectedKeptApprovedWs.every((id) => fs.existsSync(ws(id))), expectedKeptApprovedWs.map((id) => [id, fs.existsSync(ws(id))]));
  const after = tree(base);
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(before).filter((k) => k in after && before[k] !== after[k]);
  const added = Object.keys(after).filter((k) => !(k in before));
  const allowedRemoved = (k) => expectedGone.some((id) => k.startsWith(`data/workspaces/${id}/`)) || k.startsWith('data/artifacts/transcript/');
  const ignorable = (k) => k.startsWith('data/graphgoblin.db') || k === 'capacity.json' || k === 'server.log' || k.startsWith('data/cleanup-pending');
  ev.check('only reclaimed approved workspaces (and approved artifacts) disappeared', removed.filter((k) => !allowedRemoved(k) && !ignorable(k)).length === 0, removed.filter((k) => !allowedRemoved(k) && !ignorable(k)).slice(0, 20));
  ev.check('no file outside the reclaimed set changed (user, template, shared, alias, outside, retained workspaces, unrelated)', changed.filter((k) => !ignorable(k)).length === 0 && added.filter((k) => !ignorable(k)).length === 0, { changed: changed.filter((k) => !ignorable(k)).slice(0, 10), added: added.filter((k) => !ignorable(k)).slice(0, 10) });
  const removedArtifacts = removed.filter((k) => k.startsWith('data/artifacts/transcript/'));
  ev.log(`artifact files removed: ${removedArtifacts.length} (ADR-0060 proof budget: 2,000 documents / 2 MiB)`);
  let artifactOk = 0;
  for (const a of artifacts) {
    const got = await api.get(`/runs/${a.id}/artifacts/${a.artifact}`);
    if (got.status === 200 && createHash('sha256').update(got.text).digest('hex') === a.sha) artifactOk++;
  }
  ev.check(`every retained artifact still retrievable and identical (${artifactOk}/${artifacts.length})`, artifactOk === artifacts.length);
  const credited = passes.reduce((a, p) => a + p.removedFileBytes, 0);
  const bytesAfter = managedBytes();
  ev.check('credited removedFileBytes equal the managed bytes that disappeared', credited === bytesBefore - bytesAfter, { credited, disappeared: bytesBefore - bytesAfter });
  const finalPages = await api.listAll(50);
  ev.check('final paging lists exactly the retained runs', finalPages.flat().length === retained.length && new Set(finalPages.flat()).size === retained.length);
  ev.log('kept count by pass', passes.map((p) => p.preserved));

  // ------------------------------------------------------------------ phase C: configured parent-directory alias
  fs.symlinkSync(join(dataDir, 'workspaces'), join(alias, 'j-ws'), 'junction');
  const FW = await api.createLoop(workLoop('Configured junction to the workspaces root', { workingDirectory: { kind: 'fixed', path: join(alias, 'j-ws') } }));
  const phaseC = retained.slice(0, 3);
  ev.check('phase C: approve three retained temp runs while a published loop is configured on a junction to the workspaces root', (await api.mark(phaseC)).status === 200);
  for (let i = 0; i < 2; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`phase C pass ${i + 1}`, { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources }, 'workspaces on disk', phaseC.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.check('phase C: workspaces enclosed by a configured parent alias are kept', phaseC.every((id) => fs.existsSync(ws(id))));
  const del = await api.call('DELETE', `/loops/${FW}`);
  ev.log('phase C: delete the configured loop', del.status);
  for (let i = 0; i < 3 && phaseC.some((id) => fs.existsSync(ws(id))); i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`phase C after loop deletion, pass ${i + 1}`, { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources }, 'workspaces on disk', phaseC.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.check('phase C: once the configuration is gone, the approved workspaces are reclaimed', phaseC.every((id) => !fs.existsSync(ws(id))));
  ev.check('phase C: the workspaces root and retained workspaces are untouched', retained.slice(3, 263).every((id) => fs.existsSync(ws(id))));

  // ------------------------------------------------------------------ phase D: template run that never resolved its directory
  const TX = await api.createLoop({
    schemaVersion: 4,
    name: 'Template without a working-directory step',
    settings: { workingDirectory: { kind: 'template', template: '{{ trigger.payload.dir }}' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
  });
  const [tx] = await startAll([[TX, { dir: join(user, 'tpl', '0') }]]);
  ev.log('phase D: retained template run that never needed its working directory', tx, (await api.run(tx)).status);
  const phaseD = retained.slice(3, 6);
  ev.check('phase D: approve three more retained temp runs', (await api.mark(phaseD)).status === 200);
  for (let i = 0; i < 3; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`phase D pass ${i + 1}`, { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources }, 'approved workspaces on disk', phaseD.filter((id) => fs.existsSync(ws(id))).length);
  }
  const keptByUnknown = phaseD.filter((id) => fs.existsSync(ws(id))).length;
  ev.log(`phase D: approved, unshared, unaliased workspaces still on disk after 3 passes: ${keptByUnknown}/3`);
  ev.check('phase D: approved unshared workspaces are reclaimed while an unrelated template run is retained', keptByUnknown === 0, { keptByUnknown, state: s.state });
  const markTx = await api.mark([tx]);
  ev.log('phase D: approve the template run itself', markTx.status);
  for (let i = 0; i < 3 && phaseD.some((id) => fs.existsSync(ws(id))); i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`phase D after the template run is approved, pass ${i + 1}`, { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources }, 'approved workspaces on disk', phaseD.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.log('phase D: workspaces on disk at the end', phaseD.filter((id) => fs.existsSync(ws(id))).length);
  fs.writeFileSync(join(base, 'runs.json'), JSON.stringify({ approved, retained, X, Y, Z, tx }, null, 2));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  const stopped = await Promise.race([server.stop(), sleep(60_000).then(() => 'timeout')]);
  ev.log('server stop', stopped);
  if (stopped === 'timeout') ev.log('server kill after stop timeout', await server.kill());
  ev.log('failures', ev.failures ?? 0);
}
