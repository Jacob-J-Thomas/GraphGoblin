import { describe, expect, it, vi, type MockInstance, type TestContext } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as probeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readinessFailure } from '@graphgoblin/domain';
import { createCodexHarness } from './index.js';
import { preflightCli, runCli, type CliCommand, type CliResult, type CliRunner } from './cli.js';

// Inject filesystem boundary faults while retaining real exclusive creation and cleanup.
vi.mock('node:fs/promises', { spy: true });
// Observe each fake CLI process a case starts while retaining real spawning.
vi.mock('node:child_process', { spy: true });

const TEMP_NAMES = ['TEMP', 'TMP', 'TMPDIR'];

function useTempRoot(root: string): void {
  for (const name of TEMP_NAMES) vi.stubEnv(name, root);
}

/** The asynchronous work one probe case owns (#466). */
interface ProbeCase {
  /** Aborted by Vitest when it abandons the case: a test timeout or a cancelled run. */
  signal: AbortSignal;
  /** A disposable directory under the real temporary directory, removed after the case settles. */
  root: string;
  /** The fake CLI processes the case started; each has exited before the case finishes. */
  children: ChildProcess[];
}

/** The part of Vitest's test context a probe case uses; the lifecycle tests drive it directly. */
type CaseLifecycle = Pick<TestContext, 'signal'> & {
  onTestFinished(fn: () => Promise<void>): void;
};

const isRunning = (child: ChildProcess): boolean =>
  child.pid !== undefined && child.exitCode === null && child.signalCode === null;

/**
 * Runs a probe case as owned work. On a timeout or a cancelled run, Vitest aborts the case signal
 * and goes on to the case's finish hooks while the body may still be running. The fake CLI runner
 * starts no process after the abort, and the signal kills a running one. The finish hook waits for
 * the body, including the probe's own directory cleanup, and for every fake CLI process to exit;
 * only then does it restore the environment and remove the case root. No late call from this case
 * reaches the next one. A body failure after the abort and a failed root removal are both reported.
 * Vitest still enters a case whose run it cancelled before the body began, as during the case's
 * `beforeEach` hooks, with its signal already aborted: such a case starts nothing and throws the
 * abort reason, which Vitest reports as a cancellation, as for the cases it never started.
 */
function probeCase(prefix: string, body: (probe: ProbeCase) => Promise<void>) {
  return (context: CaseLifecycle): Promise<void> => {
    context.signal.throwIfAborted();
    const children: ChildProcess[] = [];
    let root: string | undefined;
    const work = (async () => {
      root = await probeFs.mkdtemp(join(tmpdir(), prefix));
      await body({ signal: context.signal, root, children });
    })();
    context.onTestFinished(async () => {
      const [outcome] = await Promise.allSettled([work]);
      await Promise.all(
        children
          .filter(isRunning)
          .map((child) => new Promise((resolve) => child.once('exit', resolve))),
      );
      vi.unstubAllEnvs();
      const failures: unknown[] = [];
      // A body that outlived the abort reports how it ended; otherwise the case reported it already.
      if (context.signal.aborted && outcome.status === 'rejected') failures.push(outcome.reason);
      try {
        if (root !== undefined) await probeFs.rm(root, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
      // Vitest reports each error of an AggregateError separately, so neither failure hides the other.
      if (failures.length > 1)
        throw new AggregateError(failures, 'The probe case failed after its abort and in cleanup');
      if (failures.length === 1) throw failures[0];
    });
    return work;
  };
}

/** `onStart` runs once the fake CLI for `args` has started. */
function fixture(
  probe: ProbeCase,
  scenario = 'ready',
  onStart?: (args: string[]) => void,
  preflightTimeoutMs?: number,
) {
  const commands: CliCommand[] = [];
  const runner = vi.fn<CliRunner>(async (command, args, timeout) => {
    commands.push(command);
    expect(await probeFs.readdir(command.cwd ?? '')).toEqual([]);
    // An abandoned case starts no further fake CLI, and its signal kills the running one.
    probe.signal.throwIfAborted();
    const spawned = vi.mocked(spawn).mock.results.length;
    const result = runCli(
      { ...command, prefix: [...command.prefix, scenario] },
      args,
      timeout,
      probe.signal,
    );
    for (const started of vi.mocked(spawn).mock.results.slice(spawned))
      if (started.type === 'return') probe.children.push(started.value);
    onStart?.(args);
    return result;
  });
  const harness = createCodexHarness({
    codexBinary: fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url)),
    cliRunner: runner,
    ...(preflightTimeoutMs ? { preflightTimeoutMs } : {}),
  });
  return { harness, commands, runner };
}

