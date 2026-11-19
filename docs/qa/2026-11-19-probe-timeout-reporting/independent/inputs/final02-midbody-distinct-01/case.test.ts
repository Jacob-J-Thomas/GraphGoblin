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
      if (started.type === 'return') { probe.children.push(started.value); qaChildren.push(started.value); qaRecord('owned-child-created', { pid: started.value.pid }); }
    onStart?.(args);
    return result;
  });
  const harness = createCodexHarness({
    codexBinary: fileURLToPath(new URL('file:///D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa/source-baseline/packages/adapter-codex/src/fixtures/readiness-cli.mjs')),
    cliRunner: runner,
  });
  return { harness, commands, runner };
}
import { beforeEach } from 'vitest';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as qaSleep } from 'node:timers/promises';
const qaVariant = "distinct-error";
const qaStart = performance.now();
const qaEvents = process.env.GG505_OUTPUT + '/events.jsonl';
const qaRoots: string[] = [];
const qaChildren: ChildProcess[] = [];
const qaOriginalTemp = Object.fromEntries(TEMP_NAMES.map((name) => [name, process.env[name]]));
const qaAborted = Promise.withResolvers<void>();
let qaOuterSignal: AbortSignal;
let qaOuterFinished = false;
let qaLocalMockRestored = false;
let qaFaultMockInstalled = false;
let qaInitialRmImplementation: unknown;
let qaRunnerEntries: string[] = [];
function qaRecord(event: string, more = {}) { appendFileSync(qaEvents, JSON.stringify({ event, elapsedMs: Math.round(performance.now() - qaStart), ...more }) + '\n'); }
beforeEach((context) => {
  if (!context.task.name.startsWith('reports a body failure')) return;
  qaOuterSignal = context.signal;
  qaInitialRmImplementation = vi.mocked(probeFs.rm).getMockImplementation();
  qaRunnerEntries = readdirSync(process.env.TEMP!);
  context.signal.addEventListener('abort', () => {
    const reason = context.signal.reason;
    qaRecord('actual-outer-abort', { name: reason.name, message: reason.message, stack: reason.stack });
    qaAborted.resolve();
  }, { once: true });
});
async function qaHoldActual<T>(operation: Promise<T>, inner: AbortSignal): Promise<T> {
  const began = performance.now();
  const value = await operation;
  qaRecord('real-importActual-resolved', { actualImportDurationMs: performance.now() - began, outerAborted: qaOuterSignal.aborted });
  const fallback = new AbortController();
  try { await Promise.race([qaAborted.promise.then(() => qaSleep(650)), qaSleep(9000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Expected real default timeout was not observed'); })]); }
  finally { fallback.abort(); }
  qaRecord('released-import-result', { outerAborted: qaOuterSignal.aborted, innerAborted: inner.aborted, sameReasonObject: inner.reason === qaOuterSignal.reason });
  if (qaVariant === 'distinct-error') {
    const original = qaOuterSignal.reason;
    const distinct = new Error(original.message);
    distinct.name = original.name;
    distinct.stack = original.stack;
    qaRecord('distinct-error-created', { sameObject: distinct === original, sameMessage: distinct.message === original.message, sameStack: distinct.stack === original.stack });
    throw distinct;
  }
  return value;
}

describe('one maintained combined-fault row at its first real import wait', () => {

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

  it.for(['without an abort'] as const)(
    'reports a body failure %s once, and a failed case-root removal, after the same settlement',
    (when, context) =>
      lifecycleTest(async (lifecycle) => {
        try {
        const abandoned = when === 'after its abort';
        const failure = new Error(`Body failure ${when}`);
        const removalFailure = Object.assign(new Error('Case root removal failure'), {
          code: 'EBUSY',
        });
        const seen: Seen = { root: '', commands: [], children: [] };
        let bodySettled = false;
        const { rm } = await qaHoldActual(vi.importActual<typeof probeFs>('node:fs/promises'), lifecycle.context.signal);
        const remove = vi.spyOn(probeFs, 'rm'); qaFaultMockInstalled = true; qaRecord('local-rm-fault-installed');
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
          remove.mockRestore(); qaLocalMockRestored = true; qaRecord('local-rm-mock-restored');
          // The case's processes have exited; remove the root its failed removal preserved.
          if (seen.root !== '') await rm(seen.root, { recursive: true, force: true });
        }
        } finally { qaOuterFinished = true; qaRecord('outer-owned-body-finished'); }
      })(context),
  );

it('successor observes settled state without repairing it', () => {
  const snapshot = {
    outerFinished: qaOuterFinished, localMockRestored: qaLocalMockRestored, faultMockInstalled: qaFaultMockInstalled, localMockRestoredOrNotInstalled: !qaFaultMockInstalled || qaLocalMockRestored,
    rootsCreated: qaRoots.length, rootsStillPresent: qaRoots.filter((root) => existsSync(root)),
    childrenCreated: qaChildren.length, livingOwnedChildren: qaChildren.filter(isRunning).length,
    envRestored: TEMP_NAMES.every((name) => process.env[name] === qaOriginalTemp[name]),
    rmImplementationRestored: vi.mocked(probeFs.rm).getMockImplementation() === qaInitialRmImplementation,
    runnerEntriesUnchanged: JSON.stringify(readdirSync(qaOriginalTemp.TEMP!)) === JSON.stringify(qaRunnerEntries),
  };
  qaRecord('successor-first-observation', snapshot);
  expect(snapshot).toMatchObject({ outerFinished: true, localMockRestoredOrNotInstalled: true, rootsStillPresent: [], childrenCreated: 0, livingOwnedChildren: 0, envRestored: true, rmImplementationRestored: true, runnerEntriesUnchanged: true });
});

});
