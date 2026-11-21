// Native harmless script: append one line to a disposable counter file and echo JSON.
// Usage: node append.mjs <counterFile> <tag> [more args...]
import { appendFileSync } from 'node:fs';
const [counter, ...rest] = process.argv.slice(2);
appendFileSync(counter, JSON.stringify({ pid: process.pid, args: rest, cwd: process.cwd(), t: Date.now() }) + '\n');
process.stdout.write(JSON.stringify({ appended: true, args: rest }));
