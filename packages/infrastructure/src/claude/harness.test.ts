import { describe, expect, it, vi } from 'vitest';
import * as probeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    version?: string;
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
    if (command.args.includes('--version'))
      return outcome(`${options.version ?? '2.1.285'} (Claude Code)`);
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
  it.each([
    { terminationUnconfirmed: true as const, code: 'HARNESS_TERMINATION_UNCONFIRMED' },
    { timedOut: true, code: 'HARNESS_TIMEOUT' },
    { overflow: true, code: 'HARNESS_OUTPUT_LIMIT' },
    // A failed output pipe may have lost acceptance evidence, so no refusal can be trusted (#364).
    { outputFailed: true as const, code: 'HARNESS_TURN_FAILED' },
  ])('preserves $code over a native zero-turn refusal envelope', async ({ code, ...transport }) => {
    const { harness } = fixture({
      records: [
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          session_id: id,
        },
      ],
      exit: { exitCode: 1, turnRejection: 'session-missing', ...transport },
    });
    await expect(
      harness.resume(id, request, new AbortController().signal).result,
    ).rejects.toMatchObject({ code });
  });
  it('does not let a refusal diagnostic conceal unconfirmed native termination', async () => {
    const { harness } = fixture({
      records: [init],
      exit: { exitCode: null, terminationUnconfirmed: true, turnRejection: 'session-missing' },
    });
    const session = harness.resume(id, request, new AbortController().signal);
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED' });
    expect((await drain(session.events)).at(-1)).toMatchObject({
      type: 'error',
      code: 'HARNESS_TERMINATION_UNCONFIRMED',
      submission: 'delivery-uncertain',
    });
  });

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
  it('creates the prerequisite directory under a system temporary directory of 226 characters (#102)', async () => {
    // Windows `fs.mkdtemp` refused the 249-character probe path here (ENAMETOOLONG), although the
    // directory can be created and the CLI started in it; see docs/qa/2026-10-19-wp-f5-launch-diagnosis.md.
    const root = await probeFs.mkdtemp(join(tmpdir(), 'gg-long-temp-'));
    let longTemp = root;
    while (longTemp.length < 226 - 21) longTemp = join(longTemp, 'segment-abcdefghij');
    longTemp = join(longTemp, 'x'.repeat(226 - longTemp.length - 1));
    expect(longTemp).toHaveLength(226);
    await probeFs.mkdir(longTemp, { recursive: true });
    const directories: string[] = [];
    const runner: ClaudeCliRunner = async (command) => {
      directories.push(command.cwd);
      expect(await probeFs.readdir(command.cwd)).toEqual([]);
      if (command.args.includes('--version')) return outcome('2.1.285');
      if (command.args.includes('--help')) return outcome(help);
      return outcome('{"authMethod":"claude.ai"}');
    };
    for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, longTemp);
    try {
      const harness = new ClaudeHarness({ runner, platform: 'win32' });
      expect(await harness.preflight()).toMatchObject({ ok: true, problems: [] });
      expect(directories).toHaveLength(3);
      expect(new Set(directories).size).toBe(1);
      expect(directories[0]?.startsWith(longTemp)).toBe(true);
      expect(directories[0]?.length).toBeGreaterThan(248);
      await expect(probeFs.access(directories[0] ?? '')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.unstubAllEnvs();
      await probeFs.rm(root, { recursive: true, force: true });
    }
  });
  it('tries a fresh prerequisite directory name after a name collision and never removes the existing one', async () => {
    const collision = Object.assign(new Error('Synthetic name collision'), { code: 'EEXIST' });
    const create = vi.spyOn(probeFs, 'mkdir').mockRejectedValueOnce(collision);
    const remove = vi.spyOn(probeFs, 'rm');
    const directories = new Set<string>();
    const runner: ClaudeCliRunner = (command) => {
      directories.add(command.cwd);
      if (command.args.includes('--version')) return Promise.resolve(outcome('2.1.285'));
      if (command.args.includes('--help')) return Promise.resolve(outcome(help));
      return Promise.resolve(outcome('{"authMethod":"claude.ai"}'));
    };
    try {
      const harness = new ClaudeHarness({ runner, platform: 'win32' });
      expect(await harness.preflight()).toMatchObject({ ok: true, problems: [] });
      const attempted = create.mock.calls.map(([path]) => String(path));
      expect(attempted).toHaveLength(2);
      expect(attempted[0]).not.toBe(attempted[1]);
      expect([...directories]).toEqual([attempted[1]]);
      expect(remove.mock.calls.map(([path]) => String(path))).toEqual([attempted[1]]);
    } finally {
      create.mockRestore();
      remove.mockRestore();
    }
  });
  it.each([
    ['four name collisions', 'EEXIST', 4],
    ['a creation fault', 'EACCES', 1],
  ])(
    'fails the check without starting the CLI or removing anything after %s',
    async (_case, code, attempts) => {
      const fault = Object.assign(new Error('Synthetic creation fault'), { code });
      const create = vi.spyOn(probeFs, 'mkdir').mockRejectedValue(fault);
      const remove = vi.spyOn(probeFs, 'rm');
      const runner = vi.fn<ClaudeCliRunner>();
      try {
        const harness = new ClaudeHarness({ runner, platform: 'win32' });
        expect(await harness.preflight()).toMatchObject({
          ok: false,
          state: 'unknown',
          problems: [
            'Claude readiness could not be confirmed. Check that the Claude CLI starts and responds, then retry preflight.',
          ],
        });
        const attempted = create.mock.calls.map(([path]) => String(path));
        expect(attempted).toHaveLength(attempts);
        expect(new Set(attempted).size).toBe(attempts);
        expect(runner).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
      } finally {
        create.mockRestore();
        remove.mockRestore();
      }
    },
  );
  it('checks the installed capability/auth prerequisites and exposes explicit model support and policies', async () => {
    const { harness, calls } = fixture();
    expect(await harness.preflight()).toMatchObject({
      state: 'ready',
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
  it.each(['claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'])(
    'executes %s through strict native model verification with its requested effort',
    async (model) => {
      for (const effort of ['low', 'max'] as const) {
        const { harness, calls } = fixture({
          records: [
            { ...init, model },
            { ...final, modelUsage: { [model]: {} } },
          ],
        });
        const session = harness.start({ ...request, model, effort }, new AbortController().signal);
        expect(await session.sessionId).toBe(id);
        expect(await session.result).toMatchObject({ finalText: 'finished' });
        expect(calls[3]?.args).toEqual(
          expect.arrayContaining(['--model', model, '--effort', effort]),
        );
        const policy = (await drain(session.events)).find((event) => event.type === 'item');
        expect(policy).toMatchObject({
          item: {
            detail: { requestedModel: model, requestedEffort: effort, effectiveEffort: null },
          },
        });
      }
      // The reported model must be the requested one in both init and result usage.
      const mismatched = fixture({ records: [init, final] }).harness;
      await expect(
        mismatched.start({ ...request, model }, new AbortController().signal).result,
      ).rejects.toMatchObject({
        code: 'HARNESS_UNSUPPORTED_POLICY',
        message: expect.stringMatching(/Claude CLI 2\.1\.285.*launch policy.*model/),
      });
      const otherUsage = fixture({
        records: [
          { ...init, model },
          { ...final, modelUsage: { [model]: {}, 'claude-opus-5-5': {} } },
        ],
      }).harness;
      await expect(
        otherUsage.start({ ...request, model }, new AbortController().signal).result,
      ).rejects.toMatchObject({ code: 'HARNESS_UNSUPPORTED_POLICY' });
      // An unsupported effort is refused before any CLI process starts.
      const refused = fixture();
      await expect(
        refused.harness.start({ ...request, model, effort: 'none' }, new AbortController().signal)
          .result,
      ).rejects.toMatchObject({ code: 'HARNESS_INVALID_CONFIGURATION' });
      expect(refused.calls).toHaveLength(0);
    },
  );
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
      'submitted',
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
      { ...request, effort: 'none' as const },
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
      'submitted',
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
  it('preserves the CLI version, safe refusal name and recovery hint in result and error events', async () => {
    for (const { records, code, identity } of [
      {
        records: [{ type: 'system', subtype: 'future_metadata', body: 'PRIVATE_BODY' }],
        code: 'HARNESS_PROTOCOL_ERROR',
        identity: 'system/future_metadata',
      },
      {
        records: [{ ...init, plugins: [{ name: 'cc-plugin-hostile', body: 'PRIVATE_BODY' }] }],
        code: 'HARNESS_UNSUPPORTED_POLICY',
        identity: 'cc-plugin-hostile',
      },
      {
        records: [
          {
            ...init,
            plugins: [
              {
                name: 'cc-plugin-agents-md',
                path: 'C:/Users/alice/secret.txt',
                source: 'cc-plugin-agents-md@builtin',
              },
            ],
          },
        ],
        code: 'HARNESS_UNSUPPORTED_POLICY',
        identity: 'cc-plugin-agents-md',
      },
      {
        records: [{ type: 'system', subtype: 'alice@example.com' }],
        code: 'HARNESS_PROTOCOL_ERROR',
        identity: '<invalid>',
      },
    ]) {
      const { harness } = fixture({ version: '2.1.287', records });
      const session = harness.start(request, new AbortController().signal);
      await expect(session.result).rejects.toMatchObject({
        code,
        message: expect.stringMatching(
          new RegExp(
            `Claude CLI 2\\.1\\.287.*${identity}.*Update GraphGoblin or report this Claude CLI version`,
          ),
        ),
      });
      const events = await drain(session.events);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'error',
          code,
          message: expect.stringContaining(identity),
        }),
      );
      expect(JSON.stringify(events)).not.toContain('PRIVATE_BODY');
      expect(JSON.stringify(events)).not.toContain('alice');
    }
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
              : '{"loggedIn":false,"authMethod":"none"}',
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
    for (const options of [{ preflightTimeoutMs: 0 }, { maxOutputBytes: 0 }])
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
      maxOutputBytes: 1024,
    });
    expect(
      await configured.start({ ...request, effort: 'max' }, new AbortController().signal).result,
    ).toMatchObject({ finalText: 'finished' });
    expect(configuredCalls.at(-1)).toMatchObject({ timeoutMs: null, maxOutputBytes: 1024 });
    expect(configuredCalls.at(-1)?.args).toEqual(expect.arrayContaining(['--effort', 'max']));
    expect(configuredCalls.at(-1)?.args).not.toContain('--max-turns');
    expect(configuredCalls.at(-1)?.args).not.toContain('--max-budget-usd');
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
    { spawnCode: 'EACCES' as const, code: 'HARNESS_TURN_FAILED' },
    { stdinFailed: true, code: 'HARNESS_TURN_FAILED' },
    { outputFailed: true as const, code: 'HARNESS_TURN_FAILED' },
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
  it.each([
    ['timeout', { timedOut: true }, 'unknown', 'HARNESS_TIMEOUT'],
    [
      'missing executable',
      { spawnCode: 'ENOENT', startRefusal: 'executable-missing' },
      'cli-missing',
      'HARNESS_NOT_INSTALLED',
    ],
    // A refusal with no established cause never claims that the CLI is missing (#364).
    ['unexplained start refusal', { spawnCode: 'ENOENT' }, 'unknown', 'HARNESS_TURN_FAILED'],
    [
      'unconfirmed termination',
      { terminationUnconfirmed: true },
      'unknown',
      'HARNESS_TERMINATION_UNCONFIRMED',
    ],
    ['aborted process', { aborted: true }, 'unknown', 'HARNESS_TURN_FAILED'],
    ['output overflow', { overflow: true }, 'unknown', 'HARNESS_OUTPUT_LIMIT'],
  ] as const)(
    'keeps %s authoritative over positive auth-status text',
    async (_name, fault, state, code) => {
      const runner: ClaudeCliRunner = (command) => {
        if (command.args.includes('--version')) return Promise.resolve(outcome('2.1.285'));
        if (command.args.includes('--help')) return Promise.resolve(outcome(help));
        return Promise.resolve(outcome('Not logged in', { notLoggedIn: true, ...fault }));
      };
      const harness = new ClaudeHarness({ platform: 'win32', runner });
      const result = await harness.preflight();
      expect(result).toMatchObject({ state, ok: false });
      expect(result).not.toHaveProperty('authenticated');
      await expect(
        harness.start(request, new AbortController().signal).result,
      ).rejects.toMatchObject({ code });
    },
  );
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

it.each(['auth', 'quota', 'transport'] as const)(
  'does not infer a real turn failure from %s stderr classification',
  async (failureState) => {
    const { harness } = fixture({ exit: { exitCode: 1, failureState, notLoggedIn: true } });
    const session = harness.start(request, new AbortController().signal);
    const events = drain(session.events);
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      retriable: false,
    });
    await events;
  },
);

