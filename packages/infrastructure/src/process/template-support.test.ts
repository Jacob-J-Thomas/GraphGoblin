import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ProcessScripts } from './scripts.js';
describe('private helper capture', () => {
  it('assembles split chunks before returning independently bounded stdout/stderr and excludes inherited credentials', async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin: Object.assign(new EventEmitter(), {
        end: () => {
          stdout.emit('data', Buffer.from('{"note":"split-'));
          stdout.emit('data', Buffer.from('credential"}'));
          stderr.emit('data', Buffer.from('abc'));
          stderr.emit('data', Buffer.from('defghi'));
          child.emit('close', 0);
        },
      }),
      pid: undefined,
    }) as unknown as ChildProcess;
    let environment: NodeJS.ProcessEnv | undefined;
    const spawnImpl: typeof spawn = ((
      _command: string,
      _args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
    ) => {
      environment = options.env;
      return child;
    }) as typeof spawn;
    const result = await new ProcessScripts({
      baseEnv: { GG_KEY: 'inherited-secret' },
      spawnImpl,
    }).run({
      command: 'never-launched',
      args: [],
      cwd: '.',
      env: { SAFE: 'yes' },
      inheritEnv: false,
      maxStdoutBytes: 100,
      maxStderrBytes: 6,
      signal: new AbortController().signal,
    });
    expect(environment).toEqual({ SAFE: 'yes' });
    expect(result).toMatchObject({
      stdout: '{"note":"split-credential"}',
      stdoutOverflow: false,
      stderr: 'abcdef',
      stderrOverflow: true,
    });
  });
});
