// Check 3: kill the real API (TerminateProcess) at observed phases of a pressure cleanup pass:
// right after it listens (batch deletion), during refresh/inventory (batch committed, nothing
// staged yet), right after a workspace is renamed into quarantine (before any unlink), mid-purge,
// and during a later job's inventory. Each kill is classified from the stopped store, then the
// store is inspected read-only. Finally the API restarts under pressure and must finish cleanly.
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, temp, join, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('07-interrupt-phases');
const base = join(temp, 'gg-qa-412f-a-phases');
// Fixture is unique. Leave all directories for the orchestrator.
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const logFile = join(base, 'server.log.txt');
const PORT = 6624;
const FILES = 1500;
setCapacity(capacityFile, ADEQUATE);
const inspect = () => JSON.parse(execFileSync('python', ['-I', join(here, 'inspect-db.py'), dataDir], { encoding: 'utf8' }));
const qdir = join(dataDir, 'cleanup-pending');
const qEntries = () => (fs.existsSync(qdir) ? fs.readdirSync(qdir) : []);
const count = (dir) => {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
};
const bytesUnder = (dir) => {
  let b = 0;
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
      else b += fs.lstatSync(p).size;
    }
  };
  walk(dir);
  return b;
};
const scriptLoop = {
  schemaVersion: 4,
  name: 'Phases work',
  settings: { workingDirectory: { kind: 'temp' } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'files',
      kind: 'script',
      label: 'Write files',
      config: {
        command: process.execPath,
        args: ['-e', "const fs=require('fs');const n=Number(process.argv[1]);fs.mkdirSync('sub');for(let i=0;i<n;i++)fs.writeFileSync((i%2?'sub/':'')+'f'+i+'.bin',Buffer.alloc(1000,121));", '{{ trigger.payload.files }}'],
        cwd: 'workspace',
        stdin: 'none',
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'files', port: 'in' } },
    { id: 'e2', from: { node: 'files', port: 'out' }, to: { node: 'done', port: 'in' } },
  ],
};

