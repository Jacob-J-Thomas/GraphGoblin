import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupStaleStoreCopies, readStoreCopy } from './store-copy.js';
import { identityOf } from './tree.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-qafix-ownership-'));
  // os.tmpdir is the product's public environment input. Each test file has its own process.
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, base);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

async function owned(name: string, extra: Record<string, unknown> = {}) {
  const path = join(base, name);
  await mkdir(path);
  await writeFile(join(path, 'store.db'), 'private bytes');
  await writeFile(
    join(path, 'owner.json'),
    JSON.stringify({
      kind: 'graphgoblin-reset-store',
      pid: 2147483647,
      identity: await identityOf(path),
      ...extra,
    }),
  );
  return path;
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe('private reset copy ownership', () => {
  it('removes only a proven dead copy and its known sidecars, and is idempotent', async () => {
    const path = await owned('gg-reset-store-STALE1');
    for (const leaf of ['store.db-wal', 'store.db-shm', 'store.db-journal', 'owner.next'])
      await writeFile(join(path, leaf), 'private bytes');
    await cleanupStaleStoreCopies();
    await cleanupStaleStoreCopies();
    expect(await readdir(base)).toEqual([]);
  });

  it('preserves live copy owners and live SQLite workers', async () => {
    const parent = await owned('gg-reset-store-ALIVE1', { pid: process.pid });
    const worker = await owned('gg-reset-store-ALIVE2', { workerPid: process.pid });
    await cleanupStaleStoreCopies();
    for (const path of [parent, worker])
      expect(await readFile(join(path, 'store.db'), 'utf8')).toBe('private bytes');
  });

  it('preserves malformed, oversized, unmarked and replaced directories and unrelated names', async () => {
    const malformed = await owned('gg-reset-store-BAD001');
    await writeFile(join(malformed, 'owner.json'), '{');
    const oversized = await owned('gg-reset-store-BAD002');
    await writeFile(join(oversized, 'owner.json'), ' '.repeat(4097));
    const replaced = await owned('gg-reset-store-BAD003', { identity: 'a different directory' });
    const unrelated = await owned('gg-reset-store-similar-but-not-owned');
    const unmarked = join(base, 'gg-reset-store-BAD004');
    await mkdir(unmarked);
    await writeFile(join(unmarked, 'keep'), 'unrelated bytes');
    await writeFile(join(base, 'gg-reset-store-FILE01'), 'plain file');
    await cleanupStaleStoreCopies();
    for (const path of [malformed, oversized, replaced, unrelated, unmarked])
      expect(await exists(path)).toBe(true);
    expect(await readFile(join(base, 'gg-reset-store-FILE01'), 'utf8')).toBe('plain file');
  });

  it('preserves a marked directory with unexpected contents or linked files and never follows a root link', async () => {
    const unknown = await owned('gg-reset-store-OTHER1');
    await writeFile(join(unknown, 'keep'), 'unrelated bytes');
    const linked = await owned('gg-reset-store-LINK01');
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'keep'), 'outside bytes');
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(outside, join(linked, 'store.db-wal'), type);
    await symlink(outside, join(base, 'gg-reset-store-LINK02'), type);
    await cleanupStaleStoreCopies();
    expect(await readFile(join(unknown, 'keep'), 'utf8')).toBe('unrelated bytes');
    expect(await readFile(join(linked, 'store.db'), 'utf8')).toBe('private bytes');
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('outside bytes');
  });

  it('cleans its owned directory when the source cannot be copied', async () => {
    expect(await readStoreCopy(join(base, 'absent.db'))).toMatchObject({
      readable: false,
      reason: expect.stringContaining('ENOENT'),
    });
    expect(await readdir(base)).toEqual([]);
  });

  it('resolves the configured system temp root while still checking physical copy directories', async () => {
    const physical = join(base, 'physical');
    const alias = join(base, 'alias');
    await mkdir(physical);
    await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, alias);
    expect(await readStoreCopy(join(base, 'absent.db'))).toMatchObject({
      readable: false,
      reason: expect.stringContaining('ENOENT'),
    });
    const directory = join(physical, 'gg-reset-store-STALE1');
    await mkdir(directory);
    await writeFile(join(directory, 'store.db'), 'private bytes');
    await writeFile(
      join(directory, 'owner.json'),
      JSON.stringify({
        kind: 'graphgoblin-reset-store',
        pid: 2147483647,
        identity: await identityOf(directory),
      }),
    );
    await cleanupStaleStoreCopies();
    expect(await readdir(physical)).toEqual([]);
  });
});
