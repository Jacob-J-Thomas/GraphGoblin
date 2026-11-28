import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readinessFailure } from '@graphgoblin/domain';
import { describe, expect, it, type TestContext } from 'vitest';
import { createCodexAdapters } from './adapters.js';
import { CodexHarness } from './harness.js';
import { controlLiveAdapters, LIVE_FIXTURE_PREFIX } from './fixtures/live-collection-setup.js';

/**
 * The live smoke suite allocates its working directory only while it runs enabled (#511). These
 * cases run Vitest itself on `src/live.test.ts` in a child process, as an ordinary run collects
 * it, with the child's TEMP/TMP/TMPDIR in a directory the case owns. Every child installs
 * `fixtures/live-collection-setup.ts`, which makes its Codex adapters test-controlled: no Codex
 * CLI, owner configuration or model request is reached, even by a live case selected by mistake.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const setupFile = fileURLToPath(new URL('./fixtures/live-collection-setup.ts', import.meta.url));
const vitestNode = pathToFileURL(createRequire(import.meta.url).resolve('vitest/node')).href;

/** The child: Vitest on the live suite with the package's own configuration and a JSON report. */
const RUNNER = [
  'const [vitest, root, setup, report, pattern] = process.argv.slice(1);',
  'const { startVitest } = await import(vitest);',
  "await startVitest(['src/live.test.ts'], { root, setupFiles: [setup], reporters: ['json'], outputFile: report, run: true, watch: false, cache: false, coverage: { enabled: false }, ...(pattern ? { testNamePattern: pattern } : {}) });",
  'process.exit();',
].join('\n');

const LIVE_CASES = [
  'passes preflight',
  'starts a session and resumes it',
  'cancel ends the CLI and the command it was running',
  'makes a canonical structured Choice with stable ids',
];

/** The parent's environment without its Vitest, coverage, live, temporary or Codex settings. */
function childEnvironment(settings: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !/^(?:VITEST\w*|TEST|NODE_ENV|NODE_OPTIONS|NODE_V8_COVERAGE|LIVE\w*|GG_LIVE_\w+|TEMP|TMP|TMPDIR|CODEX_HOME)$/i.test(
        entry[0],
      ),
  );
  return { ...Object.fromEntries(inherited), ...settings };
}

interface Collected {
  code: number | null;
  /** Each live case's status in the child's JSON report, by title. */
  statuses: Record<string, string>;
  /** The live fixtures the controlled preflight saw while the suite ran; absent if it never ran. */
  seen?: string[];
  /** The live fixtures left in the child's temporary directory after it exited. */
  left: string[];
  /** The end of the child's own output, for failure messages. */
  log: string;
}

interface JsonReport {
  testResults: { assertionResults: { title: string; status: string }[] }[];
}

/**
 * Runs the child Vitest as owned work of the case: Vitest abandoning the case ends the child, and
 * the case's directory goes only after the child has closed.
 */
