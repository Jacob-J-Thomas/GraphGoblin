import process from 'node:process';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath, URL } from 'node:url';
import { ClaudeHarness } from '@graphgoblin/infrastructure/claude';

/** Real child transport over a scripted CLI; no installed provider CLI is ever launched. */
export function resultFixture(holdResult) {
  const calls = { started: [], resumed: [] };
  const runner = async (request, onStdout) => {
    const hold = holdResult && request.stdin === 'Task B';
    if (request.stdin !== undefined) {
      const index = request.args.indexOf('--resume');
      const turn = { turn: { prompt: request.stdin } };
      if (index < 0) calls.started.push(turn);
      else calls.resumed.push({ sessionId: request.args[index + 1], request: turn });
    }
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./claude-result.cli.mjs', import.meta.url)),
        hold ? 'hold' : 'complete',
        ...request.args,
      ],
      {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      },
    );
    const closed = once(child, 'close');
    closed.catch(() => undefined);
    child.stderr.resume();
    child.stdin.end(request.stdin ?? '');
    let stdout = '';
    for await (const line of createInterface({ input: child.stdout })) {
      stdout += line + '\n';
      onStdout?.(Buffer.from(line + '\n'));
      if (hold && line.includes('"type":"result"')) process.send?.({ type: 'claude.result.hold' });
    }
    const [exitCode] = await closed;
    return { stdout, exitCode, timedOut: false, aborted: false, overflow: false };
  };
  return { harness: new ClaudeHarness({ runner, platform: 'win32' }), calls };
}
