import type { HarnessEvent, HarnessSession, HarnessStartRequest } from '@graphgoblin/engine';
import { describe, expect, it, vi } from 'vitest';
import { ReplayCodex, loadFixture } from './__fixtures__/replay.js';
import { createCodexAdapters } from './adapters.js';
import type { CliRunner } from './cli.js';
import { CodexHarness, createCodexHarness, type CodexClientFactory } from './harness.js';
import { mapEffort } from './options.js';

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

describe('CodexHarness.start', () => {
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
    expect(codex.runs[0]?.clientOptions).toEqual({
      codexPathOverride: '/opt/codex',
      env: { PATH: '/bin' },
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
            dropped: null,
            nan: Number.NaN,
            fn: () => 1,
            list: [1, null, 'a'],
          },
        },
      }),
      new AbortController().signal,
    ).result;
    expect(codex.runs[1]?.threadOptions).toMatchObject({
      model: 'gpt-6.1-sol',
      modelReasoningEffort: 'xhigh',
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'on-request',
      networkAccessEnabled: true,
      webSearchMode: 'live',
    });
    expect(codex.runs[1]?.clientOptions.config).toEqual({
      'mcp_servers.docs': { command: 'npx', args: ['docs-mcp'] },
      list: [1, 'a'],
    });
  });

  it('maps the canonical effort scale onto Codex levels', () => {
    expect(
      ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((e) => mapEffort(e as never)),
    ).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'xhigh']);
  });

  it('replays command and file-change items', async () => {
    const codex = ReplayCodex.fromFixtures('command-and-file-change');
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const session = harness.start(request(), new AbortController().signal);
    const types = (await drain(session)).map((e) => (e.type === 'item' ? e.item.type : e.type));
    expect(types).toEqual([
      'session',
      'error',
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
    expect(events.map((e) => e.type)).toEqual(['session', 'item', 'item', 'error']);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'HARNESS_TURN_FAILED',
      retriable: false,
    });
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_TURN_FAILED' });
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
  it('announces the known session id at once and reuses the start settings', async () => {
    const codex = ReplayCodex.fromFixtures('message', 'message');
    const harness = new CodexHarness({ clientFactory: codex.factory });
    const first = harness.start(
      request({ model: 'gpt-6-astra', effort: 'high', workingDirectory: '/proj' }),
      new AbortController().signal,
    );
    const id = await first.sessionId;
    await first.result;

    const resumed = harness.resume(id, { prompt: 'again' }, new AbortController().signal);
    await expect(resumed.sessionId).resolves.toBe(id);
    const events = await drain(resumed);
    // The fixture's own thread.started repeats the id; it is not announced twice.
    expect(events[0]).toEqual({ type: 'session', sessionId: id, mode: 'resumed' });
    expect(events.filter((e) => e.type === 'session')).toHaveLength(1);
    expect(codex.runs[1]).toMatchObject({
      kind: 'resume',
      threadId: id,
      threadOptions: {
        model: 'gpt-6-astra',
        modelReasoningEffort: 'high',
        workingDirectory: '/proj',
      },
    });
  });

  it('falls back to the configured resume options for a session it did not start', async () => {
    const codex = new ReplayCodex(
      {
        events: [
          { type: 'thread.started', thread_id: 'other' },
          { type: 'turn.completed', usage: { input_tokens: 1 } },
        ],
      },
      { events: [{ type: 'turn.completed', usage: {} }] },
    );
    const harness = new CodexHarness({
      clientFactory: codex.factory,
      model: 'gpt-6-sol',
      effort: 'medium',
      resumeOptions: { sandbox: 'read-only' },
    });
    const session = harness.resume('abc', { prompt: 'go' }, new AbortController().signal);
    const sessions = (await drain(session)).filter((e) => e.type === 'session');
    expect(sessions).toEqual([
      { type: 'session', sessionId: 'abc', mode: 'resumed' },
      { type: 'session', sessionId: 'other', mode: 'resumed' },
    ]);
    expect(codex.runs[0]?.threadOptions).toEqual({
      model: 'gpt-6-sol',
      modelReasoningEffort: 'medium',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
    });
    // `other` is now remembered with the fallback settings.
    await harness.resume('other', { prompt: 'x' }, new AbortController().signal).result;
    expect(codex.runs[1]?.threadOptions?.sandboxMode).toBe('read-only');
  });

  it('forgets the oldest remembered sessions beyond its bound', async () => {
    const scripts = Array.from({ length: 1001 }, (_, i) => ({
      events: [
        { type: 'thread.started', thread_id: `t${i}` },
        { type: 'turn.completed', usage: {} },
      ],
    }));
    const codex = new ReplayCodex(...scripts, { events: [] });
    const harness = new CodexHarness({ clientFactory: codex.factory });
    for (let i = 0; i < 1001; i += 1) {
      await harness.start(request({ model: 'remembered' }), new AbortController().signal).result;
    }
    harness.resume('t0', { prompt: 'x' }, new AbortController().signal).result.catch(() => {});
    expect(codex.runs.at(-1)?.threadOptions?.model).toBe('gpt-6-luna');
  });
});