describe('Codex readiness probe directory', () => {
  it(
    'runs the fake CLI under a 226-character TEMP/TMP/TMPDIR root and removes its probe',
    probeCase('gg-codex-long-', async (probe) => {
      let longTemp = probe.root;
      while (longTemp.length < 226 - 21) longTemp = join(longTemp, 'segment-abcdefghij');
      longTemp = join(longTemp, 'x'.repeat(226 - longTemp.length - 1));
      expect(longTemp).toHaveLength(226);
      await probeFs.mkdir(longTemp, { recursive: true });
      useTempRoot(longTemp);
      const { harness, commands } = fixture(probe);
      expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true, problems: [] });
      expect(commands).toHaveLength(4);
      const directories = new Set(commands.map((command) => command.cwd));
      expect(directories.size).toBe(1);
      const directory = commands[0]?.cwd ?? '';
      expect(dirname(directory)).toBe(longTemp);
      expect(basename(directory)).toMatch(/^gg-codex-probe-[a-f0-9]{8}$/);
      expect(directory).toHaveLength(250);
      await expect(probeFs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await probeFs.readdir(longTemp)).toEqual([]);
    }),
  );

  it.for([1, 4])(
    'preserves %i existing collision directories and bounds retries',
    (collisions, context) =>
      probeCase('gg-codex-collision-', async (probe) => {
        const { root } = probe;
        const { mkdir } = await vi.importActual<typeof probeFs>('node:fs/promises');
        const create = vi.spyOn(probeFs, 'mkdir');
        const remove = vi.spyOn(probeFs, 'rm');
        const existing: string[] = [];
        for (let index = 0; index < collisions; index += 1) {
          create.mockImplementationOnce(async (path, options) => {
            // Another creator wins this name: the second real mkdir produces EEXIST.
            await mkdir(path, options);
            const directory = String(path);
            existing.push(directory);
            await probeFs.writeFile(join(directory, 'preserved.txt'), 'existing directory');
            return mkdir(path, options);
          });
        }
        try {
          useTempRoot(root);
          const { harness, commands, runner } = fixture(probe);
          const ready = collisions === 1;
          expect(await harness.preflight()).toMatchObject({
            state: ready ? 'ready' : 'unknown',
            ok: ready,
          });
          const attempted = create.mock.calls.map(([path]) => String(path));
          expect(attempted).toHaveLength(ready ? 2 : 4);
          expect(new Set(attempted).size).toBe(attempted.length);
          for (const [path, options] of create.mock.calls) {
            expect(dirname(String(path))).toBe(root);
            expect(options).toEqual({ mode: 0o700 });
          }
          expect(existing).toEqual(attempted.slice(0, collisions));
          for (const directory of existing)
            expect(await probeFs.readFile(join(directory, 'preserved.txt'), 'utf8')).toBe(
              'existing directory',
            );
          if (ready) {
            expect(commands).toHaveLength(4);
            expect(new Set(commands.map((command) => command.cwd))).toEqual(
              new Set([attempted[1]]),
            );
            expect(remove.mock.calls.map(([path]) => String(path))).toEqual([attempted[1]]);
            await expect(probeFs.access(attempted[1] ?? '')).rejects.toMatchObject({
              code: 'ENOENT',
            });
          } else {
            expect(runner).not.toHaveBeenCalled();
            expect(remove).not.toHaveBeenCalled();
          }
        } finally {
          create.mockRestore();
          remove.mockRestore();
        }
      })(context),
  );

  it(
    'fails a real directory creation fault before starting the fake CLI or removing anything',
    probeCase('gg-codex-fault-', async (probe) => {
      const blocked = join(probe.root, 'not-a-directory');
      await probeFs.writeFile(blocked, 'preserved file');
      const create = vi.spyOn(probeFs, 'mkdir');
      const remove = vi.spyOn(probeFs, 'rm');
      try {
        useTempRoot(blocked);
        const { harness, runner } = fixture(probe);
        expect(await harness.preflight()).toMatchObject({ state: 'unknown', ok: false });
        expect(create).toHaveBeenCalledTimes(1);
        expect(runner).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(await probeFs.readFile(blocked, 'utf8')).toBe('preserved file');
      } finally {
        create.mockRestore();
        remove.mockRestore();
      }
    }),
  );
});

