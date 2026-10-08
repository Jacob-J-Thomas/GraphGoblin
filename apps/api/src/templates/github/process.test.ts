import { ChildProcess, type SpawnOptions } from 'node:child_process';
import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, chmod } from 'node:fs/promises';
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
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof filesystem>();
  return { ...actual, open: vi.fn(actual.open) };
});

const request: CommandRequest = {
  program: 'fixture.exe',
  args: ['literal argument'],
  cwd: 'C:/fixture/workspace',
  timeoutMs: 10,
};
const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(filesystem.open).mockImplementation(
    (await vi.importActual<typeof filesystem>('node:fs/promises')).open,
  );
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
  it('ignores late process errors and output after the first settled result without starting termination', async () => {
    const f = fixture();
    const pending = f.commands.run(request);
    f.child.output.emit('data', 'é');
    f.child.errors.emit('data', 'safe');
    f.child.emit('close', 7);
    const settled = await pending;
    f.child.emit('error', new Error('late private diagnostic'));
    f.child.output.emit('data', 'late output');
    f.child.emit('close', 0);
    expect(settled).toMatchObject({
      exitCode: 7,
      stdout: 'é',
      stderr: 'safe',
      termination: 'confirmed',
    });
    expect(f.calls).toHaveLength(1);
    expect(f.child.kills).toEqual([]);
  });
  it('treats an error after process creation as an uncertain termination until the tree closes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.commands.run({ ...request, timeoutMs: 1000 });
    f.child.emit('error', new Error('private transport error'));
    expect(f.calls[1]?.program).toBe('taskkill.exe');
    f.child.emit('close', 0);
    f.killer.emit('close', 1);
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({
      exitCode: 0,
      timedOut: false,
      termination: 'unconfirmed',
      stderr: '',
    });
  });
  it('retains a hard deadline if Windows tree-kill creation and parent termination both throw', async () => {
    vi.useFakeTimers();
    const child = new Child(123),
      calls: string[] = [];
    child.onKill = () => {
      throw new Error('inert kill failure');
    };
    const commands = new NativeCommands(
      (program) => {
        calls.push(program);
        if (program === 'taskkill.exe') throw new Error('inert taskkill spawn failure');
        return child;
      },
      'win32',
      {},
      20,
      { kill: vi.fn(), alive: vi.fn() },
    );
    const pending = commands.run(request);
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toMatchObject({
      exitCode: -1,
      timedOut: true,
      termination: 'unconfirmed',
    });
    expect(calls).toEqual(['fixture.exe', 'taskkill.exe']);
    expect(child.kills).toEqual(['SIGKILL']);
  });
  it('keeps no-PID Unix termination bounded even when duplicate stop requests arrive', async () => {
    vi.useFakeTimers();
    const f = fixture('linux', { pid: undefined });
    const pending = f.commands.run(request);
    f.child.input.emit('error', new Error('first broken pipe'));
    f.child.input.emit('error', new Error('duplicate broken pipe'));
    expect(f.child.kills).toEqual(['SIGKILL']);
    expect(f.groups.kill).not.toHaveBeenCalled();
    f.child.emit('close', null);
    expect(await pending).toMatchObject({
      exitCode: -1,
      timedOut: false,
      termination: 'confirmed',
    });
    expect(f.groups.alive).not.toHaveBeenCalled();
  });
  it.each([
    { code: 'ESRCH', termination: 'confirmed' },
    { code: 'EPERM', termination: 'unconfirmed' },
    { code: null, termination: 'unconfirmed' },
  ] as const)(
    'default Unix group observation preserves $code uncertainty without a real signal',
    async ({ code, termination }) => {
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        const error = new Error('inert group observation');
        if (code !== null) Object.assign(error, { code });
        throw error;
      });
      const child = new Child(123);
      const commands = new NativeCommands(() => child, 'linux', {}, 20);
      const pending = commands.run(request);
      child.emit('close', 0);
      expect(await pending).toMatchObject({ exitCode: 0, termination });
      expect(kill).toHaveBeenCalledExactlyOnceWith(-123, 0);
    },
  );
  it('default Unix tree termination targets the detached group and observes ESRCH before confirming', async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('inert missing group'), { code: 'ESRCH' });
      return true;
    });
    const child = new Child(123);
    const commands = new NativeCommands(() => child, 'linux', {}, 20);
    const pending = commands.run(request);
    await vi.advanceTimersByTimeAsync(10);
    child.emit('close', 0);
    expect(await pending).toMatchObject({ timedOut: true, termination: 'confirmed' });
    expect(kill.mock.calls).toEqual([
      [-123, 'SIGKILL'],
      [-123, 0],
    ]);
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

