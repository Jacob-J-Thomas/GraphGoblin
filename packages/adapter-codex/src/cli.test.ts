import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bundledCli,
  CLI_CLEANUP_ALLOWANCE_MS,
  cliFor,
  preflightCli,
  runCli,
  type CliResult,
} from './cli.js';

// Observe the processes runCli starts, and substitute a controlled child where a case says so.
vi.mock('node:child_process', { spy: true });

/** The process the `index`th spawn of this case started. */
function started(index = 0): ChildProcess | undefined {
  const result = vi.mocked(spawn).mock.results[index];
  return result?.type === 'return' ? result.value : undefined;
}

/** A process has exited once Node recorded its exit code or signal. */
const exited = (child: ChildProcess | undefined): boolean =>
  child !== undefined && (child.exitCode !== null || child.signalCode !== null);

describe('bundledCli', () => {
  it('resolves the launcher of the CLI the SDK depends on', () => {
    const cli = bundledCli();
    expect(cli?.command).toBe(process.execPath);
    expect(cli?.prefix[0]).toMatch(/codex[\\/]bin[\\/]codex\.js$/);
    expect(existsSync(cli?.prefix[0] ?? '')).toBe(true);
  });

  it('returns undefined when the SDK cannot be resolved', () => {
    expect(
      bundledCli(() => {
        throw new Error('not found');
      }),
    ).toBeUndefined();
  });
});

describe('cliFor', () => {
  it('runs JavaScript launchers through Node and executables directly', () => {
    expect(cliFor('/x/codex.js')).toEqual({ command: process.execPath, prefix: ['/x/codex.js'] });
    expect(cliFor('C:\\bin\\codex.exe')).toEqual({ command: 'C:\\bin\\codex.exe', prefix: [] });
  });
});

describe('runCli', () => {
  const node = { command: process.execPath, prefix: [] };

  it('captures stdout and stderr together, stdout alone, and the exit code', async () => {
    const result = await runCli(
      node,
      ['-e', 'process.stdout.write("out ");process.stderr.write("err");process.exit(3)'],
      10_000,
    );
    expect(result).toEqual({ code: 3, output: expect.stringMatching(/out|err/), stdout: 'out ' });
    expect(result.output).toContain('err');
  });

  it('reports a missing binary as a spawn error', async () => {
    const result = await runCli(
      { command: 'graphgoblin-no-such-codex-binary', prefix: [] },
      ['--version'],
      10_000,
    );
    expect(result.code).toBeNull();
    expect(result.spawnError).toMatch(/ENOENT/);
  });

  it('kills a process that exceeds the timeout and returns only once it has closed (#506)', async () => {
    const result = await runCli(node, ['-e', 'setTimeout(() => {}, 60000)'], 200);
    expect(result).toEqual({
      code: null,
      output: '',
      stdout: '',
      spawnError: 'timed out after 200 ms',
    });
    expect(exited(started())).toBe(true);
  });

  it('ends a running process on cancellation and returns only once it has closed (#506)', async () => {
    const controller = new AbortController();
    const call = runCli(
      node,
      ['-e', 'process.stdout.write("started");setInterval(() => {}, 1000)'],
      60_000,
      controller.signal,
    );
    const child = started();
    await new Promise((resolve) => child?.stdout?.once('data', resolve));
    controller.abort();
    expect(await call).toEqual({
      code: null,
      output: 'started',
      stdout: 'started',
      spawnError: 'The operation was aborted',
    });
    expect(exited(child)).toBe(true);
  });
});

