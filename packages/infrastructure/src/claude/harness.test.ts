import { describe, expect, it, vi } from 'vitest';
import * as probeFs from 'node:fs/promises';
import { HarnessOptionsSchema } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import type { HarnessEvent, HarnessStartRequest } from '@graphgoblin/engine';
import { ClaudeHarness } from './harness.js';
import type { ClaudeCliRunner, ClaudeProcessRequest, ClaudeProcessResult } from './process.js';
vi.mock('node:fs/promises', { spy: true });
const id = '11111111-1111-4111-8111-111111111111';
const help = [
  '--safe-mode',
  '--restricted',
  '--setting-sources',
  '--strict-mcp-config',
  '--tools',
  '--allowedTools',
  '--permission-mode',
  '--permission-prompts',
  '--effort',
  '--json-schema',
  '--output-format',
  '--input-format',
  '--model',
  '--verbose',
  '--print',
  '--no-session-persistence',
  '--resume',
].join(' ');
const init = {
  type: 'system',
  subtype: 'init',
  session_id: id,
  tools: ['Read', 'Glob', 'Grep'],
  permissionMode: 'dontAsk',
  model: 'claude-opus-5-5',
  apiKeySource: 'none',
  mcp_servers: [],
  plugins: [],
  skills: [],
};
const schemaInit = { ...init, tools: [...init.tools, 'StructuredOutput'] };
const final = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: id,
  result: 'finished',
  usage: { input_tokens: 2, output_tokens: 3 },
  modelUsage: { 'claude-opus-5-5': {} },
};
const outcome = (stdout = '', extra: Partial<ClaudeProcessResult> = {}): ClaudeProcessResult => ({
  stdout,
  exitCode: 0,
  aborted: false,
  timedOut: false,
  overflow: false,
  ...extra,
});
const request: HarnessStartRequest = {
  workingDirectory: 'synthetic-workspace',
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  options: HarnessOptionsSchema.parse({ sandbox: 'read-only', approval: 'never' }),
  turn: { prompt: 'synthetic prompt' },
};
function fixture(
  options: {
    auth?: string;
    records?: unknown[];
    turns?: unknown[][];
    exit?: Partial<ClaudeProcessResult>;
    throwTurn?: boolean;
  } = {},
) {
  const calls: ClaudeProcessRequest[] = [];
  let turnIndex = 0;
  const runner: ClaudeCliRunner = async (command, onStdout) => {
    await Promise.resolve();
    calls.push(command);
    if (command.args.includes('--version')) return outcome('2.1.285 (Claude Code)');
    if (command.args.includes('--help')) return outcome(help);
    if (command.args.includes('auth'))
      return outcome(options.auth ?? JSON.stringify({ authMethod: 'claude.ai', email: 'PRIVATE' }));
    if (options.throwTurn) throw new Error('PRIVATE_PROVIDER_BODY');
    for (const record of options.turns?.[turnIndex++] ?? options.records ?? [init, final])
      onStdout?.(Buffer.from(JSON.stringify(record) + '\n'));
    return outcome('', options.exit);
  };
  return {
    calls,
    harness: new ClaudeHarness({
      runner,
      platform: 'win32',
      binary: 'installed-claude',
      env: {
        Path: 'trusted',
        USERPROFILE: 'profile',
        ANTHROPIC_API_KEY: 'PRIVATE',
        ANTHROPIC_BASE_URL: 'bad',
      },
    }),
  };
}
async function drain(events: AsyncIterable<HarnessEvent>) {
  const values: HarnessEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}
