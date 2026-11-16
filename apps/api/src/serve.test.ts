import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessDefaultsRefusedError } from './defaults-refusal.js';
import { serve, shellFailureOutput, startupFailureCause, type ServeOptions } from './serve.js';
import { StoreRefusedError } from './store-refusal.js';
import { eventually, freePort, listening } from './testing/api-subprocess.js';
import {
  GATEWAY_LOG_PENDING_BYTES,
  nodeLogFileSystem,
  openGatewayLog,
  type GatewayLogWriter,
  type LogFileSystem,
} from './windows-log/gateway-log-writer.js';
import type { StartupStage } from './windows-log/guard.js';

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
});