describe('Claude start refusal diagnostics (#364)', () => {
  const refused = (extra: Partial<ClaudeProcessResult> = {}) =>
    outcome('', { exitCode: null, spawnCode: 'ENOENT', ...extra });
  const longDirectory = join(tmpdir(), 'x'.repeat(259));
  it.each([
    [
      'a missing working directory',
      { startRefusal: 'working-directory-missing' as const },
      request.workingDirectory,
      'HARNESS_INVALID_CONFIGURATION',
      'Claude could not be started because the working directory does not exist; check the working directory setting',
    ],
    [
      'a working directory that is not a folder',
      { startRefusal: 'working-directory-not-directory' as const },
      request.workingDirectory,
      'HARNESS_INVALID_CONFIGURATION',
      'Claude could not be started because the working directory is not a folder; check the working directory setting',
    ],
    [
      'an absent executable',
      { startRefusal: 'executable-missing' as const },
      request.workingDirectory,
      'HARNESS_NOT_INSTALLED',
      'The Claude executable was not found at its configured path; install the Claude CLI or correct its path',
    ],
    [
      'an unexplained ENOENT',
      {},
      request.workingDirectory,
      'HARNESS_TURN_FAILED',
      "Claude could not be started (ENOENT); check the Claude executable's path and permissions and the working directory",
    ],
    [
      'an unexplained EACCES',
      { spawnCode: 'EACCES' as const },
      request.workingDirectory,
      'HARNESS_TURN_FAILED',
      "Claude could not be started (EACCES); check the Claude executable's path and permissions and the working directory",
    ],
    [
      'an unexplained refusal in a long working directory',
      {},
      longDirectory,
      'HARNESS_TURN_FAILED',
      'Claude could not be started (ENOENT); the working directory path is longer than the 258 characters Windows allows',
    ],
  ])(
    'reports a turn refusal with %s as fixed text and no submission',
    async (_case, observation, workingDirectory, code, message) => {
      const { harness, calls } = fixture({ records: [], exit: refused(observation) });
      const session = harness.start(
        { ...request, workingDirectory, turn: { prompt: 'PRIVATE_PROMPT' } },
        new AbortController().signal,
      );
      const events = await drain(session.events);
      const failure = { code, message, retriable: false };
      expect(events).toEqual([
        { type: 'error', ...failure, submission: 'definitely-not-submitted' },
      ]);
      await expect(session.result).rejects.toMatchObject(failure);
      await expect(session.sessionId).rejects.toMatchObject({ code });
      // The authored working directory is used exactly as given; nothing substitutes another.
      expect(calls.at(-1)?.cwd).toBe(workingDirectory);
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
      expect(JSON.stringify(events)).not.toContain(workingDirectory);
    },
  );
  it('keeps a turn uncertain when its output pipe failed, even with a recognised refusal', async () => {
    const { harness } = fixture({
      records: [],
      exit: { exitCode: 1, outputFailed: true, turnRejection: 'auth' },
    });
    const session = harness.start(request, new AbortController().signal);
    expect((await drain(session.events)).at(-1)).toEqual({
      type: 'error',
      code: 'HARNESS_TURN_FAILED',
      message: 'Claude turn failed',
      retriable: false,
      submission: 'delivery-uncertain',
    });
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TURN_FAILED' });
  });
  it('keeps cancellation ahead of a working-directory diagnosis', async () => {
    const controller = new AbortController();
    const runner: ClaudeCliRunner = (command) => {
      if (command.args.includes('--version')) return Promise.resolve(outcome('2.1.285'));
      if (command.args.includes('--help')) return Promise.resolve(outcome(help));
      if (command.args.includes('auth'))
        return Promise.resolve(outcome('{"authMethod":"claude.ai"}'));
      controller.abort();
      return Promise.resolve(refused({ aborted: true, startRefusal: 'working-directory-missing' }));
    };
    const session = new ClaudeHarness({ runner, platform: 'win32' }).start(
      request,
      controller.signal,
    );
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(await drain(session.events)).toEqual([]);
  });
  it.each([
    [
      { startRefusal: 'executable-missing' as const },
      'cli-missing',
      'HARNESS_NOT_INSTALLED',
      'Claude CLI was not found at the configured path.',
      'Install the Claude CLI or set GG_CLAUDE_BINARY, then retry preflight.',
    ],
    [
      { startRefusal: 'working-directory-missing' as const },
      'unknown',
      'HARNESS_TURN_FAILED',
      'Claude CLI could not be started because its temporary check folder does not exist.',
      'Check that the Claude CLI starts and responds, then retry preflight.',
    ],
    [
      { startRefusal: 'working-directory-not-directory' as const },
      'unknown',
      'HARNESS_TURN_FAILED',
      'Claude CLI could not be started because its temporary check folder is not a folder.',
      'Check that the Claude CLI starts and responds, then retry preflight.',
    ],
    [
      {},
      'unknown',
      'HARNESS_TURN_FAILED',
      'Claude CLI could not be started (ENOENT).',
      'Check that the Claude CLI starts and responds, then retry preflight.',
    ],
  ])(
    'reports check refusal %o as %s; the check folder is never configuration',
    async (observation, state, code, detail, action) => {
      const calls: ClaudeProcessRequest[] = [];
      const runner: ClaudeCliRunner = (command) => {
        calls.push(command);
        return Promise.resolve(refused(observation));
      };
      const harness = new ClaudeHarness({ runner, platform: 'win32' });
      const facts = await harness.preflight();
      expect(facts).toMatchObject({ state, ok: false, problems: [`${detail} ${action}`] });
      expect(facts).not.toHaveProperty('authenticated');
      expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
      const session = harness.start(request, new AbortController().signal);
      await expect(session.result).rejects.toMatchObject({ code, message: detail });
      expect((await drain(session.events)).at(-1)).toMatchObject({
        code,
        submission: 'definitely-not-submitted',
      });
    },
  );
  it('reports an unreadable check output without trusting partial sign-in text', async () => {
    const runner: ClaudeCliRunner = (command) =>
      Promise.resolve(
        command.args.includes('auth')
          ? outcome('{"loggedIn":false}', { outputFailed: true, notLoggedIn: true })
          : outcome(command.args.includes('--help') ? help : '2.1.285'),
      );
    const facts = await new ClaudeHarness({ runner, platform: 'win32' }).preflight();
    expect(facts).toMatchObject({
      state: 'unknown',
      problems: [
        'Claude CLI check output could not be read. Check that the Claude CLI starts and responds, then retry preflight.',
      ],
    });
    expect(facts).not.toHaveProperty('authenticated');
  });
  it('names the Windows limit for an unexplained refusal from a long temporary check folder', async () => {
    const root = await probeFs.mkdtemp(join(tmpdir(), 'gg-364-long-temp-'));
    let longTemp = root;
    while (longTemp.length < 240) longTemp = join(longTemp, 'segment-abcdefghij');
    await probeFs.mkdir(longTemp, { recursive: true });
    const directories: string[] = [];
    const runner: ClaudeCliRunner = (command) => {
      directories.push(command.cwd);
      return Promise.resolve(refused());
    };
    for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, longTemp);
    try {
      const facts = await new ClaudeHarness({ runner, platform: 'win32' }).preflight();
      expect(directories[0]?.length).toBeGreaterThan(258);
      expect(facts).toMatchObject({
        state: 'unknown',
        problems: [
          'Claude CLI could not be started (ENOENT) from its temporary check folder, whose path (from TEMP or TMP) is longer than the 258 characters Windows allows for a working directory. Check that the Claude CLI starts and responds, then retry preflight.',
        ],
      });
    } finally {
      vi.unstubAllEnvs();
      await probeFs.rm(root, { recursive: true, force: true });
    }
  });
});

