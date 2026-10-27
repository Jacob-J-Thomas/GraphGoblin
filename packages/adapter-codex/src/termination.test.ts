import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { HarnessEvent, HarnessSession } from '@graphgoblin/engine';
import type { TurnOptions } from '@openai/codex-sdk';
import { CodexHarness, type CodexClientFactory } from './harness.js';

const treeCli = fileURLToPath(new URL('./fixtures/tree-cli.mjs', import.meta.url));
const request = {
  workingDirectory: tmpdir(),
  options: { sandbox: 'read-only' as const, approval: 'never' as const },
  turn: { prompt: 'Controlled fixture; no provider call' },
};

/**
 * The SDK's `CodexExec.run` contract over a real process: the turn's `signal` kills the CLI, the
 * event stream ends only at the CLI's stdout EOF, and a nonzero exit is thrown after it.
 */
function cliFactory(pidFile: string): CodexClientFactory {
  const thread = {
    runStreamed: (input: string, options?: TurnOptions) =>
      Promise.resolve({
        events: (async function* () {
          const child = spawn(process.execPath, [treeCli, pidFile], {
            ...(options?.signal ? { signal: options.signal } : {}),
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
          let spawnError: Error | undefined;
          child.once('error', (error) => {
            spawnError = error;
          });
          const exit = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
            child.once('exit', (code, signal) => resolve([code, signal])),
          );
          child.stdin.end(input);
          try {
            for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity }))
              yield JSON.parse(line) as { type: string };
            if (spawnError) throw spawnError;
            const [code, signal] = await exit;
            if (code !== 0 || signal)
              throw new Error(`Codex Exec exited with ${signal ?? `code ${code ?? 1}`}`);
          } finally {
            if (!child.killed) child.kill();
          }
        })(),
      }),
  };
  return () => ({ startThread: () => thread, resumeThread: () => thread });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const started: number[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const pid of started.splice(0)) if (alive(pid)) process.kill(pid);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
});

async function untilSubmitted(session: HarnessSession, seen: HarnessEvent[]) {
  const events = session.events[Symbol.asyncIterator]();
  for (;;) {
    const step = await events.next();
    if (step.done) throw new Error('The turn ended before it was accepted');
    seen.push(step.value);
    if (step.value.type === 'submitted') return events;
  }
}

it('reports unconfirmed termination within the acknowledgement when a CLI descendant keeps its output open after abort', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-tree-'));
  directories.push(directory);
  const pidFile = join(directory, 'pids.json');
  const controller = new AbortController();
  const session = new CodexHarness({
    clientFactory: cliFactory(pidFile),
    cancelGraceMs: 500,
  }).start(request, controller.signal);
  const seen: HarnessEvent[] = [];
  const events = await untilSubmitted(session, seen);
  const { cli, tool } = JSON.parse(await readFile(pidFile, 'utf8')) as {
    cli: number;
    tool: number;
  };
  started.push(tool, cli);

  controller.abort();
  const outcome = await Promise.race([
    session.result.then(
      () => 'the aborted turn completed',
      (error: unknown) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve('still waiting for the CLI output'), 10_000)),
  ]);

  expect(outcome).toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED', retriable: false });
  for (let step = await events.next(); !step.done; step = await events.next())
    seen.push(step.value);
  expect(seen.at(-1)).toMatchObject({
    type: 'error',
    code: 'HARNESS_TERMINATION_UNCONFIRMED',
    retriable: false,
    submission: 'delivery-uncertain',
  });
  // The abort killed the CLI itself; its descendant is what kept the stream open.
  await vi.waitFor(() => expect(alive(cli)).toBe(false));
  expect(alive(tool)).toBe(true);
  await expect(session.cancel()).rejects.toMatchObject({
    code: 'HARNESS_TERMINATION_UNCONFIRMED',
  });
}, 60_000);

it('confirms cancellation when the killed CLI was the only holder of its output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-tree-'));
  directories.push(directory);
  const pidFile = join(directory, 'pids.json');
  const session = new CodexHarness({
    clientFactory: cliFactory(pidFile),
    cancelGraceMs: 10_000,
  }).start(request, new AbortController().signal);
  await untilSubmitted(session, []);
  const { cli, tool } = JSON.parse(await readFile(pidFile, 'utf8')) as {
    cli: number;
    tool: number;
  };
  started.push(tool, cli);
  // Without the descendant, the CLI's output ends when the abort kills it.
  process.kill(tool);
  await vi.waitFor(() => expect(alive(tool)).toBe(false));

  await session.cancel();
  await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
}, 60_000);
