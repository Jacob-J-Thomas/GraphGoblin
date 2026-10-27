// Follow-up to 16-artifact-alias: is a data directory that is reached through a different
// spelling usable at all? Same physical directory given as (1) its plain path (control), (2) a
// different letter case, (3) its Windows 8.3 short name, (4) a junction. One run that needs a temp
// workspace and publishes a transcript, and one trigger -> exit run, in each case.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer, client, setCapacity, ADEQUATE, workLoop, temp, join, Evidence } from './qa-lib.mjs';

const ev = new Evidence('19-datadir-alias');
const base = join(temp, 'gg-qa-e3r-dalias');
fs.rmSync(base, { recursive: true, force: true });
const realBase = join(base, 'physical-data-root');
fs.mkdirSync(realBase, { recursive: true });
const capacityFile = join(base, 'capacity.json');
setCapacity(capacityFile, ADEQUATE);
const shortOf = (p) =>
  execFileSync('cmd', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
fs.symlinkSync(realBase, join(base, 'junction-to-data'), 'junction');
const variants = [
  ['plain path (control)', realBase],
  ['different letter case', realBase.replace('physical-data-root', 'PHYSICAL-Data-Root')],
  ['8.3 short name', shortOf(realBase)],
  ['junction', join(base, 'junction-to-data')],
];
try {
  for (const [label, dataDir] of variants) {
    ev.log(`variant ${label}: GG_DATA_DIR = ${dataDir}`);
    const server = await startServer({ dataDir, port: 6581, capacityFile, logFile: join(base, 'server.log'), env: { QA_LOG_LEVEL: 'warn' } });
    const api = client(server.url);
    try {
      const W = await api.createLoop(workLoop(`Work ${label}`));
      const id = (await api.startRun(W, { text: `run ${label}`, files: 1, bytes: 10 })).id;
      const run = await api.waitFinal(id);
      ev.check(`${label}: a run with a temp workspace and a transcript succeeds`, run.status === 'succeeded', run.status === 'succeeded' ? undefined : run.failure?.message);
    } finally {
      await server.stop();
    }
  }
} catch (error) {
  ev.log('ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  ev.log('failures', ev.failures ?? 0);
}
