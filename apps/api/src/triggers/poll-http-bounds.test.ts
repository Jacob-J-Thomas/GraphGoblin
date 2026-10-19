import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { HTTP_PROBE_MAX_BODY_BYTES } from '@graphgoblin/engine';
import { CapturingLogger, FakeClock, FakeScripts } from '@graphgoblin/engine/testing';
import { HttpProbes } from '@graphgoblin/infrastructure/http';
import { PollTriggers } from './poll.js';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
});

describe('poll HTTP overflow diagnostics', () => {
  it.each([false, true])(
    'refuses overflow without dispatch and exposes its typed code (items: %s)',
    async (items) => {
      let oversized = true;
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(oversized ? ' '.repeat(HTTP_PROBE_MAX_BODY_BYTES) : '');
        res.end(JSON.stringify({ ready: oversized, items: [1] }));
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const clock = new FakeClock();
      const logger = new CapturingLogger();
      const startRun = vi.fn(() => Promise.reject(new Error('must not dispatch')));
      const startPollItem = vi.fn(() => Promise.reject(new Error('must not dispatch')));
      const polls = new PollTriggers({
        clock,
        logger,
        probes: new HttpProbes(),
        scripts: new FakeScripts(),
        manager: { startRun, startPollItem },
        hasDedupe: () => Promise.resolve(false),
        findSeen: () => Promise.resolve(new Set()),
        scriptCwd: process.cwd(),
      });
      const definition = LoopDefinitionSchema.parse({
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'bounded probe',
        nodes: [
          {
            id: 'poll',
            kind: 'trigger',
            label: 'Poll',
            config: {
              type: 'poll',
              intervalSeconds: 5,
              enabled: true,
              probe: { kind: 'http', method: 'GET', url, timeoutSeconds: 10 },
              fireWhen: 'probe.json.ready',
              ...(items
                ? { items: { select: 'probe.json.items', dedupeKey: '$string(item)' } }
                : {}),
            },
          },
        ],
        edges: [],
      });
      const now = clock.now().toISOString();
      polls.arm(
        { id: 'loop', name: 'bounded probe', ownerId: 'local', createdAt: now, updatedAt: now },
        {
          id: 'version',
          loopId: 'loop',
          version: 1,
          status: 'published',
          definition,
          createdAt: now,
        },
      );
      clock.advance(5000);
      expect(await polls.poll()).toEqual([]);
      expect(logger.lines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          msg: 'poll trigger failed',
          obj: expect.objectContaining({ code: 'HTTP_PROBE_BODY_OVERFLOW' }),
        }),
      );
      expect(startRun).not.toHaveBeenCalled();
      expect(startPollItem).not.toHaveBeenCalled();
      // A failed bounded read must not strand the serialized sweep or poison later probes.
      oversized = false;
      const warnings = logger.lines.length;
      clock.advance(5000);
      expect(await polls.poll()).toEqual([]);
      expect(logger.lines).toHaveLength(warnings);
    },
  );
});