// Controlled runner seam: each case scripts the runner's documented result for one check, so no
// native pipe fault, owner CLI, provider or model turn is involved (#364).
describe('Claude lost check output and help-only check failures (#364)', () => {
  const CHECK = 'Check that the Claude CLI starts and responds, then retry preflight.';
  const UPDATE = 'Update the Claude CLI, then retry preflight.';
  const UNREADABLE = 'Claude CLI check output could not be read.';
  const VERSIONED = 'Claude CLI 2.1.285 failed the --max-turns/--help check.';
  // Truncated bodies: the first matches the sign-in classifier's `authenticat` wording.
  const AUTH_BODY =
    '{"authMethod":"claude.ai","email":"authentication+CANARY_364_AUTH_BODY@example.invalid';
  const NEUTRAL_BODY = '{"authMethod":"claude.ai","email":"CANARY_364_AUTH_BODY';
  const HELP_BODY = '--safe-mode --restricted CANARY_364_HELP_BODY';
  const refusal = (extra: Partial<ClaudeProcessResult> = {}) =>
    outcome('', { exitCode: null, spawnCode: 'ENOENT', ...extra });
  /** Version always passes; help and sign-in pass unless a case supplies their result. */
  function checks(results: { help?: ClaudeProcessResult; auth?: ClaudeProcessResult }) {
    const calls: ClaudeProcessRequest[] = [];
    const runner: ClaudeCliRunner = async (command, onStdout) => {
      await Promise.resolve();
      calls.push(command);
      if (command.args.includes('--version')) return outcome('2.1.285 (Claude Code)');
      if (command.args.includes('--help')) return results.help ?? outcome(help);
      if (command.args.includes('auth'))
        return results.auth ?? outcome('{"authMethod":"claude.ai"}');
      for (const record of [init, final]) onStdout?.(Buffer.from(JSON.stringify(record) + '\n'));
      return outcome();
    };
    const harness = new ClaudeHarness({
      runner,
      platform: 'win32',
      binary: 'CANARY_364_BINARY/claude.exe',
    });
    return { calls, harness };
  }
  /** The turn's own readiness check refuses it: one unsubmitted error and no turn process. */
  async function refusedTurn(
    harness: ClaudeHarness,
    calls: ClaudeProcessRequest[],
    failure: { code: string; message: string; retriable: boolean },
  ) {
    const session = harness.start(
      { ...request, turn: { prompt: 'CANARY_364_PROMPT' } },
      new AbortController().signal,
    );
    const events = await drain(session.events);
    await expect(session.result).rejects.toMatchObject(failure);
    expect(events).toEqual([{ type: 'error', ...failure, submission: 'definitely-not-submitted' }]);
    expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
    return events;
  }
  /** No canary, binary, check-folder name or path reaches a public value. */
  function expectPrivate(value: unknown, calls: ClaudeProcessRequest[]) {
    const text = JSON.stringify(value);
    const folders = [...new Set(calls.map((call) => call.cwd))];
    expect(folders.length).toBeGreaterThan(0);
    for (const fragment of ['CANARY_364', ...folders, ...folders.map((path) => basename(path))]) {
      expect(text).not.toContain(fragment);
      expect(text).not.toContain(JSON.stringify(fragment).slice(1, -1));
    }
  }

  it.each([
    ['auth-like partial stdout', 1, AUTH_BODY, {}],
    ['auth-like partial stdout', null, AUTH_BODY, {}],
    ['recognised auth stderr', 1, NEUTRAL_BODY, { failureState: 'auth' }],
    ['recognised auth stderr', null, NEUTRAL_BODY, { failureState: 'auth' }],
    ['recognised quota stderr', 1, '', { failureState: 'quota' }],
    ['recognised transport stderr', null, '', { failureState: 'transport' }],
    ['explicit sign-out text', 1, '{"loggedIn":false', { notLoggedIn: true }],
  ] as const)(
    'keeps a lost sign-in check output unknown despite %s at exit %s',
    async (_case, exitCode, stdout, evidence) => {
      const { harness, calls } = checks({
        auth: outcome(stdout, { exitCode, outputFailed: true, ...evidence }),
      });
      const facts = await harness.preflight();
      expect(facts).toMatchObject({
        state: 'unknown',
        ok: false,
        version: '2.1.285',
        authMethod: null,
        problems: [`${UNREADABLE} ${CHECK}`],
      });
      expect(facts).not.toHaveProperty('authenticated');
      const events = await refusedTurn(harness, calls, {
        code: 'HARNESS_TURN_FAILED',
        message: UNREADABLE,
        retriable: false,
      });
      expectPrivate([facts, events], calls);
    },
  );
  it.each([
    [
      'structured sign-out',
      outcome('{"loggedIn":false,"authMethod":"none"}', { exitCode: 1 }),
      'Claude is not signed in.',
    ],
    [
      'recognised auth stderr',
      outcome('', { exitCode: 1, failureState: 'auth' }),
      'Claude sign-in is missing or invalid.',
    ],
    [
      'auth-like stdout',
      outcome(AUTH_BODY, { exitCode: 1 }),
      'Claude sign-in is missing or invalid.',
    ],
  ] as const)('keeps a completed sign-in check with %s signed out', async (_case, auth, detail) => {
    const { harness, calls } = checks({ auth });
    expect(await harness.preflight()).toMatchObject({
      state: 'auth',
      ok: false,
      authenticated: false,
      authMethod: null,
      problems: [`${detail} Run claude auth login, then retry preflight.`],
    });
    await refusedTurn(harness, calls, {
      code: 'HARNESS_NOT_AUTHENTICATED',
      message: detail,
      retriable: false,
    });
  });
  const stronger = [
    [
      'HARNESS_TERMINATION_UNCONFIRMED',
      { terminationUnconfirmed: true },
      'Claude CLI check process did not confirm that it stopped.',
    ],
    ['HARNESS_TIMEOUT', { timedOut: true }, 'Claude CLI did not answer before the check deadline.'],
    [
      'HARNESS_OUTPUT_LIMIT',
      { overflow: true },
      'Claude CLI printed more output than the check accepts.',
    ],
  ] as const;
  it.each(
    (['help', 'auth'] as const).flatMap((check) =>
      stronger.map(([code, fault, detail]) => [check, code, fault, detail] as const),
    ),
  )('keeps the %s check %s ahead of its lost output', async (check, code, fault, detail) => {
    const lost = outcome(check === 'help' ? HELP_BODY : AUTH_BODY, {
      exitCode: null,
      outputFailed: true,
      failureState: check === 'help' ? 'cli-incompatible' : 'auth',
      ...fault,
    });
    const { harness, calls } = checks(check === 'help' ? { help: lost } : { auth: lost });
    const facts = await harness.preflight();
    expect(facts).toMatchObject({ state: 'unknown', ok: false, problems: [`${detail} ${CHECK}`] });
    if (check === 'help') expect(facts).toMatchObject({ authenticated: true });
    else expect(facts).not.toHaveProperty('authenticated');
    const session = harness.start(request, new AbortController().signal);
    await expect(session.result).rejects.toMatchObject({ code, message: detail });
    expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
  });
  it.each(['help', 'auth'] as const)(
    'keeps cancellation ahead of a lost %s check output',
    async (check) => {
      const affected = check === 'help' ? '--help' : 'auth';
      const calls: ClaudeProcessRequest[] = [];
      const runner: ClaudeCliRunner = async (command) => {
        calls.push(command);
        if (command.args.includes('--version')) return outcome('2.1.285');
        if (!command.args.includes(affected))
          return outcome(command.args.includes('--help') ? help : '{"authMethod":"claude.ai"}');
        return await new Promise((resolve) =>
          command.signal.addEventListener(
            'abort',
            () =>
              resolve(
                outcome(check === 'help' ? HELP_BODY : AUTH_BODY, {
                  exitCode: null,
                  aborted: true,
                  outputFailed: true,
                  failureState: check === 'help' ? 'cli-incompatible' : 'auth',
                }),
              ),
            { once: true },
          ),
        );
      };
      const session = new ClaudeHarness({ runner, platform: 'win32' }).start(
        request,
        new AbortController().signal,
      );
      await vi.waitFor(() => expect(calls.some((call) => call.args.includes(affected))).toBe(true));
      await session.cancel();
      await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
      expect(await drain(session.events)).toEqual([]);
      expect(calls.some((call) => call.args.includes('--print'))).toBe(false);
    },
  );
  it.each([
    [
      'a missing check folder',
      refusal({ startRefusal: 'working-directory-missing' }),
      'Claude CLI could not be started because its temporary check folder does not exist.',
    ],
    [
      'a check folder that is not a folder',
      refusal({ startRefusal: 'working-directory-not-directory' }),
      'Claude CLI could not be started because its temporary check folder is not a folder.',
    ],
    ['an unexplained ENOENT refusal', refusal(), 'Claude CLI could not be started (ENOENT).'],
    [
      'an unexplained EACCES refusal',
      refusal({ spawnCode: 'EACCES' }),
      'Claude CLI could not be started (EACCES).',
    ],
    ['lost output at exit 0', outcome(HELP_BODY, { outputFailed: true }), UNREADABLE],
    [
      'lost output with an unknown-option diagnosis at exit 1',
      outcome(HELP_BODY, { exitCode: 1, outputFailed: true, failureState: 'cli-incompatible' }),
      UNREADABLE,
    ],
    [
      'lost output without an exit code',
      outcome(HELP_BODY, { exitCode: null, outputFailed: true }),
      UNREADABLE,
    ],
  ] as const)(
    'keeps %s when only the help check fails after the version check passed',
    async (_case, helpResult, detail) => {
      const { harness, calls } = checks({ help: helpResult });
      const facts = await harness.preflight();
      expect(facts).toMatchObject({
        state: 'unknown',
        ok: false,
        version: '2.1.285',
        authenticated: true,
        authMethod: 'claude.ai',
        problems: [`${detail} ${CHECK}`],
      });
      expect(calls.filter((call) => call.args.includes('auth'))).toHaveLength(1);
      const events = await refusedTurn(harness, calls, {
        code: 'HARNESS_TURN_FAILED',
        message: detail,
        retriable: false,
      });
      expectPrivate([facts, events], calls);
    },
  );
  it.each([
    [
      'exits with code 1',
      outcome(HELP_BODY, { exitCode: 1 }),
      'unknown',
      'HARNESS_TURN_FAILED',
      VERSIONED,
      CHECK,
    ],
    [
      'stops without an exit code',
      outcome('', { exitCode: null }),
      'unknown',
      'HARNESS_TURN_FAILED',
      VERSIONED,
      CHECK,
    ],
    [
      'cannot receive its input',
      outcome(help, { stdinFailed: true }),
      'unknown',
      'HARNESS_TURN_FAILED',
      VERSIONED,
      CHECK,
    ],
    [
      'reports an unknown option',
      outcome('', { exitCode: 1, failureState: 'cli-incompatible' }),
      'cli-incompatible',
      'HARNESS_CLI_INCOMPATIBLE',
      VERSIONED,
      UPDATE,
    ],
    [
      'lacks a required option',
      outcome(help.replace('--restricted ', '')),
      'cli-incompatible',
      'HARNESS_UNSUPPORTED_POLICY',
      'Claude CLI 2.1.285 does not list required options: --restricted.',
      UPDATE,
    ],
  ] as const)(
    'keeps the version-named guidance when the option check %s',
    async (_case, helpResult, state, code, detail, action) => {
      const { harness, calls } = checks({ help: helpResult });
      expect(await harness.preflight()).toMatchObject({
        state,
        ok: false,
        version: '2.1.285',
        authenticated: true,
        problems: [`${detail} ${action}`],
      });
      await refusedTurn(harness, calls, { code, message: detail, retriable: false });
    },
  );
});
