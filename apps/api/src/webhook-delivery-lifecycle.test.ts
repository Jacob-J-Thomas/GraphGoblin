import { createServer, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestApp } from './testing/test-app.js';

const held = new Set<ServerResponse>();
const requests: string[] = [];
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    requests.push(req.url ?? '');
    if (req.url === '/backoff' && requests.filter((p) => p === req.url).length === 1)
      res.writeHead(503).end();
    else if (req.url === '/backoff') res.writeHead(200).end();
    else {
      held.add(res);
      res.once('close', () => held.delete(res));
    }
  });
});
let url: string;
beforeAll(async () => {
  await new Promise<void>((ok) => receiver.listen(0, '127.0.0.1', ok));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw Error('Missing receiver address');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  receiver.closeAllConnections();
  await new Promise<void>((ok) => receiver.close(() => ok()));
});

it.each(['in-flight', 'backoff'])(
  'loop deletion stops a webhook during %s without orphan events',
  { timeout: 20_000 },
  async (phase) => {
    const api = await createTestApp();
    try {
      const loopId = await api.publishLoop({
        schemaVersion: 4,
        name: 'Delete during ' + phase,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              returns: 'trigger.payload',
              destinations: [{ kind: 'webhook', url: url + '/' + phase }],
            },
          },
        ],
        edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      });
      const started = await api.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: { input: {} },
      });
      const { run } = started.json<{ run: { id: string } }>();
      await vi.waitFor(async () => {
        const detail = await api.container.ports.runs.get(run.id);
        expect(detail?.deliveries?.[0]).toMatchObject({
          status: 'pending',
          attempts: 1,
          inFlight: phase === 'in-flight',
        });
        expect(requests.filter((p) => p === '/' + phase)).toHaveLength(1);
      });
      expect((await api.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
        204,
      );
      for (const response of held) response.writeHead(200).end('ack');
      await api.idle();
      expect(requests.filter((p) => p === '/' + phase)).toHaveLength(1);
      expect((await api.app.inject({ method: 'GET', url: '/runs/' + run.id })).statusCode).toBe(
        404,
      );
      expect(await api.container.ports.events.read(run.id)).toEqual([]);
      expect(api.logger.lines).toContainEqual(
        expect.objectContaining({ level: 'info', msg: 'webhook delivery stopped: run deleted' }),
      );
      expect(api.logger.lines.filter((line) => line.level === 'error')).toEqual([]);
    } finally {
      for (const response of held) response.writeHead(200).end('ack');
      await api.close();
    }
  },
);
