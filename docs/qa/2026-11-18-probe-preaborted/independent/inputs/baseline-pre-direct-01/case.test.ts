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
import { beforeEach, afterAll } from 'vitest';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as qaSleep } from 'node:timers/promises';
const qaMode = "pre-direct";
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

describe('exact maintained entry under independent cancellation control', () => {

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
});
