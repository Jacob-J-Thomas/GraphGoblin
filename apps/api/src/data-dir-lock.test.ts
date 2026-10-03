import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireDataDirLock } from './data-dir-lock.js';

let dataDir: string;
let path: string;

beforeEach(async () => {
  dataDir = join(tmpdir(), `gg-lock-${randomUUID()}`);
  path = join(dataDir, 'graphgoblin.lock');
  // Acquisition creates a fresh directory. Keep the empty test directory after cleanup.
  await (await acquireDataDirLock(dataDir)).release();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const file of [path, `${path}.reclaim`, join(dataDir, 'not-a-directory')]) {
    await unlink(file).catch(() => undefined);
  }
});

describe('data-directory ownership', () => {
  it('creates an exclusive lock with this PID and start time and releases it', async () => {
    const lock = await acquireDataDirLock(dataDir);
    const record = JSON.parse(await readFile(path, 'utf8')) as { pid: number; startedAt: string };
    expect(record.pid).toBe(process.pid);
    expect(Number.isNaN(Date.parse(record.startedAt))).toBe(false);
    await lock.release();
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a live PID without replacing its lock', async () => {
    const lock = await acquireDataDirLock(dataDir);
    const original = await readFile(path, 'utf8');
    await expect(acquireDataDirLock(dataDir)).rejects.toThrow(
      `another GraphGoblin process holds ${path}`,
    );
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(access(`${path}.reclaim`)).rejects.toMatchObject({ code: 'ENOENT' });
    await lock.release();
  });

  it('replaces a stale lock from a process that exited', async () => {
    const child = spawnSync(process.execPath, ['-e', '']);
    expect(child.status).toBe(0);
    await writeFile(path, JSON.stringify({ pid: child.pid, startedAt: '2020-01-01T00:00:00Z' }));
    const lock = await acquireDataDirLock(dataDir);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
    await lock.release();
  });

  it.each(['EPERM', 'EACCES', 'UNKNOWN'])(
    'refuses when PID probing fails with %s',
    async (code) => {
      const original = JSON.stringify({ pid: process.pid });
      await writeFile(path, original);
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('cannot probe'), { code });
      });
      await expect(acquireDataDirLock(dataDir)).rejects.toThrow(`holds ${path}`);
      expect(await readFile(path, 'utf8')).toBe(original);
    },
  );

  it.each(['', '{', 'null', '1', '{}', '{"pid":"1"}', '{"pid":0}', '{"pid":-1}', '{"pid":1.5}'])(
    'refuses unverifiable lock contents %j',
    async (original) => {
      await writeFile(path, original);
      await expect(acquireDataDirLock(dataDir)).rejects.toThrow(`holds ${path}`);
      expect(await readFile(path, 'utf8')).toBe(original);
    },
  );

  it('does not let a delayed repeated release remove a new acquisition', async () => {
    const first = await acquireDataDirLock(dataDir);
    await Promise.all([first.release(), first.release()]);
    await first.release();
    const second = await acquireDataDirLock(dataDir);
    const original = await readFile(path, 'utf8');
    await first.release();
    expect(await readFile(path, 'utf8')).toBe(original);
    await second.release();
  });

  it('leaves a lock with a different ownership token intact on release', async () => {
    const lock = await acquireDataDirLock(dataDir);
    await writeFile(path, 'replacement ownership');
    await lock.release();
    expect(await readFile(path, 'utf8')).toBe('replacement ownership');
  });

  it('accepts a missing file during release', async () => {
    const lock = await acquireDataDirLock(dataDir);
    await unlink(path);
    await lock.release();
  });

  it.each(['fresh', 'stale'])(
    'admits only one simultaneous contender for a %s lock',
    async (kind) => {
      if (kind === 'stale') {
        const child = spawnSync(process.execPath, ['-e', '']);
        expect(child.status).toBe(0);
        await writeFile(path, JSON.stringify({ pid: child.pid }));
      }
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => acquireDataDirLock(dataDir)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'fulfilled') await result.value.release();
        else expect(String(result.reason)).toContain('another GraphGoblin process holds');
      }
    },
  );

  it('refuses an existing reclamation guard without deleting either file', async () => {
    await writeFile(path, JSON.stringify({ pid: process.pid }));
    await writeFile(`${path}.reclaim`, 'interrupted reclamation');
    await expect(acquireDataDirLock(dataDir)).rejects.toThrow(`holds ${path}.reclaim`);
    expect(await readFile(`${path}.reclaim`, 'utf8')).toBe('interrupted reclamation');
  });

  it('propagates filesystem errors instead of assuming a stale lock', async () => {
    const file = join(dataDir, 'not-a-directory');
    await writeFile(file, 'keep');
    await expect(acquireDataDirLock(file)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('keep');
  });
});
