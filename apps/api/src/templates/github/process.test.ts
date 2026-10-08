import { ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeCommands,
  gateCommand,
  nativeExecutable,
  safeEnvironment,
  type CommandRequest,
  type ProcessGroups,
} from './process.js';

class Child extends ChildProcess {
  readonly output = new PassThrough();
  readonly errors = new PassThrough();
  readonly input = new PassThrough();
  readonly kills: (NodeJS.Signals | number | undefined)[] = [];
  onKill?: () => void;
  constructor(pid: number | undefined) {
    super();
    Object.defineProperties(this, {
      pid: { value: pid },
      stdout: { value: this.output },
      stderr: { value: this.errors },
      stdin: { value: this.input },
    });
  }
  override kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    this.onKill?.();
    return true;
  }
}
const request: CommandRequest = {
  program: 'fixture.exe',
  args: ['literal argument'],
  cwd: 'C:/fixture/workspace',
  timeoutMs: 10,
};
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
function fixture(
  platform: NodeJS.Platform = 'win32',
  options: { pid?: number | undefined; alive?: boolean; environment?: NodeJS.ProcessEnv } = {},
) {
  const child = new Child('pid' in options ? options.pid : 123);
  const killer = new Child(456);
  const calls: { program: string; args: readonly string[]; options: SpawnOptions }[] = [];
  const groups: ProcessGroups = { kill: vi.fn(), alive: vi.fn(() => options.alive ?? false) };
  const spawn = (program: string, args: readonly string[], spawnOptions: SpawnOptions) => {
    calls.push({ program, args, options: spawnOptions });
    return program === 'taskkill.exe' ? killer : child;
  };
  return {
    child,
    killer,
    calls,
    groups,
    commands: new NativeCommands(spawn, platform, options.environment ?? {}, 20, groups),
  };
}

describe('native command effect boundary', () => {
  it('preserves literal argv/stdin and strips inherited credentials without opening a shell', async () => {
    const environment = {
      Path: 'fixture-path',
      TEMP: 'fixture-temp',
      GH_TOKEN: 'secret',
      GITHUB_TOKEN: 'secret',
      GG_DATA_DIR: 'owner-data',
      API_KEY: 'secret',
    };
    const f = fixture('win32', { environment });
    let input = '';
    f.child.input.on('data', (chunk) => {
      input += String(chunk);
    });
    const args = ['$(never-run)', '& del important', 'text with spaces', '--flag=value'];
    const pending = f.commands.run({
      ...request,
      args,
      stdin: '{"literal":true}',
      env: { FIXTURE_MODE: 'test' },
    });
    f.child.output.write('safe output');
    f.child.errors.write('safe diagnostic');
    f.child.emit('close', 0);
    expect(await pending).toEqual({
      exitCode: 0,
      stdout: 'safe output',
      stderr: 'safe diagnostic',
      timedOut: false,
      overflow: false,
      termination: 'confirmed',
    });
    expect(f.calls).toEqual([
      {
        program: request.program,
        args,
        options: {
          cwd: request.cwd,
          env: { Path: 'fixture-path', TEMP: 'fixture-temp', FIXTURE_MODE: 'test' },
          shell: false,
          windowsHide: true,
          detached: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      },
    ]);
    expect(input).toBe('{"literal":true}');
    expect(environment.GH_TOKEN).toBe('secret');
  });

  it.each(['tool.cmd', 'tool.BAT'])('refuses %s before spawn', async (program) => {
    const f = fixture();
    await expect(f.commands.run({ ...request, program })).rejects.toThrow(
      'Native command required',
    );
    expect(f.calls).toEqual([]);
  });
  it('refuses NUL in an argument before spawn', async () => {
    const f = fixture();
    await expect(f.commands.run({ ...request, args: ['bad\0argument'] })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
  it('settles a synchronous spawn failure without leaking its raw error', async () => {
    const commands = new NativeCommands(
      () => {
        throw new Error('private-marker');
      },
      'win32',
      {},
      20,
      { kill: vi.fn(), alive: vi.fn() },
    );
    expect(await commands.run(request)).toEqual({
      exitCode: -1,
      stdout: '',
      stderr: '',
      timedOut: false,
      overflow: false,
      termination: 'confirmed',
    });
  });
  it('settles failure before process creation without raw diagnostics', async () => {
    const f = fixture('win32', { pid: undefined });
    const pending = f.commands.run(request);
    f.child.emit('error', new Error('private-marker'));
    expect(await pending).toMatchObject({ exitCode: -1, stderr: '', termination: 'confirmed' });
  });

  it('counts combined UTF-8 stdout/stderr bytes and stops buffering at overflow', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.commands.run({ ...request, timeoutMs: 1000, maxBytes: 5 });
    f.child.output.write(Buffer.from('é'));
    f.child.errors.write('abc');
    f.child.output.write('overflow');
    f.child.errors.write('must not buffer');
    f.killer.emit('close', 0);
    f.child.emit('close', null);
    expect(await pending).toEqual({
      exitCode: -1,
      stdout: 'é',
      stderr: 'abc',
      timedOut: false,
      overflow: true,
      termination: 'confirmed',
    });
    expect(f.calls[1]).toMatchObject({
      program: 'taskkill.exe',
      args: ['/pid', '123', '/t', '/f'],
    });
  });

  it('waits for the successful Windows tree kill after a parent close', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let settled = false;
    const pending = f.commands.run(request).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(10);
    f.child.emit('close', 9);
    await Promise.resolve();
    expect(settled).toBe(false);
    f.killer.emit('close', 0);
    expect(await pending).toMatchObject({ exitCode: 9, timedOut: true, termination: 'confirmed' });
    expect(f.child.kills).toEqual([]);
  });

  it.each(['nonzero', 'error'] as const)(
    'keeps Windows %s tree-kill failure unconfirmed even after parent close',
    async (failure) => {
      vi.useFakeTimers();
      const f = fixture();
      const pending = f.commands.run(request);
      await vi.advanceTimersByTimeAsync(10);
      if (failure === 'error') f.killer.emit('error', new Error('fixture taskkill unavailable'));
      else f.killer.emit('close', 1);
      f.child.emit('close', 0);
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toMatchObject({ timedOut: true, termination: 'unconfirmed' });
      expect(f.child.kills).toEqual(['SIGKILL']);
    },
  );

  it('cannot promote an error during failed termination into confirmed descendant shutdown', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.commands.run(request);
    f.child.onKill = () => {
      f.child.emit('error', new Error('kill failed'));
    };
    await vi.advanceTimersByTimeAsync(10);
    f.killer.emit('close', 1);
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ timedOut: true, termination: 'unconfirmed' });
  });

  it('hard-stops without advertising success when neither process nor killer closes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.commands.run(request);
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toMatchObject({
      exitCode: -1,
      timedOut: true,
      termination: 'unconfirmed',
    });
  });

  it.each([false, true])(
    'checks detached Unix descendants on parent close (alive=%s)',
    async (alive) => {
      const f = fixture('linux', { alive });
      const pending = f.commands.run(request);
      f.child.emit('close', 0);
      expect(await pending).toMatchObject({ termination: alive ? 'unconfirmed' : 'confirmed' });
      expect(f.calls[0]?.options.detached).toBe(true);
      expect(f.groups.alive).toHaveBeenCalledWith(123);
    },
  );
  it('kills only the injected Unix process group and confirms the reported group disappearance', async () => {
    vi.useFakeTimers();
    const f = fixture('linux');
    const pending = f.commands.run(request);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.groups.kill).toHaveBeenCalledWith(123);
    f.child.emit('close', 0);
    expect(await pending).toMatchObject({ timedOut: true, termination: 'confirmed' });
  });
  it('falls back after injected group kill failure and preserves uncertain liveness', async () => {
    vi.useFakeTimers();
    const f = fixture('linux');
    f.groups.kill = () => {
      throw new Error('fixture group unavailable');
    };
    f.groups.alive = () => {
      throw new Error('fixture liveness unavailable');
    };
    const pending = f.commands.run(request);
    await vi.advanceTimersByTimeAsync(10);
    f.child.emit('close', 0);
    expect(await pending).toMatchObject({ termination: 'unconfirmed' });
    expect(f.child.kills).toEqual(['SIGKILL']);
  });
  it('terminates on a broken stdin and does not retain later output', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.commands.run({ ...request, timeoutMs: 1000 });
    f.child.input.emit('error', new Error('fixture pipe closed'));
    f.child.output.write('must not buffer');
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({
      stdout: '',
      timedOut: false,
      termination: 'unconfirmed',
    });
  });
});

