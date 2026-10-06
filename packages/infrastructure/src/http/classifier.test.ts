import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChoiceRequest } from '@graphgoblin/engine';
import { HttpChoiceClassifier } from './classifier.js';

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
      server!.closeAllConnections();
    });
  server = undefined;
});
const request: ChoiceRequest = {
  question: 'Route this',
  options: [
    { label: 'yes', description: 'approved' },
    { label: 'no', description: 'rejected' },
  ],
  context: { value: 1 },
};
const valid = {
  answers: { answer: { type: 'choice', choice: 'yes', probabilities: { yes: 0.8, no: 0.2 } } },
};
async function endpoint(body: unknown = valid, status = 200, delay = false) {
  const calls: {
    url: string | undefined;
    method: string | undefined;
    auth: string | undefined;
    body: unknown;
  }[] = [];
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let text = '';
    for await (const chunk of req) text += String(chunk);
    calls.push({
      url: req.url,
      method: req.method,
      auth: req.headers.authorization,
      body: JSON.parse(text) as unknown,
    });
    if (delay) return;
    res.writeHead(status, {
      'content-type': 'application/json',
      ...(status >= 300 && status < 400 ? { location: '/redirect-target' } : {}),
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  server = createServer((req, res) => {
    void handle(req, res).catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return { url: `http://127.0.0.1:${address.port}/api/`, calls };
}
describe('HTTP Choice classifier', () => {
  it.each([undefined, 'private-test-key'])(
    'sends the exact protocol, provider id, state, and optional bearer (%s)',
    async (bearer) => {
      const fixture = await endpoint();
      const client = new HttpChoiceClassifier({
        endpoint: fixture.url,
        providerModel: 'kev-native',
        ...(bearer ? { bearer } : {}),
      });
      expect(await client.choose(request, new AbortController().signal)).toEqual({
        label: 'yes',
        confidence: 0.8,
        alternatives: [{ label: 'no', confidence: 0.2 }],
      });
      expect(fixture.calls).toEqual([
        {
          url: '/api/v1/systemone',
          method: 'POST',
          auth: bearer ? `Bearer ${bearer}` : undefined,
          body: {
            model: 'kev-native',
            state: request.context,
            questions: {
              answer: {
                type: 'choice',
                instructions: 'Route this',
                criteria: { yes: 'approved', no: 'rejected' },
              },
            },
          },
        },
      ]);
    },
  );
  it('preserves explicit confidence and sorts alternatives', async () => {
    const fixture = await endpoint({
      model: 'kev',
      usage: { input_tokens: 1 },
      answers: {
        answer: {
          ...valid.answers.answer,
          confidence: 0.9,
          probabilities: { yes: 0.6, no: 0.1, maybe: 0.3 },
        },
      },
    });
    const result = await new HttpChoiceClassifier({
      endpoint: fixture.url,
      providerModel: 'kev',
    }).choose(
      { ...request, options: [...request.options, { label: 'maybe', description: 'uncertain' }] },
      new AbortController().signal,
    );
    expect(result).toEqual({
      label: 'yes',
      confidence: 0.9,
      alternatives: [
        { label: 'maybe', confidence: 0.3 },
        { label: 'no', confidence: 0.1 },
      ],
    });
  });
  it.each([
    '{broken',
    {},
    { answers: { answer: { type: 'noul' } } },
    { answers: { answer: { ...valid.answers.answer, probabilities: { yes: 0.8 } } } },
    { answers: { answer: { ...valid.answers.answer, probabilities: { yes: 0.8, extra: 0.2 } } } },
    {
      answers: {
        answer: { ...valid.answers.answer, probabilities: { yes: 0.8, no: 0.1, extra: 0.1 } },
      },
    },
    { answers: { answer: { ...valid.answers.answer, probabilities: { yes: -0.1, no: 1.1 } } } },
    { answers: { answer: { ...valid.answers.answer, probabilities: { yes: null, no: 0 } } } },
    { answers: { answer: { ...valid.answers.answer, confidence: 1.1 } } },
  ])('rejects malformed Choice response %j', async (body) => {
    const fixture = await endpoint(body);
    await expect(
      new HttpChoiceClassifier({ endpoint: fixture.url, providerModel: 'kev' }).choose(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DECIDER_INVALID_RESPONSE' });
  });
  it.each([undefined, 0.7])(
    'rejects a bearer echoed as the choice without retaining it (confidence %s)',
    async (confidence) => {
      const bearer = 'gg-provider-bearer-private-regression';
      const fixture = await endpoint({
        answers: {
          answer: {
            ...valid.answers.answer,
            choice: bearer,
            ...(confidence !== undefined ? { confidence } : {}),
          },
        },
      });
      const answer = await new HttpChoiceClassifier({
        endpoint: fixture.url,
        providerModel: 'kev',
        bearer,
      })
        .choose(request, new AbortController().signal)
        .catch((error: unknown) => error);
      expect(answer).toMatchObject({
        code: 'DECIDER_INVALID_RESPONSE',
        message: 'Classifier choice must be one of the submitted labels',
      });
      expect(String(answer)).not.toContain(bearer);
      expect(fixture.calls[0]?.auth).toBe(`Bearer ${bearer}`);
    },
  );
  it.each(['', ' yes', 'YES', 'yеs', '__proto__', 'constructor'])(
    'requires exact label membership for choice %j',
    async (choice) => {
      const fixture = await endpoint({ answers: { answer: { ...valid.answers.answer, choice } } });
      await expect(
        new HttpChoiceClassifier({ endpoint: fixture.url, providerModel: 'kev' }).choose(
          request,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: 'DECIDER_INVALID_RESPONSE',
        message: 'Classifier choice must be one of the submitted labels',
      });
    },
  );
  it.each([301, 302, 307, 308])(
    'reports HTTP %i redirects without following or echoing the bearer',
    async (status) => {
      const fixture = await endpoint('private-test-key', status);
      const error: unknown = await new HttpChoiceClassifier({
        endpoint: fixture.url,
        providerModel: 'kev',
        bearer: 'private-test-key',
      })
        .choose(request, new AbortController().signal)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: 'DECIDER_REDIRECT',
        status,
        message: 'Classifier redirects are not followed',
      });
      expect(fixture.calls.map((call) => call.url)).toEqual(['/api/v1/systemone']);
      expect(String(error)).not.toContain('private-test-key');
    },
  );
  it.each([
    [401, 'DECIDER_NOT_AUTHENTICATED'],
    [403, 'DECIDER_NOT_AUTHENTICATED'],
    [429, 'DECIDER_RATE_LIMITED'],
    [400, 'DECIDER_HTTP_ERROR'],
    [503, 'DECIDER_HTTP_ERROR'],
  ])('maps HTTP %i without echoing credentials', async (status, code) => {
    const fixture = await endpoint('private-test-key', Number(status));
    const client = new HttpChoiceClassifier({
      endpoint: fixture.url,
      providerModel: 'kev',
      bearer: 'private-test-key',
    });
    const error: unknown = await client
      .choose(request, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code, status });
    expect(String(error)).not.toContain('private-test-key');
  });
  it('times out and preserves caller cancellation', async () => {
    const fixture = await endpoint(valid, 200, true);
    await expect(
      new HttpChoiceClassifier({
        endpoint: fixture.url,
        providerModel: 'kev',
        timeoutMs: 20,
      }).choose(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DECIDER_TIMEOUT' });
    const abort = new AbortController();
    const pending = new HttpChoiceClassifier({
      endpoint: fixture.url,
      providerModel: 'kev',
    }).choose(request, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('maps connection failures and ignores transport diagnostics that echo credentials', async () => {
    const fixture = await endpoint();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    await expect(
      new HttpChoiceClassifier({ endpoint: fixture.url, providerModel: 'kev' }).choose(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'DECIDER_UNREACHABLE' });
    const client = new HttpChoiceClassifier({
      endpoint: fixture.url,
      providerModel: 'kev',
      fetch: () => Promise.reject(new Error('private-test-key')),
    });
    await expect(client.choose(request, new AbortController().signal)).rejects.toThrow(
      'Classifier endpoint is unreachable',
    );
  });
  it('maps an abort during body consumption to timeout or caller cancellation', async () => {
    const fetch = (_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new Error('private-test-key')), {
              once: true,
            });
          }),
      } as Response);
    await expect(
      new HttpChoiceClassifier({
        endpoint: 'http://localhost',
        providerModel: 'kev',
        timeoutMs: 20,
        fetch,
      }).choose(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DECIDER_TIMEOUT' });
  });
});
