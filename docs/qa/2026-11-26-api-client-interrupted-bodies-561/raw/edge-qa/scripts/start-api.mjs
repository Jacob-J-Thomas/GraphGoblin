// Starts the built API (disposable store) as an owned child, writes its PID, and waits for /healthz-like readiness.
import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
const [,, label] = process.argv;
const root = 'G:/ggq/gg-qa-inspector-combined/GraphGoblin/apps/api';
const out = openSync(`G:/ggq/tmp/rq-inspector-qa/out/api-${label}.stdout.log`, 'a');
const err = openSync(`G:/ggq/tmp/rq-inspector-qa/out/api-${label}.stderr.log`, 'a');
const child = spawn(process.execPath, ['dist/main.js'], { cwd: root, stdio: ['ignore', out, err], detached: false, env: process.env });
writeFileSync(`G:/ggq/tmp/rq-inspector-qa/out/api-${label}.pid`, String(child.pid));
console.log('api pid', child.pid, 'port', process.env.GG_PORT);
child.on('exit', (code, signal) => { console.log('api exit', code, signal); process.exit(0); });