describe('Codex readiness probe settlement (#506)', () => {
  it(
    'removes the probe directory only after a timed-out fake CLI has closed, keeping the typed timeout',
    probeCase('gg-codex-timeout-', async (probe) => {
      useTempRoot(probe.root);
      const close = vi.fn();
      let kill: MockInstance<ChildProcess['kill']> | undefined;
      // `login status` never answers in the hang scenario: only its deadline ends it.
      const { harness, commands, runner } = fixture(
        probe,
        'hang',
        (args) => {
          if (args.join(' ') !== 'login status') return;
          const child = probe.children.at(-1)!;
          kill = vi.spyOn(child, 'kill');
          child.once('close', close);
        },
        // Ample for the three answering checks to start under load; the hanging one times out.
        1000,
      );
      expect(await harness.preflight()).toEqual({
        ...readinessFailure('codex', 'unknown'),
        version: '0.160.0',
      });
      // Every fake CLI had closed before preflight returned.
      expect(probe.children.filter(isRunning)).toEqual([]);
      expect(commands).toHaveLength(4);
      expect(await runner.mock.results[3]?.value).toEqual({
        code: null,
        output: '',
        stdout: '',
        spawnError: 'timed out after 1000 ms',
      });
      // Termination was requested once, the child closed, and only then was its probe removed.
      expect(kill?.mock.calls).toEqual([['SIGTERM']]);
      const directory = commands[0]?.cwd ?? '';
      const removals = vi.mocked(probeFs.rm).mock;
      const removal = removals.calls.findIndex(([path]) => String(path) === directory);
      expect(removal).toBeGreaterThanOrEqual(0);
      const [requested] = kill?.mock.invocationCallOrder ?? [];
      const [closed] = close.mock.invocationCallOrder;
      expect(requested).toBeLessThan(closed ?? 0);
      expect(closed).toBeLessThan(removals.invocationCallOrder[removal] ?? 0);
      await expect(probeFs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await probeFs.readdir(probe.root)).toEqual([]);
    }),
    30_000,
  );

  it(
    'reports a missing executable without waiting and removes the probe directory',
    probeCase('gg-codex-missing-', async (probe) => {
      useTempRoot(probe.root);
      // A wait for the 15 s deadline would outlast this case's 5 s budget.
      const result = await preflightCli(
        { command: join(probe.root, 'graphgoblin-no-such-codex.exe'), prefix: [] },
        runCli,
        15_000,
      );
      expect(result).toEqual(readinessFailure('codex', 'cli-missing'));
      expect(await probeFs.readdir(probe.root)).toEqual([]);
    }),
  );

  const FLAGS = '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config';
  const UNKNOWN = readinessFailure('codex', 'unknown').problems[0];
  const ACTION = ' Check that the Codex CLI starts and responds, then retry preflight.';
  const NOT_STOPPED = `Codex CLI check process did not confirm that it stopped.${ACTION}`;
  const PROBE_LEFT = `Codex readiness check could not remove its temporary folder.${ACTION}`;
  const timedOut = (unconfirmed: boolean): CliResult => ({
    code: null,
    output: 'quota PRIVATE_PARTIAL_OUTPUT',
    stdout: '',
    spawnError: 'timed out after 10 ms',
    ...(unconfirmed ? { terminationUnconfirmed: true } : {}),
  });
  /** The version and help checks pass; `login status` returns the scenario's result. */
  const controlledRun = (login: CliResult) =>
    vi.fn<CliRunner>((_cli, args) =>
      Promise.resolve(
        args.includes('--version')
          ? { code: 0, output: 'codex-cli 0.160.0', stdout: 'codex-cli 0.160.0' }
          : args.includes('--help')
            ? { code: 0, output: FLAGS, stdout: FLAGS }
            : login,
      ),
    );

  it.for([
    {
      name: 'a timed-out check that did not confirm it stopped',
      login: timedOut(true),
      expected: { state: 'unknown', version: '0.160.0', problems: [UNKNOWN, NOT_STOPPED] },
    },
    {
      name: 'a timed-out check that closed',
      login: timedOut(false),
      expected: { state: 'unknown', version: '0.160.0', problems: [UNKNOWN] },
    },
  ])('retains its probe before confirmed close, given $name', (scenario, context) =>
    probeCase('gg-codex-retained-', async (probe) => {
      useTempRoot(probe.root);
      const run = controlledRun(scenario.login);
      const result = await preflightCli({ command: process.execPath, prefix: [] }, run, 10);
      // The typed timeout stays the result; an unconfirmed stop adds only its fixed problem.
      expect(result).toEqual({ ok: false, ...scenario.expected });
      const directory = run.mock.calls[0]?.[0].cwd ?? '';
      expect(basename(directory)).toMatch(/^gg-codex-probe-[a-f0-9]{8}$/);
      const closed = scenario.login.terminationUnconfirmed === undefined;
      // A check that may still be running in the probe keeps it: not one removal is attempted.
      // Once the check has closed, the probe is removed once.
      const removals = vi.mocked(probeFs.rm).mock.calls.map(([path]) => String(path));
      expect(removals).toEqual(closed ? [directory] : []);
      const left = await probeFs.readdir(directory).then(
        (entries) => entries,
        (error: NodeJS.ErrnoException) => error.code,
      );
      expect(left).toEqual(closed ? 'ENOENT' : []);
      const text = JSON.stringify(result);
      for (const hidden of ['PRIVATE', basename(directory)]) expect(text).not.toContain(hidden);
      // The case's own teardown removes its root, and with it a retained probe.
    })(context),
  );

  it.for([
    {
      name: 'a timeout whose probe directory stayed',
      login: timedOut(false),
      expected: { state: 'unknown', version: '0.160.0', problems: [UNKNOWN, PROBE_LEFT] },
    },
    {
      name: 'a signed-out CLI whose probe directory stayed',
      login: { code: 1, output: 'Not logged in', stdout: '' },
      expected: {
        state: 'auth',
        version: '0.160.0',
        authenticated: false,
        problems: [
          'Codex sign-in is missing or invalid. Run codex login, then retry preflight.',
          PROBE_LEFT,
        ],
      },
    },
    {
      name: 'a ready CLI whose probe directory stayed',
      login: { code: 0, output: 'Logged in using ChatGPT', stdout: 'Logged in using ChatGPT' },
      expected: { state: 'unknown', problems: [PROBE_LEFT] },
    },
  ])('keeps the check result of $name and adds a fixed cleanup problem', (scenario, context) =>
    probeCase('gg-codex-cleanup-', async (probe) => {
      useTempRoot(probe.root);
      const run = controlledRun(scenario.login);
      const remove = vi.spyOn(probeFs, 'rm');
      remove.mockRejectedValueOnce(
        Object.assign(new Error('EBUSY: resource busy PRIVATE_REMOVAL'), { code: 'EBUSY' }),
      );
      try {
        const result = await preflightCli({ command: process.execPath, prefix: [] }, run, 10);
        expect(result).toEqual({ ok: false, ...scenario.expected });
        const directory = run.mock.calls[0]?.[0].cwd ?? '';
        // One removal, never retried; the fault leaves the disposable directory to the case.
        expect(remove.mock.calls.map(([path]) => String(path))).toEqual([directory]);
        expect(await probeFs.readdir(directory)).toEqual([]);
        const text = JSON.stringify(result);
        expect(basename(directory)).toMatch(/^gg-codex-probe-[a-f0-9]{8}$/);
        for (const hidden of ['PRIVATE', basename(directory)]) expect(text).not.toContain(hidden);
      } finally {
        remove.mockRestore();
      }
    })(context),
  );
});

