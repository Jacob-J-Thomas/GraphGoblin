import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProcess, spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import type * as FsModule from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { killTree } from '../process/index.js';
import { ClaudeHarnessError } from './errors.js';
import { runClaudeProcess } from './process.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return { ...actual, spawn: vi.fn() };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return { ...actual, stat: vi.fn() };
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
let directoryStats: Stats, fileStats: Stats;
beforeAll(async () => {
  const actual = await vi.importActual<typeof FsModule>('node:fs/promises');
  directoryStats = await actual.stat(tmpdir());
  fileStats = await actual.stat(fileURLToPath(import.meta.url));
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(killTree).mockResolvedValue(true);
  vi.mocked(stat).mockResolvedValue(directoryStats);
  child = new ChildProcess();
  // These cases model a process that started; spawn refusals clear the pid as Node leaves it.
  Object.assign(child, { pid: 4242 });
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
      Object.assign(child, { pid: undefined });
      const result = runClaudeProcess(request());
      const error = Object.assign(new Error('PRIVATE_NATIVE_BODY'), { code });
      child.emit('error', error);
      expect(await result).toMatchObject({ spawnCode: code === 'EACCES' ? 'EACCES' : 'UNKNOWN' });
      expect(JSON.stringify(await result)).not.toContain('PRIVATE_NATIVE_BODY');
    },
  );
  it('does not treat a later error of a started child, such as a failed kill, as a spawn refusal', async () => {
    const result = runClaudeProcess(request());
    child.emit('error', Object.assign(new Error('PRIVATE_KILL_BODY'), { code: 'EPERM' }));
    child.emit('close', 0);
    const settled = await result;
    expect(settled).toMatchObject({ exitCode: 0 });
    expect(settled).not.toHaveProperty('spawnCode');
    expect(stat).not.toHaveBeenCalled();
  });
  it.each(['stdout', 'stderr'] as const)(
    "reports a started child's %s pipe failure and stops its tree",
    async (stream) => {
      const result = runClaudeProcess(request());
      child[stream]?.emit(
        'error',
        Object.assign(new Error('PRIVATE_PIPE_BODY'), { code: 'EPIPE' }),
      );
      expect(killTree).toHaveBeenCalledWith(child);
      child.emit('close', null);
      expect(await result).toMatchObject({ outputFailed: true, exitCode: null });
      expect(await result).not.toHaveProperty('spawnCode');
      expect(JSON.stringify(await result)).not.toContain('PRIVATE_PIPE_BODY');
    },
  );
});

