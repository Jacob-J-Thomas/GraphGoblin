import type { HarnessEvent, HarnessSession, HarnessStartRequest } from '@graphgoblin/engine';
import { describe, expect, it, vi } from 'vitest';
import { ReplayCodex, loadFixture } from './__fixtures__/replay.js';
import { createCodexAdapters } from './adapters.js';
import type { CliRunner } from './cli.js';
import { CodexHarness, createCodexHarness, type CodexClientFactory } from './harness.js';

const request = (overrides: Partial<HarnessStartRequest> = {}): HarnessStartRequest => ({
  workingDirectory: '/work',
  options: { sandbox: 'workspace-write', approval: 'never' },
  turn: { prompt: 'Reply with OK.' },
  ...overrides,
});

async function drain(session: HarnessSession): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const event of session.events) out.push(event);
  return out;
}

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** A complete Codex SDK usage object with every counter but `input_tokens` at zero. */
function codexUsage(inputTokens: number) {
  return {
    input_tokens: inputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

describe('CodexHarness.start', () => {
  it.each(
    [false, true].flatMap((retriable) =>
      (['sync', 'promise', 'iterator'] as const).map((boundary) => ({ retriable, boundary })),
    ),
  )(
    'preserves typed missing-session metadata at $boundary with retriable=$retriable',
    async ({ retriable, boundary }) => {
      const error = Object.assign(new Error('Recorded conversation no longer exists'), {
        code: 'HARNESS_SESSION_MISSING',
        retriable,
      });
      const harness = new CodexHarness({
        clientFactory: () => ({
          startThread: () => {
            throw new Error('Expected resume');
          },
          resumeThread: () => {
            if (boundary === 'sync') throw error;
            return {
              runStreamed: () =>
                boundary === 'promise'
                  ? Promise.reject(error)
                  : Promise.resolve({
                      events: (async function* () {
                        yield await Promise.reject(error);
                      })(),
                    }),
            };
          },
        }),
      });
      if (boundary === 'sync') {
        expect(() => harness.resume('missing-id', request(), new AbortController().signal)).toThrow(
          error,
        );
        return;
      }
      const session = harness.resume('missing-id', request(), new AbortController().signal);
      const events = await drain(session);
      expect(events.filter((event) => event.type === 'session')).toEqual([]);
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'HARNESS_SESSION_MISSING',
        submission: 'session-missing',
        retriable,
      });
      await expect(session.result).rejects.toMatchObject({
        code: 'HARNESS_SESSION_MISSING',
        retriable,
      });
    },
  );

  it('replays a message turn: session first, items, usage, turn-complete, result', async () => {
    const codex = ReplayCodex.fromFixtures('message');
    const harness = createCodexHarness({ clientFactory: codex.factory });
    expect(harness.id).toBe('codex');
    const session = harness.start(request(), new AbortController().signal);
    const events = await drain(session);
    const threadId = loadFixture('message').events[0] as { thread_id: string };
    expect(events.map((e) => e.type)).toEqual([
      'session',
      'item',
      'submitted',
      'item',
      'usage',
      'turn-complete',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: threadId.thread_id, mode: 'fresh' });
    await expect(session.sessionId).resolves.toBe(threadId.thread_id);
    const result = await session.result;
    expect(result.finalText).toBe('OK');
    expect(result.structured).toBeUndefined();
    expect(result.items.map((i) => i.type)).toEqual(['error', 'message']);
    expect(result.usage).toEqual({
      inputTokens: 16122,
      cachedInputTokens: 1792,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    });
  });

  it('sets every behaviour-affecting option explicitly on the thread', async () => {
    const codex = ReplayCodex.fromFixtures('message', 'message');
    const harness = new CodexHarness({
      clientFactory: codex.factory,
      codexBinary: '/opt/codex',
      env: { PATH: '/bin' },
    });
    await harness.start(request(), new AbortController().signal).result;
    expect(codex.runs[0]?.threadOptions).toEqual({
      model: 'gpt-6-luna',
      modelReasoningEffort: 'low',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      workingDirectory: '/work',
    });
    // ADR-0063: the machine's plugins, apps, memories, hooks and notify program are switched off.
    expect(codex.runs[0]?.clientOptions).toEqual({
      codexPathOverride: '/opt/codex',
      env: { PATH: '/bin' },
      config: {
        features: { plugins: false, apps: false, memories: false, hooks: false },
        notify: [],
      },
    });
    expect(codex.runs[0]?.input).toBe('Reply with OK.');
    expect(codex.runs[0]?.turnOptions?.outputSchema).toBeUndefined();

    await harness.start(
      request({
        model: 'gpt-6.1-sol',
        effort: 'max',
        options: {
          sandbox: 'danger-full-access',
          approval: 'on-request',
          networkAccess: true,
          webSearch: true,
          configOverrides: {
            'mcp_servers.docs': { command: 'npx', args: ['docs-mcp'] },
            'features.memories': true,
            notify: ['notify.exe'],
            dropped: null,
            nan: Number.NaN,
            fn: () => 1,
            list: [1, null, 'a'],
            table: { kept: 1 },
            'table.added': { nested: 2 },
            'table.added.more': 3,
            scalar: 1,
            'scalar.child': 4,
          },
        },
      }),
      new AbortController().signal,
    ).result;
    expect(codex.runs[1]?.threadOptions).toMatchObject({
      model: 'gpt-6.1-sol',
      modelReasoningEffort: 'max',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-request',
      networkAccessEnabled: true,
      webSearchMode: 'live',
    });
    // Node overrides layer over the isolation defaults key path by key path; dotted keys are
    // paths, as the CLI reads every `--config` key.
    expect(codex.runs[1]?.clientOptions.config).toEqual({
      features: { plugins: false, apps: false, memories: true, hooks: false },
      notify: ['notify.exe'],
      mcp_servers: { docs: { command: 'npx', args: ['docs-mcp'] } },
      list: [1, 'a'],
      table: { kept: 1, added: { nested: 2, more: 3 } },
      scalar: { child: 4 },
    });
  });

  it('replays command and file-change items', async () => {
    const codex = ReplayCodex.fromFixtures('command-and-file-change');
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const session = harness.start(request(), new AbortController().signal);
    const types = (await drain(session)).map((e) => (e.type === 'item' ? e.item.type : e.type));
    expect(types).toEqual([
      'session',
      'error',
      'submitted',
      'command',
      'file-change',
      'message',
      'usage',
      'turn-complete',
    ]);
    expect((await session.result).finalText).toBe('DONE');
  });

  it('parses the final message as structured output when a schema was given', async () => {
    const codex = ReplayCodex.fromFixtures('structured', 'message');
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const schema = { type: 'object' };
    const result = await harness.start(
      request({ turn: { prompt: 'decide', outputSchema: schema } }),
      new AbortController().signal,
    ).result;
    expect(codex.runs[0]?.turnOptions?.outputSchema).toBe(schema);
    expect(result.structured).toMatchObject({ route: 'approve', confidence: 0.98 });

    // Non-JSON text with a schema leaves `structured` unset for the engine to repair.
    const plain = await harness.start(
      request({ turn: { prompt: 'x', outputSchema: schema } }),
      new AbortController().signal,
    ).result;
    expect(plain.structured).toBeUndefined();
    expect(plain.finalText).toBe('OK');
  });

  it('reports a failed turn as an error event and rejects the result with a code', async () => {
    const codex = ReplayCodex.fromFixtures('failed-invalid-model');
    const log = logger();
    const harness = new CodexHarness({ clientFactory: codex.factory, logger: log });
    const session = harness.start(request(), new AbortController().signal);
    const events = await drain(session);
    expect(events.map((e) => e.type)).toEqual(['session', 'item', 'item', 'submitted', 'error']);
    // The provider's own refusal survives the CLI's exit error that follows it (#243).
    const refusal = {
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message:
        "The provider refused the request (HTTP 400): The 'gpt-graphgoblin-does-not-exist' model is not supported when using Codex with a ChatGPT account.",
      retriable: false,
    };
    expect(events.at(-1)).toMatchObject({ type: 'error', ...refusal });
    await expect(session.result).rejects.toMatchObject(refusal);
    await expect(session.sessionId).resolves.toMatch(/^01a0/);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('rejects the session id too when the CLI fails before reporting a thread', async () => {
    const codex = new ReplayCodex({
      events: [],
      throwOnStart: new Error('spawn C:\\codex.exe ENOENT'),
    });
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const session = harness.start(request(), new AbortController().signal);
    const events = await drain(session);
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'HARNESS_NOT_INSTALLED' }),
    ]);
    await expect(session.sessionId).rejects.toThrow(/ENOENT/);
    await expect(session.result).rejects.toThrow(/ENOENT/);
  });

  it('classifies a thrown exit with no turn events as a failure', async () => {
    const codex = new ReplayCodex({
      events: [{ type: 'thread.started', thread_id: 't1' }],
      exitCode: 1,
    });
    const session = new CodexHarness({ clientFactory: codex.factory }).start(
      request(),
      new AbortController().signal,
    );
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      message: expect.stringMatching(/exited with code 1/),
    });
  });

  it('logs and ignores capability slugs it cannot resolve yet', async () => {
    const codex = ReplayCodex.fromFixtures('message');
    const log = logger();
    const harness = new CodexHarness({ clientFactory: codex.factory, logger: log });
    await harness.start(
      request({ capabilities: { skills: ['review'] } }),
      new AbortController().signal,
    ).result;
    expect(log.debug).toHaveBeenCalledOnce();
  });
});