describe('Claude existing harness contract', () => {
  it('uses a fresh empty prerequisite directory and removes it after inspection', async () => {
    const directories = new Set<string>();
    const runner: ClaudeCliRunner = async (command) => {
      directories.add(command.cwd);
      expect(command.cwd).not.toBe(request.workingDirectory);
      expect(await probeFs.readdir(command.cwd)).toEqual([]);
      if (command.args.includes('--version')) return outcome('2.1.285');
      if (command.args.includes('--help')) return outcome(help);
      return outcome('{"authMethod":"claude.ai"}');
    };
    const harness = new ClaudeHarness({ runner, platform: 'win32' });
    expect((await harness.preflight()).ok).toBe(true);
    expect(directories.size).toBe(1);
    for (const directory of directories)
      await expect(probeFs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['success', 'unconfirmed'] as const)(
    'handles prerequisite cleanup failure without concealing %s disposition',
    async (disposition) => {
      const directories = new Set<string>();
      const runner: ClaudeCliRunner = (command) => {
        directories.add(command.cwd);
        if (disposition === 'unconfirmed')
          return Promise.resolve(outcome('', { terminationUnconfirmed: true }));
        if (command.args.includes('--version')) return Promise.resolve(outcome('2.1.285'));
        if (command.args.includes('--help')) return Promise.resolve(outcome(help));
        return Promise.resolve(outcome('{"authMethod":"claude.ai"}'));
      };
      const cleanup = vi
        .spyOn(probeFs, 'rm')
        .mockRejectedValueOnce(new Error('Synthetic removal fault'));
      try {
        const harness = new ClaudeHarness({ runner, platform: 'win32' });
        await expect(
          harness.start(request, new AbortController().signal).result,
        ).rejects.toMatchObject({
          code:
            disposition === 'unconfirmed'
              ? 'HARNESS_TERMINATION_UNCONFIRMED'
              : 'HARNESS_TURN_FAILED',
        });
      } finally {
        cleanup.mockRestore();
        for (const directory of directories)
          await probeFs.rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('checks the installed capability/auth prerequisites and exposes explicit model support and policies', async () => {
    const { harness, calls } = fixture();
    expect(await harness.preflight()).toMatchObject({
      ok: true,
      authenticated: true,
      version: '2.1.285',
      authMethod: 'claude.ai',
      supportedPolicies: [
        expect.objectContaining({ sandbox: 'read-only' }),
        expect.objectContaining({ sandbox: 'danger-full-access' }),
      ],
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.args).toEqual([
      '--safe-mode',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      'auth',
      'status',
      '--json',
    ]);
  });
  it('executes Fable through strict native model verification with its requested effort', async () => {
    const model = 'claude-fable-5-1';
    const { harness, calls } = fixture({
      records: [
        { ...init, model },
        { ...final, modelUsage: { [model]: {} } },
      ],
    });
    const session = harness.start(
      { ...request, model, effort: 'max' },
      new AbortController().signal,
    );
    expect(await session.sessionId).toBe(id);
    expect(await session.result).toMatchObject({ finalText: 'finished' });
    expect(calls[3]?.args).toEqual(expect.arrayContaining(['--model', model, '--effort', 'max']));
    const mismatched = fixture({ records: [init, final] }).harness;
    await expect(
      mismatched.start({ ...request, model }, new AbortController().signal).result,
    ).rejects.toMatchObject({
      code: 'HARNESS_UNSUPPORTED_POLICY',
      message: expect.stringMatching(/Claude CLI 2\.1\.285.*launch policy.*model/),
    });
  });
  it('checks auth before every start and resume, uses the same env, and maps current port events/result', async () => {
    const { harness, calls } = fixture();
    const first = harness.start(request, new AbortController().signal);
    expect(await first.sessionId).toBe(id);
    expect(await first.result).toMatchObject({
      finalText: 'finished',
      usage: { inputTokens: 2, outputTokens: 3 },
    });
    expect((await drain(first.events)).map((event) => event.type)).toEqual([
      'session',
      'item',
      'usage',
      'turn-complete',
    ]);
    const resumed = harness.resume(
      id,
      { ...request, model: 'claude-opus-5-5', effort: 'high' },
      new AbortController().signal,
    );
    expect(await resumed.result).toMatchObject({ finalText: 'finished' });
    expect((await drain(resumed.events))[0]).toEqual({
      type: 'session',
      sessionId: id,
      mode: 'resumed',
    });
    expect(calls.filter((call) => call.args.includes('auth'))).toHaveLength(2);
    const turns = calls.filter((call) => call.args.includes('--print'));
    expect(turns).toHaveLength(2);
    const probes = calls.filter((call) => !call.args.includes('--print'));
    expect(probes).toHaveLength(6);
    expect(probes.every((call) => call.cwd !== request.workingDirectory)).toBe(true);
    expect(new Set(probes.slice(0, 3).map((call) => call.cwd)).size).toBe(1);
    expect(new Set(probes.slice(3).map((call) => call.cwd)).size).toBe(1);
    expect(turns.every((call) => call.cwd === request.workingDirectory)).toBe(true);
    expect(turns[0]?.stdin).toBe('synthetic prompt');
    expect(turns[0]?.args).not.toContain('synthetic prompt');
    expect(turns[1]?.args).toContain('--resume');
    expect(turns[1]?.args).toContain(id);
    expect(turns[1]?.args).toContain('high');
    expect(turns[0]?.args).not.toContain('--no-session-persistence');
    for (const call of calls) {
      expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(call.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(call.env).toEqual(calls[0]?.env);
    }
  });
  it.each(['api_key', 'api_key_helper', 'oauth_token', 'third_party', 'none', 'unknown'])(
    'refuses %s before a model starts and hides raw status',
    async (method) => {
      const { harness, calls } = fixture({
        auth: JSON.stringify({ authMethod: method, email: 'PRIVATE', token: 'PRIVATE' }),
      });
      const session = harness.start(request, new AbortController().signal);
      await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_NOT_AUTHENTICATED' });
      expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
      expect(JSON.stringify(await drain(session.events))).not.toContain('PRIVATE');
      await expect(session.sessionId).rejects.toThrow();
    },
  );
  it('fails unsupported request/capabilities/session IDs before any CLI launch', async () => {
    for (const req of [
      { ...request, options: HarnessOptionsSchema.parse({ sandbox: 'workspace-write' }) },
      { ...request, model: 'gpt-6-luna' },
      { ...request, effort: 'minimal' as const },
      { ...request, capabilities: { plugins: ['plugin'] } },
    ]) {
      const { harness, calls } = fixture();
      await expect(harness.start(req, new AbortController().signal).result).rejects.toBeInstanceOf(
        Error,
      );
      expect(calls).toHaveLength(0);
    }
    const { harness, calls } = fixture();
    await expect(
      harness.resume('bad', request, new AbortController().signal).result,
    ).rejects.toMatchObject({
      code: 'HARNESS_INVALID_CONFIGURATION',
      message: 'Claude resume requires a valid native session id',
    });
    expect(calls).toHaveLength(0);
  });
  it('validates structured results through the existing schema contract', async () => {
    const { harness, calls } = fixture({
      records: [schemaInit, { ...final, structured_output: { ok: true } }],
    });
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    expect(
      await harness.start(
        { ...request, turn: { prompt: 'synthetic', outputSchema: schema } },
        new AbortController().signal,
      ).result,
    ).toMatchObject({ structured: { ok: true } });
    expect(calls.at(-1)?.args).toContain(JSON.stringify(schema));
  });
  it('handles the native schema carrier without extending CLI execution tools or promoting carrier content', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const { harness, calls } = fixture({
      records: [
        schemaInit,
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'carrier',
                name: 'StructuredOutput',
                input: { ok: true, file_path: 'PRIVATE_FILE', command: 'PRIVATE_COMMAND' },
              },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'carrier',
                is_error: false,
                content: 'PRIVATE_CARRIER_RESULT',
              },
            ],
          },
        },
        { ...final, structured_output: { ok: true } },
      ],
    });
    const session = harness.start(
      { ...request, turn: { prompt: 'synthetic', outputSchema: schema } },
      new AbortController().signal,
    );
    const [completed, events] = await Promise.all([session.result, drain(session.events)]);
    expect(completed.structured).toEqual({ ok: true });
    expect(events.map((event) => event.type)).toEqual([
      'session',
      'item',
      'item',
      'item',
      'usage',
      'turn-complete',
    ]);
    expect(
      completed.items
        .filter((item) => item.id === 'carrier')
        .map((item) => ({ type: item.type, status: item.status, detail: item.detail })),
    ).toEqual([
      {
        type: 'other',
        status: 'running',
        detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
      },
      {
        type: 'other',
        status: 'ok',
        detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
      },
    ]);
    expect(JSON.stringify(completed.items)).not.toContain('PRIVATE');
    const args = calls.find((call) => call.args.includes('--print'))!.args;
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(args).not.toContain('StructuredOutput');
  });
  it('rejects malformed/incomplete/out-of-order streams and abnormal exit without final success evidence', async () => {
    for (const options of [
      { records: [final] },
      { records: [init] },
      { records: [{ ...init, tools: ['Read', 'Bash', 'Grep'] }] },
      { exit: { exitCode: 1 } },
    ]) {
      const { harness } = fixture(options);
      const session = harness.start(request, new AbortController().signal);
      await expect(session.result).rejects.toBeInstanceOf(Error);
      expect((await drain(session.events)).some((event) => event.type === 'turn-complete')).toBe(
        false,
      );
    }
  });
  it('converts private transport failures to typed fixed diagnostics', async () => {
    const { harness } = fixture({ throwTurn: true });
    const session = harness.start(request, new AbortController().signal);
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: 'Claude turn failed',
    });
    expect(JSON.stringify(await drain(session.events))).not.toContain('PRIVATE_PROVIDER_BODY');
  });
  it('aborts during auth without starting a model and makes cancel idempotent', async () => {
    const calls: ClaudeProcessRequest[] = [];
    const runner: ClaudeCliRunner = async (command) => {
      calls.push(command);
      if (command.args.includes('--version')) return outcome('2.1.285');
      if (command.args.includes('--help')) return outcome(help);
      return await new Promise((resolve) =>
        command.signal.addEventListener('abort', () => resolve(outcome('', { aborted: true })), {
          once: true,
        }),
      );
    };
    const harness = new ClaudeHarness({ runner, platform: 'win32' });
    const session = harness.start(request, new AbortController().signal);
    await vi.waitFor(() => expect(calls.some((call) => call.args.includes('auth'))).toBe(true));
    await Promise.all([session.cancel(), session.cancel()]);
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
    expect(await drain(session.events)).toEqual([]);
  });
  it('cancels an in-flight turn, reacts to the caller signal and never starts already aborted requests', async () => {
    const calls: ClaudeProcessRequest[] = [];
    const runner: ClaudeCliRunner = async (command, onStdout) => {
      calls.push(command);
      if (command.args.includes('--version')) return outcome('2.1.285');
      if (command.args.includes('--help')) return outcome(help);
      if (command.args.includes('auth')) return outcome('{"authMethod":"claude.ai"}');
      onStdout?.(Buffer.from(JSON.stringify(init) + '\n'));
      return await new Promise((resolve) =>
        command.signal.addEventListener('abort', () => resolve(outcome('', { aborted: true })), {
          once: true,
        }),
      );
    };
    const harness = new ClaudeHarness({ runner, platform: 'win32' });
    const controller = new AbortController();
    const session = harness.start(request, controller.signal);
    await session.sessionId;
    controller.abort();
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    await session.cancel();
    expect((await drain(session.events)).some((event) => event.type === 'turn-complete')).toBe(
      false,
    );
    const stopped = new AbortController();
    stopped.abort();
    const { harness: unused, calls: empty } = fixture();
    await expect(unused.start(request, stopped.signal).result).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(empty).toHaveLength(0);
  });
});