async function collectLive(
  context: TestContext,
  live: '0' | '1',
  control: { pattern?: string; preflight?: 'ready' | 'unready' } = {},
): Promise<Collected> {
  context.signal.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), 'gg-live-collection-'));
  // Set once the child has started; until then there is nothing to wait for.
  const owned: { closed?: Promise<number | null> } = {};
  context.onTestFinished(async () => {
    await owned.closed;
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  });
  const temporary = join(root, 'temp');
  const record = join(root, 'record.json');
  const report = join(root, 'report.json');
  await mkdir(temporary);
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      RUNNER,
      vitestNode,
      packageRoot,
      setupFile,
      report,
      control.pattern ?? '',
    ],
    {
      cwd: packageRoot,
      env: childEnvironment({
        LIVE: live,
        TEMP: temporary,
        TMP: temporary,
        TMPDIR: temporary,
        // Never the owner's Codex configuration, even if a CLI were started by mistake.
        CODEX_HOME: join(root, 'unused-codex-home'),
        GG_LIVE_COLLECTION_RECORD: record,
        GG_LIVE_COLLECTION_PREFLIGHT: control.preflight ?? 'ready',
      }),
      signal: context.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    },
  );
  let log = '';
  const keep = (chunk: Buffer): void => {
    log = (log + chunk.toString('utf8')).slice(-8_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  // An abandoned case's abort reaches the child as an error; its close still follows.
  child.on('error', (error) => keep(Buffer.from(`\n${error.message}\n`)));
  owned.closed = new Promise((resolve) => child.once('close', resolve));
  const code = await owned.closed;
  const parsed = JSON.parse(
    await readFile(report, 'utf8').catch(() => {
      throw new Error(`The child Vitest wrote no report (exit ${code}):\n${log}`);
    }),
  ) as JsonReport;
  const statuses = Object.fromEntries(
    parsed.testResults
      .flatMap((file) => file.assertionResults)
      .map((result) => [result.title, result.status]),
  );
  const seen = await readFile(record, 'utf8').then(
    (text) => (JSON.parse(text) as { fixtures: string[] }).fixtures,
    () => undefined,
  );
  const left = (await readdir(temporary)).filter((name) => name.startsWith(LIVE_FIXTURE_PREFIX));
  return { code, statuses, ...(seen ? { seen } : {}), left, log };
}

describe('Codex live suite fixture lifecycle (#511)', () => {
  it('collects the disabled suite with every case skipped and allocates no fixture', async (context) => {
    const run = await collectLive(context, '0');
    expect(run.code, run.log).toBe(0);
    expect(run.statuses).toEqual(Object.fromEntries(LIVE_CASES.map((title) => [title, 'skipped'])));
    expect(run.seen).toBeUndefined();
    expect(run.left).toEqual([]);
  }, 120_000);

  it.for(['ready', 'unready'] as const)(
    'allocates the enabled suite fixture while a no-turn case runs and removes it after a %s preflight',
    { timeout: 120_000 },
    async (preflight, context) => {
      const run = await collectLive(context, '1', {
        // Vitest 5 joins a case's full name with " > ".
        pattern: '^Codex live smoke > passes preflight$',
        preflight,
      });
      const passed = preflight === 'ready';
      expect(run.code, run.log).toBe(passed ? 0 : 1);
      expect(run.statuses).toEqual({
        ...Object.fromEntries(LIVE_CASES.map((title) => [title, 'skipped'])),
        'passes preflight': passed ? 'passed' : 'failed',
      });
      // Exactly one fixture existed while the case ran, and none once the suite had ended.
      expect(run.seen).toEqual([expect.stringMatching(/^graphgoblin-live-/)]);
      expect(run.left).toEqual([]);
    },
  );

  it('controls the live adapters: preflight records the fixtures and every turn is refused', async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'gg-live-control-'));
    context.onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, `${LIVE_FIXTURE_PREFIX}case`));
    await mkdir(join(root, 'unrelated'));
    const record = join(root, 'record.json');
    const original = Object.getOwnPropertyDescriptors(CodexHarness.prototype);
    const restore = controlLiveAdapters({ record, temporary: root, ready: false });
    try {
      // A fixed structured directory keeps the decider's call out of the temporary directory.
      const { harness, decider } = createCodexAdapters({
        model: 'gpt-6-luna',
        effort: 'low',
        structured: { workingDirectory: root },
      });
      expect(await harness.preflight()).toEqual(readinessFailure('codex', 'unknown'));
      expect(JSON.parse(await readFile(record, 'utf8'))).toEqual({
        fixtures: [`${LIVE_FIXTURE_PREFIX}case`],
      });
      const request = {
        workingDirectory: root,
        options: { sandbox: 'read-only', approval: 'never' } as const,
        turn: { prompt: 'Controlled fixture; no provider call' },
      };
      const signal = new AbortController().signal;
      expect(() => harness.start(request, signal)).toThrow('starts no Codex turn');
      expect(() => harness.resume('thread', request, signal)).toThrow('starts no Codex turn');
      await expect(
        decider.route(
          {
            model: 'gpt-6-luna',
            effort: 'low',
            instructions: 'Controlled fixture; no provider call',
            routes: [{ id: 'ready', label: 'Ready' }],
            context: {},
          },
          signal,
        ),
      ).rejects.toThrow('starts no Codex turn');
    } finally {
      restore();
    }
    expect(Object.getOwnPropertyDescriptors(CodexHarness.prototype)).toEqual(original);
    // The passing control reports what the live case expects.
    const passing = controlLiveAdapters({ record, temporary: root, ready: true });
    try {
      expect(await createCodexAdapters().harness.preflight()).toMatchObject({
        state: 'ready',
        ok: true,
        authenticated: true,
      });
    } finally {
      passing();
    }
    expect(Object.getOwnPropertyDescriptors(CodexHarness.prototype)).toEqual(original);
  });
});
