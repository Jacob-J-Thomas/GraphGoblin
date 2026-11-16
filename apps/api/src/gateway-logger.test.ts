import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { symbols } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { loadConfig } from './config.js';
import {
  createGatewayLogger,
  managedAccessSerializers,
  managedClientErrorHandler,
} from './gateway-logger.js';
import { createTestApp } from './testing/test-app.js';
import { openGatewayLog, type GatewayLogWriter } from './managed-log/gateway-log-writer.js';

const roots: string[] = [];
const writers: GatewayLogWriter[] = [];
afterEach(async () => {
  for (const writer of writers.splice(0)) await writer.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

const ACCESS_CANARIES = [
  'GG_QUERY_CANARY',
  'GG_VERSION_CANARY',
  'GG_HEADER_CANARY',
  'GG_BEARER_CANARY',
];

async function managedLogger(level = 'info') {
  const root = await mkdtemp(join(tmpdir(), 'gg-managed-logger-'));
  roots.push(root);
  const writer = await openGatewayLog({ root });
  writers.push(writer);
  const config = loadConfig({ GG_DATA_DIR: root, GG_LOG_LEVEL: level });
  return { root, writer, logger: createGatewayLogger(config, writer) };
}

async function records(root: string, writer: GatewayLogWriter) {
  expect(await writer.settle(5_000)).toBe(true);
  const text = await readFile(join(root, 'gateway.log'), 'utf8');
  return {
    text,
    lines: text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

it('keeps the correlated private #381 diagnostic and narrows real access records to method, route and status', async () => {
  const { root, writer, logger } = await managedLogger();
  const fixture = await createTestApp({
    serverLogger: logger,
    harnesses: { codex: new FakeHarness() },
  });
  try {
    // The same unexpected storage fault the engine's #381 boundary test uses, here composed with
    // the real repositories, HTTP app and managed Pino destination.
    const fault = new TypeError('GG_PRIVATE_RUN_CANARY unexpected engine fault');
    fault.stack =
      'TypeError: GG_PRIVATE_RUN_CANARY\n    at D:/GG_PRIVATE_STACK_CANARY/engine.ts:12:1';
    vi.spyOn(fixture.container.repos.runs, 'saveThread').mockRejectedValueOnce(fault);
    const loopId = await fixture.publishLoop(
      singleNodeLoop('managed-log', {
        id: 'infer',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'go' } },
      }),
    );
    const started = await fixture.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs?probe=GG_QUERY_CANARY`,
      headers: {
        'accept-version': 'GG_VERSION_CANARY',
        'x-graphgoblin-canary': 'GG_HEADER_CANARY',
      },
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    const refused = await fixture.app.inject({
      method: 'GET',
      url: '/loops?probe=GG_QUERY_CANARY',
      headers: { authorization: 'Bearer GG_BEARER_CANARY' },
    });
    expect(refused.statusCode).toBe(401);
    const runId = started.json<{ run: RunRecord }>().run.id;
    await fixture.idle();
    const run = await fixture.app.inject(`/runs/${runId}`);
    const failure = run.json<RunRecord>().failure;
    // The public failure is the safe #381 projection.
    expect(failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error interrupted the run. See the server logs for this run.',
    });
    expect(run.body).not.toMatch(/GG_PRIVATE_(RUN|STACK)_CANARY/);
    expect((await fixture.app.inject('/no-such-route?probe=GG_QUERY_CANARY')).statusCode).toBe(404);

    const { text, lines } = await records(root, writer);
    // The safe public failure directs the operator to this correlated private record.
    const privateRecord = lines.find(
      (line) => line['level'] === 50 && line['runId'] === runId && line['error'] !== undefined,
    );
    expect(privateRecord).toMatchObject({
      runId,
      error: {
        name: 'TypeError',
        message: 'GG_PRIVATE_RUN_CANARY unexpected engine fault',
        stack: expect.stringContaining('GG_PRIVATE_STACK_CANARY'),
      },
    });
    const access = lines.filter(
      (line) => line['msg'] === 'incoming request' || line['msg'] === 'request completed',
    );
    expect(access.length).toBeGreaterThanOrEqual(8);
    for (const line of access) {
      const projected = (line['req'] ?? line['res']) as Record<string, unknown>;
      expect(
        Object.keys(projected).every((key) => ['method', 'route', 'statusCode'].includes(key)),
      ).toBe(true);
    }
    expect(access).toContainEqual(
      expect.objectContaining({
        msg: 'incoming request',
        req: { method: 'POST', route: '/loops/:id/runs' },
      }),
    );
    expect(access).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        res: { method: 'POST', route: '/loops/:id/runs', statusCode: 202 },
      }),
    );
    expect(access).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        res: { method: 'GET', statusCode: 404 },
      }),
    );
    expect(access).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        res: { method: 'GET', route: '/loops', statusCode: 401 },
      }),
    );
    for (const canary of ACCESS_CANARIES) expect(text).not.toContain(canary);
  } finally {
    await fixture.close();
  }
});

it('keeps the configured level for the managed destination', async () => {
  const { root, writer, logger } = await managedLogger('warn');
  logger.info({ runId: 'r' }, 'below level');
  logger.warn({ runId: 'r' }, 'at level');
  const { lines } = await records(root, writer);
  expect(lines.map((line) => line['msg'])).toEqual(['at level']);
});

it('keeps the ordinary shell logger and its default serializers', () => {
  const config = loadConfig({ GG_LOG_LEVEL: 'debug' });
  const shell = createGatewayLogger(config);
  expect(shell.level).toBe('debug');
  const serializers = (shell as unknown as Record<symbol, Record<string, unknown>>)[
    symbols.serializersSym
  ];
  expect(serializers?.['req']).not.toBe(managedAccessSerializers.req);
});

it('projects only validated access fields from unusual inputs', () => {
  expect(managedAccessSerializers.req({})).toEqual({});
  expect(
    managedAccessSerializers.req({ method: 'get /x?GG_QUERY_CANARY', routeOptions: { url: 7 } }),
  ).toEqual({});
  expect(
    managedAccessSerializers.req({ method: 'PATCH', routeOptions: { url: '/runs/:runId' } }),
  ).toEqual({ method: 'PATCH', route: '/runs/:runId' });
  expect(managedAccessSerializers.res({ statusCode: 500 })).toEqual({ statusCode: 500 });
  expect(managedAccessSerializers.res({ statusCode: '500', request: { method: 'GET' } })).toEqual({
    method: 'GET',
  });
});

describe('managed client-error handler', () => {
  /** The real managed logger over a capturing destination, and a fake client connection. */
  function connection(level = 'trace') {
    const lines: Record<string, unknown>[] = [];
    const logger = createGatewayLogger(loadConfig({ GG_LOG_LEVEL: level }), {
      write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    const socket = { destroyed: false, writable: true, write: vi.fn(), destroy: vi.fn() };
    return { lines, logger, socket };
  }

  /** A Node parser error carrying request text in every field the standard serializer copies. */
  function parserError(code: unknown) {
    return Object.assign(new Error('Parse Error: GG_CLIENT_MESSAGE_CANARY'), {
      code,
      bytesParsed: 3,
      reason: 'GG_CLIENT_REASON_CANARY',
      rawPacket: Buffer.from('GET /?GG_CLIENT_PACKET_CANARY HTTP/1.1\r\n'),
      headers: { authorization: 'Bearer GG_CLIENT_HEADER_CANARY' },
    });
  }

  it.each([
    ['ERR_HTTP_REQUEST_TIMEOUT', 'client timeout', 408, 'Request Timeout', 'Client Timeout'],
    [
      'HPE_HEADER_OVERFLOW',
      'client header_overflow',
      431,
      'Request Header Fields Too Large',
      'Exceeded maximum allowed HTTP header size',
    ],
    ['HPE_INVALID_METHOD', 'client error', 400, 'Bad Request', 'Client Error'],
    ['EPIPE', 'client error', 400, 'Bad Request', 'Client Error'],
  ])(
    'answers %s with the default response and records only its closed outcome',
    (code, msg, statusCode, reason, message) => {
      const { lines, logger, socket } = connection();
      const error = parserError(code);
      managedClientErrorHandler.call({ log: logger }, error, socket);
      const body = JSON.stringify({ error: reason, message, statusCode });
      expect(socket.write.mock.calls).toEqual([
        [
          `HTTP/1.1 ${statusCode} ${reason}\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`,
        ],
      ]);
      expect(socket.destroy.mock.calls).toEqual([[error]]);
      expect(lines).toEqual([
        {
          level: 10,
          time: expect.any(Number),
          pid: process.pid,
          hostname: expect.any(String),
          msg,
          clientError: { statusCode, code },
        },
      ]);
      expect(JSON.stringify(lines)).not.toContain('CANARY');
    },
  );

  it('leaves a reset or already destroyed connection alone, as the default does', () => {
    const reset = connection();
    managedClientErrorHandler.call({ log: reset.logger }, parserError('ECONNRESET'), reset.socket);
    const destroyed = connection();
    destroyed.socket.destroyed = true;
    managedClientErrorHandler.call(
      { log: destroyed.logger },
      parserError('HPE_INVALID_METHOD'),
      destroyed.socket,
    );
    for (const { lines, socket } of [reset, destroyed]) {
      expect(lines).toEqual([]);
      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    }
  });

  it('closes an unwritable connection and omits any code that is not a Node identifier', () => {
    for (const code of [undefined, 42, 'hpe_lower', 'HPE GG_CODE_CANARY', 'X'.repeat(65)]) {
      const { lines, logger, socket } = connection();
      socket.writable = false;
      const error = parserError(code);
      managedClientErrorHandler.call({ log: logger }, error, socket);
      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy.mock.calls).toEqual([[error]]);
      expect(lines).toEqual([
        expect.objectContaining({ msg: 'client error', clientError: { statusCode: 400 } }),
      ]);
      expect(JSON.stringify(lines)).not.toContain('CANARY');
    }
  });

  it('keeps the configured level: an info gateway answers without a trace record', () => {
    const { lines, logger, socket } = connection('info');
    managedClientErrorHandler.call({ log: logger }, parserError('HPE_INVALID_METHOD'), socket);
    expect(lines).toEqual([]);
    expect(socket.write).toHaveBeenCalledOnce();
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
});
