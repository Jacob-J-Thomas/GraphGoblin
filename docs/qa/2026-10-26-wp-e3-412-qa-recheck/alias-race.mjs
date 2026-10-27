// Check 2, orchestrator case (b): the workspace alias race ADR-0060 documents ("Remaining
// filesystem race"). A retained run's fixed working directory X is a junction to an unrelated
// retained directory Y. During a pressure pass, after the refresh sweep (detected when the first
// approved workspace A appears in quarantine) and before approved workspace B is staged, X is
// retargeted to B's workspace. Controls: the same retarget between passes (before the sweep),
// and substitution of an approved workspace itself by a junction.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, temp, join, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('17-alias-race');
const base = join(temp, 'gg-qa-e3r-race');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const capacityFile = join(base, 'capacity.json');
const dataDir = join(base, 'data');
const Y = join(base, 'y');
const Y2 = join(base, 'y2');
const X = join(base, 'x-link');
const X2 = join(base, 'x2-link');
const eMoved = join(base, 'e-moved');
for (const [d, text] of [[Y, 'retained y'], [Y2, 'retained y2']]) {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(join(d, 'sentinel.txt'), text);
}
fs.symlinkSync(Y, X, 'junction');
fs.symlinkSync(Y2, X2, 'junction');
setCapacity(capacityFile, ADEQUATE);
const ws = (id) => join(dataDir, 'workspaces', id);
const quarantine = join(dataDir, 'cleanup-pending');
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const scriptLoop = (name, workingDirectory) => ({
  schemaVersion: 4,
  name,
  settings: { workingDirectory },
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
async function waitPass(api, prev) {
  const deadline = Date.now() + 150_000;
  for (;;) {
    const s = await api.storage();
    if (s.checkedAt !== prev && !s.cleaning) return s;
    if (Date.now() > deadline) throw new Error('no pass observed');
    await sleep(100);
  }
}

const server = await startServer({ dataDir, port: 6581, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
const api = client(server.url);
try {
  const S = await api.createLoop(scriptLoop('Race temp', { kind: 'temp' }));
  const FR = await api.createLoop(scriptLoop('Race retained fixed X', { kind: 'fixed', path: X }));
  const FR2 = await api.createLoop(scriptLoop('Race retained fixed X2', { kind: 'fixed', path: X2 }));
  const ids = {};
  for (const [k, files] of [['A', 1900], ['B', 20], ['E', 5]]) {
    ids[k] = (await api.startRun(S, { files })).id;
    await api.waitFinal(ids[k], 300_000);
  }
  ids.r1 = (await api.startRun(FR, { files: 1 })).id;
  ids.r2 = (await api.startRun(FR2, { files: 1 })).id;
  ids.D = (await api.startRun(S, { files: 20 })).id;
  for (const k of ['r1', 'r2', 'D']) await api.waitFinal(ids[k], 300_000);
  ev.log('runs', ids);
  ev.check('approve A (1,900 files), B (20 files) and E (5 files)', (await api.mark([ids.A, ids.B, ids.E])).status === 200);
  // Substitution control: E's own workspace replaced by a junction to an outside directory.
  fs.renameSync(ws(ids.E), eMoved);
  fs.symlinkSync(eMoved, ws(ids.E), 'junction');
  const eBefore = fs.readdirSync(eMoved).length;
  const yBefore = sha(join(Y, 'sentinel.txt'));
  const bBefore = fs.readdirSync(ws(ids.B)).length;

  // ------------------------------------------------ in-pass retarget X: Y -> B's workspace
  let s = await api.storage();
  setCapacity(capacityFile, PRESSURE);
  const t0 = Date.now();
  let retargetedAt;
  let bAtRetarget;
  for (;;) {
    const entries = fs.existsSync(quarantine) ? fs.readdirSync(quarantine) : [];
    if (entries.length) {
      fs.rmdirSync(X); // removes the junction only
      fs.symlinkSync(ws(ids.B), X, 'junction');
      retargetedAt = Date.now() - t0;
      bAtRetarget = { exists: fs.existsSync(ws(ids.B)), quarantineEntries: entries.length };
      break;
    }
    if (Date.now() - t0 > 150_000) throw new Error('A never reached quarantine');
    await new Promise((r) => setImmediate(r));
  }
  ev.log(`retargeted X to B's workspace ${retargetedAt} ms after pressure was set, once A was in quarantine`, bAtRetarget);
  s = await waitPass(api, s.checkedAt);
  ev.log('pass 1', { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
  const bGone = !fs.existsSync(ws(ids.B));
  ev.log('after pass 1', {
    A_workspace: fs.existsSync(ws(ids.A)),
    B_workspace: fs.existsSync(ws(ids.B)),
    X_isLink: fs.lstatSync(X).isSymbolicLink(),
    X_target: fs.readlinkSync(X),
    X_resolves: fs.existsSync(X),
    Y_sentinel_unchanged: sha(join(Y, 'sentinel.txt')) === yBefore,
    r1: (await api.get(`/runs/${ids.r1}`)).status,
  });
  ev.log(`OUTCOME in-pass race: B's workspace (${bBefore} entries) ${bGone ? 'was REMOVED although the retained fixed directory X now points at it (the race ADR-0060 documents)' : 'was KEPT'}`);
  ev.check('substitution control: E (workspace replaced by a junction) kept, outside target untouched', fs.lstatSync(ws(ids.E)).isSymbolicLink() && fs.readdirSync(eMoved).length === eBefore);
  ev.check('retained directory Y untouched', sha(join(Y, 'sentinel.txt')) === yBefore && fs.existsSync(join(Y, 'f0.bin')));
  const again = (await api.startRun(FR, { files: 1 })).id;
  const againRun = await api.waitFinal(again, 120_000);
  ev.log('a new run of the retained loop whose fixed directory X now dangles', { status: againRun.status, failure: againRun.failure ?? null });

  // ------------------------------------------------ between-pass retarget X2: Y2 -> D's workspace, then approve D
  fs.rmdirSync(X2);
  fs.symlinkSync(ws(ids.D), X2, 'junction');
  ev.check('approve D after its workspace became the target of X2 (between passes)', (await api.mark([ids.D])).status === 200);
  s = await waitPass(api, s.checkedAt);
  ev.log('pass 2', { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
  s = await waitPass(api, s.checkedAt);
  ev.log('pass 3', { state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
  ev.check('control: a junction created before the sweep protects D (run deleted, workspace kept)', (await api.get(`/runs/${ids.D}`)).status === 404 && fs.existsSync(ws(ids.D)) && fs.readdirSync(ws(ids.D)).length === 20);
  ev.check('Y2 untouched', fs.readFileSync(join(Y2, 'sentinel.txt'), 'utf8') === 'retained y2');
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  try {
    for (const r of (await api.get('/runs?status=queued,running,waiting,paused&limit=50')).json.items) await api.post(`/runs/${r.id}/cancel`);
  } catch {}
  ev.log('server stop', await server.stop());
  ev.log('failures', ev.failures ?? 0);
}