describe('native credential-location context', () => {
  it.each([false, true])(
    'exposes location context only to trusted native requests (trusted=%s)',
    async (trusted) => {
      const context = {
        SSH_AUTH_SOCK: '/inert/agent',
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/inert/bus',
        XDG_RUNTIME_DIR: '/inert/runtime',
        XDG_CONFIG_HOME: '/inert/config',
        GH_CONFIG_DIR: '/inert/gh',
      };
      const f = fixture('linux', {
        environment: {
          PATH: '/inert/bin',
          ...context,
          GH_TOKEN: 'never-pass',
          GITHUB_TOKEN: 'never-pass',
          NODE_OPTIONS: 'never-pass',
        },
      });
      const pending = f.commands.run({
        ...request,
        credentialContext: trusted,
        env: { ...context, GH_TOKEN: 'never-pass', GIT_TERMINAL_PROMPT: '0' },
      });
      f.child.emit('close', 0);
      await pending;
      expect(f.calls[0]?.options.env).toEqual({
        PATH: '/inert/bin',
        ...(trusted ? context : {}),
        GIT_TERMINAL_PROMPT: '0',
      });
    },
  );
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
    await writeFile(
      join(launcher, '../..', 'package.json'),
      JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
    );
    expect(
      await gateCommand(
        'pnpm',
        ['check', '$(literal)'],
        { PATH: dir, COREPACK_HOME: join(dir, 'missing') },
        dir,
      ),
    ).toEqual({
      program: await realpath(process.execPath),
      args: [await realpath(launcher), 'check', '$(literal)'],
    });
  });
  function peHeader() {
    const bytes = Buffer.alloc(128);
    bytes.write('MZ', 0, 'ascii');
    bytes.writeUInt32LE(64, 60);
    Buffer.from([80, 69, 0, 0]).copy(bytes, 64);
    return bytes;
  }
  async function nativePackage(
    root: string,
    bin: string,
    bytes: Buffer | string,
    version = '12.8.1',
  ) {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'pnpm', version, bin: { pnpm: bin } }),
    );
    await mkdir(join(root, bin, '..'), { recursive: true });
    await writeFile(join(root, bin), bytes);
    return join(root, bin);
  }
  it('resolves the installed pnpm12 nvm Windows native executable with an exact workspace pin', async () => {
    const dir = await directory(),
      bin = join(dir, 'nvm4w/nodejs'),
      cache = join(dir, 'cache');
    const launcher = await nativePackage(join(bin, 'node_modules/pnpm'), 'pnpm.exe', peHeader());
    await writeFile(join(bin, 'pnpm.cmd'), 'never interpreted or executed');
    await mkdir(cache);
    await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify({ pnpm: '9.3.1' }));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@12.8.1+sha512.abcd' }),
    );
    const args = ['check', 'argument with spaces', '$(literal)', '& literal'];
    expect(
      await gateCommand('pnpm', args, { PATH: bin, COREPACK_HOME: cache }, dir, 'win32'),
    ).toEqual({
      program: await realpath(launcher),
      args,
    });
  });
  it('resolves only the declared native bin from the exact installed Corepack cache package', async () => {
    const dir = await directory(),
      cache = join(dir, 'cache');
    const launcher = await nativePackage(join(cache, 'v1/pnpm/12.8.1'), 'pnpm', peHeader());
    await mkdir(join(launcher, '..', 'bin'));
    await writeFile(join(launcher, '..', 'bin/pnpm.mjs'), 'never interpreted');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    expect(
      await gateCommand('pnpm', ['check'], { PATH: dir, COREPACK_HOME: cache }, dir, 'win32'),
    ).toEqual({
      program: await realpath(launcher),
      args: ['check'],
    });
  });
  it.runIf(process.platform !== 'win32')(
    'resolves a pinned Unix native ELF launcher without a shell',
    async () => {
      const dir = await directory(),
        bin = join(dir, 'bin');
      await mkdir(bin);
      const bytes = Buffer.alloc(64);
      Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(bytes);
      const launcher = await nativePackage(join(dir, 'lib/node_modules/pnpm'), 'pnpm', bytes);
      await chmod(launcher, 0o755);
      await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
      expect(
        await gateCommand(
          'pnpm',
          ['check'],
          { PATH: bin, COREPACK_HOME: join(dir, 'missing') },
          dir,
          'linux',
        ),
      ).toEqual({
        program: await realpath(launcher),
        args: ['check'],
      });
      await chmod(launcher, 0o644);
      await expect(
        gateCommand('pnpm', [], { PATH: bin, COREPACK_HOME: join(dir, 'missing') }, dir, 'linux'),
      ).rejects.toMatchObject({
        code: 'PNPM_LAUNCHER_UNAVAILABLE',
      });
    },
  );
  it.each([
    '#!/bin/sh\nnever run',
    '#!/usr/bin/env node\nnever run',
    Buffer.from('MZ'),
    Buffer.alloc(64),
    (() => {
      const bytes = peHeader();
      bytes.writeUInt32LE(1048577, 60);
      return bytes;
    })(),
    (() => {
      const bytes = peHeader();
      bytes[64] = 0;
      return bytes;
    })(),
  ])('refuses native metadata pointing at a script or invalid executable header', async (bytes) => {
    const dir = await directory();
    await nativePackage(join(dir, 'node_modules/pnpm'), 'pnpm.exe', bytes);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir, 'win32'),
    ).rejects.toMatchObject({
      code: 'PNPM_LAUNCHER_UNAVAILABLE',
    });
  });
  async function modelUnixFileMode(launcher: string, mode: number) {
    const originalOpen = (await vi.importActual<typeof filesystem>('node:fs/promises')).open;
    vi.mocked(filesystem.open).mockImplementation(async (path, flags, permissions) => {
      const file = await originalOpen(path, flags, permissions);
      if (String(path) === launcher) {
        const stats = await file.stat();
        stats.mode = mode;
        // Only model the Unix execute bit on Windows; bytes, path checks and close remain real disposable I/O.
        Object.defineProperty(file, 'stat', { value: () => Promise.resolve(stats) });
      }
      return file;
    });
  }
  function elfHeader() {
    const bytes = Buffer.alloc(64);
    Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(bytes);
    return bytes;
  }
  it.each([
    { reason: 'valid ELF64', bytes: elfHeader(), accepted: true },
    {
      reason: 'valid ELF32 big-endian',
      bytes: (() => {
        const b = elfHeader();
        b[4] = 1;
        b[5] = 2;
        return b;
      })(),
      accepted: true,
    },
    { reason: 'short ELF', bytes: elfHeader().subarray(0, 8), accepted: false },
    { reason: 'wrong magic', bytes: Buffer.alloc(64), accepted: false },
    {
      reason: 'unsupported class',
      bytes: (() => {
        const b = elfHeader();
        b[4] = 0;
        return b;
      })(),
      accepted: false,
    },
    {
      reason: 'unsupported byte order',
      bytes: (() => {
        const b = elfHeader();
        b[5] = 0;
        return b;
      })(),
      accepted: false,
    },
    {
      reason: 'unsupported ELF version',
      bytes: (() => {
        const b = elfHeader();
        b[6] = 2;
        return b;
      })(),
      accepted: false,
    },
  ])(
    'validates $reason from bounded native header reads without execution',
    async ({ bytes, accepted }) => {
      const dir = await directory(),
        root = join(dir, 'node_modules/pnpm');
      const launcher = await nativePackage(root, 'pnpm', bytes);
      await modelUnixFileMode(await realpath(launcher), 0o755);
      await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
      const result = gateCommand(
        'pnpm',
        ['check'],
        { PATH: dir, COREPACK_HOME: join(dir, 'missing') },
        dir,
        'linux',
      );
      if (accepted)
        await expect(result).resolves.toEqual({
          program: await realpath(launcher),
          args: ['check'],
        });
      else await expect(result).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
    },
  );
  it.each([
    { reason: 'Mach-O', bytes: Buffer.from('feedfacf', 'hex'), accepted: true },
    { reason: 'fat Mach-O', bytes: Buffer.from('cafebabe', 'hex'), accepted: true },
    { reason: 'short Mach-O', bytes: Buffer.from('feedfa', 'hex'), accepted: false },
    { reason: 'unknown Mach-O', bytes: Buffer.alloc(64), accepted: false },
  ])(
    'validates $reason using injected executable mode and inert native bytes',
    async ({ bytes, accepted }) => {
      const dir = await directory();
      const launcher = await nativePackage(join(dir, 'node_modules/pnpm'), 'pnpm', bytes);
      await modelUnixFileMode(await realpath(launcher), 0o755);
      await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
      const result = gateCommand(
        'pnpm',
        ['check'],
        { PATH: dir, COREPACK_HOME: join(dir, 'missing') },
        dir,
        'darwin',
      );
      if (accepted)
        await expect(result).resolves.toEqual({
          program: await realpath(launcher),
          args: ['check'],
        });
      else await expect(result).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
    },
  );
  it('refuses a nonexecutable Unix native candidate despite valid package pin and ELF bytes', async () => {
    const dir = await directory();
    const launcher = await nativePackage(join(dir, 'node_modules/pnpm'), 'pnpm', elfHeader());
    await modelUnixFileMode(await realpath(launcher), 0o644);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir, 'linux'),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it.each([
    (() => {
      const bytes = peHeader();
      bytes.writeUInt32LE(32, 60);
      return bytes;
    })(),
    peHeader().subarray(0, 64),
  ])('refuses a PE offset before the header or a truncated PE signature', async (bytes) => {
    const dir = await directory();
    await nativePackage(join(dir, 'node_modules/pnpm'), 'pnpm.exe', bytes);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir, 'win32'),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it('refuses a pnpm12 native executable with a different version or undeclared bin', async () => {
    const dir = await directory(),
      root = join(dir, 'node_modules/pnpm');
    await nativePackage(root, 'pnpm.exe', peHeader(), '12.8.0');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    const resolve = () =>
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir, 'win32');
    await expect(resolve()).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'pnpm', version: '12.8.1', bin: { pnpm: 'pnpm' } }),
    );
    await expect(resolve()).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it.each(['lib/node_modules/pnpm/bin/pnpm.cjs', 'node_modules/pnpm/bin/pnpm.cjs'])(
    'resolves standard Unix/npm/nvm layout %s without launching a wrapper',
    async (layout) => {
      const dir = await directory(),
        bin = join(dir, 'bin'),
        launcher = join(dir, layout);
      await mkdir(bin);
      await mkdir(join(launcher, '..'), { recursive: true });
      await writeFile(launcher, 'inert pnpm launcher');
      await writeFile(
        join(launcher, '../..', 'package.json'),
        JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
      );
      expect(
        await gateCommand(
          'pnpm',
          ['check'],
          { PATH: bin, COREPACK_HOME: join(dir, 'missing') },
          dir,
        ),
      ).toEqual({
        program: await realpath(process.execPath),
        args: [await realpath(launcher), 'check'],
      });
    },
  );
  it('resolves a symlinked installed pnpm launcher without interpreting its contents', async ({
    skip,
  }) => {
    const dir = await directory(),
      bin = join(dir, 'bin'),
      launcher = join(dir, 'installed/pnpm/bin/pnpm.cjs');
    await mkdir(bin);
    await mkdir(join(launcher, '..'), { recursive: true });
    await writeFile(launcher, 'inert pnpm launcher');
    await writeFile(
      join(launcher, '../..', 'package.json'),
      JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
    );
    try {
      await symlink(launcher, join(bin, 'pnpm'), 'file');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM')
        return skip();
      throw error;
    }
    expect(
      (
        await gateCommand(
          'pnpm',
          ['check'],
          { PATH: bin, COREPACK_HOME: join(dir, 'missing') },
          dir,
        )
      ).args[0],
    ).toBe(await realpath(launcher));
  });
  it.each([false, true])(
    'uses only an already installed pinned Corepack cache (project=%s), without executing Corepack',
    async (project) => {
      const dir = await directory(),
        cache = join(dir, 'cache'),
        launcher = join(cache, 'v1/pnpm/9.3.1/bin/pnpm.cjs');
      await mkdir(join(launcher, '..'), { recursive: true });
      await writeFile(launcher, 'inert pnpm launcher');
      await writeFile(
        join(launcher, '../..', 'package.json'),
        JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
      );
      await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify({ pnpm: '9.3.1' }));
      if (project)
        await writeFile(
          join(dir, 'package.json'),
          JSON.stringify({ packageManager: 'pnpm@9.3.1+sha512.abcd' }),
        );
      expect(
        await gateCommand('pnpm', ['check'], { PATH: dir, COREPACK_HOME: cache }, dir),
      ).toEqual({
        program: await realpath(process.execPath),
        args: [await realpath(launcher), 'check'],
      });
    },
  );
  it('refuses installed/cache pnpm versions that differ from the workspace pin', async () => {
    const dir = await directory(),
      cache = join(dir, 'cache'),
      launcher = join(cache, 'v1/pnpm/9.3.1/bin/pnpm.cjs');
    await mkdir(join(launcher, '..'), { recursive: true });
    await writeFile(launcher, 'inert');
    await writeFile(
      join(launcher, '../..', 'package.json'),
      JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
    );
    await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify({ pnpm: '9.3.1' }));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: cache }, dir),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
    await mkdir(join(dir, 'node_modules/pnpm/bin'), { recursive: true });
    await writeFile(join(dir, 'node_modules/pnpm/bin/pnpm.cjs'), 'inert');
    await writeFile(
      join(dir, 'node_modules/pnpm/package.json'),
      JSON.stringify({ name: 'pnpm', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } }),
    );
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: cache }, dir),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it.each([
    { name: 'renamed-wrapper', version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } },
    { name: 'pnpm', version: '9.3.1', bin: { pnpm: 'untrusted.js' } },
    { name: 'pnpm', version: 'unknown', bin: { pnpm: 'bin/pnpm.cjs' } },
  ])('refuses unrelated or unsafe launcher metadata %j', async (metadata) => {
    const dir = await directory(),
      launcher = join(dir, 'node_modules/pnpm/bin/pnpm.cjs');
    await mkdir(join(launcher, '..'), { recursive: true });
    await writeFile(launcher, 'inert');
    await writeFile(join(launcher, '../..', 'package.json'), JSON.stringify(metadata));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it.each([
    null,
    12,
    {},
    { version: '9.3.1', bin: { pnpm: 'bin/pnpm.cjs' } },
    { name: 'pnpm', bin: { pnpm: 'bin/pnpm.cjs' } },
    { name: 'pnpm', version: 9, bin: { pnpm: 'bin/pnpm.cjs' } },
    { name: 'pnpm', version: '9.3.1' },
    { name: 'pnpm', version: '9.3.1', bin: null },
    { name: 'pnpm', version: '9.3.1', bin: 'bin/pnpm.cjs' },
    { name: 'pnpm', version: '9.3.1', bin: {} },
  ])('refuses incomplete or incorrectly typed installed package metadata %j', async (metadata) => {
    const dir = await directory(),
      root = join(dir, 'node_modules/pnpm');
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(root, 'bin/pnpm.cjs'), 'inert, never executed');
    await writeFile(join(root, 'package.json'), JSON.stringify(metadata));
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir),
    ).rejects.toMatchObject({
      code: 'PNPM_LAUNCHER_UNAVAILABLE',
    });
  });
  it.each([
    'directory-launcher',
    'directory-metadata',
    'oversized-metadata',
    'malformed-metadata',
  ] as const)('refuses nonregular or unbounded package members (%s)', async (kind) => {
    const dir = await directory(),
      root = join(dir, 'node_modules/pnpm');
    await mkdir(join(root, 'bin'), { recursive: true });
    if (kind === 'directory-launcher') await mkdir(join(root, 'bin/pnpm.cjs'));
    else await writeFile(join(root, 'bin/pnpm.cjs'), 'inert, never executed');
    if (kind === 'directory-metadata') await mkdir(join(root, 'package.json'));
    else
      await writeFile(
        join(root, 'package.json'),
        kind === 'oversized-metadata'
          ? ' '.repeat(65537)
          : kind === 'malformed-metadata'
            ? '{bad json'
            : JSON.stringify({
                name: 'pnpm',
                version: '9.3.1',
                bin: { pnpm: 'bin/pnpm.cjs' },
              }),
      );
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir),
    ).rejects.toMatchObject({
      code: 'PNPM_LAUNCHER_UNAVAILABLE',
    });
  });
  it('uses PNPM_HOME and Path only as installed candidate roots with literal argument preservation', async () => {
    const dir = await directory(),
      home = join(dir, 'pnpm-home');
    const launcher = await nativePackage(join(home, 'pnpm'), 'pnpm.exe', peHeader());
    await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.8.1' }));
    for (const environment of [
      { PNPM_HOME: home, COREPACK_HOME: join(dir, 'missing') },
      { Path: home, COREPACK_HOME: join(dir, 'missing') },
    ])
      expect(
        await gateCommand('pnpm', ['check', 'literal & argument'], environment, dir, 'win32'),
      ).toEqual({
        program: await realpath(launcher),
        args: ['check', 'literal & argument'],
      });
    await expect(nativeExecutable('absent.exe', {})).rejects.toMatchObject({
      code: 'NATIVE_PROGRAM_UNAVAILABLE',
    });
  });
  it.each([
    {
      platform: 'win32',
      environment: (dir: string) => ({ LOCALAPPDATA: dir }),
      folder: 'node/corepack',
    },
    {
      platform: 'linux',
      environment: (dir: string) => ({ XDG_CACHE_HOME: dir }),
      folder: 'node/corepack',
    },
    {
      platform: 'linux',
      environment: (dir: string) => ({ HOME: dir }),
      folder: '.cache/node/corepack',
    },
  ] as const)(
    'resolves the installed default cache from explicit $platform location context',
    async ({ platform, environment, folder }) => {
      const dir = await directory(),
        root = join(dir, folder, 'v1/pnpm/9.3.1');
      const launcher = await nativePackage(root, 'bin/pnpm.cjs', 'inert cjs', '9.3.1');
      await writeFile(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.3.1' }));
      expect(
        await gateCommand('pnpm', ['check'], { ...environment(dir), PATH: dir }, dir, platform),
      ).toEqual({
        program: await realpath(process.execPath),
        args: [await realpath(launcher), 'check'],
      });
    },
  );
  it.each([null, 0, {}, { packageManager: 12 }, { packageManager: 'yarn@1.0.0' }])(
    'does not derive a pnpm pin from unrelated project metadata %j',
    async (metadata) => {
      const dir = await directory(),
        cache = join(dir, 'cache');
      const launcher = await nativePackage(
        join(cache, 'v1/pnpm/9.3.1'),
        'bin/pnpm.cjs',
        'inert cjs',
        '9.3.1',
      );
      await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify({ pnpm: '9.3.1' }));
      await writeFile(join(dir, 'package.json'), JSON.stringify(metadata));
      expect(
        await gateCommand('pnpm', ['check'], { PATH: dir, COREPACK_HOME: cache }, dir),
      ).toEqual({
        program: await realpath(process.execPath),
        args: [await realpath(launcher), 'check'],
      });
    },
  );
  it.each([null, 0, {}, { pnpm: 12 }])(
    'refuses an untyped default cache version %j without choosing a wrapper',
    async (metadata) => {
      const dir = await directory(),
        cache = join(dir, 'cache');
      await mkdir(cache);
      await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify(metadata));
      await writeFile(join(dir, 'pnpm.cmd'), 'never executed');
      await expect(
        gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: cache }, dir),
      ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
    },
  );
  it('refuses an unsafe workspace pin even when an otherwise matching native installation exists', async () => {
    const dir = await directory();
    await nativePackage(join(dir, 'node_modules/pnpm'), 'pnpm.exe', peHeader());
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@../../12.8.1' }),
    );
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir, 'win32'),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it('refuses unsafe Corepack version paths and never executes an arbitrary shell wrapper', async () => {
    const dir = await directory(),
      cache = join(dir, 'cache');
    await mkdir(cache);
    await writeFile(join(cache, 'lastKnownGood.json'), JSON.stringify({ pnpm: '../../untrusted' }));
    await writeFile(join(dir, 'pnpm'), '#!/bin/sh\\nmalicious wrapper');
    await expect(
      gateCommand('pnpm', [], { PATH: dir, COREPACK_HOME: cache }, dir),
    ).rejects.toMatchObject({ code: 'PNPM_LAUNCHER_UNAVAILABLE' });
  });
  it('refuses a missing pnpm launcher rather than falling back to a shell shim', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'pnpm.cmd'), 'disposable inert shim');
    await expect(
      gateCommand('pnpm', ['check'], { PATH: dir, COREPACK_HOME: join(dir, 'missing') }, dir),
    ).rejects.toMatchObject({
      code: 'PNPM_LAUNCHER_UNAVAILABLE',
    });
  });
});
