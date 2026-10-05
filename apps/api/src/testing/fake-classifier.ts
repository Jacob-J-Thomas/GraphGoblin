import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface FakeClassifierRequest {
  url: string | undefined;
  method: string | undefined;
  authorization: string | undefined;
  body: {
    model: string;
    state: unknown;
    questions: {
      answer: { type: 'choice'; instructions: string; criteria: Record<string, string> };
    };
  };
}
export interface FakeClassifierResponse {
  status?: number;
  body: unknown;
}

/** Reusable loopback-only Choice endpoint for backend tests and the web E2E consumer. */
export async function startFakeClassifierEndpoint() {
  const requests: FakeClassifierRequest[] = [];
  let respond = (
    request: FakeClassifierRequest,
  ): FakeClassifierResponse | Promise<FakeClassifierResponse> => {
    const labels = Object.keys(request.body.questions.answer.criteria);
    return {
      body: {
        model: request.body.model,
        answers: {
          answer: {
            type: 'choice',
            choice: labels[0],
            probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])),
          },
        },
      },
    };
  };
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    const call: FakeClassifierRequest = {
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      body: JSON.parse(text) as FakeClassifierRequest['body'],
    };
    requests.push(call);
    const result = await respond(call);
    response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
    response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake classifier did not bind TCP');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    respondWith(responder: typeof respond) {
      respond = responder;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
