import { describe, expect, it } from 'vitest';
import { loadFixture } from './__fixtures__/replay.js';
import { TurnAccumulator, classifyCodexError, mapUsage, normalizeItem, oneLine } from './events.js';

describe('normalizeItem', () => {
  it('maps every Codex item type and summarises it on one line', () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ id: 'a', type: 'agent_message', text: 'Hello\n  world' }, 'message', 'Hello world'],
      [{ id: 'b', type: 'reasoning', text: 'thinking' }, 'reasoning', 'thinking'],
      [
        {
          id: 'c',
          type: 'command_execution',
          command: 'ls -la',
          aggregated_output: 'x',
          exit_code: 2,
          status: 'failed',
        },
        'command',
        'ls -la (exit 2)',
      ],
      [
        { id: 'c2', type: 'command_execution', command: 'sleep', aggregated_output: '' },
        'command',
        'sleep',
      ],
      [
        {
          id: 'd',
          type: 'file_change',
          changes: [
            { path: 'a.txt', kind: 'add' },
            { path: 'b.txt', kind: 'update' },
          ],
          status: 'completed',
        },
        'file-change',
        'add a.txt, update b.txt',
      ],
      [
        {
          id: 'd2',
          type: 'file_change',
          changes: [{ path: 'a', kind: 'delete' }],
          status: 'failed',
        },
        'file-change',
        'delete a (failed)',
      ],
      [{ id: 'd3', type: 'file_change' }, 'file-change', ''],
      [
        { id: 'e', type: 'mcp_tool_call', server: 'gh', tool: 'search', status: 'completed' },
        'tool-call',
        'gh.search',
      ],
      [
        {
          id: 'e2',
          type: 'mcp_tool_call',
          server: 'gh',
          tool: 'search',
          error: { message: 'boom' },
          status: 'failed',
        },
        'tool-call',
        'gh.search failed: boom',
      ],
      [
        { id: 'e3', type: 'mcp_tool_call', server: 'gh', tool: 'search', status: 'failed' },
        'tool-call',
        'gh.search',
      ],
      [{ id: 'f', type: 'web_search', query: 'codex sdk' }, 'search', 'codex sdk'],
      [{ id: 'g', type: 'error', message: 'deprecated key' }, 'error', 'deprecated key'],
      [
        {
          id: 'h',
          type: 'todo_list',
          items: [
            { text: 'a', completed: true },
            { text: 'b', completed: false },
          ],
        },
        'other',
        'todo list: 1/2 done',
      ],
      [{ id: 'h2', type: 'todo_list' }, 'other', 'todo list: 0/0 done'],
      [{ id: 'i', type: 'collab_tool_call' }, 'other', 'collab_tool_call'],
      [{ id: 'j', type: 'agent_message', text: 42 }, 'message', ''],
    ];
    for (const [raw, type, summary] of cases) {
      const item = normalizeItem(raw as never);
      expect(item.type).toBe(type);
      expect(item.summary).toBe(summary);
      expect(item.id).toBe(raw.id);
      expect(item.detail).toMatchObject({ id: raw.id });
      if (raw.type === 'command_execution' && raw.id === 'c') {
        expect(item).toMatchObject({ commandPreview: 'ls -la', exitCode: 2, status: 'failed' });
      }
      if (raw.type === 'command_execution' && raw.id === 'c2') {
        expect(item).toMatchObject({ commandPreview: 'sleep', status: 'running' });
      }
      if (raw.id === 'e3') expect(item).toMatchObject({ status: 'failed' });
      if (raw.id === 'd2') expect(item).toMatchObject({ status: 'failed' });
    }
  });

  it('caps long summaries and truncates large command output in the detail', () => {
    const item = normalizeItem({
      id: 'x',
      type: 'command_execution',
      command: 'y'.repeat(500),
      aggregated_output: 'z'.repeat(20_000),
      exit_code: -1,
      status: 'failed',
    });
    expect(item.summary).toHaveLength(200);
    expect(item.summary.endsWith('...')).toBe(true);
    expect(item.commandPreview).toHaveLength(160);
    expect(item.commandPreview?.endsWith('...')).toBe(true);
    expect(item.exitCode).toBe(-1);
    expect(item.status).toBe('failed');
    const detail = item.detail as { aggregated_output: string };
    expect(detail.aggregated_output.length).toBeLessThan(17_000);
    expect(detail.aggregated_output.endsWith('[truncated]')).toBe(true);
    expect(oneLine('  a \n b ')).toBe('a b');
  });
});

