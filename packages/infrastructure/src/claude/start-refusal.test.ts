// Native Claude start refusals (#364) through ClaudeHarness and the real process runner. The
// executable is this Node binary running the fake CLI fixture; no provider or model is involved.
// Windows refuses a missing, non-folder or overlong working directory with the same spawn ENOENT
// as a missing executable, so these cases use real refusals of the current host.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent } from '@graphgoblin/engine';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { ClaudeHarness } from './harness.js';
import { runClaudeProcess, type ClaudeProcessRequest } from './process.js';

const fixture = fileURLToPath(new URL('./fixtures/turn-cli.mjs', import.meta.url));
const CANARY = 'PRIVATE_CANARY_364';
const windows = process.platform === 'win32';
const CHECK = 'Check that the Claude CLI starts and responds, then retry preflight.';
const MISSING_DIRECTORY =
  'Claude could not be started because the working directory does not exist; check the working directory setting';
const owned: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  const base = await realpath(tmpdir());
  for (const root of owned.splice(0)) {
    // Remove only this file's own disposable roots, after checking where they resolve.
    const resolved = await realpath(root);
    expect(resolved.startsWith(base + sep) && resolved.includes('gg-claude-start-')).toBe(true);
    await rm(resolved, { recursive: true, force: true });
  }
});
async function ownedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gg-claude-start-'));
  owned.push(root);
  return root;
}
/** An existing directory whose full path has exactly `length` characters. */
async function directoryOfLength(root: string, length: number): Promise<string> {
  let directory = join(root, CANARY);
  while (directory.length < length - 21) directory = join(directory, 'segment-abcdefghij');
  directory = join(directory, 'x'.repeat(length - directory.length - 1));
  expect(directory).toHaveLength(length);
  await mkdir(directory, { recursive: true });
  return directory;
}
function harness(binary: string = process.execPath, turns: ClaudeProcessRequest[] = []) {
  return new ClaudeHarness({
    platform: 'win32',
    binary,
    runner: (request, onStdout) => {
      if (request.stdin !== undefined) turns.push(request);
      return runClaudeProcess(
        { ...request, args: [fixture, 'success', ...request.args] },
        onStdout,
      );
    },
  });
}
async function turn(claude: ClaudeHarness, workingDirectory: string) {
  const session = claude.start(
    {
      workingDirectory,
      model: 'claude-opus-5-5',
      effort: 'high',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: `${CANARY} prompt` },
    },
    new AbortController().signal,
  );
  const events: HarnessEvent[] = [];
  for await (const event of session.events) events.push(event);
  const settled = await session.result.then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  return { events, ...settled };
}
/** Public diagnostics carry fixed text only: no path, canary, native error text or prompt. */
function expectPrivate(value: unknown, ...paths: string[]): void {
  const text = JSON.stringify(value);
  for (const fragment of [CANARY, 'spawn ', 'errno', 'syscall', ...paths])
    expect(text).not.toContain(fragment);
}
function expectRefused(events: HarnessEvent[], error: unknown, code: string, message: string) {
  const failure = { code, message, retriable: false };
  expect(events).toEqual([{ type: 'error', ...failure, submission: 'definitely-not-submitted' }]);
  expect(error).toMatchObject(failure);
}

