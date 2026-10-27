// Check 5: kill the real API process (TerminateProcess) at different moments of pressure cleanup,
// inspect the stopped store, restart, and verify approvals, references, paging, files and
// accounting stay consistent and the job resumes.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  startServer,
  client,
  setCapacity,
  ADEQUATE,
  PRESSURE,
  workLoop,
  parentLoop,
  temp,
  join,
  here,
  Evidence,
  sleep,
} from './qa-lib.mjs';
import { spawn } from 'node:child_process';

const ev = new Evidence('05-interrupt');
const base = join(temp, 'gg-qa-e3r-crash');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const logFile = join(base, 'server.log');
const PORT = 6584;
setCapacity(capacityFile, ADEQUATE);

const inspect = () => JSON.parse(execFileSync('python', ['-I', join(here, 'inspect-db.py'), dataDir], { encoding: 'utf8' }));
function files(dir) {
  let count = 0,
    bytes = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        count++;
        bytes += fs.lstatSync(p).size;
      }
    }
  };
  walk(dir);
  return { count, bytes };
}
const disk = () => ({
  workspaces: fs.existsSync(join(dataDir, 'workspaces')) ? fs.readdirSync(join(dataDir, 'workspaces')).length : 0,
  workspaceFiles: files(join(dataDir, 'workspaces')),
  quarantine: fs.existsSync(join(dataDir, 'cleanup-pending')) ? fs.readdirSync(join(dataDir, 'cleanup-pending')).length : 0,
  quarantineFiles: files(join(dataDir, 'cleanup-pending')),
  artifactFiles: files(join(dataDir, 'artifacts')),
});