describe('read-only observation after an actual spawn refusal (#364)', () => {
  const root = join(tmpdir(), 'gg-364-controlled');
  const executable = join(root, 'claude.exe');
  const workspace = join(root, 'workspace');
  // Windows process start also tries the path with `.com` and `.exe` appended.
  const names =
    process.platform === 'win32'
      ? [executable, `${executable}.com`, `${executable}.exe`]
      : [executable];
  const fault = (code?: string) =>
    Object.assign(new Error('PRIVATE_FS_BODY'), code === undefined ? {} : { code });
  // Tokens, because the case tables are built before the real Stats objects exist.
  type State = 'file' | 'directory' | Error | Promise<Stats>;
  function observe(states: Record<string, State>): void {
    vi.mocked(stat).mockImplementation((path) => {
      const state = states[String(path)];
      if (state === undefined) return Promise.reject(new Error(`unexpected ${String(path)}`));
      if (state instanceof Error) return Promise.reject(state);
      if (state === 'file') return Promise.resolve(fileStats);
      return state === 'directory' ? Promise.resolve(directoryStats) : state;
    });
  }
  const observed = () => vi.mocked(stat).mock.calls.map(([path]) => String(path));
  function refuse(code = 'ENOENT', binary = executable, signal?: AbortSignal) {
    Object.assign(child, { pid: undefined });
    const result = runClaudeProcess({
      ...request(signal),
      binary,
      cwd: workspace,
    });
    child.emit('error', Object.assign(new Error(`spawn ${binary} ${code}`), { code }));
    return result;
  }
  it('establishes a missing executable only when every name process start tries is absent or a folder', async () => {
    const absent = Object.fromEntries(names.map((name) => [name, fault('ENOENT')]));
    observe({ ...absent, [executable]: fault('ENOTDIR') });
    expect(await refuse()).toMatchObject({
      spawnCode: 'ENOENT',
      startRefusal: 'executable-missing',
    });
    expect(observed()).toEqual(names);
    observe({ ...absent, [executable]: 'directory' });
    expect(await refuse()).toMatchObject({ startRefusal: 'executable-missing' });
  });
  it.each([
    ['a file', 'file' as const],
    ['an unreadable path', fault('EACCES')],
    ['an unclassified read fault', fault()],
  ])('leaves the cause open when the executable path is %s', async (_case, state) => {
    observe({
      ...Object.fromEntries(names.map((name) => [name, fault('ENOENT')])),
      [executable]: state,
      [workspace]: 'directory',
    });
    const result = await refuse();
    expect(result).toMatchObject({ spawnCode: 'ENOENT', exitCode: null });
    expect(result).not.toHaveProperty('startRefusal');
    expect(observed()).toEqual([...names, workspace]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it.each([
    ['missing', fault('ENOENT'), 'working-directory-missing'],
    ['beneath a file', fault('ENOTDIR'), 'working-directory-missing'],
    ['a file', 'file', 'working-directory-not-directory'],
    ['an existing folder', 'directory', undefined],
    ['unreadable', fault('EACCES'), undefined],
    ['denied', fault('EPERM'), undefined],
  ] as const)(
    'classifies a working directory that is %s without resolving a bare executable name',
    async (_case, state, refusal) => {
      observe({ [workspace]: state });
      const result = await refuse('ENOENT', 'claude');
      expect(observed()).toEqual([workspace]);
      if (refusal) expect(result).toMatchObject({ spawnCode: 'ENOENT', startRefusal: refusal });
      else expect(result).not.toHaveProperty('startRefusal');
    },
  );
  it('never resolves a relative executable path', async () => {
    observe({ [workspace]: 'directory' });
    expect(await refuse('ENOENT', join('bin', 'claude.exe'))).not.toHaveProperty('startRefusal');
    expect(observed()).toEqual([workspace]);
  });
  it('establishes a missing executable only from an ENOENT refusal', async () => {
    observe({
      ...Object.fromEntries(names.map((name) => [name, fault('ENOENT')])),
      [workspace]: 'directory',
    });
    const result = await refuse('EACCES');
    expect(result).toMatchObject({ spawnCode: 'EACCES' });
    expect(result).not.toHaveProperty('startRefusal');
    expect(observed()).toEqual([workspace]);
  });
  it.each(['abort', 'deadline'] as const)(
    'reports the refusal at once without a diagnosis or timeout when the %s arrives during the observation',
    async (mode) => {
      let release!: (stats: Stats) => void;
      const pending = new Promise<Stats>((resolve) => {
        release = resolve;
      });
      observe({ [workspace]: pending });
      const controller = new AbortController();
      const result = refuse('ENOENT', 'claude', controller.signal);
      expect(observed()).toEqual([workspace]);
      if (mode === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(1000);
      const settled = await result;
      expect(settled).toMatchObject({
        spawnCode: 'ENOENT',
        exitCode: null,
        aborted: mode === 'abort',
        timedOut: false,
      });
      expect(settled).not.toHaveProperty('startRefusal');
      expect(settled).not.toHaveProperty('terminationUnconfirmed');
      expect(killTree).not.toHaveBeenCalled();
      release(fileStats);
      await Promise.resolve();
      expect(await result).toBe(settled);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('ignores the pipe faults and close that follow a refusal, settling once with the refusal', async () => {
    observe({ [workspace]: 'directory' });
    const result = refuse('ENOENT', 'claude');
    // Windows reports a 260-character working directory like this (ENOTCONN on both pipes).
    for (const stream of ['stdout', 'stderr', 'stdin'] as const)
      child[stream]?.emit(
        'error',
        Object.assign(new Error('PRIVATE_PIPE_BODY'), { code: 'ENOTCONN' }),
      );
    child.emit('close', -4058);
    child.emit('error', Object.assign(new Error('PRIVATE_SECOND_BODY'), { code: 'EACCES' }));
    const settled = await result;
    expect(settled).toEqual({
      exitCode: null,
      stdout: '',
      timedOut: false,
      aborted: false,
      overflow: false,
      spawnCode: 'ENOENT',
    });
    expect(killTree).not.toHaveBeenCalled();
    expect(observed()).toEqual([workspace]);
  });
});

it.each(['stdout', 'stderr'] as const)(
  'classifies %s without mining model/turn content',
  async (stream) => {
    const result = runClaudeProcess({ ...request(), classifyDiagnostics: true });
    child[stream]?.emit(
      'data',
      Buffer.from(
        stream === 'stdout'
          ? 'A response discussing quota and authentication'
          : 'Usage limit: quota exhausted PRIVATE_BODY',
      ),
    );
    child.emit('close', 1);
    if (stream === 'stderr') expect(await result).toMatchObject({ failureState: 'quota' });
    else expect(await result).not.toHaveProperty('failureState');
    expect(JSON.stringify(await result)).not.toContain('PRIVATE_BODY');
  },
);

it('does not infer turn causes from stderr', async () => {
  const result = runClaudeProcess(request());
  child.stderr?.emit('data', Buffer.from('quota network authentication PRIVATE_BODY'));
  child.emit('close', 1);
  expect(await result).not.toHaveProperty('failureState');
  expect(JSON.stringify(await result)).not.toContain('PRIVATE_BODY');
});

it('reports nonzero tree acknowledgement even if the root independently closes', async () => {
  vi.mocked(killTree).mockResolvedValue(false);
  const controller = new AbortController();
  const pending = runClaudeProcess(request(controller.signal));
  controller.abort();
  child.emit('close', 0);
  expect(await pending).toMatchObject({ terminationUnconfirmed: true, exitCode: null });
});

it('completes cancellation when tree acknowledgement precedes child close', async () => {
  const controller = new AbortController();
  const pending = runClaudeProcess(request(controller.signal));
  controller.abort();
  await Promise.resolve();
  child.emit('close', null);
  expect(await pending).not.toHaveProperty('terminationUnconfirmed');
  expect(vi.getTimerCount()).toBe(0);
});