describe('cancellation', () => {
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

  it('cancel() gives up waiting after the grace period', async () => {
    const stuck: CodexClientFactory = () => ({
      startThread: () => ({
        runStreamed: () => new Promise(() => {}),
      }),
      resumeThread: () => {
        throw new Error('unused');
      },
    });
    const session = new CodexHarness({ clientFactory: stuck, cancelGraceMs: 10 }).start(
      request(),
      new AbortController().signal,
    );
    await session.cancel();
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
    (responses: Record<string, Awaited<ReturnType<CliRunner>>>): CliRunner =>
    (_cli, args) =>
      Promise.resolve(responses[args.join(' ')] ?? { code: 1, output: '' });

  it('reports version and login for a healthy install', async () => {
    const harness = new CodexHarness({
      codexBinary: 'C:/tools/codex.exe',
      cliRunner: runner({
        '--version': { code: 0, output: 'codex-cli 0.160.0\n' },
        'login status': { code: 0, output: 'Logged in using ChatGPT\n' },
      }),
    });
    expect(await harness.preflight()).toEqual({
      ok: true,
      version: '0.160.0',
      authenticated: true,
      problems: [],
    });
  });

  it('reports a logged-out CLI as a problem', async () => {
    const harness = new CodexHarness({
      cliRunner: runner({
        '--version': { code: 0, output: 'codex dev' },
        'login status': { code: 1, output: 'Not logged in' },
      }),
    });
    const result = await harness.preflight();
    expect(result).toMatchObject({ ok: false, version: 'codex dev', authenticated: false });
    expect(result.problems[0]).toMatch(/not logged in/);
  });

  it('reports a login status call that could not run', async () => {
    const harness = new CodexHarness({
      cliRunner: runner({
        '--version': { code: 0, output: 'codex-cli 1.2.3' },
        'login status': { code: null, output: '', spawnError: 'timed out after 10 ms' },
      }),
    });
    expect((await harness.preflight()).problems).toEqual([
      'codex login status failed: timed out after 10 ms',
    ]);
  });

  it('reports a missing binary without throwing', async () => {
    const harness = new CodexHarness({
      codexBinary: 'C:/missing/codex.exe',
      cliRunner: runner({ '--version': { code: null, output: '', spawnError: 'spawn ENOENT' } }),
    });
    const result = await harness.preflight();
    expect(result).toEqual({
      ok: false,
      authenticated: false,
      problems: ['Codex CLI could not be run (C:/missing/codex.exe): spawn ENOENT'],
    });
    const failing = new CodexHarness({
      codexBinary: 'codex.mjs',
      cliRunner: runner({ '--version': { code: 2, output: '' } }),
    });
    expect((await failing.preflight()).problems[0]).toMatch(/exit 2$/);
    const noisy = new CodexHarness({
      cliRunner: runner({ '--version': { code: 2, output: 'bad flag' } }),
    });
    expect((await noisy.preflight()).problems[0]).toMatch(/bad flag$/);
  });

  it('turns an unexpected runner failure into a problem', async () => {
    const harness = new CodexHarness({ cliRunner: () => Promise.reject(new Error('boom')) });
    expect(await harness.preflight()).toEqual({
      ok: false,
      authenticated: false,
      problems: ['preflight failed: boom'],
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
});