/** Spawn with the capacity file as it is; resolve when the first cleanup pass begins (port read). */
function spawnUntilPass() {
  const child = spawn(process.execPath, [join(here, 'qa-server.mjs'), dataDir, String(PORT), capacityFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, QA_LOG_LEVEL: 'warn' },
  });
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  let buffer = '';
  const passStarted = new Promise((res) => {
    const on = (chunk) => {
      out.write(String(chunk).replace(/"hostname":"[^"]*",?/g, ''));
      buffer += String(chunk);
      if (/QA_CAPACITY_READ/.test(buffer)) res(Date.now());
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
  const exited = new Promise((res) => child.once('exit', (code) => res(code)));
  return { child, passStarted, exited, out, ready: () => /QA_READY/.test(buffer) };
}

let server;
let api;
try {
  // ------------------------------------------------------------ build the store
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  api = client(server.url);
  const W = await api.createLoop(workLoop('Crash work'));
  const C = await api.createLoop(workLoop('Crash child'));
  const P = await api.createLoop(parentLoop('Crash parent', C));
  const approved = [];
  const retained = [];
  const N = 60;
  for (let i = 0; i < N; i++) {
    const shared = i % 10 === 0; // every tenth approved run shares its transcript with a retained run
    const text = shared ? `shared ${i} [[items=400]]` : `approved ${i} [[items=400]]`;
    approved.push((await api.startRun(W, { text, files: 200, bytes: 1000 })).id);
    if (shared) retained.push((await api.startRun(W, { text, files: 5, bytes: 10 })).id);
    if (i % 6 === 5) await api.waitFinal(approved.at(-1), 300_000);
  }
  for (let i = 0; i < 8; i++) retained.push((await api.startRun(W, { text: `retained ${i}`, files: 5, bytes: 10 })).id);
  const parent = (await api.startRun(P, {})).id;
  for (const id of [...approved, ...retained, parent]) await api.waitFinal(id, 300_000);
  const child = (await api.get(`/runs?parent=${parent}`)).json.items[0].id;
  approved.push(parent, child);
  for (let i = 0; i < approved.length; i += 100) {
    const r = await api.mark(approved.slice(i, i + 100));
    if (r.status !== 200) throw new Error('mark ' + r.text);
  }
  // A retained run with a delete-ready mark withdrawn stays retained.
  const sharedArtifacts = [];
  for (const id of retained) {
    const th = (await api.get(`/runs/${id}/thread`)).json;
    for (const a of th.artifacts ?? []) {
      const got = await api.get(`/runs/${id}/artifacts/${a.id}`);
      sharedArtifacts.push({ id, artifact: a.id, sha: createHash('sha256').update(got.text).digest('hex') });
    }
  }
  ev.log(`store: ${approved.length} approved (incl. parent/child), ${retained.length} retained`);
  await server.stop();
  const initial = { db: inspect(), disk: disk() };
  ev.log('initial', initial);
  const totalOwnedBytes = initial.disk.workspaceFiles.bytes; // artifact bytes are tracked separately
  fs.writeFileSync(join(base, 'ids.json'), JSON.stringify({ approved, retained, sharedArtifacts }));

  // ------------------------------------------------------------ kill at different moments
  setCapacity(capacityFile, PRESSURE);
  const delays = [0, 15, 60, 150, 300, 600, 1200, 2500];
  for (const delay of delays) {
    const s = spawnUntilPass();
    const t0 = await Promise.race([s.passStarted, s.exited.then(() => null)]);
    if (t0 === null) {
      ev.log(`delay ${delay}: process exited before a pass`);
      continue;
    }
    if (delay) await sleep(delay);
    const wasReady = s.ready();
    s.child.kill('SIGKILL');
    await s.exited;
    s.out.end();
    const state = { db: inspect(), disk: disk() };
    ev.log(`kill ${delay} ms after the pass began (listening before kill: ${wasReady})`, state);
    ev.check(`after kill@${delay}: integrity ok, no orphan rows, no dangling relations`, state.db.integrity === 'ok' && state.db.orphanEvents === 0 && state.db.orphanSessions === 0 && state.db.danglingParents === 0 && state.db.danglingReplaySources === 0, state.db);
    ev.check(`after kill@${delay}: every pending job carries its approval and has no surviving run`, state.db.pendingWithApproval === state.db.pendingResources && state.db.pendingWhoseRunExists === 0, state.db);
  }

  // ------------------------------------------------------------ restart under adequate storage: nothing moves
  setCapacity(capacityFile, ADEQUATE);
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  api = client(server.url);
  const beforeAdequate = disk();
  const listing = (await api.listAll(7)).flat();
  ev.check('restart (adequate): paging has no duplicates', new Set(listing).size === listing.length, listing.length);
  ev.check('restart (adequate): every retained run listed and readable', retained.every((id) => listing.includes(id)));
  let unreadable = 0;
  for (const id of listing) {
    const r = await api.get(`/runs/${id}`);
    const e = await api.get(`/runs/${id}/events?after=0&limit=5`);
    if (r.status !== 200 || e.status !== 200) unreadable++;
  }
  ev.check('restart (adequate): every listed run and its events readable (no partial run)', unreadable === 0, unreadable);
  let approvalsIntact = 0;
  for (const id of approved) {
    const r = await api.get(`/runs/${id}`);
    if (r.status === 200 && r.json.deletionApproval) approvalsIntact++;
    if (r.status === 200 && !r.json.deletionApproval) ev.log('approved run lost its approval', id);
  }
  ev.log(`approved runs still present (and still approved): ${approvalsIntact}`);
  ev.check('restart (adequate): no retained run gained approval', (await Promise.all(retained.map(async (id) => (await api.run(id)).deletionApproval))).every((a) => !a));
  const s0 = await api.storage();
  ev.log('storage after adequate restart', s0);
  await sleep(1500);
  ev.check('adequate restart deletes nothing more (files unchanged)', JSON.stringify(disk()) === JSON.stringify(beforeAdequate), { before: beforeAdequate, after: disk() });
  await server.stop();

  // ------------------------------------------------------------ pressure until done
  setCapacity(capacityFile, PRESSURE);
  const atResume = { db: inspect(), disk: disk() };
  ev.log('state before resuming cleanup', atResume);
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  api = client(server.url);
  let st = await api.storage();
  // Re-check harness fix: since round 2 the startup cleanup runs AFTER listening, so wait for it
  // to finish before taking its result (the first QA's harness read it at listen time).
  for (let i = 0; st.cleaning && i < 6000; i++) {
    await sleep(100);
    st = await api.storage();
  }
  const passes = [st];
  ev.log('startup pass', st);
  let stable = 0;
  for (let i = 0; i < 12 && stable < 2; i++) {
    const prev = st.checkedAt;
    for (;;) {
      st = await api.storage();
      if (st.checkedAt !== prev && !st.cleaning) break;
      await sleep(500);
    }
    passes.push(st);
    ev.log(`timer pass ${i + 1}`, { state: st.state, deletedRuns: st.deletedRuns, removedFileBytes: st.removedFileBytes, pending: st.pendingResources, preserved: st.preservedResources, reusable: st.reusableDatabaseBytes });
    stable = st.state === 'no-eligible' && st.deletedRuns === 0 && st.removedFileBytes === 0 ? stable + 1 : 0;
  }
  const end = disk();
  ev.log('end disk', end);
  for (const id of approved) ev.check(`approved ${id} deleted`, (await api.get(`/runs/${id}`)).status === 404);
  for (const id of retained) ev.check(`retained ${id} present`, (await api.get(`/runs/${id}`)).status === 200);
  for (const a of sharedArtifacts) {
    const got = await api.get(`/runs/${a.id}/artifacts/${a.artifact}`);
    ev.check(`retained artifact ${a.artifact} identical after interrupted cleanup`, got.status === 200 && createHash('sha256').update(got.text).digest('hex') === a.sha, got.status);
  }
  const listingEnd = (await api.listAll(7)).flat();
  ev.check('final paging: exactly the retained runs, no duplicates', listingEnd.length === retained.length && new Set(listingEnd).size === listingEnd.length && retained.every((id) => listingEnd.includes(id)), listingEnd.length);
  ev.check('quarantine empty at the end', end.quarantine === 0, end);
  ev.check('only retained workspaces remain', end.workspaces === retained.length, end.workspaces);
  const credited = passes.reduce((a, p) => a + p.removedFileBytes, 0);
  const presentAtResume = atResume.disk.workspaceFiles.bytes + atResume.disk.quarantineFiles.bytes + atResume.disk.artifactFiles.bytes;
  const presentAtEnd = end.workspaceFiles.bytes + end.quarantineFiles.bytes + end.artifactFiles.bytes;
  ev.check('bytes credited after restart equal bytes actually removed after restart (no double credit)', credited === presentAtResume - presentAtEnd, { credited, removedAfterRestart: presentAtResume - presentAtEnd, totalOwnedWorkspaceBytesInitially: totalOwnedBytes });
  await server.stop();
  ev.log('final db state', inspect());
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  await server?.kill().catch(() => undefined);
} finally {
  ev.log('failures', ev.failures ?? 0);
}
