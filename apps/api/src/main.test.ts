import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as appModule from './app.js';
import * as containerModule from './container.js';
import { main } from './main.js';

let dataDir: string;
let lockPath: string;
let running: Awaited<ReturnType<typeof main>> | undefined;

beforeEach(() => {
  dataDir = join(tmpdir(), `gg-main-${randomUUID()}`);
  lockPath = join(dataDir, 'graphgoblin.lock');
  vi.stubEnv('GG_DATA_DIR', dataDir);
  vi.stubEnv('GG_DB_URL', `file:${join(dataDir, 'graphgoblin.db').replace(/\\/g, '/')}`);
  vi.stubEnv('GG_HOST', '127.0.0.1');
  vi.stubEnv('GG_PORT', '0');
  vi.stubEnv('GG_LOG_LEVEL', 'silent');
  vi.stubEnv('GG_WEB_DIST', '');
  vi.stubEnv('GG_SWAGGER_UI', 'false');
  vi.stubEnv('GG_MASTER_KEY', Buffer.alloc(32, 8).toString('base64'));
});

afterEach(async () => {
  await running?.app.close();
  await running?.container.stop();
  running = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // Remove only test-created files, leaving the temporary directory intact.
  for (const file of await readdir(dataDir).catch(() => [] as string[])) {
    await unlink(join(dataDir, file)).catch(() => undefined);
  }
});

describe('API process lifecycle', () => {
  it('holds ownership while listening, refuses another start, and releases on clean HTTP close', async () => {
    running = await main();
    const original = await readFile(lockPath, 'utf8');
    await expect(main()).rejects.toThrow(`another GraphGoblin process holds ${lockPath}`);
    expect(await readFile(lockPath, 'utf8')).toBe(original);
    expect((await running.app.inject('/healthz')).statusCode).toBe(200);
    await running.app.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops the container and releases ownership if HTTP setup fails', async () => {
    vi.spyOn(appModule, 'buildApp').mockRejectedValueOnce(new Error('HTTP setup failed'));
    await expect(main()).rejects.toThrow('HTTP setup failed');
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases ownership if the port is occupied', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    vi.stubEnv('GG_PORT', String(address.port));
    try {
      await expect(main()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'releases ownership before exiting on %s',
    async (signal) => {
      const previous = new Set(process.listeners(signal));
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      running = await main();
      const listener = process.listeners(signal).find((candidate) => !previous.has(candidate));
      expect(listener).toBeDefined();
      listener!(signal);
      listener!(signal); // Repeated signals still perform one shutdown.
      await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
      await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(process.listeners(signal)).not.toContain(listener);
    },
  );

  it('keeps ownership during startup when SIGINT arrives', async () => {
    const previous = new Set(process.listeners('SIGINT'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const create = containerModule.createContainer;
    vi.spyOn(containerModule, 'createContainer').mockImplementationOnce(
      async (config, overrides) => {
        const container = await create(config, overrides);
        const start = container.start;
        vi.spyOn(container, 'start').mockImplementationOnce(async () => {
          await gate;
          await start();
        });
        return container;
      },
    );
    const starting = main();
    try {
      await vi.waitFor(async () => {
        await access(lockPath);
      });
      const listener = process.listeners('SIGINT').find((candidate) => !previous.has(candidate));
      listener!('SIGINT');
      expect(exit).not.toHaveBeenCalled();
      await expect(access(lockPath)).resolves.toBeUndefined();
    } finally {
      resume();
      running = await starting;
    }
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
