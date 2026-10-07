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
    { label: 'ship', description: 'ready to merge' },
    { label: 'fix', description: 'needs work' },
  ],
  context: { diff: 'x' },
};

describe('CodexDecider.choose', () => {
  it('asks for an enum of route labels and returns label and clamped confidence', async () => {
    const { port, complete } = structuredReturning({
      route: 'fix',
      confidence: 1.4,
      reasoning: 'tests fail',
    });
    const decider = createCodexDecider(port);
    expect(decider.id).toBe('codex');
    expect(decider.available()).toBe(true);
    const result = await decider.choose(
      { ...choice, model: 'gpt-6-luna', effort: 'low' },
      new AbortController().signal,
    );
    expect(result).toEqual({ label: 'fix', confidence: 1 });
    const call = complete.mock.calls[0]?.[0];
    expect(call?.schema).toEqual(choiceSchema(['ship', 'fix']));
    expect(call?.model).toBe('gpt-6-luna');
    expect(call?.effort).toBe('low');
    expect(call?.prompt).toContain('- ship: ready to merge');
    expect(call?.prompt).toContain('"diff": "x"');
  });

  it('omits confidence when the answer has none and passes no model by default', async () => {
    const { port, complete } = structuredReturning({ route: 'ship', confidence: 'high' });
    const result = await createCodexDecider(port).choose(choice, new AbortController().signal);
    expect(result).toEqual({ label: 'ship' });
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('model');
  });

  it('rejects answers without a route or not shaped as an object', async () => {
    await expect(
      createCodexDecider(structuredReturning({ confidence: 0.2 }).port).choose(
        choice,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DECIDER_INVALID_RESPONSE' });
    await expect(
      createCodexDecider(structuredReturning('ship').port).choose(
        choice,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no structured answer/);
    await expect(
      createCodexDecider(structuredReturning([1]).port).choose(
        choice,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no structured answer/);
  });
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
