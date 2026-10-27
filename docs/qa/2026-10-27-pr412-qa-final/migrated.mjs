// R1 migrated-store case, step 2 of 2: start the PR head on the pre-PR store made by
// mkstore-main.mjs (migrations 0021 and 0022 apply), inspect the backfilled obligations, then
// check behaviour under pressure:
//   - terminal template runs that never resolved a directory create no obligation;
//   - a LIVE dynamic template run (dw, waiting) blocks reclamation only while it is live;
//   - a LIVE literal template run (lw) protects only its own literal directory;
//   - a new live literal run whose literal path IS an approved workspace protects that workspace
//     until the run ends.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer, client, setCapacity, ADEQUATE, PRESSURE, workLoop, temp, join, here, Evidence, sleep } from './qa-lib.mjs';

const ev = new Evidence('02b-migrated');
const base = join(temp, 'gg-qa-412f-b-mig');
const dataDir = join(base, 'data');
const capacityFile = join(base, 'capacity.json');
const { ids } = JSON.parse(fs.readFileSync(join(base, 'ids.json'), 'utf8'));
const refs = () => JSON.parse(execFileSync('python', ['-I', join(here, 'refs-dump.py'), dataDir], { encoding: 'utf8' }));
const ws = (id) => join(dataDir, 'workspaces', id);
const label = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
const show = (r) => ({
  migrations: r.migrations,
  state: r.state,
  references: r.references.map((x) => ({ ...x, run: x.run ? label[x.run] ?? x.run : null })),
});
setCapacity(capacityFile, ADEQUATE);
let server;
try {
  server = await startServer({ dataDir, port: 6620, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
  let api = client(server.url);
  for (const [k, id] of Object.entries(ids)) ev.log(`after upgrade: ${k} status=${(await api.run(id)).status}`);
  ev.log('server stop (to inspect the migrated store)', await server.stop());
  ev.log('read-only preservation audit',execFileSync('python',['-I',join(here,'upgrade-audit.py'),'after'],{encoding:'utf8'}));
  const migrated = refs();
  ev.log('workspace obligations right after migrating the pre-PR store\n' + JSON.stringify(show(migrated), null, 1));
  const pend = migrated.references.filter((r) => r.kind === 'pending');
  ev.check('backfill: no obligation for terminal template runs that never resolved a directory (dx, de) or did (ds)', !migrated.references.some((r) => [ids.dx, ids.de, ids.ds].includes(r.run)));
  ev.check('backfill: one pending obligation per live template run (dw dynamic with no path, lw literal with its path)', pend.length === 2 && pend.some((r) => r.run === ids.dw && r.path === null) && pend.some((r) => r.run === ids.lw && r.path === join(base, 'literal', 'one')), pend);

  server = await startServer({ dataDir, port: 6620, capacityFile, logFile: join(base, 'server.log.txt'), env: { QA_LOG_LEVEL: 'warn' } });
  api = client(server.url);
  ev.check('migrations apply once on a second reopen',refs().migrations === 24);
  const W = await api.createLoop(workLoop('New temp work after the upgrade'));
  const n = [];
  for (let i = 0; i < 2; i++) n.push((await api.startRun(W, { text: `n${i}`, files: 2, bytes: 1000 })).id);
  for (const id of n) await api.waitFinal(id);
  ev.check('approve two new temp-workspace runs', (await api.mark(n)).status === 200);
  const waitPass = async (prev) => {
    const deadline = Date.now() + 150_000;
    for (;;) {
      const s = await api.storage();
      if (s.checkedAt !== prev && !s.cleaning) return s;
      if (Date.now() > deadline) throw new Error('no pass');
      await sleep(250);
    }
  };
  const brief = (s) => ({ state: s.state, deletedRuns: s.deletedRuns, removedFileBytes: s.removedFileBytes, pending: s.pendingResources, preserved: s.preservedResources });
  let s = await api.storage();
  setCapacity(capacityFile, PRESSURE);
  for (let i = 1; i <= 2; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`pass ${i} while dw (dynamic) and lw (literal) wait`, brief(s), 'new workspaces on disk', n.filter((id) => fs.existsSync(ws(id))).length);
  }
  ev.check('a LIVE dynamic template run keeps approved workspaces (documented: unknown future directory)', n.every((id) => fs.existsSync(ws(id))));
  const cancel = await api.post(`/runs/${ids.dw}/cancel`);
  const dwEnd = await api.waitFinal(ids.dw);
  ev.log('cancel dw', cancel.status, dwEnd.status);
  s = await waitPass(s.checkedAt);
  ev.log('pass after dw ended (lw still waiting)', brief(s), 'new workspaces on disk', n.filter((id) => fs.existsSync(ws(id))).length);
  ev.check('once the dynamic run is terminal its obligation is released; the literal live run does not block unrelated workspaces', n.every((id) => !fs.existsSync(ws(id))));

  // Literal path equal to an approved workspace.
  const q = (await api.startRun(W, { text: 'q', files: 2, bytes: 1000 })).id;
  await api.waitFinal(q);
  const LQ = await api.createLoop({
    schemaVersion: 4,
    name: 'Literal template on q workspace, waiting',
    settings: { workingDirectory: { kind: 'template', template: ws(q) } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'signal', name: 'go' } },
      { id: 'files', kind: 'script', label: 'Files', config: { command: process.execPath, args: ['-e', "require('fs').writeFileSync('w.txt','x')"], cwd: 'workspace', stdin: 'none' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'hold', port: 'in' } },
      { id: 'e2', from: { node: 'hold', port: 'out' }, to: { node: 'files', port: 'in' } },
      { id: 'e3', from: { node: 'files', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  });
  const lq = (await api.startRun(LQ, {})).id;
  await api.waitFor(lq, (r) => r.status === 'waiting');
  ev.check('approve q while a live literal run names q workspace', (await api.mark([q])).status === 200);
  for (let i = 1; i <= 2; i++) {
    s = await waitPass(s.checkedAt);
    ev.log(`pass ${i} with the live literal run on q`, brief(s), 'q run', (await api.get(`/runs/${q}`)).status, 'q workspace on disk', fs.existsSync(ws(q)));
  }
  ev.check('a live literal template protects exactly its directory (q run deleted, q workspace kept)', (await api.get(`/runs/${q}`)).status === 404 && fs.existsSync(ws(q)));
  await api.post(`/runs/${lq}/cancel`);
  ev.log('cancel lq', (await api.waitFinal(lq)).status);
  s = await waitPass(s.checkedAt);
  ev.log('pass after lq ended', brief(s), 'q workspace on disk', fs.existsSync(ws(q)));
  ev.check('after the literal run ends, q workspace is reclaimed', !fs.existsSync(ws(q)));
  ev.check('literal directory and the pre-upgrade temp workspace (unowned) untouched', fs.existsSync(join(base, 'literal', 'one')) && fs.existsSync(ws(ids.w1)));
  await api.post(`/runs/${ids.lw}/cancel`);
  await api.waitFinal(ids.lw);
  setCapacity(capacityFile, ADEQUATE);
  ev.log('server stop', await server.stop());
  server = undefined;
  ev.log('obligations at the end\n' + JSON.stringify(show(refs()), null, 1));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
  if (server) ev.log('server stop', await Promise.race([server.stop(), sleep(60_000).then(() => server.kill())]));
} finally {
  ev.log('failures', ev.failures ?? 0);
}