describe('mapUsage', () => {
  it('maps snake_case counters and zeroes anything missing or invalid', () => {
    expect(
      mapUsage({
        input_tokens: 10,
        cached_input_tokens: 4,
        cache_write_input_tokens: 1,
        output_tokens: 3,
        reasoning_output_tokens: 2,
      }),
    ).toEqual({ inputTokens: 10, cachedInputTokens: 4, outputTokens: 3, reasoningOutputTokens: 2 });
    expect(mapUsage({ input_tokens: -1, output_tokens: 'x', cached_input_tokens: 2.7 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 2,
      reasoningOutputTokens: 0,
    });
    expect(mapUsage(null)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });
});

describe('classifyCodexError', () => {
  it('uses native-message fallback for unknown metadata and defaults a missing retry hint to false', () => {
    expect(
      classifyCodexError({
        code: 'UNKNOWN',
        message: 'No rollout found with id abc',
        retriable: true,
      }),
    ).toMatchObject({ code: 'HARNESS_SESSION_MISSING', retriable: false });
    expect(
      classifyCodexError({
        code: 'HARNESS_SESSION_MISSING',
        message: 'Recorded conversation refused',
      }),
    ).toEqual({
      code: 'HARNESS_SESSION_MISSING',
      message: 'Recorded conversation refused',
      retriable: false,
    });
  });
  it('unwraps the JSON API error Codex reports and names the provider refusal', () => {
    const raw = loadFixture('failed-invalid-model').events.find((e) => e.type === 'turn.failed');
    const message = (raw as { error: { message: string } }).error.message;
    expect(classifyCodexError(message)).toEqual({
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message:
        "The provider refused the request (HTTP 400): The 'gpt-graphgoblin-does-not-exist' model is not supported when using Codex with a ChatGPT account.",
      retriable: false,
    });
  });

  it('classifies the provider refusal of a request parameter as a pinned argument refusal (#243)', () => {
    // The shape the real CLI reported for effort minimal on gpt-6-luna (F2 LP-5).
    const refusal = JSON.stringify({
      type: 'error',
      error: {
        message: "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model.",
        type: 'invalid_request_error',
        param: 'reasoning.effort',
        code: 'unsupported_value',
      },
      status: 400,
    });
    expect(classifyCodexError(refusal)).toEqual({
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message:
        "The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model.",
      retriable: false,
    });
    // Only an explicit invalid-request refusal is a refusal of the request; other errors keep
    // their existing classes.
    expect(
      classifyCodexError(
        JSON.stringify({ status: 404, error: { type: 'invalid_request_error', message: 'gone' } }),
      ),
    ).toEqual({ code: 'HARNESS_TURN_FAILED', message: 'gone', retriable: false });
    expect(
      classifyCodexError(JSON.stringify({ status: 400, error: { message: 'bad gateway text' } })),
    ).toEqual({ code: 'HARNESS_TURN_FAILED', message: 'bad gateway text', retriable: false });
  });

  // PR #426 review B2: the parsed status and type decide before any CLI-message heuristic.
  it.each([
    'Error: unexpected argument in reasoning.effort',
    'Error: unknown option reasoning.effort',
    "Error: invalid value for reasoning.effort: 'minimal'.",
    'No rollout found for this request.',
    'Session not found in referenced input.',
    'Session does not exist for this request.',
    'Thread not found in referenced input.',
    'Thread does not exist for this request.',
    'Failed to load session settings for this model.',
    'Failed to find rollout settings for this model.',
    'This would exceed the usage limit for the model.',
    'The quota for this parameter is fixed.',
    'The rate limit parameter is not supported.',
    'Too many requests in one batch.',
    'insufficient_quota is not a valid value.',
    'Not logged in users cannot set this value.',
    'Unauthorized value for reasoning.effort.',
    'Authentication parameters are not accepted here.',
    'login is not a valid value.',
    'Invalid API key format in metadata.',
    'Token has expired is not a valid value.',
    'ENOENT is not a valid value.',
    'not recognized as an internal value.',
    'unable to locate codex tool definition.',
    'stream disconnected is not a valid value.',
    'timed out is not a valid value.',
    'ECONNRESET is not a valid value.',
    'network is not a valid value.',
    'overloaded is not a valid value.',
    'temporarily unavailable is not a valid value.',
  ])('keeps a 400 invalid-request refusal saying %j a refusal with its text', (text) => {
    const refusal = JSON.stringify({
      type: 'error',
      error: { message: text, type: 'invalid_request_error', param: 'reasoning.effort' },
      status: 400,
    });
    expect(classifyCodexError(refusal)).toEqual({
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message: `The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
      retriable: false,
    });
    // Typed metadata keeps its earlier boundary.
    expect(
      classifyCodexError(
        Object.assign(new Error(refusal), { code: 'HARNESS_SESSION_MISSING', retriable: false }),
      ),
    ).toMatchObject({ code: 'HARNESS_SESSION_MISSING' });
  });

  it('classifies quota, rate limits, auth, missing binaries, and transient failures', () => {
    expect(classifyCodexError("You've hit your usage limit. Try again later.")).toMatchObject({
      code: 'HARNESS_QUOTA_EXHAUSTED',
      retriable: false,
    });
    expect(
      classifyCodexError(JSON.stringify({ status: 429, error: { message: 'slow down' } })),
    ).toMatchObject({ code: 'HARNESS_QUOTA_EXHAUSTED', retriable: true, message: 'slow down' });
    expect(
      classifyCodexError(JSON.stringify({ error: { code: 'insufficient_quota', message: 'q' } })),
    ).toMatchObject({ code: 'HARNESS_QUOTA_EXHAUSTED', retriable: false });
    expect(
      classifyCodexError(JSON.stringify({ status: 401, message: 'Unauthorized' })),
    ).toMatchObject({ code: 'HARNESS_NOT_AUTHENTICATED', message: 'Unauthorized' });
    expect(classifyCodexError('Not logged in')).toMatchObject({
      code: 'HARNESS_NOT_AUTHENTICATED',
    });
    expect(classifyCodexError('spawn codex ENOENT')).toMatchObject({
      code: 'HARNESS_NOT_INSTALLED',
    });
    expect(classifyCodexError(JSON.stringify({ status: 503 }))).toMatchObject({
      code: 'HARNESS_TRANSPORT_FAILED',
      retriable: true,
    });
    expect(classifyCodexError('stream disconnected before completion')).toMatchObject({
      retriable: true,
    });
    expect(classifyCodexError('null')).toMatchObject({ code: 'HARNESS_TURN_FAILED' });
    expect(classifyCodexError('something odd')).toEqual({
      code: 'HARNESS_TURN_FAILED',
      message: 'something odd',
      retriable: false,
    });
  });
});

describe('TurnAccumulator', () => {
  it('retains authoritative typed evidence over later generic and missing-session wrappers', () => {
    const acc = new TurnAccumulator('resumed');
    acc.push({ type: 'turn.failed', error: { message: 'Not logged in' } });
    acc.fail({
      code: 'HARNESS_SESSION_MISSING',
      message: 'Recorded conversation refused',
      retriable: true,
    });
    expect(acc.finish().failure?.code).toBe('HARNESS_SESSION_MISSING');
    acc.fail({ code: 'HARNESS_TERMINATION_UNCONFIRMED', message: 'Process still alive' });
    acc.fail({ code: 'HARNESS_SESSION_MISSING', message: 'Recorded conversation refused' });
    acc.fail('Generic wrapper');
    expect(acc.finish().failure?.code).toBe('HARNESS_TERMINATION_UNCONFIRMED');
  });
  it('replays the plain message fixture', () => {
    const acc = new TurnAccumulator('fresh');
    const out = loadFixture('message').events.flatMap((e) => acc.push(e));
    expect(out.map((e) => e.type)).toEqual([
      'session',
      'item',
      'submitted',
      'item',
      'usage',
      'turn-complete',
    ]);
    expect(out[0]).toEqual({ type: 'session', sessionId: acc.sessionId, mode: 'fresh' });
    // The configuration deprecation warning is an ordinary error item, not a failure.
    expect(out[1]).toMatchObject({ type: 'item', item: { type: 'error' } });
    const outcome = acc.finish();
    expect(outcome).toMatchObject({ finalText: 'OK', completed: true });
    expect(outcome.failure).toBeUndefined();
    expect(outcome.usage.inputTokens).toBeGreaterThan(0);
  });

  it('replays the command and file change fixture', () => {
    const acc = new TurnAccumulator('fresh');
    const out = loadFixture('command-and-file-change').events.flatMap((e) => acc.push(e));
    const items = out.flatMap((e) => (e.type === 'item' ? [e.item] : []));
    expect(items.map((i) => i.type)).toEqual(['error', 'command', 'file-change', 'message']);
    expect(items[1]).toMatchObject({ exitCode: 0, status: 'ok' });
    expect(items[1]?.summary).toContain('Get-ChildItem -Name');
    expect(items[1]?.commandPreview).toContain('Get-ChildItem -Name');
    expect(items[1]?.summary).toContain('(exit 0)');
    expect(items[2]?.summary).toBe('add <WORKDIR>\\notes.txt');
    expect(acc.finish().finalText).toBe('DONE');
  });

  it('turns turn.failed into a classified failure and ignores the preceding stream error', () => {
    const acc = new TurnAccumulator('fresh');
    const out = loadFixture('failed-invalid-model').events.flatMap((e) => acc.push(e));
    expect(out.map((e) => e.type)).toEqual(['session', 'item', 'item', 'submitted']);
    const outcome = acc.finish();
    expect(outcome.completed).toBe(false);
    expect(outcome.failure?.code).toBe('HARNESS_ARGUMENTS_REJECTED');
    expect(outcome.failure?.message).toContain('not supported');
  });

  it('never lets the generic process-exit error replace a failure the stream reported (#243)', () => {
    const exit = new Error('Codex Exec exited with code 1: Reading prompt from stdin...\n');
    const failed = new TurnAccumulator('fresh');
    failed.push({ type: 'turn.started' });
    failed.push({ type: 'turn.failed', error: { message: 'something odd' } });
    failed.fail(exit);
    expect(failed.finish().failure).toEqual({
      code: 'HARNESS_TURN_FAILED',
      message: 'something odd',
      retriable: false,
    });
    // A top-level error is the stream's own report of an unfinished turn, too.
    const errored = new TurnAccumulator('fresh');
    errored.push({ type: 'error', message: 'stream ended unexpectedly' });
    errored.fail(exit);
    expect(errored.finish().failure?.message).toBe('stream ended unexpectedly');
    // Higher-ranked evidence from outside the stream still wins.
    const outranked = new TurnAccumulator('fresh');
    outranked.push({ type: 'turn.failed', error: { message: 'something odd' } });
    outranked.fail(new Error('Codex Exec exited with code 1: Error: Not logged in'));
    expect(outranked.finish().failure?.code).toBe('HARNESS_NOT_AUTHENTICATED');
    // With nothing reported by the stream, or after a completed turn, the exit error is the cause.
    const silent = new TurnAccumulator('fresh');
    silent.push({ type: 'turn.started' });
    silent.fail(exit);
    expect(silent.finish().failure?.message).toBe(exit.message);
    const completed = new TurnAccumulator('fresh');
    completed.push({ type: 'error', message: 'Reconnecting... 1/5' });
    completed.push({
      type: 'turn.completed',
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    });
    completed.fail(exit);
    expect(completed.finish().failure?.message).toBe(exit.message);
    // The SDK reports a signal the same way.
    const signalled = new TurnAccumulator('fresh');
    signalled.push({ type: 'turn.failed', error: { message: 'something odd' } });
    signalled.fail(new Error('Codex Exec exited with signal SIGTERM: '));
    expect(signalled.finish().failure?.message).toBe('something odd');
  });

  // PR #426 review B1: only the SDK's own process-exit error wraps the stream's failure.
  it.each([
    ['an SDK parse failure', new Error('Failed to parse item: MALFORMED_PROTOCOL_ITEM')],
    ['an exit-shaped message that is not an Error', 'Codex Exec exited with code 1: text'],
    ['an Error subclass', new TypeError('Codex Exec exited with code 1: from elsewhere')],
    [
      'an error with its own code',
      Object.assign(new Error('Codex Exec exited with code 1: pipe'), { code: 'EPIPE' }),
    ],
  ] as const)('records %s thrown after a stream failure as evidence of its own', (_, error) => {
    const acc = new TurnAccumulator('fresh');
    acc.push({ type: 'turn.started' });
    acc.push({ type: 'error', message: 'An earlier generic diagnostic' });
    acc.fail(error);
    expect(acc.finish().failure).toEqual(classifyCodexError(error));
  });

  // PR #426 audit scan 2: the SDK's exit error can carry the structured refusal from stderr.
  const providerError = (text: string, status = 400, type = 'invalid_request_error') =>
    JSON.stringify({ status, error: { type, param: 'reasoning.effort', message: text } });
  it.each([
    ["Error: invalid value for reasoning.effort: 'minimal'.", ''],
    ['Thread not found in referenced input.', ''],
    ['Thread not found in referenced input.', 'Reading prompt from stdin...\n'],
  ])(
    'classifies the structured refusal %j inside the SDK exit error before any heuristic',
    (text, banner) => {
      const wrapper = new Error(`Codex Exec exited with code 1: ${banner}${providerError(text)}\n`);
      expect(classifyCodexError(wrapper)).toEqual({
        code: 'HARNESS_ARGUMENTS_REJECTED',
        message: `The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
        retriable: false,
      });
    },
  );

  it('reads other structured provider errors inside the SDK exit error from their structure', () => {
    expect(
      classifyCodexError(
        new Error(`Codex Exec exited with code 1: ${providerError('Slow down', 429, 'requests')}`),
      ),
    ).toEqual({ code: 'HARNESS_QUOTA_EXHAUSTED', message: 'Slow down', retriable: true });
    // Only the SDK's own exit error is unwrapped; other errors keep the whole-text rules.
    expect(
      classifyCodexError(new Error(`Something else: ${providerError('Thread not found.')}`)),
    ).toMatchObject({ code: 'HARNESS_SESSION_MISSING' });
  });

  it('never lets an exit error that repeats the stream failure replace it, whatever its text ranks', () => {
    const text = 'Thread not found in referenced input.';
    const acc = new TurnAccumulator('fresh');
    acc.push({ type: 'turn.started' });
    acc.push({ type: 'turn.failed', error: { message: providerError(text) } });
    // The JSON after a prefix on the line is read as the same provider error, so it is a repeat;
    // read as text, the heuristics would call it a missing session.
    acc.fail(new Error(`Codex Exec exited with code 1: ERROR: ${providerError(text)}`));
    expect(acc.finish().failure).toEqual({
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message: `The provider refused the request (HTTP 400, reasoning.effort): ${text}`,
      retriable: false,
    });
    // A distinct typed cause on stderr is still evidence of its own.
    const distinct = new TurnAccumulator('fresh');
    distinct.push({ type: 'turn.failed', error: { message: providerError(text) } });
    distinct.fail(new Error('Codex Exec exited with code 1: No rollout found for thread abc'));
    expect(distinct.finish().failure?.code).toBe('HARNESS_SESSION_MISSING');
  });

  // PR #426 audit scan 3: stderr is compared piece by piece, and a fatal stream failure keeps the
  // protection after turn.completed.
  it('folds each distinct stderr piece and keeps repeats out, also after completion', () => {
    const usage = {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    };
    const repeat = providerError('Effort A refused');
    const completed = new TurnAccumulator('fresh');
    completed.push({ type: 'turn.started' });
    completed.push({ type: 'turn.completed', usage });
    completed.push({ type: 'turn.failed', error: { message: repeat } });
    completed.fail(new Error(`Codex Exec exited with code 1: ERROR: ${repeat}\n{this is not JSON`));
    expect(completed.finish().failure).toMatchObject({
      code: 'HARNESS_ARGUMENTS_REJECTED',
      message: 'The provider refused the request (HTTP 400, reasoning.effort): Effort A refused',
    });
    // Stderr that is one provider error over several lines is read as a whole.
    const pretty = new TurnAccumulator('fresh');
    pretty.push({ type: 'turn.failed', error: { message: repeat } });
    pretty.fail(
      new Error(
        `Codex Exec exited with code 1: ${JSON.stringify(JSON.parse(providerError('Effort B refused')), null, 2)}`,
      ),
    );
    expect(pretty.finish().failure?.message).toBe(
      'The provider refused the request (HTTP 400, reasoning.effort): Effort B refused',
    );
    // Without stream evidence, a typed stderr piece is the cause, read without the prefix.
    const alone = new TurnAccumulator('fresh');
    alone.push({ type: 'turn.started' });
    alone.fail(
      new Error('Codex Exec exited with code 1: Reading prompt from stdin...\nNot logged in'),
    );
    expect(alone.finish().failure).toEqual({
      code: 'HARNESS_NOT_AUTHENTICATED',
      message: 'Not logged in',
      retriable: false,
    });
  });

  it('fails a stream that ends without completing, using the last stream error if any', () => {
    const silent = new TurnAccumulator('fresh');
    silent.push({ type: 'turn.started' });
    expect(silent.finish().failure?.message).toMatch(/ended before the turn completed/);

    const errored = new TurnAccumulator('resumed');
    errored.push({ type: 'error', message: 'Reconnecting... 1/5' });
    expect(errored.finish().failure?.message).toBe('Reconnecting... 1/5');

    const recovered = new TurnAccumulator('fresh');
    recovered.push({ type: 'error', message: 'Reconnecting... 1/5' });
    recovered.push({ type: 'turn.completed', usage: { input_tokens: 1 } } as never);
    expect(recovered.finish().failure).toBeUndefined();
  });

  it('keeps the first failure when a thrown error follows turn.failed', () => {
    const acc = new TurnAccumulator('fresh');
    acc.push({ type: 'turn.failed', error: { message: 'usage limit reached' } });
    acc.fail('Codex Exec exited with code 1');
    expect(acc.finish().failure?.code).toBe('HARNESS_QUOTA_EXHAUSTED');
    const unknown = new TurnAccumulator('fresh');
    expect(unknown.push({ type: 'item.started' })).toEqual([]);
  });
});
