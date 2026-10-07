import type { SecretsPort } from '@graphgoblin/engine';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, JevError, createJevDecider, type JevDeciderOptions } from './index.js';

type FetchArgs = [string, RequestInit | undefined];

function secrets(values: Record<string, string | undefined>): SecretsPort {
  return { resolve: (name) => Promise.resolve(values[name]) };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubFetch(...responses: (Response | Error)[]) {
  const calls: FetchArgs[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift() ?? new Error('no stubbed response left');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetch, calls };
}

async function ready(
  options: Partial<JevDeciderOptions> & { fetch: NonNullable<JevDeciderOptions['fetch']> },
) {
  const decider = createJevDecider({
    secrets: secrets({ 'jev-api-key': ' sk-test ' }),
    retry: { maxRetries: 0 },
    ...options,
  });
  await decider.init();
  return decider;
}

const choiceRequest = {
  question: 'Is the change ready?',
  options: [
    { id: 'ship', label: 'ship', criteria: 'ready to merge' },
    { id: 'fix', label: 'fix', criteria: 'needs work' },
    { id: 'drop', label: 'drop', criteria: 'abandon it' },
  ],
  context: { diff: 'x' },
};

const signal = () => new AbortController().signal;

describe('availability', () => {
  it('is available once the key resolves, and not before', async () => {
    const decider = createJevDecider({ secrets: secrets({ 'jev-api-key': 'k' }) });
    expect(decider.id).toBe('jev');
    expect(decider.available()).toBe(false);
    await decider.init();
    expect(decider.available()).toBe(true);
  });

  it('is unavailable without a key, with a blank key, or when the secret store fails', async () => {
    const missing = createJevDecider({ secrets: secrets({}) });
    await missing.init();
    expect(missing.available()).toBe(false);
    await expect(missing.choose(choiceRequest, signal())).rejects.toMatchObject({
      code: 'DECIDER_UNAVAILABLE',
    });
    await expect(missing.judge({ question: 'q', context: null }, signal())).rejects.toBeInstanceOf(
      JevError,
    );

    const blank = createJevDecider({ secrets: secrets({ 'jev-api-key': '   ' }) });
    await blank.init();
    expect(blank.available()).toBe(false);

    const warn = vi.fn();
    const broken = createJevDecider({
      secrets: { resolve: () => Promise.reject(new Error('keyring locked')) },
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    await broken.init();
    expect(broken.available()).toBe(false);
    expect(warn).toHaveBeenCalledWith({ err: 'keyring locked' }, expect.any(String));
  });

  it('stays unavailable when the SDK rejects the configuration', async () => {
    const decider = createJevDecider({ secrets: secrets({ 'jev-api-key': 'k' }), timeoutMs: -1 });
    await decider.init();
    expect(decider.available()).toBe(false);
    await expect(decider.refresh()).rejects.toThrow(/timeout/);
  });

  it('honours a custom secret name and picks up a new key on refresh', async () => {
    const values: Record<string, string | undefined> = {};
    const decider = createJevDecider({ secrets: secrets(values), secretName: 'my-jev' });
    await decider.init();
    expect(decider.available()).toBe(false);
    values['my-jev'] = 'k2';
    await decider.refresh();
    expect(decider.available()).toBe(true);
    values['my-jev'] = undefined;
    await decider.refresh();
    expect(decider.available()).toBe(false);
  });
});

describe('choose', () => {
  it.each([
    { ship: 0.8, fix: 0.1, drop: 0.1, 'gg-private-alternative-regression': 0.1 },
    { ship: 0.8, fix: 0.2 },
    { ship: 0.8, fix: 0.1, 'gg-private-alternative-regression': 0.1 },
  ])('requires exactly the submitted probability labels (%j)', async (probabilities) => {
    const { fetch } = stubFetch(
      json(200, { answers: { answer: { type: 'choice', choice: 'ship', probabilities } } }),
    );
    const decider = await ready({ fetch });
    await expect(decider.choose(choiceRequest, signal())).rejects.toMatchObject({
      code: 'DECIDER_INVALID_RESPONSE',
      message: 'Unexpected Jev choice response',
    });
  });
  it('sends a choice question and maps label, confidence, and ranked alternatives', async () => {
    const { fetch, calls } = stubFetch(
      json(
        200,
        {
          model: 'jev-1',
          answers: {
            answer: {
              type: 'choice',
              choice: 'ship',
              confidence: 0.81,
              probabilities: { ship: 0.81, fix: 0.04, drop: 0.15 },
            },
          },
          usage: { input_tokens: 120, output_tokens: 0 },
        },
        { 'x-typesafe-request-id': 'req_1' },
      ),
    );
    const decider = await ready({ fetch, baseUrl: 'https://jev.example/', model: 'jev-2' });
    const result = await decider.choose(choiceRequest, signal());
    expect(result).toEqual({
      type: 'choice',
      optionId: 'ship',
      confidence: 0.81,
      probabilities: { ship: 0.81, fix: 0.04, drop: 0.15 },
    });
    const [url, init] = calls[0]!;
    expect(url).toBe('https://jev.example/v1/systemone');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init?.body as string)).toEqual({
      state: { diff: 'x' },
      questions: {
        answer: {
          type: 'choice',
          instructions: 'Is the change ready?',
          criteria: { ship: 'ready to merge', fix: 'needs work', drop: 'abandon it' },
        },
      },
      model: 'jev-2',
    });
  });

  it('passes low-confidence answers through for the engine to compare with minConfidence', async () => {
    const { fetch, calls } = stubFetch(
      json(200, {
        answers: {
          answer: {
            type: 'choice',
            choice: 'fix',
            probabilities: { ship: 0.35, fix: 0.4, drop: 0.25 },
          },
        },
      }),
    );
    const decider = await ready({ fetch, timeoutMs: 5000 });
    const result = await decider.choose({ ...choiceRequest, context: 7 }, signal());
    // Without a reported confidence, the chosen label's probability is used.
    expect(result.confidence).toBe(0.4);
    expect(result.probabilities).toEqual({ ship: 0.35, fix: 0.4, drop: 0.25 });
    expect(calls[0]![0]).toBe(`${DEFAULT_BASE_URL}/v1/systemone`);
    const body = JSON.parse(calls[0]![1]?.body as string);
    expect(body.state).toEqual({ value: 7 });
    expect(body.model).toBe('jev-latest');
  });

  it('rejects unknown choices even with a complete probability map', async () => {
    const { fetch } = stubFetch(
      json(200, {
        answers: {
          answer: {
            type: 'choice',
            choice: 'unknown',
            probabilities: { ship: 0.8, fix: 0.1, drop: 0.1 },
          },
        },
      }),
    );
    await expect((await ready({ fetch })).choose(choiceRequest, signal())).rejects.toMatchObject({
      code: 'DECIDER_INVALID_RESPONSE',
    });
  });

  it('rejects malformed responses', async () => {
    const { fetch } = stubFetch(
      json(200, { answers: { answer: { type: 'noul', noul: 0.3 } } }),
      json(200, { answers: {} }),
      new Response('not json at all', { status: 200 }),
      json(200, {
        answers: { answer: { type: 'choice', choice: 'ship', probabilities: { ship: 4 } } },
      }),
    );
    const decider = await ready({ fetch });
    for (let i = 0; i < 4; i += 1) {
      await expect(decider.choose(choiceRequest, signal())).rejects.toMatchObject({
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
  });
});

describe('judge', () => {
  it('sends a noul question and maps the probability of yes', async () => {
    const { fetch, calls } = stubFetch(
      json(200, { answers: { answer: { type: 'noul', noul: 0.9 } } }),
      json(200, { answers: { answer: { type: 'noul', noul: 0.2 } } }),
    );
    const decider = await ready({ fetch });
    expect(await decider.judge({ question: 'Done?', context: 'all tests pass' }, signal())).toEqual(
      { holds: true, confidence: 0.9 },
    );
    expect(await decider.judge({ question: 'Done?', context: null }, signal())).toEqual({
      holds: false,
      confidence: 0.8,
    });
    expect(JSON.parse(calls[0]![1]?.body as string)).toMatchObject({
      state: 'all tests pass',
      questions: { answer: { type: 'noul', instructions: 'Done?' } },
    });
  });

  it('rejects a malformed yes/no response', async () => {
    const { fetch } = stubFetch(json(200, { answers: { answer: { type: 'noul', noul: 'yes' } } }));
    const decider = await ready({ fetch });
    await expect(decider.judge({ question: 'q', context: [] }, signal())).rejects.toMatchObject({
      code: 'DECIDER_INVALID_RESPONSE',
    });
  });
});

describe('errors', () => {
  it.each(['choose', 'judge'] as const)(
    'never reflects an HTTP error body from %s',
    async (method) => {
      const marker = 'gg-private-exit-error-regression';
      const { fetch } = stubFetch(json(400, { error: { message: marker } }));
      const decider = await ready({ fetch });
      const request =
        method === 'choose'
          ? decider.choose(choiceRequest, signal())
          : decider.judge({ question: 'Done?', context: null }, signal());
      await expect(request).rejects.toMatchObject({
        code: 'DECIDER_HTTP_ERROR',
        status: 400,
        message: 'Jev request failed (400)',
      });
    },
  );
  it('maps HTTP failures to coded errors', async () => {
    const { fetch } = stubFetch(
      json(401, { error: 'invalid key' }),
      json(403, { error: 'forbidden' }),
      json(429, { error: 'slow down' }),
      json(500, { error: 'boom' }),
      json(422, { error: 'bad state' }),
    );
    const decider = await ready({ fetch });
    const codes: [string, number | undefined][] = [];
    for (let i = 0; i < 5; i += 1) {
      const error = (await decider
        .choose(choiceRequest, signal())
        .catch((e: unknown) => e)) as JevError;
      codes.push([error.code, error.status]);
    }
    expect(codes).toEqual([
      ['DECIDER_NOT_AUTHENTICATED', 401],
      ['DECIDER_NOT_AUTHENTICATED', 403],
      ['DECIDER_RATE_LIMITED', 429],
      ['DECIDER_HTTP_ERROR', 500],
      ['DECIDER_HTTP_ERROR', 422],
    ]);
  });

  it('maps connection failures and aborts', async () => {
    const { fetch } = stubFetch(new TypeError('fetch failed'), new TypeError('fetch failed'));
    const decider = await ready({ fetch });
    await expect(decider.judge({ question: 'q', context: {} }, signal())).rejects.toMatchObject({
      code: 'DECIDER_UNREACHABLE',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      decider.judge({ question: 'q', context: {} }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('retries transient failures through the SDK when retries are enabled', async () => {
    const { fetch } = stubFetch(
      json(503, { error: 'busy' }),
      json(200, { answers: { answer: { type: 'noul', noul: 0.7 } } }),
    );
    const decider = await ready({
      fetch,
      retry: { maxRetries: 1, backoffInitialMs: 0, backoffMaxMs: 0 },
    });
    expect((await decider.judge({ question: 'q', context: {} }, signal())).holds).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('wraps an unexpected SDK failure', async () => {
    const decider = await ready({ fetch: stubFetch().fetch });
    const client = (decider as unknown as { client: { systemOne: () => never } }).client;
    client.systemOne = () => {
      throw new Error('weird');
    };
    await expect(decider.choose(choiceRequest, signal())).rejects.toMatchObject({
      code: 'DECIDER_HTTP_ERROR',
      message: 'Jev request failed',
    });
  });

  it('routes SDK logs to the engine logger', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { fetch } = stubFetch(json(200, { answers: { answer: { type: 'noul', noul: 0.5 } } }));
    const decider = await ready({ fetch, logger: log });
    await decider.judge({ question: 'q', context: {} }, signal());
    expect(log.debug).toHaveBeenCalledWith({}, expect.stringMatching(/^jev: /));
    const sdkLogger = (
      decider as unknown as { client: { logger: Record<'warn' | 'error', (m: string) => void> } }
    ).client.logger;
    sdkLogger.warn('w');
    sdkLogger.error('e');
    expect(log.warn).toHaveBeenCalledWith({}, 'jev: SDK warning');
    expect(log.warn).toHaveBeenCalledWith({}, 'jev: SDK error');
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/jev: [we]"/);
    expect(log.error).not.toHaveBeenCalled();
  });
});
