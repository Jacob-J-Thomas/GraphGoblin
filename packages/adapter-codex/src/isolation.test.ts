import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import type { CliResult, CliRunner } from './cli.js';
import { CodexHarness } from './harness.js';

// Loop turns run without the machine's personal Codex extensions (ADR-0063). The real SDK spawns
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
  'features.plugins=false',
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

describe('Codex loop turns without the machine personal extensions', () => {
  it('switches off every configured MCP server, plugins, apps, memories, hooks and notify', async () => {
    const { directory, files, session } = await fakeTurn(['node_repl', 'docs']);
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.node_repl.enabled=false',
      'mcp_servers.docs.enabled=false',
      ...DEFAULTS,
      ...THREAD,
    ]);
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
    });
    await expect(session.result).resolves.toMatchObject({ finalText: 'Recorded' });
    expect(await configArgs(files.argv)).toEqual([
      'mcp_servers.node_repl.enabled=true',
      'mcp_servers.docs.enabled=false',
      'features.plugins=true',
      ...DEFAULTS.slice(1),
      'approval_policy="untrusted"',
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

  it('switches them off on a resumed conversation too', async () => {
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

  it('does not start the turn when the MCP servers cannot be listed', async () => {
    const { files, session } = await fakeTurn(['node_repl'], undefined, {
      GG_FAKE_CODEX_MCP_EXIT: '2',
    });
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      submission: 'definitely-not-submitted',
      message:
        "Codex could not list the machine's MCP servers, so the turn did not start: mcp list exited 2: WARNING: proceeding, even though we could not create PATH aliases | Error: failed to load configuration",
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
            configOverrides: { 'features.prototype': true },
          },
          prompt: { template: 'The complete authored task' },
        },
      }),
    );
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
});