describe('Claude preflight and transport failure matrix', () => {
  it.each(['2.1.284', '2.1.285', '2.1.287'])(
    'reports detected version %s independently of account login',
    async (version) => {
      for (const authenticated of [true, false]) {
        const calls: string[][] = [];
        const harness = new ClaudeHarness({
          platform: 'win32',
          runner: async (command) => {
            await Promise.resolve();
            calls.push([...command.args]);
            return outcome(
              command.args.includes('--version')
                ? version
                : command.args.includes('--help')
                  ? help
                  : JSON.stringify({ authMethod: authenticated ? 'claude.ai' : 'api_key' }),
            );
          },
        });
        const facts = await harness.preflight();
        expect(facts).toMatchObject({
          version,
          authenticated,
          authMethod: authenticated ? 'claude.ai' : null,
          ok: version !== '2.1.284' && authenticated,
        });
        expect(calls.some((args) => args.includes('auth'))).toBe(true);
        expect(facts.problems).toHaveLength(Number(version === '2.1.284') + Number(!authenticated));
        if (version === '2.1.284') expect(facts.problems[0]).toMatch(/2\.1\.284.*minimum version/);
      }
    },
  );
  it('reports a missing capability and failed login together without starting a turn', async () => {
    const harness = new ClaudeHarness({
      platform: 'win32',
      runner: async (command) => {
        await Promise.resolve();
        return outcome(
          command.args.includes('--version')
            ? '2.1.287'
            : command.args.includes('--help')
              ? help.replace('--restricted', '')
              : '{}',
        );
      },
    });
    expect(await harness.preflight()).toMatchObject({
      version: '2.1.287',
      authenticated: false,
      problems: [
        expect.stringMatching(/2\.1\.287.*--restricted/),
        expect.stringMatching(/auth login/),
      ],
    });
  });
  it('reports the detected version when the hidden max-turns capability probe fails and still checks login', async () => {
    const harness = new ClaudeHarness({
      platform: 'win32',
      runner: async (command) => {
        await Promise.resolve();
        if (command.args.includes('--version')) return outcome('2.1.287');
        if (command.args.includes('--help')) {
          expect(command.args).toContain('--max-turns');
          return outcome('', { exitCode: 1 });
        }
        return outcome('{"authMethod":"claude.ai"}');
      },
    });
    expect(await harness.preflight()).toMatchObject({
      version: '2.1.287',
      authenticated: true,
      problems: [expect.stringMatching(/2\.1\.287.*--max-turns\/--help/)],
    });
  });
  it('returns fixed preflight problems for missing binary, unsupported platform/version/flags and bad auth', async () => {
    const cases: ClaudeCliRunner[] = [
      async () => await Promise.resolve(outcome('', { spawnCode: 'ENOENT' })),
      async () => await Promise.resolve(outcome('2.1.284')),
      async (command) =>
        await Promise.resolve(
          outcome(command.args.includes('--version') ? '2.1.285' : 'unsupported flags'),
        ),
      async (command) =>
        await Promise.resolve(
          outcome(
            command.args.includes('--version')
              ? '2.1.285'
              : command.args.includes('--help')
                ? help
                : '{"authMethod":"api_key","token":"PRIVATE"}',
          ),
        ),
      async () => {
        await Promise.resolve();
        throw new Error('PRIVATE');
      },
    ];
    for (const runner of cases) {
      const preflight = await new ClaudeHarness({ runner, platform: 'win32' }).preflight();
      expect(preflight.ok).toBe(false);
      expect(preflight.authMethod).toBeNull();
      expect(JSON.stringify(preflight)).not.toContain('PRIVATE');
    }
    expect(await new ClaudeHarness({ platform: 'linux' }).preflight()).toMatchObject({
      ok: false,
      supportedPolicies: [],
    });
  });
  it('validates positive process bounds', () => {
    for (const options of [
      { preflightTimeoutMs: 0 },
      { turnTimeoutMs: -1 },
      { maxOutputBytes: 0 },
      { maxTurns: 1.5 },
    ])
      expect(() => new ClaudeHarness(options)).toThrow();
    const { harness, calls } = fixture();
    expect(harness.id).toBe('claude');
    expect(calls).toHaveLength(0);
  });
  it('requires resolved settings and preserves explicit effort and process bounds', async () => {
    const { harness, calls } = fixture();
    await expect(
      harness.start({ ...request, model: '' }, new AbortController().signal).result,
    ).rejects.toMatchObject({ code: 'HARNESS_INVALID_CONFIGURATION' });
    expect(calls).toHaveLength(0);
    const configuredCalls: ClaudeProcessRequest[] = [];
    const configured = new ClaudeHarness({
      runner: async (command, onStdout) => {
        configuredCalls.push(command);
        const record = command.args.includes('--version')
          ? '2.1.285'
          : command.args.includes('--help')
            ? help
            : command.args.includes('auth')
              ? '{"authMethod":"claude.ai"}'
              : undefined;
        if (record !== undefined) return outcome(record);
        onStdout?.(Buffer.from(JSON.stringify(init) + '\n' + JSON.stringify(final)));
        return await Promise.resolve(outcome());
      },
      platform: 'win32',
      preflightTimeoutMs: 1000,
      turnTimeoutMs: 2000,
      maxOutputBytes: 1024,
      maxTurns: 5,
    });
    expect(
      await configured.start({ ...request, effort: 'max' }, new AbortController().signal).result,
    ).toMatchObject({ finalText: 'finished' });
    expect(configuredCalls.at(-1)).toMatchObject({ timeoutMs: 2000, maxOutputBytes: 1024 });
    expect(configuredCalls.at(-1)?.args).toEqual(
      expect.arrayContaining(['--effort', 'max', '--max-turns', '5']),
    );
    const withoutSettings = {
      workingDirectory: request.workingDirectory,
      options: request.options,
      turn: request.turn,
    };
    for (const partial of [
      { ...withoutSettings, model: 'claude-opus-5-5' },
      { ...withoutSettings, effort: 'xhigh' as const },
    ]) {
      const missing = fixture();
      await expect(
        missing.harness.start(partial, new AbortController().signal).result,
      ).rejects.toMatchObject({ code: 'HARNESS_INVALID_CONFIGURATION' });
      expect(missing.calls).toHaveLength(0);
    }
  });
  it.each([
    { timedOut: true, code: 'HARNESS_TIMEOUT' },
    { overflow: true, code: 'HARNESS_OUTPUT_LIMIT' },
    { spawnCode: 'EACCES' as const, code: 'HARNESS_NOT_INSTALLED' },
    { stdinFailed: true, code: 'HARNESS_TURN_FAILED' },
  ])('maps transport disposition $code safely', async ({ code, ...exit }) => {
    const { harness } = fixture({ exit });
    const session = harness.start(request, new AbortController().signal);
    await expect(session.result).rejects.toMatchObject({ code });
    expect((await drain(session.events)).some((event) => event.type === 'turn-complete')).toBe(
      false,
    );
  });
  it('does not cancel a completed session or generate a replacement session on resume mismatch', async () => {
    const { harness, calls } = fixture();
    const session = harness.start(request, new AbortController().signal);
    await session.result;
    await session.cancel();
    expect(calls.every((call) => !call.signal.aborted)).toBe(true);
    const mismatch = fixture({
      records: [{ ...init, session_id: '22222222-2222-4222-8222-222222222222' }],
    });
    await expect(
      mismatch.harness.resume(id, request, new AbortController().signal).result,
    ).rejects.toMatchObject({
      code: 'HARNESS_PROTOCOL_ERROR',
      message: expect.stringMatching(/Claude CLI 2\.1\.285.*stream-json protocol/),
    });
  });
});

