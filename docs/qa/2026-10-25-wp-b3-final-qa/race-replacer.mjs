// QA tooling, not product code: the second adversary for c05r-residual-race.mjs. It follows the
// reset through a planned run workspace (files f00000, f00001, ... are removed in order): as soon
// as file k-1 disappears, the reset is working on file k, so after a random delay it atomically
// renames a different file over file k (MoveFileEx with replace, one operation). If that lands
// after the reset's last identity check of file k and before its unlink, the reset deletes the
// replacement; otherwise the reset sees the new identity and stops.
// Usage: node race-replacer.mjs <run-dir> <replacement-dir> <stop-file> <max-delay-us> <files>
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [dir, replacements, stop, maxDelayArgument, filesArgument] = process.argv.slice(2);
const maxDelayNs = Number(maxDelayArgument) * 1000;
const files = Number(filesArgument);
const name = (i) => `f${String(i).padStart(5, '0')}.txt`;
const spin = (ns) => {
  const end = process.hrtime.bigint() + BigInt(Math.round(ns));
  while (process.hrtime.bigint() < end);
};
const attempts = [];
let polls = 0;
outer: for (let k = 1; k < files; k += 1) {
  const previous = join(dir, name(k - 1));
  while (existsSync(previous)) {
    if ((++polls & 1023) === 0 && existsSync(stop)) break outer;
  }
  if (existsSync(stop)) break;
  const delayNs = Math.random() * maxDelayNs;
  spin(delayNs);
  try {
    renameSync(join(replacements, name(k)), join(dir, name(k)));
    attempts.push({ k, delayUs: Math.round(delayNs / 1000) });
  } catch (error) {
    attempts.push({ k, error: error.code });
  }
}
process.stdout.write(JSON.stringify({ attempts }));
