// node save-build-log.mjs <captured output file> : keep the first 40 and last 60 lines, redacted.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const text = L.redact(fs.readFileSync(process.argv[2], 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
const lines = text.split(/\r?\n/);
const keep = [
  '# pnpm install && pnpm build at a0470cb51399aa3e7fff3239487753fdacc5ed28, Node v22.23.4 first on PATH (first 40 and last 60 lines of the captured output)',
  ...lines.slice(0, 40),
  '... (middle of the build output omitted) ...',
  ...lines.slice(-60),
];
fs.writeFileSync(path.join(L.OUT, 'build.log.txt'), keep.join('\n') + '\n');
