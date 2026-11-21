import * as domain from '@graphgoblin/domain';
import { describe, expect, it, vi } from 'vitest';
import { RunEventSchema } from '@graphgoblin/contracts';
import { visitTurn, provenance } from './inference-turn.js';
import { sampleThread, fakeUlid } from '@graphgoblin/contracts/testing';
import { renderTemplate, threadView, SYSTEM_CHAT_TEXT_PROMPT } from '@graphgoblin/domain';
import type { HarnessPort } from '../ports.js';
import { createTestEngine } from '../testing/scenario.js';
import { admitInferencePrompt } from './inference-context.js';

const payload = {
  protocol: 'graphgoblin.chat.v1',
  conversationId: fakeUlid('conversation'),
  requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
  turn: 3,
  history: [
    { role: 'user', text: 'old question ' + 'x'.repeat(80) },
    { role: 'assistant', text: 'old answer ' + 'x'.repeat(80) },
    { role: 'user', text: 'new question' },
    { role: 'assistant', text: 'new answer 🦎' },
  ],
  input: { kind: 'text', text: 'Required current question' },
};
function fixture() {
  const thread = sampleThread();
  thread.invocation.trigger.payload = structuredClone(payload);
  return thread;
}
const window = (limit: number) => ({
  contextTokens: 4096,
  outputReserveTokens: 1024,
  profile: 'test/byte-ceiling',
  fits: (prompt: string) => Buffer.byteLength(prompt) <= limit,
});
async function options() {
  const thread = fixture();
  return {
    thread,
    template: SYSTEM_CHAT_TEXT_PROMPT,
    prompt: await renderTemplate(SYSTEM_CHAT_TEXT_PROMPT, { ...threadView(thread) }),
    allowHistoryTrim: true,
    window: window(400),
  };
}
describe('rendered prompt admission and whole-pair history', () => {
  it('reuses the persisted prompt and admission facts across recovery, including unconfirmed intent', () => {
    const base = { runId: fakeUlid('run'), ts: '2026-11-08T00:00:00.000Z' };
    const turn = RunEventSchema.parse({
      ...base,
      seq: 2,
      type: 'harness.turn',
      nodeId: 'respond',
      visitId: base.runId + ':1',
      turnId: fakeUlid('turn'),
      harness: 'ollama',
      promptKind: 'authored',
      prompt: 'Exact retained prompt',
      context: {
        profile: 'test/bytes',
        contextTokens: 4096,
        outputReserveTokens: 1024,
        retainedHistoryPairs: 1,
        omittedHistoryPairs: 2,
      },
    });
    if (turn.type !== 'harness.turn') throw new Error('fixture');
    const state = visitTurn(
      [
        RunEventSchema.parse({
          ...base,
          seq: 1,
          type: 'node.started',
          nodeId: 'respond',
          kind: 'inference',
          attempt: 1,
          configHash: 'hash',
        }),
        turn,
      ],
      'respond',
    );
    expect(state.pending?.turn.prompt).toBe(turn.prompt);
    expect(state.pending?.turn.context).toEqual(turn.context);
    if (!state.pending) throw new Error('fixture');
    expect(provenance({ ...state.pending, intentUnconfirmed: true }).retry?.context).toEqual(
      turn.context,
    );
  });

  it('keeps the newest complete pair, preserving the required input and immutable thread', async () => {
    const input = await options();
    const before = structuredClone(input.thread);
    const admitted = await admitInferencePrompt(input);
    expect(admitted.context).toMatchObject({ omittedHistoryPairs: 1, retainedHistoryPairs: 1 });
    expect(admitted.prompt).toContain('new question');
    expect(admitted.prompt).toContain('new answer 🦎');
    expect(admitted.prompt).toContain(payload.input.text);
    expect(admitted.prompt).not.toContain('old question');
    expect(input.thread).toEqual(before);
  });
  it('can omit every pair while preserving all required current input', async () => {
    const input = await options();
    const requiredOnly = structuredClone(input.thread);
    requiredOnly.invocation.trigger.payload = { ...payload, history: [] };
    const requiredPrompt = await renderTemplate(input.template, { ...threadView(requiredOnly) });
    const admitted = await admitInferencePrompt({
      ...input,
      window: window(Buffer.byteLength(requiredPrompt)),
    });
    expect(admitted.prompt).toBe(requiredPrompt);
    expect(admitted.context).toMatchObject({ retainedHistoryPairs: 0, omittedHistoryPairs: 2 });
  });

  it('preserves full history when the complete rendered prompt fits', async () => {
    const input = await options();
    const admitted = await admitInferencePrompt({ ...input, window: window(10000) });
    expect(admitted.prompt).toBe(input.prompt);
    expect(admitted.context).toMatchObject({ omittedHistoryPairs: 0, retainedHistoryPairs: 2 });
  });
  it.each([false, true])(
    'reports fitting paired history regardless of trim permission: %s',
    async (allowHistoryTrim) => {
      const input = await options();
      const admitted = await admitInferencePrompt({
        ...input,
        allowHistoryTrim,
        window: window(10000),
      });
      expect(admitted.prompt).toBe(input.prompt);
      expect(admitted.context).toMatchObject({ retainedHistoryPairs: 2, omittedHistoryPairs: 0 });
    },
  );

  it('rejects required input/instructions that cannot fit even with empty history', async () => {
    const input = await options();
    await expect(admitInferencePrompt({ ...input, window: window(10) })).rejects.toMatchObject({
      code: 'INFERENCE_CONTEXT_LIMIT',
      options: { resumable: false },
    });
  });
  it('never rewrites a custom prompt or an inherited retry intent', async () => {
    const input = await options();
    for (const changed of [
      { template: 'Custom {{ trigger.payload.history }}' },
      { allowHistoryTrim: false },
    ])
      await expect(admitInferencePrompt({ ...input, ...changed })).rejects.toThrow(
        /Required input was not submitted/,
      );
  });
  it('rejects opaque payloads without guessing a history location', async () => {
    const input = await options();
    input.thread.invocation.trigger.payload = { history: 'opaque' };
    await expect(admitInferencePrompt(input)).rejects.toThrow(/complete prompt exceeds/);
  });

  it('refuses to trim malformed or incomplete history', async () => {
    for (const history of [payload.history.slice(1), [...payload.history].reverse()]) {
      const input = await options();
      input.thread.invocation.trigger.payload = { ...payload, history };
      await expect(admitInferencePrompt(input)).rejects.toThrow(/complete prompt exceeds/);
    }
  });
});

