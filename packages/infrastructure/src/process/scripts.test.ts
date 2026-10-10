import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ProcessScripts, killTree } from './scripts.js';

const node = process.execPath;

function request(overrides: Partial<Parameters<ProcessScripts['run']>[0]>) {
  return {
    command: node,
    args: [],
    cwd: process.cwd(),
    env: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('ProcessScripts', () => {
  it('captures stdout, stderr, exit code, env, args, and stdin', async () => {
    const scripts = new ProcessScripts({ baseEnv: { PATH: process.env['PATH'] ?? '' } });
    const result = await scripts.run(
      request({
        args: [
          '-e',
          'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(1),env:process.env.GG_TEST,input}));process.stderr.write("warn");process.exit(3)})',
          'a',
          'b',
        ],
        env: { GG_TEST: 'yes' },
        stdin: 'hello',
      }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe('warn');
    expect(JSON.parse(result.stdout)).toEqual({ args: ['a', 'b'], env: 'yes', input: 'hello' });
  });

  it('closes stdin when none is provided', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(
      request({
        args: [
          '-e',
          'let n=0;process.stdin.on("data",()=>n++);process.stdin.on("end",()=>{process.stdout.write(String(n))})',
        ],
      }),
    );
    expect(result.stdout).toBe('0');
    expect(result.exitCode).toBe(0);
  });

  it('kills the process tree on timeout', async () => {
    const scripts = new ProcessScripts();
    const started = Date.now();
    const result = await scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], timeoutMs: 300 }),
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it('kills the process when the signal aborts, including when already aborted', async () => {
    const scripts = new ProcessScripts();
    const controller = new AbortController();
    const pending = scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    const immediate = await scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], signal: aborted.signal }),
    );
    expect(immediate.exitCode === null || immediate.exitCode !== 0).toBe(true);
  }, 15_000);

  it('reports spawn failures as a null exit code with a message', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(
      request({ command: 'definitely-not-a-real-command-gg', args: [] }),
    );
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/spawn failed/);
  });

  it('caps captured output', async () => {
    const scripts = new ProcessScripts({ maxOutputBytes: 100 });
    const result = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("x".repeat(10000))'] }),
    );
    expect(result.stdout).toHaveLength(100);
    expect(result.exitCode).toBe(0);
  });

  it('bounds opted-in stdout by raw bytes and reports overflow without changing legacy capture', async () => {
    const scripts = new ProcessScripts();
    const args = ['-e', 'process.stdout.write("é".repeat(32769))'];
    const bounded = await scripts.run(request({ args, maxStdoutBytes: 65_536 }));
    expect(bounded.exitCode).toBe(0);
    expect(bounded.stdoutOverflow).toBe(true);
    expect(Buffer.byteLength(bounded.stdout)).toBe(65_536);
    expect(bounded.stdout).toBe('é'.repeat(32768));
    const legacy = await scripts.run(request({ args }));
    expect(legacy.stdoutOverflow).toBeUndefined();
    expect(legacy.stdout).toBe('é'.repeat(32769));
  });

  it('reports exact-cap output as complete and does not emit a cap-split UTF8 suffix', async () => {
    const scripts = new ProcessScripts();
    const complete = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("abc")'], maxStdoutBytes: 3 }),
    );
    expect(complete).toMatchObject({ stdout: 'abc', stdoutOverflow: false, exitCode: 0 });
    const split = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("é")'], maxStdoutBytes: 1 }),
    );
    expect(split).toMatchObject({ stdout: '', stdoutOverflow: true, exitCode: 0 });
    expect(() => scripts.run(request({ maxStdoutBytes: -1 }))).toThrow(RangeError);
  });

  it('uses fixed spawn diagnostics without echoing a credential-bearing command', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(request({ command: 'missing-command-with-secret-token-gg' }));
    expect(result.stderr).toBe('spawn failed: PROCESS_START_FAILED');
    expect(result.stderr).not.toContain('secret-token');
  });
});

describe('killTree', () => {
  function fakeChild(pid: number | undefined): ChildProcess & { killed_: boolean } {
    const child = new EventEmitter() as ChildProcess & { killed_: boolean };
    Object.assign(child, { pid, killed_: false, kill: () => ((child.killed_ = true), true) });
    return child;
  }

  it('does nothing without a pid', () => {
    const child = fakeChild(undefined);
    killTree(child, 'win32');
    expect(child.killed_).toBe(false);
  });

  it('uses taskkill on Windows and falls back to kill when taskkill is missing', () => {
    const calls: unknown[][] = [];
    const killer = new EventEmitter();
    const spawnImpl = ((...args: unknown[]) => {
      calls.push(args);
      return killer;
    }) as unknown as typeof spawn;
    const child = fakeChild(1234);
    killTree(child, 'win32', spawnImpl);
    expect(calls[0]?.[0]).toBe('taskkill');
    expect(calls[0]?.[1]).toEqual(['/pid', '1234', '/T', '/F']);
    killer.emit('error', new Error('no taskkill'));
    expect(child.killed_).toBe(true);
  });

  it('signals the process group on POSIX and falls back to kill on failure', () => {
    const child = fakeChild(999_999_999);
    killTree(child, 'linux');
    expect(child.killed_).toBe(true);
  });
});