describe('runCli settlement under test control (#506)', () => {
  /** A child that exits and closes only when the case says so. */
  class ControlledChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly kill = vi.fn((_signal?: NodeJS.Signals | number): boolean => true);
    /** A child without a pid never started, as after a missing executable. */
    readonly pid: number | undefined;
    constructor(started = true) {
      super();
      this.pid = started ? 4242 : undefined;
    }
    /** Exits; a process it started can still hold its output open, which delays close. */
    exit(code: number | null, signal: NodeJS.Signals | null = null): void {
      this.exitCode = code;
      this.signalCode = signal;
      this.emit('exit', code, signal);
    }
    close(code: number | null): void {
      this.emit('close', code, this.signalCode);
    }
  }

  const node = { command: process.execPath, prefix: [] };
  const timeout = 'timed out after 100 ms';
  const aborted = 'The operation was aborted';
  const halfway = CLI_CLEANUP_ALLOWANCE_MS / 2;

  /** The next spawn returns `child` instead of starting a process. */
  function controlled(child = new ControlledChild()): ControlledChild {
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    return child;
  }

  /** The call's result once it has settled. */
  function track(call: Promise<CliResult>): { result?: CliResult } {
    const seen: { result?: CliResult } = {};
    void call.then((result) => {
      seen.result = result;
    });
    return seen;
  }

  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a timeout, asks the child to stop and resolves only at its close, whatever its exit code', async () => {
    const child = controlled();
    const seen = track(runCli(node, ['x'], 100));
    child.stdout.emit('data', Buffer.from('partial '));
    child.stderr.emit('data', Buffer.from('warning'));
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    // Output after the first failure is drained, not kept.
    child.stdout.emit('data', Buffer.from('PRIVATE_LATE_STDOUT'));
    child.stderr.emit('data', Buffer.from('PRIVATE_LATE_STDERR'));
    await vi.advanceTimersByTimeAsync(halfway - 1);
    expect(seen.result).toBeUndefined();
    child.exit(0);
    child.close(0);
    await flush();
    expect(seen.result).toEqual({
      code: null,
      output: 'partial warning',
      stdout: 'partial ',
      spawnError: timeout,
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the wait with one stronger request, then reports termination unconfirmed', async () => {
    const child = controlled();
    const seen = track(runCli(node, ['x'], 100));
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(halfway - 1);
    expect(child.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await vi.advanceTimersByTimeAsync(CLI_CLEANUP_ALLOWANCE_MS - halfway - 1);
    expect(seen.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.result).toEqual({
      code: null,
      output: '',
      stdout: '',
      spawnError: timeout,
      terminationUnconfirmed: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    // A close after the allowance changes nothing and asks nothing more of the child.
    child.exit(1);
    child.close(1);
    await flush();
    expect(seen.result).toMatchObject({ code: null, terminationUnconfirmed: true });
    expect(child.kill).toHaveBeenCalledTimes(2);
  });

  it.for([
    [1, null],
    [null, 'SIGTERM'],
  ] as const)(
    'sends no stronger request to a child that exited (%s, %s) while its output stays open',
    async ([code, signal]) => {
      const child = controlled();
      const seen = track(runCli(node, ['x'], 100));
      await vi.advanceTimersByTimeAsync(100);
      child.exit(code, signal);
      await vi.advanceTimersByTimeAsync(CLI_CLEANUP_ALLOWANCE_MS);
      expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
      expect(seen.result).toEqual({
        code: null,
        output: '',
        stdout: '',
        spawnError: timeout,
        terminationUnconfirmed: true,
      });
    },
  );

  it('keeps a cancellation, cancels the deadline and resolves only at the close', async () => {
    const child = controlled();
    const controller = new AbortController();
    const seen = track(runCli(node, ['x'], 100, controller.signal));
    controller.abort();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(150);
    expect(seen.result).toBeUndefined();
    expect(child.kill).toHaveBeenCalledOnce();
    child.exit(1);
    child.close(1);
    await flush();
    expect(seen.result).toEqual({ code: null, output: '', stdout: '', spawnError: aborted });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a timeout when a cancellation follows it', async () => {
    const child = controlled();
    const controller = new AbortController();
    const seen = track(runCli(node, ['x'], 100, controller.signal));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(child.kill).toHaveBeenCalledOnce();
    child.close(1);
    await flush();
    expect(seen.result).toEqual({ code: null, output: '', stdout: '', spawnError: timeout });
  });

  it('keeps the first failure when a termination request throws or the child reports an error', async () => {
    const child = controlled();
    child.kill.mockImplementationOnce(() => {
      throw new Error('kill EPERM PRIVATE_KILL');
    });
    const seen = track(runCli(node, ['x'], 100));
    await vi.advanceTimersByTimeAsync(100);
    child.emit('error', new Error('kill EPERM PRIVATE_ERROR'));
    await vi.advanceTimersByTimeAsync(halfway);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    child.exit(null, 'SIGKILL');
    child.close(null);
    await flush();
    expect(seen.result).toEqual({ code: null, output: '', stdout: '', spawnError: timeout });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a started child that reports an error, keeping that error as the cause', async () => {
    const child = controlled();
    const seen = track(runCli(node, ['x'], 60_000));
    child.emit('error', new Error('read EPIPE'));
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await vi.advanceTimersByTimeAsync(10);
    expect(seen.result).toBeUndefined();
    child.close(null);
    await flush();
    expect(seen.result).toEqual({ code: null, output: '', stdout: '', spawnError: 'read EPIPE' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts nothing when the call is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runCli(node, ['x'], 100, controller.signal)).resolves.toEqual({
      code: null,
      output: '',
      stdout: '',
      spawnError: aborted,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a start failure at once, leaving no timer, listener or termination request', async () => {
    const child = controlled(new ControlledChild(false));
    const controller = new AbortController();
    const seen = track(runCli(node, ['x'], 60_000, controller.signal));
    child.emit('error', new Error('spawn codex ENOENT'));
    await flush();
    expect(seen.result).toEqual({
      code: null,
      output: '',
      stdout: '',
      spawnError: 'spawn codex ENOENT',
    });
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    child.close(-4058);
    await flush();
    expect(child.kill).not.toHaveBeenCalled();
    expect(seen.result?.spawnError).toBe('spawn codex ENOENT');
  });

  it('reports a cancellation that comes before a start failure without waiting', async () => {
    const child = controlled(new ControlledChild(false));
    const controller = new AbortController();
    const seen = track(runCli(node, ['x'], 60_000, controller.signal));
    controller.abort();
    await flush();
    expect(seen.result).toEqual({ code: null, output: '', stdout: '', spawnError: aborted });
    child.emit('error', new Error('spawn codex ENOENT'));
    child.close(-4058);
    await flush();
    expect(seen.result?.spawnError).toBe(aborted);
    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves an ordinary completion at its close and removes its deadline and listener', async () => {
    const child = controlled();
    const controller = new AbortController();
    const seen = track(runCli(node, ['x'], 100, controller.signal));
    child.stdout.emit('data', Buffer.from('[]'));
    child.stderr.emit('data', Buffer.from(' warning'));
    child.exit(0);
    child.close(0);
    await flush();
    expect(seen.result).toEqual({ code: 0, output: '[] warning', stdout: '[]' });
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(CLI_CLEANUP_ALLOWANCE_MS);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('preflightCli', () => {
  it('reports a missing bundled CLI', async () => {
    const result = await preflightCli(undefined, () => Promise.reject(new Error('unused')), 1);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'Codex CLI was not found. Install the Codex CLI or set GG_CODEX_BINARY, then retry preflight.',
    ]);
  });
});

describe('Codex no-turn executable boundaries', () => {
  it.each([
    ['ready', 'ready'],
    ['old', 'cli-incompatible'],
    ['missing-model', 'cli-incompatible'],
    ['missing-effort', 'cli-incompatible'],
    ['missing-resume-json', 'cli-incompatible'],
    ['prerelease', 'ready'],
    ['auth', 'auth'],
    ['quota', 'quota'],
    ['transport', 'transport'],
    ['unknown', 'unknown'],
    ['hang', 'unknown'],
  ])(
    '%s reports %s',
    async (scenario, state) => {
      const cli = {
        command: process.execPath,
        prefix: [fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)), scenario],
      };
      const result = await preflightCli(cli, runCli, scenario === 'hang' ? 1000 : 15000);
      expect(result).toMatchObject({ state, ok: state === 'ready' });
      if (scenario === 'ready' || scenario === 'auth')
        expect(result.authenticated).toBe(scenario === 'ready');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_MARKER');
      const update = ' Update the Codex CLI, then retry preflight.';
      const expected: Record<string, string> = {
        old: 'Codex CLI 0.100.0 is older than the minimum version 0.160.0.' + update,
        'missing-model': 'Codex CLI 0.160.0 does not list required exec options: --model.' + update,
        'missing-effort':
          'Codex CLI 0.160.0 does not list required exec options: --config.' + update,
        'missing-resume-json': 'Codex CLI 0.160.0 does not list --json for exec resume.' + update,
        auth: 'Codex sign-in is missing or invalid. Run codex login, then retry preflight.',
      };
      // One detail sentence that names the version and flag, then one action; never repeated.
      if (expected[scenario]) expect(result.problems).toEqual([expected[scenario]]);
      if (state === 'cli-incompatible') expect(result).not.toHaveProperty('authenticated');
    },
    75000,
  );
  it('probes the actual installed SDK CLI without a model turn', async (context) => {
    const cli = bundledCli();
    if (!cli) {
      context.skip('Codex binary missing');
      return;
    }
    const result = await preflightCli(cli, runCli, 15000);
    if (result.state === 'cli-missing') {
      context.skip('Codex platform binary missing');
      return;
    }
    if (result.state === 'auth') {
      context.skip(
        'Installed Codex has no accessible login in this environment (sandbox may hide owner login)',
      );
      return;
    }
    expect(result).toMatchObject({ state: 'ready', ok: true, authenticated: true });
    expect(result.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  }, 60000);
});

describe('audited Codex auth evidence', () => {
  it.each([
    ['auth-network', 'auth'],
    ['quota-network', 'quota'],
    ['stdout-quota-warning', 'quota'],
    ['auth-empty', 'unknown'],
    ['auth-unrecognised', 'unknown'],
  ] as const)(
    '%s preserves %s evidence through the executable boundary',
    async (scenario, state) => {
      const result = await preflightCli(
        {
          command: process.execPath,
          prefix: [
            fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)),
            scenario,
          ],
        },
        runCli,
        15000,
      );
      expect(result).toMatchObject({ state, ok: false });
      if (state === 'unknown') {
        expect(result).not.toHaveProperty('authenticated');
        expect(result.problems).toEqual([
          'Codex readiness could not be confirmed. Check that the Codex CLI starts and responds, then retry preflight.',
        ]);
      }
    },
    60000,
  );
});

it('keeps a timed-out lookup unknown even when partial output mentions quota', async () => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    (_cli, args) =>
      Promise.resolve(
        args.includes('--version')
          ? { code: 0, output: 'codex-cli 0.160.0', stdout: 'codex-cli 0.160.0' }
          : args.includes('--help')
            ? {
                code: 0,
                output:
                  '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
                stdout:
                  '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
              }
            : {
                code: null,
                output: 'quota PRIVATE_PARTIAL_BODY',
                stdout: 'quota PRIVATE_PARTIAL_BODY',
                spawnError: 'timed out after 10 ms',
              },
      ),
    10,
  );
  expect(result).toMatchObject({ state: 'unknown', ok: false });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_PARTIAL_BODY');
});

it('leaves login unknown if a pre-login command reports an auth diagnostic', async () => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    () => Promise.resolve({ code: 1, output: 'Invalid API key ? Please run /login', stdout: '' }),
    1000,
  );
  expect(result).toMatchObject({ state: 'auth', ok: false });
  expect(result).not.toHaveProperty('authenticated');
});

it.each([
  { code: 1, output: 'unknown option --version', stdout: '' },
  { code: 0, output: 'unparseable version', stdout: 'unparseable version' },
])('names the version probe when version syntax cannot be established: %j', async (response) => {
  const result = await preflightCli(
    { command: process.execPath, prefix: [] },
    () => Promise.resolve(response),
    1000,
  );
  expect(result.state).toBe('cli-incompatible');
  expect(result.problems).toEqual([
    `${response.code === 1 ? 'Codex CLI rejected the --version option.' : 'Codex CLI --version did not print a version number; 0.160.0 or newer is required.'} Update the Codex CLI, then retry preflight.`,
  ]);
  expect(result).not.toHaveProperty('authenticated');
});
