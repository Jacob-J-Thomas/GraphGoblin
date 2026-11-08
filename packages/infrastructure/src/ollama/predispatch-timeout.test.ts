import { describe, expect, it, vi } from 'vitest';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import { createTestEngine } from '@graphgoblin/engine/testing';
import { OllamaHarness } from './harness.js';
import { discoveredModel } from './discovery.js';
import { qwenContextDetail } from './context-fixture.js';
import type { OllamaFetch } from './http.js';

const model = discoveredModel('qwen:timeout-fixture', 'digest', 1, '2026-11-08T00:00:00.000Z', {
  capabilities: ['completion'],
});
const connection = { enabled: true, baseUrl: 'http://localhost:11434', revision: 1 };
const json = (value: unknown) => new Response(JSON.stringify(value));
const payload = {
  protocol: 'graphgoblin.chat.v1',
  conversationId: fakeUlid('timeout-conversation'),
  requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
  turn: 1,
  history: [],
  input: { kind: 'text', text: 'Hello' },
};

describe('Ollama deadline submission evidence', () => {
  it.each(['metadata', 'inference'] as const)(
    'records truthful submission when the deadline interrupts %s',
    async (stage) => {
      const engine = await createTestEngine();
      let showCount = 0;
      let release: (() => void) | undefined;
      const fetcher = vi.fn<OllamaFetch>((url, init) => {
        const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (address.endsWith('/api/version')) return Promise.resolve(json({ version: '0.32.15' }));
        if (address.endsWith('/api/show')) {
          showCount += 1;
          if (stage === 'inference' || showCount === 1)
            return Promise.resolve(json(qwenContextDetail));
        }
        return new Promise<Response>((resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          init?.signal?.addEventListener('abort', abort, { once: true });
          release = () => {
            init?.signal?.removeEventListener('abort', abort);
            resolve(json({ done: true, message: { role: 'assistant', content: 'late' } }));
          };
        });
      });
      engine.ports.harnesses.ollama = new OllamaHarness({
        fetcher,
        snapshot: () => Promise.resolve({ connection, models: [model] }),
      });
      engine.ports.modelCatalog.entries.push({
        harness: 'ollama',
        source: 'harness',
        model: model.model,
        displayName: model.model,
        efforts: ['none'],
        defaultEffort: 'none',
        enabled: true,
        availability: { state: 'available', checkedAt: '2026-11-08T00:00:00.000Z' },
      });
      const definition = createSystemChatDefinition({
        name: `Deadline ${stage}`,
        harness: 'ollama',
      });
      const respond = definition.nodes.find((node) => node.kind === 'inference')!;
      respond.config.model = model.model;
      respond.config.effort = 'none';
      respond.config.timeoutSeconds = 1;
      const version = engine.publish(definition);
      try {
        const run = await engine.runToIdle(version.loopId, payload);
        expect(run.failure?.code).toBe('INFERENCE_TIMEOUT');
        expect(run.failure?.inference?.submission).toBe(
          stage === 'metadata' ? 'definitely-not-submitted' : 'delivery-uncertain',
        );
        expect(
          fetcher.mock.calls.filter((call) =>
            (typeof call[0] === 'string'
              ? call[0]
              : 'url' in call[0]
                ? call[0].url
                : call[0].href
            ).endsWith('/api/chat'),
          ),
        ).toHaveLength(stage === 'metadata' ? 0 : 1);
        expect(showCount).toBe(2);
      } finally {
        release?.();
        engine.manager.stop();
      }
    },
  );
});
