// Check 5 (residual race, file level): race-replacer.mjs follows the confirmed reset through a
// planned run workspace and atomically renames a different file over the file the reset is about
// to remove. A replacement that is gone afterwards was deleted by the reset after its identity
// check passed: the remaining race ADR-0042 documents. Each trial reports wins and how it ended.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Log, QA_DIR, cliWithHook, makeBase, seedStore, writeMany } from './lib.mjs';

const log = new Log('c05r2-residual-race-file');
const RUN_A = '01JQAB3INTRUNAAAAAAAAAAAAA';
const RUN_B = '01JQAB3INTRUNBBBBBBBBBBBBB';
const FILES = 2000;
const delays = (process.argv[2] ?? '200,400,800,1200,200,400,800,1200,300,600,900,1500').split(',').map(Number);
const name = (i) => `f${String(i).padStart(5, '0')}.txt`;
let trialsWon = 0;
let replacementsDeleted = 0;

for (const [index, maxDelayUs] of delays.entries()) {
  const base = await makeBase('c05r2');
  const data = join(base, 'data');
  const runB = join(data, 'workspaces', RUN_B);
  const replacements = join(base, 'replacements');
  const stop = join(base, 'stop');
  log.section(`trial ${index + 1}: random delay up to ${maxDelayUs} us after file k-1 disappears`);
  try {
    mkdirSync(data, { recursive: true });
    await seedStore(join(data, 'graphgoblin.db'), { runIds: [RUN_A, RUN_B], format: 3 });
    writeMany(join(data, 'workspaces', RUN_A), 600);
    writeMany(runB, FILES);
    writeMany(replacements, FILES, 'f', (i) => `REPLACEMENT ${i}: created after planning, must survive\n`);
    let attacker;
    let out = '';
    const result = await cliWithHook(['--reset', '--yes', '--data-dir', data], data, {}, () => {
      attacker = spawn(process.execPath, [join(QA_DIR, 'race-replacer.mjs'), runB, replacements, stop, String(maxDelayUs), String(FILES)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      attacker.stdout.on('data', (c) => (out += c));
      attacker.stderr.on('data', (c) => (out += c));
      return `attacker pid ${attacker.pid}`;
    });
    writeFileSync(stop, '');
    if (attacker) await once(attacker, 'exit');
    let attempts = [];
    try {
      attempts = JSON.parse(out).attempts;
    } catch {
      log.line(`attacker output: ${out}`);
    }
    const placed = attempts.filter((a) => a.error === undefined);
    // A placed replacement that no longer exists was deleted by the reset.
    const deleted = placed.filter((a) => !existsSync(join(runB, name(a.k))));
    const survived = placed.filter((a) => existsSync(join(runB, name(a.k))) && readFileSync(join(runB, name(a.k)), 'utf8').startsWith('REPLACEMENT'));
    replacementsDeleted += deleted.length;
    if (deleted.length) trialsWon += 1;
    const ending = /Reset stopped: (.*)/.exec(result.stderr)?.[1] ?? (result.stdout.includes('Reset complete.') ? 'Reset complete.' : `exit ${result.code}`);
    log.line(`reset exit ${result.code}: ${ending}`);
    log.line(`replacements placed: ${placed.length}; deleted by the reset: ${deleted.length} ${JSON.stringify(deleted)}; survived: ${survived.length} ${JSON.stringify(survived.slice(0, 5))}`);
    log.block('timeline', result.timeline.join('\n'));
  } catch (error) {
    log.check(false, `trial ${index + 1}: script error`, error.stack);
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
log.section('Result');
log.line(`trials: ${delays.length}; trials in which the reset deleted a replacement created after its check: ${trialsWon}; replacements deleted in total: ${replacementsDeleted}`);
log.save();