describe('unconfirmed native termination', () => {
  it.each(['cancel', 'signal'] as const)(
    'preserves actionable typed failure for %s and after completion',
    async (mode) => {
      let ready!: () => void;
      const launched = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const runner: ClaudeCliRunner = async (command, onStdout) => {
        if (command.args.includes('--version')) return outcome('2.1.285');
        if (command.args.includes('--help')) return outcome(help);
        if (command.args.includes('auth')) return outcome('{"authMethod":"claude.ai"}');
        onStdout?.(Buffer.from(JSON.stringify(init) + '\n'));
        ready();
        return await new Promise((resolve) =>
          command.signal.addEventListener(
            'abort',
            () => resolve(outcome('', { aborted: true, terminationUnconfirmed: true })),
            { once: true },
          ),
        );
      };
      const harness = new ClaudeHarness({ runner, platform: 'win32' });
      const controller = new AbortController();
      const session = harness.start(request, controller.signal);
      await launched;
      if (mode === 'cancel')
        await expect(session.cancel()).rejects.toMatchObject({
          code: 'HARNESS_TERMINATION_UNCONFIRMED',
        });
      else controller.abort();
      await expect(session.result).rejects.toMatchObject({
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
        retriable: false,
      });
      await expect(session.cancel()).rejects.toMatchObject({
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
      });
      const events = await drain(session.events);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'error', code: 'HARNESS_TERMINATION_UNCONFIRMED' }),
      );
      expect(events.some((event) => event.type === 'turn-complete')).toBe(false);
    },
  );
  it('reports unconfirmed timeout termination before ordinary timeout handling', async () => {
    const { harness } = fixture({ exit: { timedOut: true, terminationUnconfirmed: true } });
    await expect(harness.start(request, new AbortController().signal).result).rejects.toMatchObject(
      { code: 'HARNESS_TERMINATION_UNCONFIRMED' },
    );
  });
});

