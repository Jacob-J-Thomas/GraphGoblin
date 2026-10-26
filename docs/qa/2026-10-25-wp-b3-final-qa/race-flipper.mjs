// QA tooling, not product code: the adversary for c05r-residual-race.mjs. It repeatedly swaps a
// planned run workspace directory with a prepared junction to an unrelated folder (two renames),
// holds the junction for a few microseconds, then swaps the real directory back, until the stop
// file appears. Usage: node race-flipper.mjs <real> <hidden> <junction> <stop-file> <spin-us>
import { existsSync, renameSync } from 'node:fs';
import process from 'node:process';

const [real, hidden, junction, stop, spinArgument] = process.argv.slice(2);
const spinNs = BigInt(Math.round(Number(spinArgument) * 1000));
const spin = (ns) => {
  const end = process.hrtime.bigint() + ns;
  while (process.hrtime.bigint() < end);
};
let swaps = 0;
let busy = 0;
let checked = 0;
for (;;) {
  if ((checked++ & 63) === 0 && existsSync(stop)) break;
  try {
    renameSync(real, hidden);
  } catch {
    busy += 1;
    continue;
  }
  try {
    renameSync(junction, real);
  } catch {
    renameSync(hidden, real);
    busy += 1;
    continue;
  }
  swaps += 1;
  spin(spinNs);
  // Put everything back; retry while the reset holds a handle below the junction target.
  for (;;) {
    try {
      renameSync(real, junction);
      break;
    } catch (error) {
      if (!existsSync(real)) break; // the reset removed the junction itself
    }
  }
  for (;;) {
    try {
      renameSync(hidden, real);
      break;
    } catch {
      // retry
    }
  }
  spin(spinNs * 4n);
}
process.stdout.write(JSON.stringify({ swaps, busy }));
