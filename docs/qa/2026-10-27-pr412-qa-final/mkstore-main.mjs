// R1 migrated-store case, step 1 of 2: with the PRE-PR build (main at the merge base 50990e8c,
// migrations up to 0020), create a store holding template-directory runs in every relevant state:
// terminal runs that never resolved their directory (trigger -> exit; empty render), a terminal
// run that did resolve it, and LIVE (waiting) runs of a dynamic and of a literal template.
// Step 2 (migrated.mjs) starts the PR head on this store, which applies 0021 and 0022.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { client, workLoop, temp, join, here, Evidence, sleep, redact } from './qa-lib.mjs';

const ev = new Evidence('01b-mkstore-main');
const base = join(temp, 'gg-qa-412f-b-mig');
// Fixture is unique. Leave all directories for the orchestrator.
const dataDir = join(base, 'data');
for (const d of [dataDir, join(base, 'user', 'dyn'), join(base, 'user', 'dynwait'), join(base, 'literal', 'one')]) fs.mkdirSync(d, { recursive: true });

const child = spawn(process.execPath, ['--experimental-loader',pathToFileURL(join(here,'main-resolver.mjs')).href,join(here, 'qa-server-main.mjs'), dataDir, '6620', join(base, 'unused-capacity.json')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, QA_LOG_LEVEL: 'warn' } });
const out = fs.createWriteStream(join(base, 'server-main.log.txt'), { flags: 'a' });
let buffer = '';
const url = await new Promise((res, rej) => {
  const on = (c) => {
    out.write(redact(String(c)));
    buffer += String(c);
    const m = /QA_READY (\S+)/.exec(buffer);
    if (m) res(m[1]);
  };
  child.stdout.on('data', on);
  child.stderr.on('data', on);
  child.once('exit', (code) => rej(new Error('main server exited ' + code)));
});
const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
const api = client(url);
const waitLoop = (name, workingDirectory) => ({
  schemaVersion: 4,
  name,
  settings: { workingDirectory },
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
const dynamic = { kind: 'template', template: '{{ trigger.payload.dir }}' };
try {
  const DX = await api.createLoop({
    schemaVersion: 4,
    name: 'Dynamic template, trigger to exit',
    settings: { workingDirectory: dynamic },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
  });
  const DT = await api.createLoop(workLoop('Dynamic template with a script', { workingDirectory: dynamic }));
  const DW = await api.createLoop(waitLoop('Dynamic template, waiting', dynamic));
  const LW = await api.createLoop(waitLoop('Literal template, waiting', { kind: 'template', template: join(base, 'literal', 'one') }));
  const W = await api.createLoop(workLoop('Temp work before the upgrade'));
  const ids = {};
  ids.dx = (await api.startRun(DX, { dir: join(base, 'user', 'dyn') })).id;
  ids.de = (await api.startRun(DT, { text: 'empty render', files: 1, bytes: 1, dir: '' })).id;
  ids.ds = (await api.startRun(DT, { text: 'resolved', files: 1, bytes: 1, dir: join(base, 'user', 'dyn') })).id;
  ids.w1 = (await api.startRun(W, { text: 'pre-upgrade temp', files: 1, bytes: 100 })).id;
  for (const k of ['dx', 'de', 'ds', 'w1']) await api.waitFinal(ids[k]);
  ids.dw = (await api.startRun(DW, { dir: join(base, 'user', 'dynwait') })).id;
  ids.lw = (await api.startRun(LW, {})).id;
  for (const k of ['dw', 'lw']) await api.waitFor(ids[k], (r) => r.status === 'waiting');
  for (const [k, id] of Object.entries(ids)) {
    const r = await api.run(id);
    ev.log(`${k} ${id} status=${r.status} failure=${r.failure?.message ?? '-'}`);
  }
  ev.check('pre-PR store: terminal dynamic runs dx (never resolved), de (empty render, failed), ds (resolved) and live waiting runs dw (dynamic) and lw (literal)', (await api.run(ids.dx)).status === 'succeeded' && (await api.run(ids.de)).status === 'failed' && (await api.run(ids.ds)).status === 'succeeded' && (await api.run(ids.dw)).status === 'waiting' && (await api.run(ids.lw)).status === 'waiting');
  fs.writeFileSync(join(base, 'ids.json'), JSON.stringify({ ids, loops: { DX, DT, DW, LW, W } }, null, 2));
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  child.stdin.write('stop\n');
  const stopped = await Promise.race([exited, sleep(60_000).then(() => 'timeout')]);
  if (stopped === 'timeout') {
    child.kill('SIGKILL');
    ev.log('main server stop timed out; killed', await exited);
  } else ev.log('main server stop', stopped);
  out.end();
  ev.log('failures', ev.failures ?? 0);
}
