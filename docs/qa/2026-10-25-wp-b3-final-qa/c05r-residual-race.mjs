// Check 5 (residual race): ADR-0042 says the identity checks narrow, but cannot eliminate, a race
// with an external process that changes the tree between the last check and unlink/rmdir. This
// adversary (race-flipper.mjs, a separate process) keeps swapping a planned run workspace with a
// junction to an unrelated folder of same-named decoy files while the confirmed reset removes it.
// A decoy that disappears means a removal resolved through the junction after the checks passed.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Log, QA_DIR, cliWithHook, listDir, makeBase, seedStore, writeMany } from './lib.mjs';

const log = new Log('c05r-residual-race');
const RUN_A = '01JQAB3INTRUNAAAAAAAAAAAAA';
const RUN_B = '01JQAB3INTRUNBBBBBBBBBBBBB';
const FILES = 3000;
const spins = (process.argv[2] ?? '2,5,10,20,50,2,5,10,20,50,100,200').split(',').map(Number);
let totalDeleted = 0;
let trialsWon = 0;

for (const [index, spinUs] of spins.entries()) {
  const base = await makeBase('c05r');
  const data = join(base, 'data');
  const decoys = join(base, 'unrelated-decoys');
  const stop = join(base, 'stop');
  const real = join(data, 'workspaces', RUN_B);
  const hidden = join(data, 'workspaces', '.flip-hidden');
  const junction = join(data, 'workspaces', '.flip-junction');
  log.section(`trial ${index + 1}: spin ${spinUs} us`);
  try {
    mkdirSync(data, { recursive: true });
    await seedStore(join(data, 'graphgoblin.db'), { runIds: [RUN_A, RUN_B], format: 3 });
    writeMany(join(data, 'workspaces', RUN_A), 1500);
    writeMany(real, FILES);
    writeMany(decoys, FILES, 'f', (i) => `decoy ${i}\n`);
    let flipper;
    let flipperOut = '';
    const confirm = ['--reset', '--yes', '--data-dir', data];
    const result = await cliWithHook(confirm, data, {}, () => {
      symlinkSync(decoys, junction, 'junction');
      flipper = spawn(process.execPath, [join(QA_DIR, 'race-flipper.mjs'), real, hidden, junction, stop, String(spinUs)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      flipper.stdout.on('data', (c) => (flipperOut += c));
      flipper.stderr.on('data', (c) => (flipperOut += c));
      return `junction prepared; flipper pid ${flipper.pid}`;
    });
    writeFileSync(stop, '');
    if (flipper) await once(flipper, 'exit');
    // Restore the real directory name if the flipper stopped mid-swap.
    if (!existsSync(real) && existsSync(hidden)) renameSync(hidden, real);
    const remaining = readdirSync(decoys).length;
    const deleted = FILES - remaining;
    totalDeleted += deleted;
    if (deleted > 0) trialsWon += 1;
    const reason = /Reset stopped: (.*)/.exec(result.stderr)?.[1] ?? '(no stop)';
    log.line(`reset exit ${result.code}; ${reason}`);
    log.line(`flipper: ${flipperOut}`);
    log.line(`run B files left in the real directory: ${existsSync(real) ? readdirSync(real).length : 'missing'}; decoys deleted through the junction: ${deleted}`);
    if (deleted > 0) {
      const missing = [];
      const have = new Set(readdirSync(decoys));
      for (let i = 0; i < FILES; i += 1) {
        const name = `f${String(i).padStart(5, '0')}.txt`;
        if (!have.has(name)) missing.push(name);
      }
      log.line(`deleted decoys: ${missing.join(', ')}`);
    }
    log.block('timeline', result.timeline.join('\n'));
    log.block('stderr', result.stderr);
    log.line(`data/workspaces now: ${JSON.stringify(listDir(join(data, 'workspaces')))}`);
    if (existsSync(junction)) unlinkSync(junction);
  } catch (error) {
    log.check(false, `trial ${index + 1}: script error`, error.stack);
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
log.section('Result');
log.line(`trials: ${spins.length}; trials in which a removal went through the junction: ${trialsWon}; decoys deleted in total: ${totalDeleted}`);
log.save();
