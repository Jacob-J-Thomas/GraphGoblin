// A controlled fake Codex CLI turn (no provider) that, like a real CLI running a long command,
// starts one "tool" process before blocking. The tool inherits this process's stdout, so the pipe
// stays open after this process is killed. It is detached so that killing this process (and, on
// Windows, closing Node's kill-on-close job) leaves it running, as a command outside the CLI's own
// cleanup would. Both PIDs are written to `<pid file>` as JSON for the test to verify and end.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { setInterval } from 'node:timers';

const pidFile = process.argv[2];
for await (const chunk of process.stdin) void chunk;
const tool = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
  detached: true,
  stdio: ['ignore', 'inherit', 'ignore'],
  windowsHide: true,
});
tool.unref();
writeFileSync(pidFile, JSON.stringify({ cli: process.pid, tool: tool.pid }));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'tree-thread' }) + '\n');
process.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\n');
setInterval(() => undefined, 1000);
