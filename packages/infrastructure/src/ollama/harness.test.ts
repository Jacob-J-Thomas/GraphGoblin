import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessEvent, HarnessStartRequest } from '@graphgoblin/engine';
import { ChatResponseJsonSchema } from '@graphgoblin/contracts';
import { OllamaError } from './http.js';
import { discoveredModel } from './discovery.js';
import { OllamaHarness } from './harness.js';
import type { OllamaFetch } from './http.js';
const at = '2026-11-07T00:00:00.000Z';
const model = discoveredModel('namespace/qwen:tag', 'sha256:1', 1, at, {
  capabilities: ['completion'],
});
const connection = { enabled: true, baseUrl: 'http://localhost:11434', revision: 1 };
const request: HarnessStartRequest = {
  model: model.model,
  effort: 'none',
  workingDirectory: '/ignored',
  options: { sandbox: 'read-only', approval: 'never' },
  turn: { prompt: 'Hello' },
};
const terminal = {
  model: model.model,
  done: true,
  message: { role: 'assistant', content: 'Hello' },
  prompt_eval_count: 5,
  eval_count: 3,
  prompt_eval_cached_count: 2,
};
function response(frames: unknown[]): Response {
  return new Response(frames.map((frame) => JSON.stringify(frame)).join('\n'));
}
function harness(fetcher: OllamaFetch = () => Promise.resolve(response([terminal]))) {
  return new OllamaHarness({
    fetcher,
    snapshot: () => Promise.resolve({ connection, models: [model] }),
    sessionId: () => 'ollama:00000000000000000000000000',
  });
}
async function events(stream: AsyncIterable<HarnessEvent>) {
  await Promise.resolve();
  const result: HarnessEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}
