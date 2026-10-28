import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
];

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
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

/** One turn through the real SDK and the fake CLI; the fake's machine has `servers` configured. */
async function fakeTurn(
  servers: string[],
  configOverrides?: Record<string, unknown>,
  fake: Record<string, string> = {},
  resumeId?: string,
) {
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
