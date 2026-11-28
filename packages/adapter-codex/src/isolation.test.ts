import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { runCli, type CliResult, type CliRunner } from './cli.js';
import { CodexHarness } from './harness.js';
import { configuredServers } from './isolation.js';
import { CodexStructured } from './structured.js';

// Observe the listing processes the adapter's own runner starts; the SDK spawns its turns itself.
vi.mock('node:child_process', { spy: true });

// Plugins inherit CLI configuration; other extensions stay isolated (ADR-0067). The real SDK spawns
// `<codexBinary> mcp list --json` (the harness's listing) and `<codexBinary> exec ...` (the turn);
// this Node executable with the preloaded fake CLI answers the listing like CLI 0.160.0 and
// records the turn's exact arguments, so these assertions cover the SDK's own argument building.
const preload = new URL('./fixtures/argv-cli.mjs', import.meta.url).href;
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(entry[0]),
  ),
);

const DEFAULTS = [
  'features.apps=false',
  'features.memories=false',
  'features.hooks=false',
  'features.multi_agent=false',
  'features.goals=false',
  'notify=[]',
];
const THREAD = [
  'model_reasoning_effort="low"',
  'sandbox_workspace_write.network_access=false',
  'web_search="disabled"',
  'approval_policy="never"',
];
const LISTING = [
  'mcp',
  'list',
  '--json',
  '--config',
  'features.plugins=false',
  '--config',
  'features.apps=false',
  '--config',
  'features.memories=false',
  '--config',
  'features.hooks=false',
  '--config',
  'features.multi_agent=false',
  '--config',
  'features.goals=false',
];

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  // Undo the prototype change the review's reproduction makes on code without the fix.
  Reflect.deleteProperty(Object.prototype, 'gg_rev423_marker');
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-codex-isolation-'));
  directories.push(directory);
  return directory;
}

function request(workingDirectory: string, configOverrides?: Record<string, unknown>) {
  return {
    workingDirectory,
    model: 'gpt-6-luna',
    effort: 'low' as const,
    options: {
      sandbox: 'read-only' as const,
      approval: 'never' as const,
      ...(configOverrides ? { configOverrides } : {}),
    },
    turn: { prompt: 'Controlled fixture; no provider call' },
  };
}

/** The real SDK on the fake CLI, whose machine has `servers` configured. */
async function fakeHarness(servers: string[], fake: Record<string, string> = {}) {
  const directory = await workspace();
  const files = { argv: join(directory, 'argv.json'), listing: join(directory, 'listing.json') };
  const harness = new CodexHarness({
    codexBinary: process.execPath,
    env: {
      ...inherited,
      NODE_OPTIONS: `--import=${preload}`,
      GG_FAKE_CODEX_ARGV: files.argv,
      GG_FAKE_CODEX_LISTING: files.listing,
      GG_FAKE_CODEX_MCP: JSON.stringify(servers),
      ...fake,
    },
  });
  return { directory, files, harness };
}

/** One turn through the real SDK and the fake CLI; the fake's machine has `servers` configured. */
async function fakeTurn(
  servers: string[],
  configOverrides?: Record<string, unknown>,
  fake: Record<string, string> = {},
  resumeId?: string,
) {
  const { directory, files, harness } = await fakeHarness(servers, fake);
  const signal = new AbortController().signal;
  const session = resumeId
    ? harness.resume(resumeId, request(directory, configOverrides), signal)
    : harness.start(request(directory, configOverrides), signal);
  return { directory, files, session };
}

async function configArgs(file: string): Promise<string[]> {
  const argv = JSON.parse(await readFile(file, 'utf8')) as string[];
  return argv.filter((_arg, index) => argv[index - 1] === '--config');
}

