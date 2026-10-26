import { createServer, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import { createTestApp } from './testing/test-app.js';

let response: ServerResponse | undefined;
function closePending() {
  response?.end();
}
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    response = res;
  });
});
let receiverUrl: string;
beforeAll(async () => {
  await new Promise<void>((ok) => receiver.listen(0, '127.0.0.1', ok));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw Error('Missing receiver address');
  receiverUrl = 'http://127.0.0.1:' + address.port;
});
afterAll(async () => {
  receiver.closeAllConnections();
  await new Promise<void>((ok) => receiver.close(() => ok()));
});

it.each([200, 400])(
  'keeps terminal and consumed-cursor streams live until HTTP %i finalization',
  { timeout: 20_000 },
  async (status) => {
    response = undefined;
    const api = await createTestApp();
    const base = await api.app.listen({ host: '127.0.0.1', port: 0 });
    const controllers: AbortController[] = [];
    try {
      const loopId = await api.publishLoop({
        schemaVersion: 4,
        name: 'Finalization ' + status,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              returns: 'trigger.payload',
              destinations: [{ kind: 'webhook', url: receiverUrl }],
            },
          },
        ],
        edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      });
      const started = await api.app.inject({
        method: 'POST',
        url: '/loops/' + loopId + '/runs',
        payload: { input: 42 },
      });
      const { run } = started.json<{ run: { id: string } }>();
      await vi.waitFor(() => expect(response).toBeDefined());
      const history = (await api.app.inject('/runs/' + run.id + '/events')).json<{
        items: { seq: number; type: string }[];
      }>();
      const terminal = history.items.find((event) => event.type === 'run.finished')!;
      const streams = await Promise.all(
        [0, terminal.seq, terminal.seq + 100].map(async (after) => {
          const controller = new AbortController();
          controllers.push(controller);
          const http = await fetch(base + '/runs/' + run.id + '/events?after=' + after, {
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
          });
          let complete = false;
          const text = http.text().then((body) => {
            complete = true;
            return body;
          });
          return { after, text, complete: () => complete };
        }),
      );
      // Longer than the old 2-second terminal grace: pending delivery is a live stream.
      await new Promise((ok) => setTimeout(ok, 2100));
      expect(streams.map((stream) => stream.complete())).toEqual([false, false, false]);
      const pending = (await api.app.inject('/runs/' + run.id)).json<RunRecord>();
      expect(pending.status).toBe('succeeded');
      expect(pending.finalizedAt).toBeUndefined();
      expect(pending.deliveries?.[0]?.status).toBe('pending');
      response!.writeHead(status).end('ack');
      await api.idle();
      const bodies = await Promise.all(streams.map((stream) => stream.text));
      expect(bodies[0]).toContain('event: delivery.finished');
      expect(bodies[1]).toContain('event: delivery.finished');
      expect(bodies[2]).not.toContain('event: delivery.finished');
      for (const body of bodies) expect(body).toContain('event: stream.complete');
      const final = (await api.app.inject('/runs/' + run.id)).json<RunRecord>();
      expect(final.finalizedAt).toEqual(expect.any(String));
      expect(final.status).toBe('succeeded');
      expect(final.deliveries?.[0]?.status).toBe(status === 200 ? 'delivered' : 'failed');
      const alreadyConsumed = await fetch(
        base + '/runs/' + run.id + '/events?after=' + final.lastEventSeq,
        { headers: { accept: 'text/event-stream' } },
      );
      expect(await alreadyConsumed.text()).toContain('event: stream.complete');
    } finally {
      controllers.forEach((controller) => controller.abort());
      closePending();
      await api.close();
    }
  },
);
