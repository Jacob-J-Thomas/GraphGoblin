import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessDefaultsRefusedError } from './defaults-refusal.js';
import { serve, shellFailureOutput, startupFailureCause, type ServeOptions } from './serve.js';
import { StoreRefusedError } from './store-refusal.js';
import { eventually, freePort, listening } from './testing/api-subprocess.js';
import { createTestApp } from './testing/test-app.js';
import {
  GATEWAY_LOG_PENDING_BYTES,
  nodeLogFileSystem,
  openGatewayLog,
  type GatewayLogWriter,
  type LogFileSystem,
} from './managed-log/gateway-log-writer.js';
import type { StartupStage } from './managed-log/guard.js';

const roots: string[] = [];
const writers: GatewayLogWriter[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const writer of writers.splice(0)) await writer.close();
  globalThis.gc?.();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
}, 30_000);

describe('managed startup failure causes', () => {
  const failure = (message: string, code?: string) =>
    Object.assign(new Error(message), code ? { code } : {});

  it.each<[StartupStage, unknown, string]>([
    ['store', Object.create(StoreRefusedError.prototype) as unknown, 'store-refused'],
    ['store', Object.create(ProcessDefaultsRefusedError.prototype) as unknown, 'defaults-refused'],
    [
      'store',
      failure('another GraphGoblin process holds C:\\store\\graphgoblin.lock'),
      'store-held',
    ],
    [
      'store',
      failure('Store ownership could not be verified (x): C:\\lock'),
      'store-ownership-unverified',
    ],
    [
      'store',
      failure('Cannot establish Windows process identity: timeout'),
      'process-identity-unavailable',
    ],
    ['configuration', failure('GG_PORT invalid'), 'invalid-configuration'],
    ['store', failure('SQLITE_NOTADB'), 'store-unavailable'],
    ['recovery', failure('recovery'), 'recovery-failed'],
    ['http', failure('duplicate route'), 'http-setup-failed'],
    ['bind', failure('listen EADDRINUSE', 'EADDRINUSE'), 'port-in-use'],
    ['bind', failure('listen EACCES', 'EACCES'), 'port-denied'],
    ['bind', failure('listen EADDRNOTAVAIL', 'EADDRNOTAVAIL'), 'port-denied'],
    ['bind', failure('other'), 'bind-failed'],
    ['bind', 'not an error', 'bind-failed'],
  ])('maps %s failure %#', (stage, error, cause) => {
    expect(startupFailureCause(stage, error)).toBe(cause);
  });

  it('prints complete refusals as their message in a shell', () => {
    const refused = Object.create(StoreRefusedError.prototype) as Error;
    Object.defineProperty(refused, 'message', { value: 'store explanation' });
    expect(shellFailureOutput(refused)).toBe('store explanation');
    const other = new Error('stack please');
    expect(shellFailureOutput(other)).toBe(other);
  });
});