describe('Codex readiness probe case lifecycle (#466)', () => {
  /**
   * Vitest's abandonment of a case under test control: abort its signal, then run its hooks. The
   * enclosing Vitest case owns the controlled one: its abort abandons the controlled case too.
   * `lifecycleTest` creates one only while its enclosing case is not yet aborted, so this listener
   * sees that abort.
   */
  function controlledLifecycle(enclosing: AbortSignal) {
    const controller = new AbortController();
    enclosing.addEventListener('abort', () => controller.abort(enclosing.reason), { once: true });
    const hooks: (() => Promise<void>)[] = [];
    const context: CaseLifecycle = {
      signal: controller.signal,
      onTestFinished: (fn) => void hooks.push(fn),
    };
    let finishing: Promise<void> | undefined;
    let unseen = false;
    // Vitest runs finish hooks once, in reverse order of registration.
    const finish = () =>
      (finishing ??= (async () => {
        for (const hook of hooks.toReversed()) await hook();
      })());
    return {
      context,
      abandon: () => controller.abort(new Error('Simulated test timeout')),
      finish,
      /**
       * Abandons and finishes the controlled case if the test has not finished it. Never rejects:
       * resolves to the errors of a finish the test did not see, for the enclosing case to report.
       */
      async settle(): Promise<unknown[]> {
        if (finishing === undefined) {
          unseen = true;
          controller.abort(new Error('The lifecycle test ended before finishing its probe case'));
        }
        const [finished] = await Promise.allSettled([finish()]);
        return unseen ? reportedBy(finished) : [];
      },
    };
  }

  /**
   * Runs a lifecycle test as owned work of its Vitest case, as `probeCase` runs a probe case. On a
   * timeout or a cancelled run, Vitest aborts the case, which abandons the controlled case, and goes
   * on to the finish hook while the test body may still be running. The hook waits for the whole
   * body, including its own cleanup, then abandons and finishes the controlled case if the body
   * ended without finishing it, as after an early failure; only then may the next case start. A
   * body failure after the abort and the errors of a controlled finish the body never saw are both
   * reported, except the abort reason itself, which the case reports once. A lifecycle test entered
   * already aborted starts nothing, as a probe case does.
   */
  function lifecycleTest(
    test: (lifecycle: ReturnType<typeof controlledLifecycle>) => Promise<void>,
  ) {
    return (context: CaseLifecycle): Promise<void> => {
      context.signal.throwIfAborted();
      const lifecycle = controlledLifecycle(context.signal);
      const body = test(lifecycle);
      context.onTestFinished(async () => {
        const [outcome] = await Promise.allSettled([body]);
        const unseen = await lifecycle.settle();
        // A body that outlived the abort reports how it ended; otherwise the case reported it already.
        // The abort reason itself, which a probe case entered after the abort rejects with, is that
        // same object the case reports as its timeout or cancellation, so it is not reported again.
        const late =
          context.signal.aborted &&
          outcome.status === 'rejected' &&
          outcome.reason !== context.signal.reason
            ? [outcome.reason]
            : [];
        const failures = [...late, ...unseen];
        if (failures.length > 1)
          throw new AggregateError(failures, 'The lifecycle test and its probe case failed late');
        if (failures.length === 1) throw failures[0];
      });
      return body;
    };
  }

  /** The errors Vitest records for a finished hook: each error of an `AggregateError` separately. */
  const reportedBy = (finished: PromiseSettledResult<void>): unknown[] => {
    if (finished.status === 'fulfilled') return [];
    const { reason } = finished;
    return reason instanceof AggregateError ? reason.errors : [reason];
  };

  /** Enters a case as Vitest does, which takes an error thrown on entry as the case's rejection. */
  const enter = (start: (context: CaseLifecycle) => Promise<void>, context: CaseLifecycle) =>
    new Promise<void>((resolve, reject) => void start(context).then(resolve, reject));

  interface Seen {
    root: string;
    commands: CliCommand[];
    children: ChildProcess[];
  }

  /** What a case left behind when it finished; the in-process facts are read first. */
  async function leftAtFinish(seen: Seen, bodySettled: boolean) {
    const left = {
      bodySettled,
      runningFakeClis: seen.children.filter(isRunning).length,
      removed: vi.mocked(probeFs.rm).mock.calls.map(([path]) => String(path)),
      stubbedTemp: TEMP_NAMES.filter((name) => process.env[name] === seen.root),
    };
    const root = await probeFs.access(seen.root).then(
      () => 'present',
      (error: NodeJS.ErrnoException) => error.code,
    );
    return { ...left, root };
  }

  // The probe's own directory removal came before the case root's, and both before it finished.
  const settledCase = (seen: Seen) => ({
    bodySettled: true,
    runningFakeClis: 0,
    removed: [seen.commands[0]?.cwd, seen.root],
    stubbedTemp: [],
    root: 'ENOENT',
  });

  it.for(['before its first fake CLI starts', 'while a fake CLI runs'] as const)(
    'settles a case abandoned %s before the case finishes',
    (moment, context) =>
      lifecycleTest(async (lifecycle) => {
        const seen: Seen = { root: '', commands: [], children: [] };
        let runningAtAbort: boolean[] = [];
        let bodySettled = false;
        const run = probeCase('gg-codex-abandoned-', async (probe) => {
          // `login status` never answers in the hang scenario: only the abort ends it.
          const { harness, commands } = fixture(probe, 'hang', (args) => {
            if (moment !== 'while a fake CLI runs' || args.join(' ') !== 'login status') return;
            runningAtAbort = probe.children.map(isRunning);
            lifecycle.abandon();
          });
          Object.assign(seen, { root: probe.root, commands, children: probe.children });
          useTempRoot(probe.root);
          expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true });
        })(lifecycle.context).finally(() => {
          bodySettled = true;
        });
        const { signal } = lifecycle.context;
        if (moment === 'before its first fake CLI starts') lifecycle.abandon();
        // As Vitest does, run the finish hooks as soon as the case is abandoned, its body unsettled.
        await Promise.race([
          signal.aborted || new Promise((resolve) => signal.addEventListener('abort', resolve)),
          Promise.allSettled([run]),
        ]);
        expect(signal.aborted).toBe(true);
        const [finished] = await Promise.allSettled([lifecycle.finish()]);

        expect(await leftAtFinish(seen, bodySettled)).toEqual(settledCase(seen));
        expect(seen.commands).toHaveLength(moment === 'while a fake CLI runs' ? 4 : 1);
        expect(runningAtAbort).toEqual(
          moment === 'while a fake CLI runs' ? [false, false, false, true] : [],
        );
        // Every process started is one the case owned; none started after the abort.
        expect(vi.mocked(spawn)).toHaveBeenCalledTimes(seen.children.length);
        // The abort made the probe fail closed, and the hook reports that late failure, never drops it.
        const [outcome] = await Promise.allSettled([run]);
        expect(outcome).toMatchObject({ status: 'rejected', reason: { name: 'AssertionError' } });
        expect(finished).toEqual(outcome);
      })(context),
  );

  it(
    'reports an ordinary case failure once, after the same settlement',
    lifecycleTest(async (lifecycle) => {
      const failure = new Error('Ordinary case failure');
      const seen: Seen = { root: '', commands: [], children: [] };
      let bodySettled = false;
      const run = probeCase('gg-codex-failing-', async (probe) => {
        const { harness, commands } = fixture(probe);
        Object.assign(seen, { root: probe.root, commands, children: probe.children });
        useTempRoot(probe.root);
        expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true });
        throw failure;
      })(lifecycle.context).finally(() => {
        bodySettled = true;
      });
      const [outcome] = await Promise.allSettled([run]);
      const [finished] = await Promise.allSettled([lifecycle.finish()]);

      expect(await leftAtFinish(seen, bodySettled)).toEqual(settledCase(seen));
      expect(seen.children).toHaveLength(4);
      expect(outcome).toEqual({ status: 'rejected', reason: failure });
      expect(finished).toEqual({ status: 'fulfilled', value: undefined });
    }),
  );

  it.for(['after its abort', 'without an abort'] as const)(
    'reports a body failure %s once, and a failed case-root removal, after the same settlement',
    (when, context) =>
      lifecycleTest(async (lifecycle) => {
        const abandoned = when === 'after its abort';
        const failure = new Error(`Body failure ${when}`);
        const removalFailure = Object.assign(new Error('Case root removal failure'), {
          code: 'EBUSY',
        });
        const seen: Seen = { root: '', commands: [], children: [] };
        let bodySettled = false;
        const { rm } = await vi.importActual<typeof probeFs>('node:fs/promises');
        const remove = vi.spyOn(probeFs, 'rm');
        // The probe still removes its own directory; only the removal of the case root fails.
        remove.mockImplementation(async (path, options) => {
          if (String(path) === seen.root) throw removalFailure;
          return rm(path, options);
        });
        try {
          const run = probeCase('gg-codex-double-fault-', async (probe) => {
            // `login status` never answers in the hang scenario: only the abort ends it.
            const { harness, commands } = fixture(probe, abandoned ? 'hang' : 'ready', (args) => {
              if (abandoned && args.join(' ') === 'login status') lifecycle.abandon();
            });
            Object.assign(seen, { root: probe.root, commands, children: probe.children });
            useTempRoot(probe.root);
            await harness.preflight();
            throw failure;
          })(lifecycle.context).finally(() => {
            bodySettled = true;
          });
          const { signal } = lifecycle.context;
          // As Vitest does, run the finish hooks once the case is abandoned or its body has failed.
          await Promise.race([
            new Promise((resolve) => signal.addEventListener('abort', resolve)),
            Promise.allSettled([run]),
          ]);
          expect(signal.aborted).toBe(abandoned);
          const [finished] = await Promise.allSettled([lifecycle.finish()]);

          // Only the injected fault left the case root behind.
          expect(await leftAtFinish(seen, bodySettled)).toEqual({
            ...settledCase(seen),
            root: 'present',
          });
          expect(seen.children).toHaveLength(4);
          const [outcome] = await Promise.allSettled([run]);
          expect(outcome).toEqual({ status: 'rejected', reason: failure });
          // The case itself reports its timeout after an abort, otherwise its body failure; the hook
          // adds a body failure only if it came after the abort, then the failed removal.
          expect(reportedBy(finished)).toEqual(
            abandoned ? [failure, removalFailure] : [removalFailure],
          );
        } finally {
          // Settle the controlled case before restoring its fault, even after an early failure.
          await lifecycle.settle();
          remove.mockRestore();
          // The case's processes have exited; remove the root its failed removal preserved.
          if (seen.root !== '') await rm(seen.root, { recursive: true, force: true });
        }
      })(context),
  );

  // Vitest still enters a case whose run it cancelled during the case's `beforeEach` hooks, its
  // signal already aborted. `vitestCase` stands in for that Vitest case, entering a probe case or a
  // lifecycle test.
  it.for(['a probe case', 'a lifecycle test'] as const)(
    'starts nothing in %s entered after its Vitest case was aborted, and rejects with that reason',
    (entry, context) =>
      lifecycleTest(async (vitestCase) => {
        // Unaborted, this ordinary probe case starts four fake CLIs.
        const ordinary = probeCase('gg-codex-cancelled-', async (probe) => {
          const { harness } = fixture(probe);
          useTempRoot(probe.root);
          expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true });
        });
        const start =
          entry === 'a probe case'
            ? ordinary
            : lifecycleTest(async (lifecycle) => {
                await ordinary(lifecycle.context);
                await lifecycle.finish();
              });
        vitestCase.abandon();
        const reason: unknown = vitestCase.context.signal.reason;
        const entered = enter(start, vitestCase.context);
        await Promise.allSettled([entered]);
        // As Vitest does, run the case's finish hooks after it.
        const [finished] = await Promise.allSettled([vitestCase.finish()]);

        // No fake CLI or case directory was started, so no hook has anything to settle or report.
        expect(vi.mocked(spawn), 'fake CLI processes started').not.toHaveBeenCalled();
        expect(vi.mocked(probeFs.mkdtemp), 'case directories created').not.toHaveBeenCalled();
        expect(finished).toEqual({ status: 'fulfilled', value: undefined });
        // Vitest receives the original reason, by which it reports a cancelled run's case as skipped.
        await expect(entered).rejects.toBe(reason);
      })(context),
  );

  // Vitest can abort a lifecycle test's case while its body still awaits, before it enters its
  // probe case, which then rejects on entry with the abort reason that the case reports as its
  // timeout or cancellation. `vitestCase` stands in for that Vitest case. A copy of the reason has
  // its name, message and stack but is a different error, which the hook still reports.
  it.for(['the abort reason', 'a copy of the abort reason'] as const)(
    'reports only an error other than the abort reason when a lifecycle test aborted mid-body ends with %s',
    (ending, context) =>
      lifecycleTest(async (vitestCase) => {
        const entered = enter(
          lifecycleTest(async (lifecycle) => {
            const { signal } = lifecycle.context;
            // The body still awaits when its case is aborted, and goes on after the abort.
            await new Promise((resolve) => signal.addEventListener('abort', resolve));
            if (ending === 'a copy of the abort reason') throw structuredClone(signal.reason);
            // Unaborted, this ordinary probe case starts four fake CLIs.
            await probeCase('gg-codex-resumed-', async (probe) => {
              const { harness } = fixture(probe);
              useTempRoot(probe.root);
              expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true });
            })(lifecycle.context);
            await lifecycle.finish();
          }),
          vitestCase.context,
        );
        vitestCase.abandon();
        const reason: unknown = vitestCase.context.signal.reason;
        // As Vitest does, run the finish hooks once the case is abandoned, its body unsettled.
        const [finished] = await Promise.allSettled([vitestCase.finish()]);
        const [outcome] = await Promise.allSettled([entered]);

        expect(vi.mocked(spawn), 'fake CLI processes started').not.toHaveBeenCalled();
        expect(vi.mocked(probeFs.mkdtemp), 'case directories created').not.toHaveBeenCalled();
        // The body ended with the abort reason itself, or with a copy of it alike in every word.
        expect(outcome).toEqual({ status: 'rejected', reason });
        const ended: unknown = outcome.status === 'rejected' ? outcome.reason : undefined;
        expect(ended === reason).toBe(ending === 'the abort reason');
        // The case reports the abort reason once; its hook adds only another error, however alike.
        const [reported, ...more] = reportedBy(finished);
        expect(more).toEqual([]);
        expect(reported).toBe(ending === 'the abort reason' ? undefined : ended);
      })(context),
  );

  it(
    'abandons the probe case of a lifecycle test whose Vitest case is aborted while a fake CLI runs',
    lifecycleTest(async (vitestCase) => {
      const seen: Seen = { root: '', commands: [], children: [] };
      let runningAtAbort: boolean[] = [];
      let bodySettled = false;
      let probeSignal: AbortSignal | undefined;
      let run: Promise<void> | undefined;
      // `vitestCase` stands in for the Vitest case of a lifecycle test that runs a probe case.
      const entered = enter(
        lifecycleTest(async (lifecycle) => {
          run = probeCase('gg-codex-enclosed-', async (probe) => {
            // `login status` never answers in the hang scenario: only the abort ends it.
            const { harness, commands } = fixture(probe, 'hang', (args) => {
              if (args.join(' ') !== 'login status') return;
              runningAtAbort = probe.children.map(isRunning);
              vitestCase.abandon();
            });
            probeSignal = probe.signal;
            Object.assign(seen, { root: probe.root, commands, children: probe.children });
            useTempRoot(probe.root);
            expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true });
          })(lifecycle.context).finally(() => {
            bodySettled = true;
          });
          await Promise.allSettled([run]);
          await lifecycle.finish();
        }),
        vitestCase.context,
      );
      const { signal } = vitestCase.context;
      // As Vitest does, run the finish hooks as soon as the case is abandoned, its body unsettled.
      await Promise.race([
        signal.aborted || new Promise((resolve) => signal.addEventListener('abort', resolve)),
        Promise.allSettled([entered]),
      ]);
      expect(signal.aborted).toBe(true);
      const [finished] = await Promise.allSettled([vitestCase.finish()]);

      expect(await leftAtFinish(seen, bodySettled)).toEqual(settledCase(seen));
      expect(runningAtAbort).toEqual([false, false, false, true]);
      // Every process started is one the case owned; none started after the abort.
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(4);
      expect(seen.children).toHaveLength(4);
      // The abort reached the probe case with its original reason; the probe failed closed, and
      // the hook reports that late failure once, never drops it.
      expect(probeSignal?.reason).toBe(signal.reason);
      const [outcome] = await Promise.allSettled([run]);
      expect(outcome).toMatchObject({ status: 'rejected', reason: { name: 'AssertionError' } });
      expect(finished).toEqual(outcome);
    }),
  );
});
