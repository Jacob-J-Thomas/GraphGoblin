// Check 5, second store: workspace-only resources (script loop, no transcript artifacts) so the
// kill lands in filesystem reclamation (inventory, quarantine rename, unlink) rather than in the
// artifact proof budget. Kills the real API at increasing delays after a pass begins.
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import {
  startServer,
  client,
  setCapacity,
  ADEQUATE,
  PRESSURE,
  temp,
  join,
  here,
  Evidence,
  sleep,
} from './qa-lib.mjs';

const ev = new Evidence('06-interrupt-reap');
const base = join(temp, 'gg-qa-e3-reap');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const logFile = join(base, 'server.log');
const PORT = 6481;
setCapacity(capacityFile, ADEQUATE);
const inspect = () => JSON.parse(execFileSync('python', ['-I', join(here, 'inspect-db.py'), dataDir], { encoding: 'utf8' }));
const sizeOf = (dir) => {
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
};
const disk = () => ({
  workspaces: fs.existsSync(join(dataDir, 'workspaces')) ? fs.readdirSync(join(dataDir, 'workspaces')).length : 0,
  workspaceFiles: sizeOf(join(dataDir, 'workspaces')),
  quarantine: fs.existsSync(join(dataDir, 'cleanup-pending')) ? fs.readdirSync(join(dataDir, 'cleanup-pending')) : [],
  quarantineFiles: sizeOf(join(dataDir, 'cleanup-pending')),
});
const scriptLoop = (name) => ({
  schemaVersion: 4,
  name,
  settings: { workingDirectory: { kind: 'temp' } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'files',
      kind: 'script',
      label: 'Write files',
      config: {
        command: process.execPath,
        args: ['-e', "const fs=require('fs');const n=Number(process.argv[1]);for(let i=0;i<n;i++)fs.writeFileSync('f'+i+'.bin',Buffer.alloc(2000,121));", '{{ trigger.payload.files }}'],
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
});

let server;
try {
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  let api = client(server.url);
  const S = await api.createLoop(scriptLoop('Reap work'));
  const approved = [];
  const retained = [];
  for (let i = 0; i < 30; i++) {
    approved.push((await api.startRun(S, { files: 1500 })).id);
    if (i % 5 === 4) await api.waitFinal(approved.at(-1), 300_000);
  }
  for (let i = 0; i < 3; i++) retained.push((await api.startRun(S, { files: 10 })).id);
  for (const id of [...approved, ...retained]) await api.waitFinal(id, 300_000);
  const marked = await api.mark(approved);
  ev.check('30 workspace-heavy runs approved', marked.status === 200, marked.status);
  await server.stop();
  const initial = { db: inspect(), disk: disk() };
  ev.log('initial', { ...initial, db: { ...initial.db, pendingQuarantineNames: initial.db.pendingQuarantineNames.length } });

  setCapacity(capacityFile, PRESSURE);
  const delays = [250, 700, 1200, 2000, 3000, 4500, 6500];
  for (const delay of delays) {
    const child = spawn(process.execPath, [join(here, 'qa-server.mjs'), dataDir, String(PORT), capacityFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, QA_LOG_LEVEL: 'warn' } });
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
    const exited = new Promise((res) => child.once('exit', res));
    await passStarted;
    await sleep(delay);
    const wasReady = /QA_READY/.test(buffer);
    child.kill('SIGKILL');
    await exited;
    out.end();
    const state = { db: inspect(), disk: disk() };
    const orphanQuarantine = state.disk.quarantine.filter((n) => !state.db.pendingQuarantineNames.includes(n));
    ev.log(`kill ${delay} ms after the pass began (pass finished, listening: ${wasReady})`, {
      runs: state.db.runs,
      approved: state.db.approved,
      pending: state.db.pendingResources,
      workspaces: state.disk.workspaces,
      workspaceFiles: state.disk.workspaceFiles,
      quarantineEntries: state.disk.quarantine.length,
      quarantineFiles: state.disk.quarantineFiles,
      integrity: state.db.integrity,
    });
    ev.check(`kill@${delay}: every quarantined directory belongs to a pending job (no orphan)`, orphanQuarantine.length === 0, orphanQuarantine);
    ev.check(`kill@${delay}: pending jobs carry approvals; no pending job for a surviving run; integrity ok`, state.db.pendingWithApproval === state.db.pendingResources && state.db.pendingWhoseRunExists === 0 && state.db.integrity === 'ok');
    ev.check(`kill@${delay}: retained workspaces intact`, retained.every((id) => fs.existsSync(join(dataDir, 'workspaces', id)) && fs.readdirSync(join(dataDir, 'workspaces', id)).length === 10));
  }
  // Restart and finish.
  const atResume = { db: inspect(), disk: disk() };
  const presentAtResume = atResume.disk.workspaceFiles.bytes + atResume.disk.quarantineFiles.bytes;
  ev.log('before final restart', { pending: atResume.db.pendingResources, quarantine: atResume.disk.quarantine.length, bytes: presentAtResume });
  server = await startServer({ dataDir, port: PORT, capacityFile, logFile, env: { QA_LOG_LEVEL: 'warn' } });
  api = client(server.url);
  let st = await api.storage();
  const passes = [st];
  ev.log('startup pass', { state: st.state, deletedRuns: st.deletedRuns, removedFileBytes: st.removedFileBytes, pending: st.pendingResources, preserved: st.preservedResources });
  for (let i = 0; i < 4 && st.pendingResources > 0; i++) {
    const prev = st.checkedAt;
    for (;;) {
      st = await api.storage();
      if (st.checkedAt !== prev && !st.cleaning) break;
      await sleep(500);
    }
    passes.push(st);
    ev.log(`timer pass ${i + 1}`, { state: st.state, deletedRuns: st.deletedRuns, removedFileBytes: st.removedFileBytes, pending: st.pendingResources, preserved: st.preservedResources });
  }
  const end = disk();
  const credited = passes.reduce((a, p) => a + p.removedFileBytes, 0);
  const presentAtEnd = end.workspaceFiles.bytes + end.quarantineFiles.bytes;
  ev.check('after restart: credited bytes equal bytes actually removed after restart', credited === presentAtResume - presentAtEnd, { credited, removed: presentAtResume - presentAtEnd });
  ev.check('end: quarantine empty, only retained workspaces remain, no pending jobs', end.quarantine.length === 0 && end.workspaces === retained.length && st.pendingResources === 0, { ...end, quarantine: end.quarantine.length, pending: st.pendingResources });
  const listing = (await api.listAll(2)).flat();
  ev.check('end: paging lists exactly the retained runs', listing.length === retained.length && retained.every((id) => listing.includes(id)), listing);
  ev.log('honesty: bytes unlinked by killed passes were never credited', { initialBytes: initial.disk.workspaceFiles.bytes, retainedBytes: end.workspaceFiles.bytes, creditedAfterRestart: credited });
  await server.stop();
  const fin = inspect();
  ev.log('final db', { ...fin, pendingQuarantineNames: fin.pendingQuarantineNames.length });
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  await server?.kill().catch(() => undefined);
} finally {
  ev.log('failures', ev.failures ?? 0);
}
