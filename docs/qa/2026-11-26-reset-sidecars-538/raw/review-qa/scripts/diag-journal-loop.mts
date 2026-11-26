// Diagnostic for the intermittent focused-run failure (reset-sidecars "root -journal, other hard
// link: none": confirmed exit 1, stderr not captured). Replays that exact scenario through the same
// source `runResetCli` the test uses, N times, and records every non-zero exit with its stderr.
// Run from apps/api: node --import tsx --conditions=development <this> <iterations> <outJson>
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { runResetCli } = (await import(
  pathToFileURL('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/reset.ts').href
)) as typeof import('G:/ggq/gg-fu-538/GraphGoblin/apps/api/src/reset/reset.ts');

const [iterations = '40', outJson] = process.argv.slice(2);
const oldStore = { readable: true as const, format: 3, status: 'complete', runIds: [] as string[] };
const failures: unknown[] = [];
let runs = 0;
const started = new Date().toISOString();
for (let i = 0; i < Number(iterations); i += 1) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-538-diag-')));
  const dataDir = join(base, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'graphgoblin.db'), 'database bytes');
  await writeFile(join(dataDir, 'graphgoblin.db-journal'), '-journal sidecar bytes');
  await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
  for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
    let out = '';
    let err = '';
    const at = new Date().toISOString();
    const code = await runResetCli({
      argv,
      env: { GG_DATA_DIR: dataDir },
      readStore: () => Promise.resolve(oldStore),
      write: (t) => (out += t),
      writeError: (t) => (err += t),
    });
    runs += 1;
    if (code !== 0) failures.push({ iteration: i, argv: argv.length === 1 ? 'dry' : 'confirmed', at, code, stdout: out, stderr: err });
  }
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
const result = { started, finished: new Date().toISOString(), temp: tmpdir(), iterations: Number(iterations), runs, failures };
if (outJson) await writeFile(outJson, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ runs, failures: failures.length }) + '\n');
