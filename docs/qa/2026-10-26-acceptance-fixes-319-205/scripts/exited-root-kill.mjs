// Reproduction for group A observation O1 (#319): a process that exited before the kill is reported
// as unconfirmed termination on Windows. It calls the built `killTree` (the function both the
// script runner and the Claude runner use) on a child whose exit Node has already observed.
//
// Safety: a helper holds an open handle to the exited process for the whole check, so Windows
// cannot hand its PID to another process; the `taskkill /T /F` that `killTree` may run can only
// find the PID gone. Usage (worktree root, after pnpm build):
//   node docs/qa/2026-10-26-acceptance-fixes-319-205/scripts/exited-root-kill.mjs <hold-process.exe> <log file>
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [holder, log] = process.argv.slice(2);
const { killTree } = await import(
  pathToFileURL(resolve('packages/infrastructure/dist/process/index.js')).href
);
writeFileSync(log, '');
const note = (line) => appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
note(`node ${process.version}`);

const child = spawn(
  process.execPath,
  ['-e', "process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"],
  { stdio: 'pipe', windowsHide: true },
);
await once(child.stdout, 'data');
const hold = spawn(holder, [String(child.pid)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
await once(hold.stdout, 'data');
note(`child ${child.pid} running; helper holds a handle to it`);
child.stdin.end();
const [code] = await once(child, 'exit');
note(`child exited on its own with code ${code}; Node observed the exit (exitCode=${child.exitCode})`);
const listed = spawnSync('tasklist', ['/FI', `PID eq ${child.pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true });
note(`tasklist for the PID: ${String(listed.stdout).trim() || '(empty)'}`);
const direct = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
note(`taskkill /T /F on that PID: exit ${direct.status}: ${String(direct.stderr).trim()}`);
const started = Date.now();
const released = await killTree(child);
note(`killTree(child) resolved ${released} after ${Date.now() - started} ms`);
note(
  released
    ? 'RESULT: a root that already exited counts as released'
    : 'RESULT: a root that already exited is reported as unconfirmed termination (O1)',
);
hold.stdin.end();
await once(hold, 'exit');