describe('CodexHarness.resume', () => {
  it('confirms native session identity and passes the node settings to resumeThread', async () => {
    const codex = ReplayCodex.fromFixtures('message', 'message');
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const settings = {
      model: 'gpt-6-astra',
      effort: 'high',
      workingDirectory: '/proj',
      options: {
        sandbox: 'read-only',
        approval: 'on-request',
        networkAccess: true,
        webSearch: true,
      },
    } as const;
    const first = harness.start(request(settings), new AbortController().signal);
    const id = await first.sessionId;
    await first.result;

    const resumed = harness.resume(
      id,
      request({ ...settings, turn: { prompt: 'again' } }),
      new AbortController().signal,
    );
    await expect(resumed.sessionId).resolves.toBe(id);
    const events = await drain(resumed);
    // The fixture's own thread.started repeats the id; it is not announced twice.
    expect(events.find((event) => event.type === 'session')).toEqual({
      type: 'session',
      sessionId: id,
      mode: 'resumed',
    });
    expect(events.filter((e) => e.type === 'session')).toHaveLength(1);
    expect(codex.runs[1]).toMatchObject({ kind: 'resume', threadId: id, input: 'again' });
    // resumeThread receives exactly the options startThread received.
    expect(codex.runs[1]?.threadOptions).toEqual(codex.runs[0]?.threadOptions);
    expect(codex.runs[1]?.threadOptions).toEqual({
      model: 'gpt-6-astra',
      modelReasoningEffort: 'high',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request',
      networkAccessEnabled: true,
      webSearchMode: 'live',
      skipGitRepoCheck: true,
      workingDirectory: '/proj',
    });
  });

  it('rejects a different native session instead of claiming reuse', async () => {
    const codex = new ReplayCodex(
      {
        events: [
          { type: 'thread.started', thread_id: 'other' },
          { type: 'turn.completed', usage: codexUsage(1) },
        ],
      },
      { events: [{ type: 'turn.completed', usage: codexUsage(0) }] },
    );
    const harness = new CodexHarness({
      clientFactory: codex.factory,
      model: 'gpt-6-sol',
      effort: 'medium',
    });
    const session = harness.resume(
      'abc',
      {
        workingDirectory: '/w',
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'go' },
      },
      new AbortController().signal,
    );
    const sessions = (await drain(session)).filter((e) => e.type === 'session');
    expect(sessions).toEqual([]);
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_SESSION_MISSING' });
    // Model and effort fall back to the harness defaults when the request names none.
    expect(codex.runs[0]?.threadOptions).toEqual({
      model: 'gpt-6-sol',
      modelReasoningEffort: 'medium',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      workingDirectory: '/w',
    });
  });
});