describe('Codex plugin inheritance with standalone extension isolation', () => {
  it('inherits plugin configuration while switching off standalone MCP servers and other extensions', async () => {
    const { directory, files, session } = await fakeTurn(['node_repl', 'docs']);
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.node_repl.enabled=false',
      'mcp_servers.docs.enabled=false',
      ...DEFAULTS,
      ...THREAD,
    ]);
    expect(await configArgs(files.argv)).not.toContain('features.plugins=true');
    expect(await configArgs(files.argv)).not.toContain('features.plugins=false');
    const listing = JSON.parse(await readFile(files.listing, 'utf8')) as {
      argv: string[];
      cwd: string;
    };
    expect(listing.argv).toEqual(LISTING);
    // The listing reads the configuration the turn will load, including a trusted project's.
    expect(await realpath(listing.cwd)).toBe(await realpath(directory));
  }, 30_000);

  it('applies a node override after the defaults, before the thread options', async () => {
    const { files, session } = await fakeTurn(['node_repl', 'docs'], {
      mcp_servers: { node_repl: { enabled: true } },
      'features.plugins': true,
      approval_policy: 'untrusted',
      model: 'wrong-model',
      model_reasoning_effort: 'xhigh',
      sandbox_mode: 'danger-full-access',
      sandbox_workspace_write: { network_access: true },
      web_search: 'live',
    });
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.node_repl.enabled=true',
      'mcp_servers.docs.enabled=false',
      ...DEFAULTS.slice(0, -1),
      'features.plugins=true',
      'notify=[]',
      'approval_policy="untrusted"',
      'model="wrong-model"',
      'model_reasoning_effort="xhigh"',
      'sandbox_mode="danger-full-access"',
      'sandbox_workspace_write.network_access=true',
      'web_search="live"',
      ...THREAD,
    ]);
    const argv = JSON.parse(await readFile(files.argv, 'utf8')) as string[];
    expect(argv.indexOf('--model')).toBeGreaterThan(argv.indexOf('model="wrong-model"'));
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-6-luna');
    expect(argv.indexOf('--sandbox')).toBeGreaterThan(
      argv.indexOf('sandbox_mode="danger-full-access"'),
    );
    expect(argv[argv.indexOf('--sandbox') + 1]).toBe('read-only');
  }, 30_000);

  it('lets a node explicitly disable inherited plugins', async () => {
    const { files, session } = await fakeTurn([], { features: { plugins: false } });
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      ...DEFAULTS.slice(0, -1),
      'features.plugins=false',
      'notify=[]',
      ...THREAD,
    ]);
  }, 30_000);

  it('switches off sub-agents and goals unless the node turns one back on', async () => {
    const defaults = await fakeTurn([]);
    await expect(defaults.session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    const args = await configArgs(defaults.files.argv);
    expect(args).toContain('features.multi_agent=false');
    expect(args).toContain('features.goals=false');

    const node = await fakeTurn([], { features: { multi_agent: true } });
    await expect(node.session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    const overridden = await configArgs(node.files.argv);
    expect(overridden).toContain('features.multi_agent=true');
    expect(overridden).not.toContain('features.multi_agent=false');
    expect(overridden).toContain('features.goals=false');
  }, 30_000);

  // QA423-01: a listed server whose name is a JavaScript prototype member must never be left
  // enabled; the loop refuses the turn instead of passing such a name.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'does not start the turn when a listed server is named %s',
    async (name) => {
      const { files, session } = await fakeTurn(['normal', name, 'other']);
      await expect(session.result).rejects.toMatchObject({
        code: 'HARNESS_TURN_FAILED',
        submission: 'definitely-not-submitted',
        message: `Codex could not list the machine's MCP servers, so the turn did not start: the server name "${name}" cannot be switched off through --config.`,
      });
      expect(existsSync(files.argv)).toBe(false);
    },
    30_000,
  );

  it('switches off a listed server named toString like any other', async () => {
    const { files, session } = await fakeTurn(['normal', 'toString'], {
      'mcp_servers.normal.enabled': true,
    });
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.normal.enabled=true',
      'mcp_servers.toString.enabled=false',
      ...DEFAULTS,
      ...THREAD,
    ]);
  }, 30_000);

  // Review round 1: a node override key is authored data. A segment that is not one plain key,
  // or is a prototype member, refuses the turn; none reaches the merge, so none can change
  // Object.prototype (`review.__proto__.<x>` did before).
  it.each([
    ['a dotted __proto__ segment', { 'review.__proto__.gg_rev423_marker': true }],
    ['a __proto__ server', JSON.parse('{"mcp_servers":{"__proto__":{"enabled":true}}}')],
    ['a constructor server', { mcp_servers: { constructor: { enabled: true } } }],
    ['a prototype feature', { 'features.prototype': true }],
    ['a key with a space', { mcp_servers: { 'team docs': { enabled: true } } }],
    ['a key with a quote', { 'features."plugins"': true }],
    ['an empty segment', { 'features..plugins': true }],
    ['a key inside an array table', { list: [{ ok: 1 }, { 'not plain': 2 }] }],
  ] as const)(
    'refuses the turn for an override with %s',
    async (_case, overrides) => {
      const { directory, files, harness } = await fakeHarness(['docs']);
      let refusal: unknown;
      let started: Promise<unknown> | undefined;
      try {
        started = harness.start(
          request(directory, overrides as Record<string, unknown>),
          new AbortController().signal,
        ).result;
      } catch (error) {
        refusal = error;
      }
      // A turn that did start (the defect) is awaited so no fake CLI outlives the test.
      await started?.catch(() => undefined);
      expect(refusal).toMatchObject({
        code: 'HARNESS_INVALID_CONFIGURATION',
        retriable: false,
        submission: 'definitely-not-submitted',
        message: expect.stringMatching(
          /^The Codex config override key ".+" cannot be passed through --config, so the turn did not start: every key segment must be letters, digits, "_" or "-", and not __proto__, constructor or prototype\.$/,
        ),
      });
      expect(Object.hasOwn(Object.prototype, 'gg_rev423_marker')).toBe(false);
      expect(existsSync(files.listing)).toBe(false);
      expect(existsSync(files.argv)).toBe(false);
    },
    30_000,
  );

  it('isolates standalone servers on resumed conversations while inheriting plugins', async () => {
    const { files, session } = await fakeTurn(['node_repl'], undefined, {}, 'argv-thread');
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    const argv = JSON.parse(await readFile(files.argv, 'utf8')) as string[];
    expect(argv.slice(-2)).toEqual(['resume', 'argv-thread']);
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.node_repl.enabled=false',
      ...DEFAULTS,
      ...THREAD,
    ]);
  }, 30_000);

  it('inherits plugins on structured calls through the common adapter too', async () => {
    const { directory, files, harness } = await fakeHarness(['docs']);
    await expect(
      new CodexStructured(harness).complete(
        {
          workingDirectory: directory,
          model: 'gpt-6-luna',
          effort: 'low',
          prompt: 'Controlled structured fixture; no provider call',
          schema: { type: 'object', properties: {}, additionalProperties: false },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ value: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.docs.enabled=false',
      ...DEFAULTS,
      ...THREAD,
    ]);
    const argv = JSON.parse(await readFile(files.argv, 'utf8')) as string[];
    expect(argv).toContain('--output-schema');
  }, 30_000);

  it('does not start the turn when the MCP servers cannot be listed', async () => {
    const { files, session } = await fakeTurn(['node_repl'], undefined, {
      GG_FAKE_CODEX_MCP_EXIT: '2',
    });
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      submission: 'definitely-not-submitted',
      message:
        "Codex could not list the machine's MCP servers, so the turn did not start: mcp list exited 2: Error: failed to load configuration",
    });
    expect(existsSync(files.argv)).toBe(false);
  }, 30_000);
});