describe('native Claude start refusals (#364)', () => {
  it('starts an ordinary turn in the requested working directory', async () => {
    const workingDirectory = join(await ownedRoot(), 'workspace');
    await mkdir(workingDirectory);
    const turns: ClaudeProcessRequest[] = [];
    const { events, result, error } = await turn(harness(undefined, turns), workingDirectory);
    expect(error).toBeUndefined();
    expect(result?.finalText).toBe(workingDirectory);
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'item',
      'submitted',
      'usage',
      'turn-complete',
    ]);
    expect(turns.map((request) => request.cwd)).toEqual([workingDirectory]);
  }, 60_000);

  it('reports a missing working directory as configuration, starting nothing', async () => {
    const root = await ownedRoot();
    const workingDirectory = join(root, `${CANARY}-missing`);
    const turns: ClaudeProcessRequest[] = [];
    const { events, error } = await turn(harness(undefined, turns), workingDirectory);
    expectRefused(events, error, 'HARNESS_INVALID_CONFIGURATION', MISSING_DIRECTORY);
    // The inherited directory is attempted as given; nothing substitutes another one.
    expect(turns.map((request) => request.cwd)).toEqual([workingDirectory]);
    expectPrivate([events, error], root, process.execPath);
  }, 60_000);

  it.skipIf(!windows)(
    'reports a working directory that is a file as configuration',
    async () => {
      const root = await ownedRoot();
      const workingDirectory = join(root, `${CANARY}-file.txt`);
      await writeFile(workingDirectory, 'not a folder');
      const { events, error } = await turn(harness(), workingDirectory);
      expectRefused(
        events,
        error,
        'HARNESS_INVALID_CONFIGURATION',
        'Claude could not be started because the working directory is not a folder; check the working directory setting',
      );
      expectPrivate([events, error], root);
    },
    60_000,
  );

  // Windows starts processes in a working directory of up to 258 characters (#102). An existing
  // longer one is refused with ENOENT, and from 260 characters its pipes also fail (ENOTCONN),
  // which this run would report as an unhandled error.
  it.skipIf(!windows).each([258, 259, 260, 300])(
    'keeps an existing %s-character working directory truthful',
    async (length) => {
      const root = await ownedRoot();
      const workingDirectory = await directoryOfLength(root, length);
      const { events, result, error } = await turn(harness(), workingDirectory);
      if (length === 258) {
        expect(error).toBeUndefined();
        expect(result?.finalText).toBe(workingDirectory);
        return;
      }
      expectRefused(
        events,
        error,
        'HARNESS_TURN_FAILED',
        'Claude could not be started (ENOENT); the working directory path is longer than the 258 characters Windows allows',
      );
      expectPrivate([events, error], root);
    },
    60_000,
  );

  it.skipIf(!windows).each([258, 259, 300])(
    'keeps preflight truthful when TEMP makes a %s-character check folder',
    async (length) => {
      const root = await ownedRoot();
      // The check folder is TEMP, a separator and `gg-claude-probe-` with 8 hexadecimal digits.
      const temp = await directoryOfLength(root, length - 25);
      for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, temp);
      const facts = await harness().preflight();
      vi.unstubAllEnvs();
      expect(facts).toMatchObject(
        length === 258
          ? { state: 'ready', ok: true, problems: [] }
          : {
              state: 'unknown',
              ok: false,
              problems: [
                `Claude CLI could not be started (ENOENT) from its temporary check folder, whose path (from TEMP or TMP) is longer than the 258 characters Windows allows for a working directory. ${CHECK}`,
              ],
            },
      );
      if (length !== 258) expect(facts).not.toHaveProperty('authenticated');
      expect(await readdir(temp)).toEqual([]);
      expectPrivate(facts, root);
    },
    60_000,
  );

  it('reports an absent executable in a valid directory as missing, before any turn', async () => {
    const root = await ownedRoot();
    const binary = join(root, `${CANARY}-claude.exe`);
    const turns: ClaudeProcessRequest[] = [];
    const claude = harness(binary, turns);
    const facts = await claude.preflight();
    expect(facts).toMatchObject({
      state: 'cli-missing',
      ok: false,
      problems: [
        'Claude CLI was not found at the configured path. Install the Claude CLI or set GG_CLAUDE_BINARY, then retry preflight.',
      ],
    });
    const workingDirectory = join(root, 'workspace');
    await mkdir(workingDirectory);
    const { events, error } = await turn(claude, workingDirectory);
    expectRefused(
      events,
      error,
      'HARNESS_NOT_INSTALLED',
      'Claude CLI was not found at the configured path.',
    );
    expect(turns).toEqual([]);
    expectPrivate([facts, events, error], root);
  }, 60_000);

  it.skipIf(!windows)(
    'reports a configured executable path that names a folder as missing',
    async () => {
      const root = await ownedRoot();
      const binary = join(root, `${CANARY}-claude.exe`);
      await mkdir(binary);
      expect(await harness(binary).preflight()).toMatchObject({ state: 'cli-missing' });
    },
    60_000,
  );

  it('does not claim that an executable named without a path is missing', async () => {
    const facts = await harness(`gg-364-${CANARY}-claude`).preflight();
    expect(facts).toMatchObject({
      state: 'unknown',
      ok: false,
      problems: [`Claude CLI could not be started (ENOENT). ${CHECK}`],
    });
    expectPrivate(facts);
  }, 60_000);
});

