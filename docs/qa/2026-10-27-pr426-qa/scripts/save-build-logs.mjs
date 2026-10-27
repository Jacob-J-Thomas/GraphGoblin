// Copy the two build outputs into the record, redacted.
//   node save-build-logs.mjs <PR build output> <main install+build output (tails)>
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const [pr, main] = process.argv.slice(2);
fs.writeFileSync(path.join(L.OUT, 'build-pr.log.txt'), L.redact(fs.readFileSync(pr, 'utf8')));
fs.writeFileSync(path.join(L.OUT, 'build-main.log.txt'), L.redact(fs.readFileSync(main, 'utf8')));
console.log('saved');