it('records a refused override key as a pinned, non-resumable run failure', async () => {
  const e = await createTestEngine();
  const { files, harness } = await fakeHarness(['docs']);
  e.ports.harnesses.codex = harness;
  try {
    const version = e.publish(
      singleNodeLoop('Refused override key', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          model: 'gpt-6-luna',
          effort: 'low',
          harnessOptions: {
            sandbox: 'read-only',
            approval: 'never',
            configOverrides: {},
          },
          prompt: { template: 'The complete authored task' },
        },
      }),
    );
    // A previously saved version can predate contract admission. Keep the adapter's final
    // refusal covered independently of the authoring schema that now rejects this key.
    const infer = version.definition.nodes.find((node) => node.kind === 'inference');
    if (!infer || infer.kind !== 'inference') throw new Error('Missing fixture inference');
    infer.config.harnessOptions.configOverrides = { 'features.prototype': true };
    e.ports.loops.add(version);
    const run = await e.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: expect.stringContaining(
        'harness turn failed: The Codex config override key "features.prototype" cannot be passed through --config',
      ),
      resumable: false,
      details: { adapterCode: 'HARNESS_INVALID_CONFIGURATION' },
      inference: { submission: 'definitely-not-submitted' },
    });
    await expect(e.manager.resume(run.id)).rejects.toThrow();
    expect(existsSync(files.listing)).toBe(false);
    expect(existsSync(files.argv)).toBe(false);
  } finally {
    e.manager.stop();
  }
}, 60_000);

