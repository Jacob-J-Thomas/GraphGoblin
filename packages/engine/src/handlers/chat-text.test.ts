import { describe, expect, it } from 'vitest';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import type { HarnessPort } from '../ports.js';
import { createTestEngine } from '../testing/scenario.js';

describe('conversational seed text envelope', () => {
  it('records history omission with the exact admitted prompt and leaves the initial thread intact', async () => {
    const engine = await createTestEngine();
    const harness: HarnessPort = engine.ports.harness;
    harness.contextWindow = () =>
      Promise.resolve({
        contextTokens: 4096,
        outputReserveTokens: 1024,
        profile: 'test/bytes',
        fits: (prompt) => Buffer.byteLength(prompt) < 400,
      });
    engine.ports.harness.script([{ finalText: 'Reply' }]);
    const version = engine.publish(
      createSystemChatDefinition({ name: 'Chat context', harness: 'codex' }),
    );
    const history = [
      { role: 'user', text: 'old ' + 'x'.repeat(200) },
      { role: 'assistant', text: 'old answer' },
      { role: 'user', text: 'new question' },
      { role: 'assistant', text: 'new answer' },
    ];
    const run = await engine.runToIdle(version.loopId, {
      protocol: 'graphgoblin.chat.v1',
      conversationId: fakeUlid('conversation'),
      requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
      turn: 3,
      history,
      input: { kind: 'text', text: 'Required current question' },
    });
    expect(run.status).toBe('succeeded');
    const turn = engine.events(run.id).find((event) => event.type === 'harness.turn');
    expect(turn?.context).toMatchObject({ retainedHistoryPairs: 1, omittedHistoryPairs: 1 });
    expect(turn?.prompt).toBe(engine.ports.harness.started[0]?.turn.prompt);
    expect(turn?.prompt).not.toContain('old answer');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.invocation.trigger.payload).toMatchObject({ history });
  });

  it('applies the editable inference deadline while context admission is pending', async () => {
    const engine = await createTestEngine();
    const harness: HarnessPort = engine.ports.harness;
    harness.contextWindow = (_request, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        }),
      );
    const definition = createSystemChatDefinition({ name: 'Chat deadline', harness: 'codex' });
    const respond = definition.nodes.find((node) => node.kind === 'inference')!;
    respond.config.timeoutSeconds = 1;
    const version = engine.publish(definition);
    const run = await engine.runToIdle(version.loopId, {
      protocol: 'graphgoblin.chat.v1',
      conversationId: fakeUlid('conversation'),
      requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
      turn: 1,
      history: [],
      input: { kind: 'text', text: 'Hello' },
    });
    expect(run.failure?.code).toBe('INFERENCE_TIMEOUT');
    expect(engine.ports.harness.started).toEqual([]);
    expect(engine.eventTypes(run.id)).not.toContain('harness.turn');
  });

  it.each(['limit', 'unsupported'] as const)(
    'fails %s context admission clearly before invoking the provider',
    async (reason) => {
      const engine = await createTestEngine();
      const harness: HarnessPort = engine.ports.harness;
      harness.contextWindow =
        reason === 'limit'
          ? () =>
              Promise.resolve({
                contextTokens: 4096,
                outputReserveTokens: 1024,
                profile: 'test/bytes',
                fits: () => false,
              })
          : () =>
              Promise.reject(
                Object.assign(new Error('No supported context profile'), {
                  code: 'HARNESS_CONTEXT_UNSUPPORTED',
                  submission: 'definitely-not-submitted',
                }),
              );
      const version = engine.publish(
        createSystemChatDefinition({ name: 'Chat refused', harness: 'codex' }),
      );
      const run = await engine.runToIdle(version.loopId, {
        protocol: 'graphgoblin.chat.v1',
        conversationId: fakeUlid('conversation'),
        requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
        turn: 1,
        history: [],
        input: { kind: 'text', text: 'Required current question' },
      });
      expect(run.failure).toMatchObject({
        code: reason === 'limit' ? 'INFERENCE_CONTEXT_LIMIT' : 'INFERENCE_CONTEXT_UNSUPPORTED',
        resumable: false,
      });
      expect(engine.ports.harness.started).toEqual([]);
      expect(engine.eventTypes(run.id)).not.toContain('harness.turn');
    },
  );

  it.each(['Hello!', '{"nested":42}', '"quoted"', '**🦎**\nA Unicode reply'])(
    'packages native answer text in the protected response: %s',
    async (finalText) => {
      const engine = await createTestEngine();
      engine.ports.harness.script([{ finalText }]);
      const version = engine.publish(
        createSystemChatDefinition({ name: 'Chat text', harness: 'codex' }),
      );
      const run = await engine.runToIdle(version.loopId, {
        protocol: 'graphgoblin.chat.v1',
        conversationId: fakeUlid('conversation'),
        requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
        turn: 1,
        history: [],
        input: { kind: 'text', text: 'Hello' },
      });
      expect(run.status).toBe('succeeded');
      expect(run.result).toEqual({ protocol: 'graphgoblin.chat.v1', reply: finalText });
      expect(engine.ports.harness.started).toHaveLength(1);
      expect(engine.ports.harness.started[0]?.turn.outputSchema).toBeUndefined();
      expect(engine.eventTypes(run.id).filter((type) => type === 'node.finished')).toHaveLength(4);
    },
  );
});
