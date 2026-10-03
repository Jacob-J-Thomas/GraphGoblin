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
    }
  });

  it('caps long summaries and truncates large command output in the detail', () => {
    const item = normalizeItem({
      id: 'x',
      type: 'command_execution',
      command: 'y'.repeat(500),
      aggregated_output: 'z'.repeat(20_000),
      status: 'completed',
    });
    expect(item.summary).toHaveLength(200);
    expect(item.summary.endsWith('...')).toBe(true);
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
  it('unwraps the JSON API error Codex reports', () => {
    const raw = loadFixture('failed-invalid-model').events.find((e) => e.type === 'turn.failed');
    const message = (raw as { error: { message: string } }).error.message;
    expect(classifyCodexError(message)).toEqual({
      code: 'HARNESS_TURN_FAILED',
      message:
        "The 'gpt-graphgoblin-does-not-exist' model is not supported when using Codex with a ChatGPT account.",
      retriable: false,
    });
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
      code: 'HARNESS_TURN_FAILED',
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
  it('replays the plain message fixture', () => {
    const acc = new TurnAccumulator('fresh');
    const out = loadFixture('message').events.flatMap((e) => acc.push(e));
    expect(out.map((e) => e.type)).toEqual(['session', 'item', 'item', 'usage', 'turn-complete']);
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
    expect(items[1]?.summary).toContain('Get-ChildItem -Name');
    expect(items[1]?.summary).toContain('(exit 0)');
    expect(items[2]?.summary).toBe('add <WORKDIR>\\notes.txt');
    expect(acc.finish().finalText).toBe('DONE');
  });

  it('turns turn.failed into a classified failure and ignores the preceding stream error', () => {
    const acc = new TurnAccumulator('fresh');
    const out = loadFixture('failed-invalid-model').events.flatMap((e) => acc.push(e));
    expect(out.map((e) => e.type)).toEqual(['session', 'item', 'item']);
    const outcome = acc.finish();
    expect(outcome.completed).toBe(false);
    expect(outcome.failure?.code).toBe('HARNESS_TURN_FAILED');
    expect(outcome.failure?.message).toContain('not supported');
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