describe('the MCP listing before each turn', () => {
  /** A harness whose listing is answered by `respond`; the turn itself would need a missing CLI. */
  function harnessWith(respond: (signal: AbortSignal | undefined) => Promise<CliResult>) {
    const calls: Parameters<CliRunner>[] = [];
    const harness = new CodexHarness({
      codexBinary: 'C:/missing/codex.exe',
      env: { PATH: 'C:/fixture' },
      cliRunner: (...args) => {
        calls.push(args);
        return respond(args[3]);
      },
    });
    return { harness, calls };
  }

  /** A completed listing whose stdout is `stdout`, after a warning on stderr. */
  const listed = (stdout: string): CliResult => ({
    code: 0,
    output: `WARNING: on stderr\n${stdout}`,
    stdout,
  });

  it.each([
    [
      {
        code: 1,
        output: `WARNING: ${'temporary path '.repeat(40)}\nError: failed to load configuration\nCaused by:\ninvalid type: string, expected a boolean in plugins.fixture.enabled`,
        stdout: '',
      },
      'HARNESS_TURN_FAILED',
      'mcp list exited 1: Error: failed to load configuration | Caused by: | invalid type: string, expected a boolean in plugins.fixture.enabled',
    ],
    [
      { code: null, output: '', stdout: '', spawnError: 'spawn C:/missing/codex.exe ENOENT' },
      'HARNESS_NOT_INSTALLED',
      'the CLI did not run (spawn C:/missing/codex.exe ENOENT).',
    ],
    [
      { code: null, output: '', stdout: '', spawnError: 'timed out after 15000 ms' },
      'HARNESS_TURN_FAILED',
      'the CLI did not run (timed out after 15000 ms).',
    ],
    [
      listed('Loaded.\nnot json'),
      'HARNESS_TURN_FAILED',
      'mcp list printed no JSON: Loaded. | not json',
    ],
    [listed('{"name":"docs"}'), 'HARNESS_TURN_FAILED', 'mcp list printed an unexpected shape.'],
    [listed('[{"enabled":true}]'), 'HARNESS_TURN_FAILED', 'mcp list printed an unexpected shape.'],
    [
      listed('[{"name":"docs"},{"name":"team.docs"}]'),
      'HARNESS_TURN_FAILED',
      'the server name "team.docs" cannot be switched off through --config.',
    ],
    [
      listed('[{"name":"docs"},{"name":"team docs"}]'),
      'HARNESS_TURN_FAILED',
      'the server name "team docs" cannot be switched off through --config.',
    ],
    [
      listed('[{"name":"say\\"hi\\""}]'),
      'HARNESS_TURN_FAILED',
      'the server name "say\\"hi\\"" cannot be switched off through --config.',
    ],
  ] as const)('refuses to start on %j', async (result, code, reason) => {
    const directory = await workspace();
    const { harness, calls } = harnessWith(() => Promise.resolve(result));
    const session = harness.start(request(directory), new AbortController().signal);
    await expect(session.result).rejects.toMatchObject({
      code,
      submission: 'definitely-not-submitted',
      message: `Codex could not list the machine's MCP servers, so the turn did not start: ${reason}`,
    });
    expect(calls).toHaveLength(1);
    const [cli, args, timeoutMs, signal] = calls[0]!;
    expect(cli).toEqual({
      command: 'C:/missing/codex.exe',
      prefix: [],
      cwd: directory,
      env: { PATH: 'C:/fixture' },
    });
    expect(args).toEqual(LISTING);
    expect(timeoutMs).toBe(15_000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('stops before the turn when the run is cancelled during the listing', async () => {
    const directory = await workspace();
    const { harness } = harnessWith(
      (signal) =>
        new Promise((resolve) =>
          signal?.addEventListener('abort', () => resolve(listed('[]')), { once: true }),
        ),
    );
    const session = harness.start(request(directory), new AbortController().signal);
    await session.cancel();
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles the actual listing process and submits no turn when the run is cancelled during it (#506)', async () => {
    const directory = await workspace();
    const argv = join(directory, 'argv.json');
    const hanging = fileURLToPath(new URL('./fixtures/readiness-cli.mjs', import.meta.url));
    let listed!: (child: ChildProcess) => void;
    const listing = new Promise<ChildProcess>((resolve) => {
      listed = resolve;
    });
    const harness = new CodexHarness({
      // A turn the SDK did submit would reach the argument-recording fake CLI.
      codexBinary: process.execPath,
      env: { ...inherited, NODE_OPTIONS: `--import=${preload}`, GG_FAKE_CODEX_ARGV: argv },
      // The adapter's own runner lists, with the turn's signal, on a fake CLI that never answers.
      cliRunner: (cli, args, timeoutMs, signal) => {
        const spawned = vi.mocked(spawn).mock.results.length;
        const result = runCli({ ...cli, prefix: [hanging, 'hang'] }, args, timeoutMs, signal);
        const started = vi.mocked(spawn).mock.results[spawned];
        if (started?.type === 'return') listed(started.value);
        return result;
      },
    });
    const session = harness.start(request(directory), new AbortController().signal);
    const child = await listing;
    // The fake has started listing.
    await new Promise((resolve) => child.stderr?.once('data', resolve));
    const closed = vi.fn();
    const settled = vi.fn();
    child.once('close', closed);
    void session.result.then(settled, settled);
    await session.cancel();
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    // The listing process closed before the turn settled; nothing was submitted.
    expect(closed).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    expect(closed.mock.invocationCallOrder[0]).toBeLessThan(settled.mock.invocationCallOrder[0]!);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const events: unknown[] = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([]);
    expect(existsSync(argv)).toBe(false);
  }, 30_000);

  // #506: after its cleanup allowance the runner reports a listing process that did not confirm
  // that it stopped. That outranks the listing's ordinary failure and the turn's cancellation. The
  // controlled runner below supplies that result directly; it starts no process, so these cases
  // check the adapter's mapping, not that any real process outlived its kill.
  describe('when the listing process does not confirm that it stopped', () => {
    const CANARY = 'C:/Users/canary-owner/.codex/private-canary';
    const unconfirmed = (spawnError: string): CliResult => ({
      code: null,
      output: `WARNING: output-canary ${CANARY}\nError: failed to load configuration ${CANARY}`,
      stdout: '[{"name":"stdout_canary"}]',
      spawnError,
      terminationUnconfirmed: true,
    });
    const notStopped = (first: string) =>
      `Codex could not list the machine's MCP servers, so the turn did not start: the listing ${first} and its process did not confirm that it stopped; it may still be running.`;

    /** The actual harness listing through `runner`; a submitted turn would reach the recording fake CLI. */
    async function recordingHarness(runner: CliRunner) {
      const directory = await workspace();
      const argv = join(directory, 'argv.json');
      const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const calls: Parameters<CliRunner>[] = [];
      const harness = new CodexHarness({
        codexBinary: process.execPath,
        env: { ...inherited, NODE_OPTIONS: `--import=${preload}`, GG_FAKE_CODEX_ARGV: argv },
        logger: log,
        cliRunner: (...args) => {
          calls.push(args);
          return runner(...args);
        },
      });
      const session = harness.start(request(directory), new AbortController().signal);
      return { argv, log, calls, session };
    }

    /** The turn reports `message` as unconfirmed termination, with nothing submitted or leaked. */
    async function expectUnconfirmed(
      { argv, log, calls, session }: Awaited<ReturnType<typeof recordingHarness>>,
      message: string,
    ) {
      // The listing's own error says nothing was submitted (the `configuredServers` cases below).
      // The harness's shared evidence fold reports every unconfirmed termination as delivery
      // uncertain (docs/05); that mapping is the harness's, unchanged here.
      const failure = {
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
        message,
        retriable: false,
        submission: 'delivery-uncertain',
      };
      const error = await session.result.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject(failure);
      const events: unknown[] = [];
      for await (const event of session.events) events.push(event);
      // No session and no submission marker: the SDK never started a turn.
      expect(events).toEqual([{ type: 'error', ...failure }]);
      expect(existsSync(argv)).toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toEqual(LISTING);
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'HARNESS_TERMINATION_UNCONFIRMED', retriable: false }),
        `codex turn failed: ${message}`,
      );
      // The fixed message carries none of the CLI's output, a path or the runner's own words.
      const reported = [
        (error as Error).message,
        JSON.stringify(events),
        JSON.stringify(log.warn.mock.calls),
      ];
      for (const text of reported) expect(text).not.toMatch(/canary|Users|EPERM/i);
    }

    it.each([
      ['its deadline', 'timed out after 15000 ms', 'timed out after 15000 ms'],
      ['an error of the started process', `spawn EPERM ${CANARY}`, 'failed'],
      ['an error worded like a deadline', `timed out after 15000 ms at ${CANARY}`, 'failed'],
    ] as const)(
      'fails the turn as unconfirmed termination after %s, without starting it',
      async (_case, spawnError, first) => {
        const harness = await recordingHarness(() => Promise.resolve(unconfirmed(spawnError)));
        await expectUnconfirmed(harness, notStopped(first));
      },
    );

    it('fails a cancelled turn as unconfirmed termination rather than as cancelled', async () => {
      const harness = await recordingHarness(
        (_cli, _args, _timeoutMs, signal) =>
          new Promise((resolve) =>
            signal?.addEventListener(
              'abort',
              () => resolve(unconfirmed('The operation was aborted')),
              { once: true },
            ),
          ),
      );
      // The listing is waiting on the turn's own signal when the turn is cancelled.
      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]![3]?.aborted).toBe(false);
      const cancelled = harness.session.cancel();
      await expect(cancelled).rejects.toMatchObject({
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
        message: notStopped('was cancelled'),
      });
      await expectUnconfirmed(harness, notStopped('was cancelled'));
    });

    it.each([
      ['The operation was aborted', 'was cancelled'],
      ['timed out after 250 ms', 'timed out after 250 ms'],
      // Not this call's deadline, so not the runner's own words for it.
      ['timed out after 15000 ms', 'failed'],
      [`spawn EPERM ${CANARY}`, 'failed'],
    ] as const)(
      'refuses the listing after %j as non-retriable and before submission',
      async (spawnError, first) => {
        const run: CliRunner = () => Promise.resolve(unconfirmed(spawnError));
        const listing = configuredServers(
          { command: 'codex', prefix: [] },
          run,
          250,
          undefined,
          undefined,
        );
        await expect(listing).rejects.toMatchObject({
          code: 'HARNESS_TERMINATION_UNCONFIRMED',
          message: notStopped(first),
          retriable: false,
          submission: 'definitely-not-submitted',
        });
      },
    );
  });
});