async function failure(fetcher: OllamaFetch) {
  const session = harness(fetcher).start(request, new AbortController().signal);
  const recorded = events(session.events);
  await expect(session.result).rejects.toBeDefined();
  return recorded;
}
describe('native Ollama harness', () => {
  it('makes a real HTTP fixture request with exact model/schema/control and split UTF8 answer', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
      incoming.on('end', () => {
        body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        expect(incoming.url).toBe('/api/chat');
        const format = body.format as { properties: { reply: { pattern: string } } };
        const pattern = format.properties.reply.pattern;
        if (!pattern.startsWith('^') || !pattern.endsWith('$') || /\\[sS]/.test(pattern)) {
          outgoing.writeHead(400);
          outgoing.end(
            JSON.stringify({
              error: 'Native grammar requires anchors and explicit character classes',
            }),
          );
          return;
        }
        outgoing.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const encoded = Buffer.from(
          JSON.stringify({
            model: model.model,
            done: false,
            message: {
              role: 'assistant',
              content: '{"protocol":"graphgoblin.chat.v1","reply":"🦎',
              thinking: 'hidden reasoning',
            },
          }) +
            '\n' +
            JSON.stringify({ ...terminal, message: { role: 'assistant', content: ' world"}' } }) +
            '\n',
        );
        const split = encoded.indexOf(Buffer.from('🦎')) + 1;
        outgoing.write(encoded.subarray(0, split));
        setImmediate(() => outgoing.end(encoded.subarray(split)));
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture port missing');
    const qwen = discoveredModel(model.model, model.digest, 1, at, {
      capabilities: ['completion', 'thinking'],
      details: { family: 'qwen35' },
      thinking: null,
    });
    const native = new OllamaHarness({
      snapshot: () =>
        Promise.resolve({
          connection: { ...connection, baseUrl: `http://127.0.0.1:${address.port}` },
          models: [qwen],
        }),
    });
    try {
      const schema = ChatResponseJsonSchema;
      const session = native.start(
        { ...request, turn: { prompt: 'exact prompt', outputSchema: schema } },
        new AbortController().signal,
      );
      const recorded = events(session.events);
      const result = await session.result;
      expect(result.finalText).toBe('{"protocol":"graphgoblin.chat.v1","reply":"🦎 world"}');
      expect(result.usage).toEqual({
        inputTokens: 5,
        outputTokens: 3,
        cachedInputTokens: 2,
        reasoningOutputTokens: 0,
      });
      expect(await session.sessionId).toMatch(/^ollama:[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(body).toEqual({
        model: model.model,
        messages: [{ role: 'user', content: 'exact prompt' }],
        stream: true,
        format: schema,
        think: false,
      });
      expect((await recorded).filter((event) => event.type === 'submitted')).toEqual([
        { type: 'submitted', marker: 'ollama.response' },
      ]);
      expect(JSON.stringify(result)).not.toContain('hidden reasoning');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('omits unsupported tools and think for a nonthinking model and permits empty adapter success', async () => {
    const fetcher = vi.fn<OllamaFetch>(() => Promise.resolve(response([{ done: true }])));
    const session = harness(fetcher).start(request, new AbortController().signal);
    expect((await session.result).finalText).toBe('');
    expect(JSON.parse(bodyText(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      model: model.model,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    });
    expect((await events(session.events)).at(-1)).toEqual({ type: 'turn-complete' });
  });
  it.each([
    [{ done: false, message: { role: 'assistant', content: 'partial' } }],
    [{ error: 'secret prompt/path' }],
    [{ done: true, message: { role: 'assistant', content: '', tool_calls: [{}] } }],
    [{ done: true, message: { role: 'user', content: 'bad role' } }],
    [{ done: true, message: { role: 'assistant', content: 1 } }],
    [{ done: true, message: { role: 'assistant', content: '', thinking: [] } }],
    [{ done: false }],
    [{ done: 'true' }],
    [{ ...terminal, model: 'substituted:tag' }],
    [terminal, terminal],
    [{ ...terminal, prompt_eval_count: -1 }],
    [{ ...terminal, eval_count: 1.5 }],
    [{ ...terminal, prompt_eval_cached_count: Infinity }],
  ])('rejects invalid terminal/protocol records %j', async (...frames) => {
    const recorded = await failure(() => Promise.resolve(response(frames)));
    expect(recorded.at(-1)).toMatchObject({
      type: 'error',
      code: 'HARNESS_PROTOCOL_ERROR',
      submission: 'delivery-uncertain',
      retriable: false,
    });
    expect(JSON.stringify(recorded)).not.toContain('secret');
  });
  it('rejects malformed JSON, invalid UTF8, missing bodies and stream read failures', async () => {
    for (const fetcher of [
      () => Promise.resolve(new Response('{bad}\n')),
      () => Promise.resolve(new Response(Uint8Array.from([255, 10]))),
      () => Promise.resolve(new Response(Uint8Array.from([0xf0]))),
      () => Promise.resolve(new Response(null)),
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('secret'));
              },
            }),
          ),
        ),
    ])
      expect((await failure(fetcher)).at(-1)).toMatchObject({ submission: 'delivery-uncertain' });
  });
  it('enforces bounded lines and total bytes rather than returning partial output', async () => {
    for (const fetcher of [
      () => Promise.resolve(new Response('x'.repeat(1024 * 1024 + 1))),
      () => Promise.resolve(new Response('x'.repeat(1024 * 1024 + 1) + '\n')),
      () => Promise.resolve(new Response(new Uint8Array(8 * 1024 * 1024 + 1))),
    ])
      expect((await failure(fetcher)).at(-1)).toMatchObject({ code: 'HARNESS_OUTPUT_LIMIT' });
  });
  it.each([
    [400, 'HARNESS_TURN_FAILED', 'definitely-not-submitted'],
    [401, 'HARNESS_NOT_AUTHENTICATED', 'definitely-not-submitted'],
    [403, 'HARNESS_NOT_AUTHENTICATED', 'definitely-not-submitted'],
    [404, 'HARNESS_MODEL_UNAVAILABLE', 'definitely-not-submitted'],
    [429, 'HARNESS_QUOTA_EXHAUSTED', 'delivery-uncertain'],
    [503, 'HARNESS_TRANSPORT_FAILED', 'delivery-uncertain'],
  ])('maps HTTP %s without leaking server diagnostics', async (status, code, submission) => {
    expect(
      (
        await failure(() =>
          Promise.resolve(new Response('secret server body', { status: Number(status) })),
        )
      ).at(-1),
    ).toMatchObject({ code, submission, retriable: false });
  });
  it('does not classify dispatched transport failures as safely repeatable', async () => {
    const fetcher = vi.fn<OllamaFetch>(() => {
      return Promise.reject(new Error('secret credentials'));
    });
    const recorded = await failure(fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(recorded.at(-1)).toMatchObject({
      code: 'HARNESS_TRANSPORT_FAILED',
      submission: 'delivery-uncertain',
      retriable: false,
    });
  });
  it('refuses native resume, unavailable models, unsupported policies and false effort mappings before dispatch', async () => {
    const fetcher = vi.fn<OllamaFetch>();
    const native = harness(fetcher);
    const resumed = native.resume('ollama:old', request, new AbortController().signal);
    await expect(resumed.result).rejects.toMatchObject({
      code: 'HARNESS_SESSION_MISSING',
      submission: 'session-missing',
    });
    for (const changed of [
      { ...request, options: { sandbox: 'workspace-write' as const, approval: 'never' as const } },
      { ...request, effort: 'high' as const },
      { ...request, model: 'missing:tag' },
    ])
      await expect(
        native.start(changed, new AbortController().signal).result,
      ).rejects.toBeDefined();
    for (const changedModel of [
      { ...model, thinkingByEffort: { none: 'none' } },
      { ...model, efforts: ['high' as const], thinkingByEffort: {} },
      { ...model, enabled: false },
    ]) {
      const invalid = new OllamaHarness({
        fetcher,
        snapshot: () => Promise.resolve({ connection, models: [changedModel] }),
      });
      await expect(
        invalid.start(
          { ...request, effort: changedModel.efforts[0] ?? 'none' },
          new AbortController().signal,
        ).result,
      ).rejects.toBeDefined();
    }
    const disabled = new OllamaHarness({
      fetcher,
      snapshot: () =>
        Promise.resolve({ connection: { ...connection, enabled: false }, models: [] }),
    });
    await expect(
      disabled.start(request, new AbortController().signal).result,
    ).rejects.toMatchObject({ code: 'HARNESS_INVALID_CONFIGURATION' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('supports proven named thinking controls exactly', async () => {
    const named = discoveredModel(model.model, model.digest, 1, at, {
      capabilities: ['completion', 'thinking'],
      thinking: { values: ['high'] },
    });
    const fetcher = vi.fn<OllamaFetch>(() => Promise.resolve(response([terminal])));
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [named] }),
    });
    await native.start({ ...request, effort: 'high' }, new AbortController().signal).result;
    expect(JSON.parse(bodyText(fetcher.mock.calls[0]?.[1]?.body)).think).toBe('high');
  });
  it('cancels before dispatch, while connecting and while streaming', async () => {
    const already = new AbortController();
    already.abort();
    await expect(harness().start(request, already.signal).result).rejects.toMatchObject({
      name: 'AbortError',
    });
    const pendingFetch: OllamaFetch = (_url, init) =>
      Promise.resolve(
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      );
    const connecting = harness(pendingFetch).start(request, new AbortController().signal);
    await new Promise((resolve) => setImmediate(resolve));
    await connecting.cancel();
    await expect(connecting.result).rejects.toMatchObject({ name: 'AbortError' });
    let cancelled = false;
    const streaming = harness(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ),
    ).start(request, new AbortController().signal);
    await new Promise((resolve) => setImmediate(resolve));
    await streaming.cancel();
    await expect(streaming.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });
  it('checks final dispatch guard before HTTP and preserves response evidence when owner disable closes a stream', async () => {
    const owner = new AbortController();
    let checks = 0;
    const fetcher = vi.fn<OllamaFetch>(() => Promise.resolve(response([terminal])));
    const guarded = new OllamaHarness({
      snapshot: () => Promise.resolve({ connection, models: [model] }),
      fetcher,
      guard: () =>
        Promise.resolve({
          signal: owner.signal,
          check() {
            if (++checks === 2)
              throw new OllamaError('HARNESS_INVALID_CONFIGURATION', 'Ollama is off in Settings');
          },
        }),
    });
    await expect(guarded.start(request, new AbortController().signal).result).rejects.toMatchObject(
      { submission: 'definitely-not-submitted' },
    );
    expect(fetcher).not.toHaveBeenCalled();
    const activeOwner = new AbortController();
    let cancelled = false;
    const streaming = new OllamaHarness({
      snapshot: () => Promise.resolve({ connection, models: [model] }),
      guard: () => Promise.resolve({ signal: activeOwner.signal, check() {} }),
      fetcher: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      done: false,
                      message: { role: 'assistant', content: 'partial' },
                    }) + '\n',
                  ),
                );
              },
              cancel() {
                cancelled = true;
              },
            }),
          ),
        ),
    });
    const session = streaming.start(request, new AbortController().signal);
    const recorded: HarnessEvent[] = [];
    const collected = (async () => {
      for await (const event of session.events) {
        recorded.push(event);
        if (event.type === 'submitted') activeOwner.abort();
      }
    })();
    await expect(session.result).rejects.toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      submission: 'delivery-uncertain',
      retriable: false,
    });
    await collected;
    expect(cancelled).toBe(true);
    expect(recorded).toContainEqual({ type: 'submitted', marker: 'ollama.response' });
    expect(recorded.at(-1)).toMatchObject({ type: 'error', submission: 'delivery-uncertain' });
  });
  it('probes metadata only and reports service-specific ready/auth/quota/transport/protocol states', async () => {
    expect(await harness(() => Promise.resolve(new Response('{"models":[]}'))).preflight()).toEqual(
      { state: 'ready', ok: true, problems: [] },
    );
    for (const [fetcher, state] of [
      [() => Promise.resolve(new Response('', { status: 401 })), 'auth'],
      [() => Promise.resolve(new Response('', { status: 429 })), 'quota'],
      [
        () => {
          return Promise.reject(new Error('offline'));
        },
        'transport',
      ],
      [() => Promise.resolve(new Response('{}')), 'unknown'],
    ] as const)
      expect(await harness(fetcher).preflight()).toMatchObject({ ok: false, state });
    expect(
      await new OllamaHarness({
        snapshot: () =>
          Promise.resolve({ connection: { ...connection, enabled: false }, models: [] }),
      }).preflight(),
    ).toMatchObject({ state: 'unknown', ok: false });
  });
});

function bodyText(value: RequestInit['body']): string {
  return typeof value === 'string' ? value : '';
}