describe('serve with the managed destination', () => {
  async function environment(fs?: LogFileSystem) {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-serve-managed-'));
    roots.push(dataDir);
    const port = await freePort(Number(process.env['GG_TEST_PORT_START'] ?? 5600), 100);
    for (const name of Object.keys(process.env))
      if (name.toUpperCase().startsWith('GG_') && !name.toUpperCase().startsWith('GG_TEST_'))
        vi.stubEnv(name, undefined);
    const values: Record<string, string> = {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_LOG_LEVEL: 'info',
      GG_REQUIRE_API_KEY: 'true',
      GG_SWAGGER_UI: 'false',
      GG_WEB_DIST: '',
      GG_OLLAMA_ENABLED: 'false',
      GG_JEV_API_KEY: '',
      GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
    };
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
    const logRoot = await mkdtemp(join(tmpdir(), 'gg-serve-log-'));
    roots.push(logRoot);
    const writer = await openGatewayLog(fs ? { root: logRoot, fs } : { root: logRoot });
    writers.push(writer);
    const stages: StartupStage[] = [];
    const managed: NonNullable<ServeOptions['managed']> = {
      destination: writer,
      onStage: (stage) => stages.push(stage),
      beforeExit: () => writer.settle(250),
    };
    return { dataDir, port, logRoot, writer, stages, managed };
  }

  it('reports each reached stage and writes engine records only to the bounded destination', async () => {
    const env = await environment();
    const running = await serve({ managed: env.managed });
    try {
      expect(env.stages).toEqual(['configuration', 'store', 'recovery', 'http', 'bind']);
      expect(await listening(env.port)).toBe(true);
      expect(await env.writer.settle(5_000)).toBe(true);
      const records = (await readFile(join(env.logRoot, 'gateway.log'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toContainEqual(
        expect.objectContaining({ msg: 'GraphGoblin API listening', port: env.port }),
      );
    } finally {
      await running.app.close();
    }
    await expect(access(join(env.dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 60_000);

  it('keeps serving while every log write is stalled, within the pending-byte bound', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let writes = 0;
    const stalled: LogFileSystem = {
      ...nodeLogFileSystem,
      async open(path, mode) {
        const handle = await nodeLogFileSystem.open(path, mode);
        return {
          ...handle,
          write: async (...args) => {
            writes++;
            await held;
            return handle.write(...args);
          },
        };
      },
    };
    const env = await environment(stalled);
    // Startup completes although the listening record cannot reach the disk.
    const running = await serve({ managed: env.managed });
    try {
      const started = performance.now();
      for (let request = 0; request < 200; request++)
        expect((await running.app.inject('/healthz')).statusCode).toBe(200);
      expect(performance.now() - started).toBeLessThan(15_000);
      // inject() settles through microtasks only; let libuv complete the writer's own lstat.
      await eventually(() => writes === 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Exactly one file operation is in flight while every request has completed.
      expect(writes).toBe(1);
      expect(env.writer.pendingBytes).toBeLessThanOrEqual(GATEWAY_LOG_PENDING_BYTES);
      expect(await env.writer.settle(250)).toBe(false);
      release();
      expect(await env.writer.settle(5_000)).toBe(true);
      expect(await readFile(join(env.logRoot, 'gateway.log'), 'utf8')).toContain(
        'GraphGoblin API listening',
      );
    } finally {
      release();
      await running.app.close();
    }
  }, 60_000);

  it('stops at the bind stage on an occupied port and releases ownership', async () => {
    const env = await environment();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(env.port, '127.0.0.1', resolve));
    try {
      const failure = await serve({ managed: env.managed }).catch((error: unknown) => error);
      expect(env.stages.at(-1)).toBe('bind');
      expect(startupFailureCause('bind', failure)).toBe('port-in-use');
      await expect(access(join(env.dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);

  it('stops at the configuration stage on invalid overrides', async () => {
    const env = await environment();
    vi.stubEnv('GG_PORT', 'invalid');
    const failure = await serve({ managed: env.managed }).catch((error: unknown) => error);
    expect(env.stages).toEqual(['configuration']);
    expect(startupFailureCause('configuration', failure)).toBe('invalid-configuration');
  });

  it('answers malformed wire requests at managed trace without logging their bytes, then keeps serving', async () => {
    const env = await environment();
    vi.stubEnv('GG_LOG_LEVEL', 'trace');
    const running = await serve({ managed: env.managed });
    try {
      // The configured level is kept: Fastify's parser-error records are trace records.
      expect(running.app.log.level).toBe('trace');
      expect(await exchange(env.port, MALFORMED)).toBe(
        clientErrorReply(400, 'Bad Request', 'Client Error'),
      );
      expect(await exchange(env.port, OVERFLOW)).toBe(
        clientErrorReply(
          431,
          'Request Header Fields Too Large',
          'Exceeded maximum allowed HTTP header size',
        ),
      );
      const ordinary = await fetch(`http://127.0.0.1:${env.port}/healthz`);
      expect(ordinary.status).toBe(200);
      await ordinary.arrayBuffer();

      expect(await env.writer.settle(5_000)).toBe(true);
      const records = (await readFile(join(env.logRoot, 'gateway.log'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      // Only the closed outcome, its status and Node's parser code; no error object, message,
      // header or packet bytes.
      expect(records.filter((record) => String(record['msg']).startsWith('client '))).toEqual([
        {
          level: 10,
          time: expect.any(Number),
          pid: process.pid,
          hostname: expect.any(String),
          msg: 'client error',
          clientError: { statusCode: 400, code: 'HPE_INVALID_HEADER_TOKEN' },
        },
        {
          level: 10,
          time: expect.any(Number),
          pid: process.pid,
          hostname: expect.any(String),
          msg: 'client header_overflow',
          clientError: { statusCode: 431, code: 'HPE_HEADER_OVERFLOW' },
        },
      ]);
      // Every string and every decoded numeric byte array in every record, not only the text.
      for (const value of records.flatMap(decodedValues))
        for (const canary of PARSER_CANARIES) expect(value).not.toContain(canary);
      expect(records).toContainEqual(
        expect.objectContaining({
          msg: 'request completed',
          res: { method: 'GET', route: '/healthz', statusCode: 200 },
        }),
      );
    } finally {
      await running.app.close();
    }
  }, 60_000);
});

/** Parser canaries in the URL, query and headers of one short packet. */
const PARSER_CANARIES = [
  'GG_PARSER_PATH_CANARY',
  'GG_PARSER_QUERY_CANARY',
  'GG_PARSER_BEARER_CANARY',
  'GG_PARSER_HEADER_CANARY',
];
/** Reaches Node's HTTP parser and fails at the invalid header name, before Fastify routes it. */
const MALFORMED =
  'GET /healthz/GG_PARSER_PATH_CANARY?probe=GG_PARSER_QUERY_CANARY HTTP/1.1\r\n' +
  'Host: 127.0.0.1\r\n' +
  'Authorization: Bearer GG_PARSER_BEARER_CANARY\r\n' +
  'Bad Header: GG_PARSER_HEADER_CANARY\r\n\r\n';
/** Exceeds Node's 16 KiB header limit. */
const OVERFLOW =
  'GET /healthz?probe=GG_PARSER_QUERY_CANARY HTTP/1.1\r\n' +
  'Host: 127.0.0.1\r\n' +
  `X-Fill: GG_PARSER_HEADER_CANARY${'f'.repeat(17 * 1024)}\r\n\r\n`;

/** Fastify's default parser-error response bytes. */
function clientErrorReply(statusCode: number, error: string, message: string): string {
  const body = JSON.stringify({ error, message, statusCode });
  return `HTTP/1.1 ${statusCode} ${error}\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`;
}

/** Send exact bytes and read until the server closes the connection. */
function exchange(port: number, packet: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('The server kept the malformed connection open.'));
    }, 10_000);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    // A reset after the response still closes the connection.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('latin1'));
    });
    socket.write(packet);
  });
}

/** Every key and string in a parsed record, with each numeric byte array decoded as Latin-1. */
function decodedValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const bytes = value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
    return value.length > 0 && bytes
      ? [Buffer.from(value as number[]).toString('latin1')]
      : value.flatMap(decodedValues);
  }
  if (value !== null && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) => [key, ...decodedValues(item)]);
  return [];
}

describe('ordinary HTTP construction (control)', () => {
  it("keeps Fastify's default parser-error handler, which logs the raw packet at trace", async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line: string) => void lines.push(line) });
    const fixture = await createTestApp({ serverLogger: logger });
    try {
      await fixture.app.listen({ host: '127.0.0.1', port: 0 });
      const { port } = fixture.app.server.address() as AddressInfo;
      expect(await exchange(port, MALFORMED)).toBe(
        clientErrorReply(400, 'Bad Request', 'Client Error'),
      );
      const record = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line['msg'] === 'client error');
      // The same input reaches the parser; the default handler's error keeps its packet bytes.
      expect(decodedValues(record?.['err']).join('\n')).toContain('GG_PARSER_QUERY_CANARY');
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
