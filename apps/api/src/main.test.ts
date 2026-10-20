import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.js';
import { createApiProcessFixture, eventually, listening } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
async function fixture() {
  const created = await createApiProcessFixture();
  fixtures.push(created);
  return created;
}
afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.dispose();
}, 60_000);
const noLock = (path: string) => expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });

// Node force-kills children on Windows for SIGINT/SIGTERM; JS handlers never run there.
// Linux CI supplies the native signal evidence. No captured callbacks or stubbed process.exit.
const nativeSignals = describe.skipIf(process.platform !== 'linux');

describe('built API entry and startup failures', () => {
  it('holds ownership while listening and releases it on supported HTTP close', async () => {
    const f = await fixture();
    for (const name of Object.keys(process.env))
      if (name.toUpperCase().startsWith('GG_')) vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries(f.env))
      if (name.toUpperCase().startsWith('GG_')) vi.stubEnv(name, value);
    let running: Awaited<ReturnType<typeof main>> | undefined;
    try {
      running = await main();
      const lock = await readFile(f.lockPath, 'utf8');
      await expect(main()).rejects.toThrow('another GraphGoblin process holds');
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
      expect((await running.app.inject('/healthz')).statusCode).toBe(200);
      await running.app.close();
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    } finally {
      await running?.app.close();
      await running?.container.stop();
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it('serves authenticated requests using a binary-created key and refuses a competing process', async () => {
    const f = await fixture();
    const token = await f.createKey();
    const child = f.run();
    try {
      await f.ready(child, token);
      const lock = await readFile(f.lockPath, 'utf8');
      const contender = f.run();
      expect(await contender.waitForExit()).toEqual({ code: 1, signal: null });
      expect(contender.stderr).toContain('another GraphGoblin process holds');
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
    } finally {
      // Cross-platform forced fixture cleanup; graceful shutdown is asserted only below on POSIX.
      await child.dispose();
    }
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('dispatches the API-key and preflight CLIs with their real exit codes', async () => {
    const f = await fixture();
    const token = await f.createKey();
    expect(token).toMatch(/^gg_/);
    await noLock(f.lockPath);
    const usage = f.run(['--create-api-key']);
    expect(await usage.waitForExit()).toEqual({ code: 2, signal: null });
    expect(usage.stderr).toContain('a key name is required');
    const invalidKeyConfig = f.run(['--create-api-key', 'invalid config'], { GG_PORT: 'invalid' });
    expect(await invalidKeyConfig.waitForExit()).toEqual({ code: 1, signal: null });
    // Preflight wins dispatch even if the other command is present. Invalid config also ensures
    // this fixture performs no installed-provider readiness probe or session.
    const preflight = f.run(['--preflight', '--create-api-key'], { GG_PORT: 'invalid' });
    expect(await preflight.waitForExit()).toEqual({ code: 1, signal: null });
    expect(preflight.stdout).toContain('GraphGoblin preflight');
    expect(preflight.stdout).toContain('FAIL');
    expect(preflight.stderr).not.toContain('a key name is required');
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('releases ownership on a real corrupt-database startup fault before HTTP setup', async () => {
    const f = await fixture();
    await f.createKey();
    // A fresh file has no WAL that could legitimately restore a damaged main-file header.
    const corrupt = join(f.dataDir, 'corrupt.db');
    await writeFile(corrupt, 'This is deliberately not a SQLite database');
    const child = f.run([], { GG_DB_URL: `file:${corrupt.replaceAll('\\', '/')}` });
    expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
    expect(child.stderr).toMatch(/not a database|SQLITE_NOTADB/i);
    expect(child.stdout).not.toContain('GraphGoblin API listening');
    await noLock(f.lockPath);
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  it('releases ownership after a real occupied-port listen failure', async () => {
    const f = await fixture();
    await f.createKey();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(f.port, '127.0.0.1', resolve));
    try {
      const child = f.run();
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expect(child.stderr).toContain('EADDRINUSE');
      await noLock(f.lockPath);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await listening(f.port)).toBe(false);
  }, 60_000);

  // POSIX permits a literal '*' asset name; Win32 rejects it. Static registration then collides
  // with the SPA wildcard, producing a real post-container buildApp failure, unlike corrupt SQL.
  it.skipIf(process.platform === 'win32')(
    'releases ownership when real static route registration fails during HTTP setup (POSIX filename fixture)',
    async () => {
      const f = await fixture();
      await f.createKey();
      const web = join(f.dataDir, 'web');
      await mkdir(web);
      await writeFile(join(web, 'index.html'), '<html>fixture</html>');
      await writeFile(join(web, '*'), 'literal wildcard asset');
      const child = f.run([], { GG_WEB_DIST: web });
      expect(await child.waitForExit()).toEqual({ code: 1, signal: null });
      expect(child.stderr).toMatch(/FST_ERR_DUPLICATED_ROUTE|already declared/);
      expect(child.stdout).not.toContain('GraphGoblin API listening');
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    },
    60_000,
  );
});

nativeSignals(
  'native API shutdown: Linux CI; win32 force-kills children without JS handlers',
  () => {
    it.each(['SIGINT', 'SIGTERM'] as const)(
      'closes its listener, releases ownership and exits once on %s',
      async (signal) => {
        const f = await fixture();
        const token = await f.createKey();
        const child = f.run();
        await f.ready(child, token);
        const lock = await readFile(f.lockPath, 'utf8');
        const contender = f.run();
        expect(await contender.waitForExit()).toEqual({ code: 1, signal: null });
        expect(contender.stderr).toContain('another GraphGoblin process holds');
        expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
        expect(child.child.kill(signal)).toBe(true);
        expect(await child.waitForExit()).toEqual({ code: 0, signal: null });
        expect(child.stdout.match(/"msg":"shutting down"/g)).toHaveLength(1);
        await noLock(f.lockPath);
        expect(await listening(f.port)).toBe(false);
      },
      60_000,
    );

    it('handles a real signal before readiness, holds ownership through startup and shuts down once', async () => {
      const f = await fixture();
      await f.createKey();
      // Keep native signal dispatch asynchronous while startup still awaits its supported key file.
      const keyFile = join(f.dataDir, 'master.key');
      await promisify(execFile)('mkfifo', [keyFile]);
      const child = f.run([], { GG_MASTER_KEY: undefined });
      await eventually(async () => {
        try {
          return (await readFile(f.lockPath, 'utf8')).length > 0;
        } catch {
          return false;
        }
      });
      const lock = await readFile(f.lockPath, 'utf8');
      expect(child.child.kill('SIGINT')).toBe(true);
      await child.waitForLog('shutting down');
      // The shutdown log proves receipt while the FIFO still prevents readiness.
      expect(child.stdout).not.toContain('GraphGoblin API listening');
      expect(await listening(f.port)).toBe(false);
      expect(child.child.kill('SIGTERM')).toBe(true);
      expect(await readFile(f.lockPath, 'utf8')).toBe(lock);
      await writeFile(keyFile, Buffer.alloc(32, 8).toString('base64'));
      expect(await child.waitForExit()).toEqual({ code: 0, signal: null });
      expect(child.stdout).toContain('GraphGoblin API listening');
      expect(child.stdout.indexOf('shutting down')).toBeLessThan(
        child.stdout.indexOf('GraphGoblin API listening'),
      );
      expect(child.stdout.match(/"msg":"shutting down"/g)).toHaveLength(1);
      await noLock(f.lockPath);
      expect(await listening(f.port)).toBe(false);
    }, 60_000);
  },
);