describe('cancellation', () => {
  it('preserves typed unconfirmed termination when cancellation is in flight', async () => {
    const controller = new AbortController();
    const harness = new CodexHarness({
      clientFactory: () => ({
        startThread: () => ({
          runStreamed: () => {
            controller.abort();
            return Promise.reject(
              Object.assign(new Error('Process still alive'), {
                code: 'HARNESS_TERMINATION_UNCONFIRMED',
                retriable: false,
              }),
            );
          },
        }),
        resumeThread: () => {
          throw new Error('Expected start');
        },
      }),
    });
    const session = harness.start(request(), controller.signal);
    expect((await drain(session)).at(-1)).toMatchObject({
      code: 'HARNESS_TERMINATION_UNCONFIRMED',
      submission: 'delivery-uncertain',
    });
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED' });
  });
  it('aborts the SDK call when the caller signal fires and rejects with an AbortError', async () => {
    const codex = new ReplayCodex({
      events: loadFixture('command-and-file-change').events,
      hangAfter: 3,
    });
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const controller = new AbortController();
    const session = harness.start(request(), controller.signal);
    const seen: HarnessEvent[] = [];
    for await (const event of session.events) {
      seen.push(event);
      if (event.type === 'item' && event.item.type === 'error') controller.abort();
    }
    expect(seen.some((e) => e.type === 'error')).toBe(false);
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(codex.runs[0]?.turnOptions?.signal?.aborted).toBe(true);
  });

  it('cancel() aborts and waits for the turn to settle', async () => {
    const codex = new ReplayCodex({ events: loadFixture('message').events, hangAfter: 1 });
    const session = new CodexHarness({ clientFactory: codex.factory }).start(
      request(),
      new AbortController().signal,
    );
    await session.sessionId;
    await session.cancel();
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    await session.cancel(); // idempotent once settled
  });

  it('cancel() reports unconfirmed termination when the turn does not end within the grace period', async () => {
    const stuck: CodexClientFactory = () => ({
      startThread: () => ({
        runStreamed: () => new Promise(() => {}),
      }),
      resumeThread: () => {
        throw new Error('unused');
      },
    });
    const log = logger();
    const session = new CodexHarness({
      clientFactory: stuck,
      cancelGraceMs: 10,
      logger: log,
    }).start(request(), new AbortController().signal);
    await expect(session.cancel()).rejects.toMatchObject({
      code: 'HARNESS_TERMINATION_UNCONFIRMED',
      retriable: false,
    });
    expect((await drain(session)).at(-1)).toMatchObject({
      type: 'error',
      code: 'HARNESS_TERMINATION_UNCONFIRMED',
      submission: 'delivery-uncertain',
    });
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HARNESS_TERMINATION_UNCONFIRMED', retriable: false }),
      expect.stringMatching(/termination was not confirmed/),
    );
  });

  it('stops waiting for an event stream that outlives an abort, even one it cannot close', async () => {
    const accepted = loadFixture('message').events.slice(0, 1);
    const factory: CodexClientFactory = () => ({
      startThread: () => ({
        runStreamed: () => {
          let index = 0;
          // An iterator without `return`: after the accepted events it never settles again.
          const events: AsyncIterable<{ type: string }> = {
            [Symbol.asyncIterator]: () => ({
              next: () =>
                index < accepted.length
                  ? Promise.resolve({ done: false as const, value: accepted[index++]! })
                  : new Promise<never>(() => {}),
            }),
          };
          return Promise.resolve({ events });
        },
      }),
      resumeThread: () => {
        throw new Error('unused');
      },
    });
    const controller = new AbortController();
    const session = new CodexHarness({ clientFactory: factory, cancelGraceMs: 10 }).start(
      request(),
      controller.signal,
    );
    await session.sessionId;
    controller.abort();
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TERMINATION_UNCONFIRMED' });
  });

  it('cancel() after a completed turn has nothing to stop', async () => {
    const session = new CodexHarness({
      clientFactory: ReplayCodex.fromFixtures('message').factory,
      cancelGraceMs: 10,
    }).start(request(), new AbortController().signal);
    await expect(session.result).resolves.toMatchObject({ finalText: 'OK' });
    await expect(session.cancel()).resolves.toBeUndefined();
  });

  it('never starts the CLI for an already-aborted signal', async () => {
    const codex = ReplayCodex.fromFixtures('message');
    const controller = new AbortController();
    controller.abort();
    const session = new CodexHarness({ clientFactory: codex.factory }).start(
      request(),
      controller.signal,
    );
    expect(await drain(session)).toEqual([]);
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
    await expect(session.sessionId).rejects.toMatchObject({ name: 'AbortError' });
    expect(codex.runs[0]?.input).toBeUndefined();
  });

  it('aborts when the signal fires between events', async () => {
    const codex = new ReplayCodex({ events: loadFixture('message').events, delayMs: 20 });
    const controller = new AbortController();
    const session = new CodexHarness({ clientFactory: codex.factory }).start(
      request(),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 30);
    await expect(session.result).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('preflight', () => {
  const runner =
    (responses: Record<string, Omit<Awaited<ReturnType<CliRunner>>, 'stdout'>>): CliRunner =>
    (_cli, args) => {
      const response =
        responses[args.join(' ')] ??
        (args.includes('--help')
          ? {
              code: 0,
              output:
                '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
            }
          : { code: 1, output: '' });
      return Promise.resolve({ ...response, stdout: response.output });
    };

  it('reports version and login for a healthy install', async () => {
    const harness = new CodexHarness({
      codexBinary: 'C:/tools/codex.exe',
      cliRunner: runner({
        '--version': { code: 0, output: 'codex-cli 0.160.0\n' },
        'login status': { code: 0, output: 'Logged in using ChatGPT\n' },
      }),
    });
    expect(await harness.preflight()).toEqual({
      state: 'ready',
      ok: true,
      version: '0.160.0',
      authenticated: true,
      problems: [],
    });
  });

  it('reports a logged-out CLI as a problem', async () => {
    const harness = new CodexHarness({
      cliRunner: runner({
        '--version': { code: 0, output: 'codex-cli 0.160.0' },
        'login status': { code: 1, output: 'Not logged in' },
      }),
    });
    const result = await harness.preflight();
    expect(result).toMatchObject({
      state: 'auth',
      ok: false,
      version: '0.160.0',
      authenticated: false,
    });
    expect(result.problems[0]).toMatch(/codex login/);
  });

  it('reports a login status call that could not run', async () => {
    const harness = new CodexHarness({
      cliRunner: runner({
        '--version': { code: 0, output: 'codex-cli 1.2.3' },
        'login status': { code: null, output: '', spawnError: 'timed out after 10 ms' },
      }),
    });
    expect(await harness.preflight()).toMatchObject({
      state: 'unknown',
      ok: false,
      problems: [
        'Codex readiness could not be confirmed. Check that the Codex CLI starts and responds, then retry preflight.',
      ],
    });
  });

  it('reports a missing binary without throwing', async () => {
    const harness = new CodexHarness({
      codexBinary: 'C:/missing/codex.exe',
      cliRunner: runner({ '--version': { code: null, output: '', spawnError: 'spawn ENOENT' } }),
    });
    const result = await harness.preflight();
    expect(result).toMatchObject({ state: 'cli-missing', ok: false });
    expect(result).not.toHaveProperty('authenticated');
    const failing = new CodexHarness({
      codexBinary: 'codex.mjs',
      cliRunner: runner({ '--version': { code: 2, output: '' } }),
    });
    expect((await failing.preflight()).problems[0]).toMatch(/could not be confirmed/);
    const noisy = new CodexHarness({
      cliRunner: runner({ '--version': { code: 2, output: 'bad flag' } }),
    });
    expect((await noisy.preflight()).problems[0]).toMatch(/could not be confirmed/);
  });

  it('turns an unexpected runner failure into a problem', async () => {
    const harness = new CodexHarness({ cliRunner: () => Promise.reject(new Error('boom')) });
    expect(await harness.preflight()).toEqual({
      state: 'unknown',
      ok: false,
      problems: [expect.stringMatching(/could not be confirmed/)],
    });
  });
});

describe('createCodexAdapters', () => {
  it('wires the harness, structured port, and decider together', () => {
    const adapters = createCodexAdapters({ model: 'm', structured: { workingDirectory: '/tmp' } });
    expect(adapters.harness.id).toBe('codex');
    expect(adapters.decider.id).toBe('codex');
    expect(adapters.decider.available()).toBe(true);
    expect(createCodexAdapters().structured).toBeDefined();
  });

  it('is lazy: nothing is spawned until a session starts', async () => {
    const codex = ReplayCodex.fromFixtures('message');
    const factory = vi.fn(codex.factory);
    const cliRunner = vi.fn<CliRunner>();
    const adapters = createCodexAdapters({ clientFactory: factory, cliRunner });
    expect(adapters.decider.available()).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(cliRunner).not.toHaveBeenCalled();
    await adapters.harness.start(request(), new AbortController().signal).result;
    expect(factory).toHaveBeenCalledOnce();
    expect(cliRunner).not.toHaveBeenCalled();
  });
});

it('does not record reuse when native initialization precedes a missing-session refusal', async () => {
  const harness = new CodexHarness({
    clientFactory: () => ({
      startThread: () => {
        throw new Error('Expected resume');
      },
      resumeThread: () => ({
        runStreamed: () =>
          Promise.resolve({
            events: (async function* () {
              yield await Promise.resolve({ type: 'thread.started', thread_id: 'removed-handle' });
              yield {
                type: 'turn.failed',
                error: { message: 'No rollout found with session id removed-handle' },
              };
            })(),
          }),
      }),
    }),
  });
  const session = harness.resume('removed-handle', request(), new AbortController().signal);
  const events = await drain(session);
  expect(events.filter((event) => event.type === 'session')).toEqual([]);
  await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_SESSION_MISSING' });
});
