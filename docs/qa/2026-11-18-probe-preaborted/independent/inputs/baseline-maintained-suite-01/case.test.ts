import { describe, expect, it, vi, type TestContext } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as probeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexHarness } from 'D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-codex/src/index.ts';
import { runCli, type CliCommand, type CliRunner } from 'D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-codex/src/cli.ts';

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
 */
function probeCase(prefix: string, body: (probe: ProbeCase) => Promise<void>) {
  return (context: CaseLifecycle): Promise<void> => {
    const children: ChildProcess[] = [];
    let root: string | undefined;
    const work = (async () => {
      root = await probeFs.mkdtemp(join(tmpdir(), prefix)); qaRoots.push(root); qaRecord('case-root-created', { root, signalAborted: context.signal.aborted });
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
function fixture(probe: ProbeCase, scenario = 'ready', onStart?: (args: string[]) => void) {
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
      if (started.type === 'return') { probe.children.push(started.value); qaObserveChild(started.value, args); }
    onStart?.(args);
    return result;
  });
  const harness = createCodexHarness({
    codexBinary: fileURLToPath(new URL('file:///D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-codex/src/fixtures/readiness-cli.mjs')),
    cliRunner: runner,
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

describe('Codex readiness probe case lifecycle (#466)', () => {
  /**
   * Vitest's abandonment of a case under test control: abort its signal, then run its hooks. The
   * enclosing Vitest case owns the controlled one: its abort abandons the controlled case too.
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
   * reported.
   */
  function lifecycleTest(
    test: (lifecycle: ReturnType<typeof controlledLifecycle>) => Promise<void>,
  ) {
    return (context: CaseLifecycle): Promise<void> => {
      const lifecycle = controlledLifecycle(context.signal);
      const body = test(lifecycle);
      context.onTestFinished(async () => {
        const [outcome] = await Promise.allSettled([body]);
        const unseen = await lifecycle.settle();
        // A body that outlived the abort reports how it ended; otherwise the case reported it already.
        const late =
          context.signal.aborted && outcome.status === 'rejected' ? [outcome.reason] : [];
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
});

import { beforeEach, afterAll } from 'vitest';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as qaSleep } from 'node:timers/promises';
const qaMode = "maintained-suite";
const qaStart = performance.now();
const qaEvents = process.env.GG505_OUTPUT + '/events.jsonl';
const qaOriginalTemp = Object.fromEntries(TEMP_NAMES.map((name) => [name, process.env[name]]));
const qaRoots: string[] = [];
const qaChildren: ChildProcess[] = [];
let qaRunnerEntries: string[] = [];
let qaRequested = false;
function qaRecord(event: string, more = {}) { appendFileSync(qaEvents, JSON.stringify({ event, elapsedMs: Math.round(performance.now() - qaStart), ...more }) + '\n'); }
function qaNativePresent(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
function qaObserveChild(child: ChildProcess, args: string[]) {
  qaChildren.push(child);
  qaRecord('owned-child-created', { pid: child.pid, args });
  child.once('spawn', () => {
    qaRecord('owned-child-native-spawn', { pid: child.pid, args, nativePresent: qaNativePresent(child.pid) });
    if (qaMode.startsWith('flight-') && args.join(' ') === 'login status' && !qaRequested) {
      qaRequested = true; qaRecord('cancel-request-marker', { pid: child.pid, nativePresent: qaNativePresent(child.pid) });
      console.log('GG505_CANCEL_REQUEST owned-child-already-running');
    }
  });
  child.once('exit', (code, signal) => qaRecord('owned-child-native-exit', { pid: child.pid, code, signal, nativePresent: qaNativePresent(child.pid) }));
}
beforeEach(async (context) => {
  qaRunnerEntries = readdirSync(process.env.TEMP!);
  qaRecord('beforeEach-enter', { task: context.task.name, signalAborted: context.signal.aborted, runnerEntries: qaRunnerEntries, runnerTemp: process.env.TEMP });
  const aborted = Promise.withResolvers<void>();
  if (context.signal.aborted) aborted.resolve();
  context.signal.addEventListener('abort', () => { qaRecord('actual-enclosing-signal-abort', { reason: String(context.signal.reason) }); aborted.resolve(); }, { once: true });
  if (qaMode.startsWith('pre-')) {
    qaRecord('cancel-request-marker', { phase: 'beforeEach', signalAbortedBeforeRequest: context.signal.aborted });
    console.log('GG505_CANCEL_REQUEST beforeEach');
    const fallback = new AbortController();
    try { await Promise.race([aborted.promise, qaSleep(3000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Genuine cancellation did not reach beforeEach'); })]); }
    finally { fallback.abort(); }
    qaRecord('beforeEach-leave-with-past-abort', { task: context.task.name, signalAborted: context.signal.aborted, reason: String(context.signal.reason) });
  }
  if (qaMode.startsWith('timeout-')) {
    const realFs = await vi.importActual<typeof probeFs>('node:fs/promises');
    vi.mocked(probeFs.readdir).mockImplementationOnce(async (path) => {
      qaRecord('held-real-readdir', { path: String(path) });
      const fallback = new AbortController();
      try { await Promise.race([aborted.promise.then(() => qaSleep(650)), qaSleep(9000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Real default Vitest timeout not seen'); })]); }
      finally { fallback.abort(); }
      qaRecord('released-real-readdir');
      return realFs.readdir(path);
    });
  }
});
afterAll(() => {
  qaRecord('final-worker-observation', {
    rootsCreated: qaRoots, rootsStillPresent: qaRoots.filter((root) => existsSync(root)),
    envRestored: TEMP_NAMES.every((name) => process.env[name] === qaOriginalTemp[name]),
    runnerTemp: qaOriginalTemp.TEMP, runnerTempExists: existsSync(qaOriginalTemp.TEMP!),
    runnerEntriesAtHook: readdirSync(qaOriginalTemp.TEMP!), runnerEntriesAtBeforeEach: qaRunnerEntries,
    childrenCreated: qaChildren.length, livingOwnedChildren: qaChildren.filter(isRunning).map((child) => child.pid), nativeOwnedChildren: qaChildren.map((child) => child.pid).filter(qaNativePresent),
  });
});