describe('installed native gate launch resolution', () => {
  async function directory() {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'gg-support-command-')));
    dirs.push(dir);
    return dir;
  }
  it('keeps only the finite inherited environment allowlist, case-insensitively', () => {
    expect(
      safeEnvironment({
        PATH: 'p',
        home: 'h',
        LANG: 'l',
        APPDATA: undefined,
        GH_TOKEN: 'secret',
        NODE_OPTIONS: '--require untrusted',
        npm_config_token: 'secret',
      }),
    ).toEqual({ PATH: 'p', home: 'h', LANG: 'l' });
  });
  it('resolves an installed native file from PATH and an explicit absolute path without executing it', async () => {
    const dir = await directory();
    const path = join(dir, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
    await writeFile(path, 'disposable inert fixture');
    expect(await nativeExecutable('fixture', { PATH: dir })).toBe(await realpath(path));
    expect(await nativeExecutable(path, { PATH: '' })).toBe(await realpath(path));
    const args = ['$(literal)', 'argument with spaces'];
    expect(await gateCommand(path, args)).toEqual({ program: await realpath(path), args });
  });
  it('refuses absent/directory candidates and Windows batch programs', async () => {
    const dir = await directory();
    await mkdir(join(dir, process.platform === 'win32' ? 'fixture.exe' : 'fixture'));
    await expect(nativeExecutable('fixture', { Path: dir })).rejects.toMatchObject({
      code: 'NATIVE_PROGRAM_UNAVAILABLE',
    });
    await expect(nativeExecutable('fixture.cmd', { PATH: dir })).rejects.toMatchObject({
      code: 'NATIVE_PROGRAM_REQUIRED',
    });
    await expect(gateCommand('fixture.bat', [])).rejects.toMatchObject({
      code: 'NATIVE_PROGRAM_REQUIRED',
    });
  });
  it('resolves pnpm through the current Node and installed cjs launcher with literal args', async () => {
    const dir = await directory();
    const launcher = join(dir, 'node_modules/pnpm/bin/pnpm.cjs');
    await mkdir(join(dir, 'node_modules/pnpm/bin'), { recursive: true });
    await writeFile(launcher, 'disposable inert launcher');
    expect(await gateCommand('pnpm', ['check', '$(literal)'], { PATH: dir })).toEqual({
      program: await realpath(process.execPath),
      args: [await realpath(launcher), 'check', '$(literal)'],
    });
  });
  it('refuses a missing pnpm launcher rather than falling back to a shell shim', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'pnpm.cmd'), 'disposable inert shim');
    await expect(gateCommand('pnpm', ['check'], { PATH: dir })).rejects.toMatchObject({
      code: 'PNPM_LAUNCHER_UNAVAILABLE',
    });
  });
});