it.each([1, 2])(
  'keeps a synthetic failure in canonical rerender %i engine-owned and pre-turn resumable',
  async (call) => {
    const input = await options();
    const original = domain.renderTemplate;
    const render = vi.spyOn(domain, 'renderTemplate');
    try {
      if (call === 2) render.mockImplementationOnce(original);
      render.mockRejectedValueOnce(new domain.TemplateError('private canonical failure'));
      const error: unknown = await admitInferencePrompt(input).catch((fault: unknown) => fault);
      expect(render).toHaveBeenCalledTimes(call);
      expect(error).toMatchObject({ code: 'INTERNAL_ERROR', options: { resumable: true } });
      expect(JSON.stringify(error)).not.toContain('private canonical failure');
    } finally {
      render.mockRestore();
    }
  },
);

it('publishes a canonical rerender fault on the current inference node before provider invocation', async () => {
  const engine = await createTestEngine();
  const harness: HarnessPort = engine.ports.harness;
  const version = engine.publish(
    domain.createSystemChatDefinition({ name: 'Canonical rerender', harness: 'codex' }),
  );
  // Synthetic fault confined to the pure system rerender. The initial prompt has already rendered.
  const render = vi.spyOn(domain, 'renderTemplate');
  try {
    harness.contextWindow = () => {
      render.mockRejectedValueOnce(new domain.TemplateError('private renderer diagnostic'));
      return Promise.resolve(window(400));
    };
    const run = await engine.runToIdle(version.loopId, payload);
    expect(render).toHaveBeenCalled();
    expect(run.failure).toEqual({
      code: 'INTERNAL_ERROR',
      nodeId: 'respond',
      resumable: true,
      message: 'An unexpected error interrupted the run. See the server logs for this run.',
    });
    expect(engine.events(run.id).filter((event) => event.type === 'run.failed')).toMatchObject([
      { failure: run.failure },
    ]);
    expect(engine.eventTypes(run.id)).not.toContain('harness.turn');
    expect(engine.ports.harness.started).toHaveLength(0);
  } finally {
    render.mockRestore();
  }
});
