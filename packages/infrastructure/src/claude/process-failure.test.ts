import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { PassThrough } from 'node:stream';
import { killTree } from '../process/index.js';
import { ClaudeHarnessError } from './errors.js';
import { runClaudeProcess } from './process.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return { ...actual, spawn: vi.fn() };
});
vi.mock('../process/index.js', () => ({ killTree: vi.fn() }));
let child: ChildProcess;
const stdout = () => child.stdout;
const request = (signal = new AbortController().signal) => ({
  binary: 'synthetic-cli',
  args: [],
  cwd: 'synthetic-workspace',
  env: {},
  signal,
  timeoutMs: 1000,
  maxOutputBytes: 1024,
});
beforeEach(() => {
  vi.useFakeTimers();
  child = new ChildProcess();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  vi.mocked(spawn).mockReturnValue(child);
});
afterEach(() => {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('bounded native transport failure outcomes', () => {
  it.each(['abort', 'timeout'] as const)(
    'reports unconfirmed termination after %s instead of successful cancellation',
    async (mode) => {
      const controller = new AbortController();
      const result = runClaudeProcess(request(controller.signal));
      if (mode === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(1000);
      expect(killTree).toHaveBeenCalledWith(child);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toMatchObject({
        exitCode: null,
        terminationUnconfirmed: true,
        aborted: mode === 'abort',
        timedOut: mode === 'timeout',
      });
      child.emit('close', 0);
      expect(await result).toMatchObject({ terminationUnconfirmed: true });
    },
  );
  it('confirmed close clears the kill deadline and distinguishes normal cancellation', async () => {
    const controller = new AbortController();
    const result = runClaudeProcess(request(controller.signal));
    controller.abort();
    child.emit('close', null, 'SIGKILL');
    expect(await result).toMatchObject({ aborted: true, exitCode: null });
    expect(await result).not.toHaveProperty('terminationUnconfirmed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['typed', 'unknown'] as const)(
    'retains only fixed %s parser diagnostics and kills the owned process',
    async (kind) => {
      const result = runClaudeProcess(request(), () => {
        if (kind === 'typed')
          throw new ClaudeHarnessError('HARNESS_PROTOCOL_ERROR', 'fixed parser diagnostic');
        throw new Error('PRIVATE_PROVIDER_BODY');
      });
      stdout()?.emit('data', Buffer.from('synthetic'));
      stdout()?.emit('data', Buffer.from('ignored'));
      expect(killTree).toHaveBeenCalledWith(child);
      child.emit('close', null);
      expect(await result).toMatchObject({ callbackError: { code: 'HARNESS_PROTOCOL_ERROR' } });
      expect(JSON.stringify(await result)).not.toContain('PRIVATE_PROVIDER_BODY');
    },
  );
  it('reports stdin delivery failure without claiming a successful turn', async () => {
    const result = runClaudeProcess(request());
    child.stdin?.emit('error', new Error('PRIVATE_STDIN_BODY'));
    expect(killTree).toHaveBeenCalledWith(child);
    child.emit('close', null);
    expect(await result).toMatchObject({ stdinFailed: true });
    expect(JSON.stringify(await result)).not.toContain('PRIVATE_STDIN_BODY');
  });
  it.each(['EACCES', 'EPERM'] as const)(
    'maps native spawn error %s without retaining its body',
    async (code) => {
      const result = runClaudeProcess(request());
      const error = Object.assign(new Error('PRIVATE_NATIVE_BODY'), { code });
      child.emit('error', error);
      expect(await result).toMatchObject({ spawnCode: code === 'EACCES' ? 'EACCES' : 'UNKNOWN' });
      expect(JSON.stringify(await result)).not.toContain('PRIVATE_NATIVE_BODY');
    },
  );
});