describe('native Claude start refusals as run failures (#364)', () => {
  async function run(claude: ClaudeHarness, workingDirectory: string) {
    const engine = await createTestEngine({
      defaults: {
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          claude: { model: 'claude-opus-5-5', effort: 'high' },
        },
      },
    });
    engine.ports.harnesses.claude = claude;
    engine.ports.modelCatalog.entries.push({
      harness: 'claude',
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Opus',
      efforts: ['high'],
      defaultEffort: 'high',
      enabled: true,
    });
    const version = engine.publish({
      ...singleNodeLoop('claude-start-refusal', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: 'claude',
          prompt: { template: 'Synthetic task' },
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
        },
      }),
      settings: { workingDirectory: { kind: 'fixed', path: workingDirectory } },
    });
    const record = await engine.runToIdle(version.loopId);
    expect(record.status).toBe('failed');
    return record.failure;
  }
  it('keeps a missing working directory a non-resumable configuration failure that was not submitted', async () => {
    const root = await ownedRoot();
    // The run's own records may keep its working directory; the failure is fixed text.
    const failure = await run(harness(), join(root, `${CANARY}-missing`));
    expect(failure).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: `harness turn failed: ${MISSING_DIRECTORY}`,
      resumable: false,
      details: { adapterCode: 'HARNESS_INVALID_CONFIGURATION' },
      inference: { submission: 'definitely-not-submitted' },
    });
    expectPrivate(failure, root);
  }, 60_000);
  it('keeps an established missing executable restorable', async () => {
    const root = await ownedRoot();
    const workingDirectory = join(root, 'workspace');
    await mkdir(workingDirectory);
    const failure = await run(harness(join(root, `${CANARY}-claude.exe`)), workingDirectory);
    expect(failure).toMatchObject({
      code: 'HARNESS_NOT_INSTALLED',
      message: 'Claude CLI was not found at the configured path.',
      resumable: true,
      inference: { submission: 'definitely-not-submitted' },
    });
    expectPrivate(failure, root);
  }, 60_000);
});

describe('native Claude help-only check refusal (#364)', () => {
  /**
   * Version and sign-in checks start natively. For the help check only, the harness's own fresh,
   * empty check folder is removed (or replaced by a file) before its real start and restored
   * afterwards, so Windows refuses that one start and the runner observes the folder.
   */
  async function helpOnlyRefusal(file: boolean, detail: string) {
    const checks: ClaudeProcessRequest[] = [];
    const turns: ClaudeProcessRequest[] = [];
    const claude = new ClaudeHarness({
      platform: 'win32',
      binary: process.execPath,
      runner: async (request, onStdout) => {
        (request.stdin === undefined ? checks : turns).push(request);
        const refused = request.args.includes('--help');
        if (refused) {
          // Only the harness's own empty check folder directly under TEMP is ever changed.
          expect(dirname(request.cwd)).toBe(tmpdir());
          expect(basename(request.cwd)).toMatch(/^gg-claude-probe-[0-9a-f]{8}$/);
          await rmdir(request.cwd);
          if (file) await writeFile(request.cwd, 'not a folder');
        }
        try {
          return await runClaudeProcess(
            { ...request, args: [fixture, 'success', ...request.args] },
            onStdout,
          );
        } finally {
          if (refused) {
            if (file) await rm(request.cwd);
            await mkdir(request.cwd);
          }
        }
      },
    });
    const facts = await claude.preflight();
    expect(facts).toMatchObject({
      state: 'unknown',
      ok: false,
      version: '2.1.287',
      authenticated: true,
      authMethod: 'claude.ai',
      problems: [`${detail} ${CHECK}`],
    });
    const root = await ownedRoot();
    const workingDirectory = join(root, 'workspace');
    await mkdir(workingDirectory);
    const { events, error } = await turn(claude, workingDirectory);
    expectRefused(events, error, 'HARNESS_TURN_FAILED', detail);
    expect(turns).toEqual([]);
    expect(checks.filter((request) => request.args.includes('auth'))).toHaveLength(2);
    const folders = checks.map((request) => basename(request.cwd));
    expectPrivate([facts, events, error], root, process.execPath, ...folders);
  }
  it('keeps a missing check folder when only the help check is refused', async () => {
    await helpOnlyRefusal(
      false,
      'Claude CLI could not be started because its temporary check folder does not exist.',
    );
  }, 60_000);
  it.skipIf(!windows)(
    'keeps a check folder that is a file when only the help check is refused',
    async () => {
      await helpOnlyRefusal(
        true,
        'Claude CLI could not be started because its temporary check folder is not a folder.',
      );
    },
    60_000,
  );
});