function launch() {
  const child = spawn(process.execPath, [join(here, 'qa-server.mjs'), dataDir, String(PORT), capacityFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, QA_LOG_LEVEL: 'warn' } });
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  let buffer = '';
  let readyAt;
  const ready = new Promise((res) => {
    const on = (chunk) => {
      out.write(String(chunk).replace(/"hostname":"[^"]*",?/g, ''));
      buffer += String(chunk);
      if (!readyAt && /QA_READY/.test(buffer)) {
        readyAt = Date.now();
        res(readyAt);
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
  const exited = new Promise((res) => child.once('exit', res));
  return { child, ready, exited, out };
}

let ids;
async function killWhen(label, trigger) {
  const s = launch();
  await s.ready;
  const t0 = Date.now();
  const seen = await trigger(t0);
  const q = qEntries();
  const atKill = { msAfterListening: Date.now() - t0, quarantineEntries: q.length, quarantineFiles: q.map((e) => count(join(qdir, e))), ...seen };
  s.child.kill('SIGKILL');
  await s.exited;
  s.out.end();
  const db = inspect();
  const orphan = q.filter((n) => !db.pendingQuarantineNames.includes(n));
  const approvedPresent = db.approved;
  const phase =
    seen.phase ??
    (approvedPresent === ids.approved.length && db.pendingResources === 0 ? 'before batch commit' : q.length === 0 ? 'refresh/inventory (batch committed, nothing staged)' : 'with quarantine present');
  ev.log(`kill [${label}] classified as: ${phase}`, atKill, {
    runs: db.runs,
    approved: db.approved,
    pending: db.pendingResources,
    quarantinedJobs: db.quarantinedJobs,
    integrity: db.integrity,
    references: db.workspaceReferences,
    unknownReferences: db.workspaceReferencesUnknown,
    orphanReferences: db.workspaceReferencesOrphanRun,
    sweep: db.workspaceReferenceState,
  });
  ev.check(`kill [${label}]: integrity ok, no orphan events/sessions/uses, no dangling relations`, db.integrity === 'ok' && db.orphanEvents === 0 && db.orphanSessions === 0 && db.orphanUses === 0 && db.danglingParents === 0 && db.danglingReplaySources === 0, db);
  ev.check(`kill [${label}]: every pending job carries its approval and no pending job's run survives`, db.pendingWithApproval === db.pendingResources && db.pendingWhoseRunExists === 0);
  ev.check(`kill [${label}]: every quarantine directory belongs to a pending job`, orphan.length === 0, orphan);
  ev.check(`kill [${label}]: no workspace reference row for a deleted run`, db.workspaceReferencesOrphanRun === 0 && db.workspaceReferencesOrphanVersion === 0);
  ev.check(`kill [${label}]: retained workspaces intact`, ids.retained.every((id) => count(join(dataDir, 'workspaces', id)) === 10));
  return { phase, atKill, db };
}

let server;
try {
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  const api = client(server.url);
  const S = await api.createLoop(scriptLoop);
  const approved = [];
  for (let i = 0; i < 24; i++) {
    approved.push((await api.startRun(S, { files: FILES })).id);
    if (i % 4 === 3) await api.waitFinal(approved.at(-1), 300_000);
  }
  const retained = [];
  for (let i = 0; i < 4; i++) retained.push((await api.startRun(S, { files: 10 })).id);
  for (const id of [...approved, ...retained]) await api.waitFinal(id, 300_000);
  ev.check('24 approved runs with 1,500-file workspaces (two directory levels)', (await api.mark(approved)).status === 200);
  ids = { approved, retained };
  await server.stop();
  server = undefined;
  const initialBytes = bytesUnder(join(dataDir, 'workspaces'));
  ev.log('initial', { workspaceBytes: initialBytes, db: (({ runs, approved, pendingResources, workspaceReferences }) => ({ runs, approved, pendingResources, workspaceReferences }))(inspect()) });

  setCapacity(capacityFile, PRESSURE);
  const poll = async (cond, max = 120_000) => {
    const t = Date.now();
    for (;;) {
      const r = cond();
      if (r) return r;
      if (Date.now() - t > max) return { phase: 'condition not reached' };
      await new Promise((res) => setImmediate(res));
    }
  };
  const results = [];
  results.push(await killWhen('immediately on listening', async () => ({})));
  results.push(await killWhen('120 ms after listening, quarantine empty', async (t0) => poll(() => (Date.now() - t0 >= 120 ? {} : undefined))));
  results.push(
    await killWhen('first quarantine entry appears (after rename, before unlink)', async () =>
      poll(() => {
        const q = qEntries();
        return q.length ? { phase: 'after quarantine, before purge', files: count(join(qdir, q[0])) } : undefined;
      }),
    ),
  );
  results.push(
    await killWhen('quarantine entry below half of its files (mid-purge)', async () =>
      poll(() => {
        for (const e of qEntries()) {
          const n = count(join(qdir, e));
          if (n > 0 && n < FILES / 2) return { phase: 'mid-purge', files: n };
        }
        return undefined;
      }),
    ),
  );
  results.push(
    await killWhen('a job finished and the next is not yet staged (later inventory)', async () => {
      let sawEntry = false;
      let lastPending;
      return poll(() => {
        const q = qEntries();
        if (q.length) sawEntry = true;
        else if (sawEntry) return { phase: 'inventory of a later job (previous job purged, next not staged)', previousEntry: lastPending };
        lastPending = q[0];
        return undefined;
      });
    }),
  );
  results.push(
    await killWhen('quarantine entry appears again', async () =>
      poll(() => {
        const q = qEntries();
        return q.length ? { phase: 'after quarantine, before purge', files: count(join(qdir, q[0])) } : undefined;
      }),
    ),
  );
  ev.log('kill phases reached', results.map((r) => r.phase));

  // ------------------------------------------------------------ restart under pressure and finish
  const atResume = { db: inspect(), bytes: bytesUnder(join(dataDir, 'workspaces')) + bytesUnder(qdir) };
  ev.log('before final restart', { pending: atResume.db.pendingResources, quarantinedJobs: atResume.db.quarantinedJobs, quarantineDirs: qEntries().length, managedBytes: atResume.bytes });
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  const api2 = client(server.url);
  let st = await api2.storage();
  for (let i = 0; st.cleaning && i < 3000; i++) {
    await sleep(100);
    st = await api2.storage();
  }
  const passes = [st];
  ev.log('startup pass (after listening)', { state: st.state, deletedRuns: st.deletedRuns, removedFileBytes: st.removedFileBytes, pending: st.pendingResources, preserved: st.preservedResources });
  for (let i = 0; i < 4 && (st.pendingResources > 0 || st.state === 'pressure'); i++) {
    const prev = st.checkedAt;
    for (;;) {
      st = await api2.storage();
      if (st.checkedAt !== prev && !st.cleaning) break;
      await sleep(250);
    }
    passes.push(st);
    ev.log(`timer pass ${i + 1}`, { state: st.state, deletedRuns: st.deletedRuns, removedFileBytes: st.removedFileBytes, pending: st.pendingResources, preserved: st.preservedResources });
  }
  const endBytes = bytesUnder(join(dataDir, 'workspaces')) + bytesUnder(qdir);
  const credited = passes.reduce((a, p) => a + p.removedFileBytes, 0);
  ev.check('after restart: credited bytes equal bytes removed after the restart (no double credit)', credited === atResume.bytes - endBytes, { credited, removedAfterRestart: atResume.bytes - endBytes, unlinkedByKilledPasses: initialBytes - atResume.bytes });
  ev.check('end: quarantine empty, no pending jobs, only retained workspaces remain', qEntries().length === 0 && st.pendingResources === 0 && fs.readdirSync(join(dataDir, 'workspaces')).length === retained.length, { q: qEntries().length, pending: st.pendingResources, workspaces: fs.readdirSync(join(dataDir, 'workspaces')).length });
  ev.check('end: status no-eligible with nothing kept', st.state === 'no-eligible' && st.preservedResources === 0, st.state);
  for (const id of approved) if ((await api2.get(`/runs/${id}`)).status !== 404) ev.check(`approved ${id} deleted`, false);
  const listing = (await api2.listAll(3)).flat();
  ev.check('end: paging lists exactly the retained runs, each readable', listing.length === retained.length && retained.every((id) => listing.includes(id)), listing);
  for (const id of retained) ev.check(`retained ${id} unapproved and readable`, !(await api2.run(id)).deletionApproval);
  await server.stop();
  server = undefined;
  const fin = inspect();
  ev.log('final db', { ...fin, pendingQuarantineNames: fin.pendingQuarantineNames.length });
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
  await server?.kill().catch(() => undefined);
} finally {
  ev.log('failures', ev.failures ?? 0);
}
