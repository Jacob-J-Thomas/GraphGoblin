import type { StructuredPort } from '@graphgoblin/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  JUDGE_SCHEMA,
  choicePrompt,
  choiceSchema,
  createCodexDecider,
  judgePrompt,
} from './decider.js';

function structuredReturning(value: unknown) {
  const complete = vi.fn<StructuredPort['complete']>(() => Promise.resolve({ value }));
  return { port: { complete } satisfies StructuredPort, complete };
}

const choice = {
  question: 'Is the change ready?',
  options: [
    { id: 'ship', label: 'Ship it', criteria: 'ready to merge' },
    { id: 'fix', label: 'Fix it', criteria: 'needs work' },
  ],
  context: { diff: 'x' },
};

describe('CodexDecider.choose', () => {
  it('uses stable option ids and returns strictly bounded informational confidence', async () => {
    const { port, complete } = structuredReturning({
      route: 'fix',
      confidence: 0.9,
      reasoning: 'Tests fail',
    });
    const decider = createCodexDecider(port);
    expect(decider.id).toBe('codex');
    expect(decider.available()).toBe(true);
    expect(
      await decider.choose(
        { ...choice, model: 'gpt-6-luna', effort: 'low' },
        new AbortController().signal,
      ),
    ).toEqual({ type: 'choice', optionId: 'fix', confidence: 0.9, probabilities: null });
    const call = complete.mock.calls[0]?.[0];
    expect(call?.schema).toEqual(choiceSchema(['ship', 'fix']));
    expect(call?.model).toBe('gpt-6-luna');
    expect(call?.effort).toBe('low');
    expect(call?.prompt).toContain('- ship (Ship it): ready to merge');
    expect(call?.prompt).toContain('"diff": "x"');
  });
  it('passes no unresolved model or effort fields by default', async () => {
    const { port, complete } = structuredReturning({
      route: 'ship',
      confidence: 1,
      reasoning: 'Ready',
    });
    await createCodexDecider(port).choose(choice, new AbortController().signal);
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('model');
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('effort');
  });
  it.each([
    null,
    'ship',
    [],
    { route: 'ship' },
    { route: 'unknown', confidence: 1, reasoning: 'Q' },
    { route: 'ship', confidence: -1, reasoning: 'Q' },
    { route: 'ship', confidence: 2, reasoning: 'Q' },
    { route: 'ship', confidence: NaN, reasoning: 'Q' },
    { route: 'ship', confidence: Infinity, reasoning: 'Q' },
    { route: 'ship', confidence: 'high', reasoning: 'Q' },
    { route: 'ship', confidence: 1, reasoning: 4 },
    { route: 'ship', confidence: 1, reasoning: 'Q', extra: true },
  ])('rejects malformed or undeclared Choice answers (%j)', async (value) => {
    await expect(
      createCodexDecider(structuredReturning(value).port).choose(
        choice,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DECIDER_INVALID_RESPONSE' });
  });
  it.each([
    ['HARNESS_NOT_INSTALLED', false, 'DECIDER_UNAVAILABLE'],
    ['HARNESS_NOT_AUTHENTICATED', false, 'DECIDER_NOT_AUTHENTICATED'],
    ['HARNESS_QUOTA_EXHAUSTED', true, 'DECIDER_RATE_LIMITED'],
    ['HARNESS_TURN_FAILED', true, 'DECIDER_UNREACHABLE'],
    ['HARNESS_TURN_FAILED', false, 'DECIDER_HTTP_ERROR'],
  ] as const)(
    'maps native Choice failure %s without retaining provider text',
    async (code, retriable, expected) => {
      const { port, complete } = structuredReturning({});
      complete.mockRejectedValue(
        Object.assign(new Error('private-native-message'), { code, retriable }),
      );
      await expect(
        createCodexDecider(port).choose(choice, new AbortController().signal),
      ).rejects.toMatchObject({ code: expected, message: 'Codex Choice completion failed' });
    },
  );
  it.each([
    null,
    'raw failure',
    new DOMException('Cancelled', 'AbortError'),
    Object.assign(new Error('request failure'), { code: 'UNKNOWN_CODE' }),
    Object.assign(new Error('protocol failure'), { code: 'HARNESS_TURN_FAILED' }),
  ])(
    'preserves unknown/cancellation errors without inventing retryable categories (%j)',
    async (error) => {
      const { port, complete } = structuredReturning({});
      complete.mockRejectedValue(error);
      const expected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'HARNESS_TURN_FAILED'
          ? expect.objectContaining({ code: 'DECIDER_HTTP_ERROR' })
          : error;
      await expect(
        createCodexDecider(port).choose(choice, new AbortController().signal),
      ).rejects.toEqual(expected);
    },
  );
});

describe('CodexDecider.judge', () => {
  it('asks a yes/no question and returns holds with confidence', async () => {
    const { port, complete } = structuredReturning({
      holds: false,
      confidence: -0.5,
      reasoning: 'no',
    });
    const answer = await createCodexDecider(port).judge(
      { question: 'Done?', context: null, model: 'm', effort: 'high' },
      new AbortController().signal,
    );
    expect(answer).toEqual({ holds: false, confidence: 0, reasoning: 'no' });
    expect(complete.mock.calls[0]?.[0].schema).toBe(JUDGE_SCHEMA);
    expect(complete.mock.calls[0]?.[0].prompt).toContain('Question: Done?');
  });

  it('accepts a missing confidence and rejects a missing verdict', async () => {
    expect(
      await createCodexDecider(structuredReturning({ holds: true }).port).judge(
        { question: 'q', context: {} },
        new AbortController().signal,
      ),
    ).toEqual({ holds: true });
    await expect(
      createCodexDecider(structuredReturning({ holds: 'yes' }).port).judge(
        { question: 'q', context: {} },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DECIDER_INVALID_RESPONSE' });
  });
  it('retains only the bounded judge reasoning field', async () => {
    const answer = await createCodexDecider(
      structuredReturning({
        holds: true,
        confidence: 0.93,
        reasoning: 'x'.repeat(3000),
        payload: 'private-envelope',
      }).port,
    ).judge({ question: 'Done?', context: null }, new AbortController().signal);
    expect(answer).toEqual({ holds: true, confidence: 0.93, reasoning: 'x'.repeat(2048) });
    expect(JSON.stringify(answer)).not.toContain('private-envelope');
  });
});

describe('prompts', () => {
  it('render the question and context', () => {
    expect(choicePrompt({ ...choice, context: undefined as never })).toContain('null');
    expect(judgePrompt({ question: 'q?', context: [1] })).toContain('[\n  1\n]');
  });
});
