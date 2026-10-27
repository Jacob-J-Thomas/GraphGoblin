// node pid-check.mjs <out-name> <note> <pid>...  : tasklist each PID and write <out-name>.log.txt
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const [name, note, ...pids] = process.argv.slice(2);
const lines = [`# ${note}`, `# checked ${new Date().toISOString()}`];
for (const p of pids) lines.push(`PID ${p}: ${L.tasklistLine(Number(p))}`);
fs.writeFileSync(path.join(L.OUT, `${name}.log.txt`), L.redact(lines.join('\n') + '\n'));
process.stdout.write(lines.join('\n') + '\n');
