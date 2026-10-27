// Real disposable script. One append is one independently countable external effect.
import fs from 'node:fs';
const [file, label, scenario] = process.argv.slice(2);
fs.appendFileSync(file, JSON.stringify({ pid: process.pid, label, at: Date.now() }) + '\n');
const count = fs.readFileSync(file, 'utf8').trim().split('\n').length;
process.stdout.write('null');
if (scenario === 'different' && count === 2) process.exit(7);