describe('Claude native structured repair through the engine', () => {
  it.each([undefined, null, { ok: 'wrong' }])(
    'repairs the exact native candidate %s instead of final-text fallback',
    async (candidate) => {
      const { harness, calls } = fixture({
        turns: [
          [schemaInit, { ...final, result: '{"ok":true}', structured_output: candidate }],
          [schemaInit, { ...final, structured_output: { ok: true } }],
        ],
      });
      const engine = await createTestEngine({
        defaults: {
          byHarness: {
            codex: { model: 'gpt-6-luna', effort: 'low' },
            claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
          },
        },
      });
      engine.ports.harnesses.claude = harness;
      engine.ports.modelCatalog.entries.push({
        harness: 'claude',
        model: 'claude-opus-5-5',
        source: 'harness',
        displayName: 'Opus',
        efforts: ['xhigh'],
        defaultEffort: 'xhigh',
        enabled: true,
      });
      const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      };
      const v = engine.publish(
        singleNodeLoop(
          'native-repair-' +
            (candidate === undefined ? 'missing' : candidate === null ? 'null' : 'wrong'),
          {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: {
              harness: 'claude',
              prompt: { template: 'Synthetic fixture' },
              harnessOptions: { sandbox: 'read-only', approval: 'never' },
              output: { schema: { jsonSchema: schema, native: true, repair: { maxAttempts: 1 } } },
            },
          },
        ),
      );
      const run = await engine.runToIdle(v.loopId);
      expect(run.status).toBe('succeeded');
      expect((await engine.manager.getThread(run.id))?.lastOutput?.value).toEqual({ ok: true });
      const turns = calls.filter((call) => call.args.includes('--print'));
      expect(turns).toHaveLength(2);
      expect(turns[1]?.args).toContain('--resume');
      expect(turns[1]?.args).toContain(id);
      expect(turns[1]?.stdin).toContain('Validation errors');
      expect(turns[1]?.args).toContain(JSON.stringify(schema));
      expect(calls.filter((call) => call.args.includes('auth'))).toHaveLength(2);
    },
  );
});
