import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runResetCli } from './reset.js';

const bases: string[] = [];
afterEach(async () => {
  for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
});

async function fixture(nested = false) {
  const base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-rid-cli-'));
  bases.push(base);
  const dataDir = join(base, 'data');
  const outside = join(base, 'outside');
  const folder = nested ? join(dataDir, 'database') : dataDir;
  await mkdir(folder, { recursive: true });
  await mkdir(outside);
  await writeFile(join(folder, 'graphgoblin.db'), 'planned database');
  await writeFile(join(dataDir, 'master.key'), 'key bytes');
  await writeFile(join(outside, 'graphgoblin.db'), 'outside database');
  await writeFile(join(outside, 'graphgoblin.lock'), 'outside lock');
  const run = async (change: (text: string) => void = () => undefined) => {
    let out = '';
    let err = '';
    const code = await runResetCli({
      argv: ['--reset', '--yes', '--data-dir', dataDir],
      env: { GG_DATA_DIR: dataDir, GG_DB_URL: pathToFileURL(join(folder, 'graphgoblin.db')).href },
      readStore: () =>
        Promise.resolve({ readable: true, format: 4, status: 'complete', runIds: [] }),
      write: (text) => {
        out += text;
        change(text);
      },
      writeError: (text) => {
        err += text;
      },
    });
    return { code, out, err };
  };
  return { base, dataDir, outside, folder, run };
}

describe('reset CLI planned identities', () => {
  it('refuses a database replaced at Removing and keeps the replacement', async () => {
    const { base, dataDir, outside, run } = await fixture();
    const result = await run((text) => {
      if (text !== 'Removing:\n') return;
      renameSync(join(dataDir, 'graphgoblin.db'), join(base, 'original.db'));
      writeFileSync(join(dataDir, 'graphgoblin.db'), 'replacement database');
    });
    expect.soft(result.code).toBe(1);
    expect(result.out).toContain('Removing:\n');
    expect.soft(result.out).not.toContain('  removed graphgoblin.db');
    expect.soft(result.out).not.toContain('Reset complete');
    expect
      .soft(result.err)
      .toContain(
        'Reset stopped: could not remove graphgoblin.db: graphgoblin.db was replaced during the reset',
      );
    expect.soft(result.err).toContain('Removed:        nothing');
    expect.soft(result.err).toContain('Partly removed: graphgoblin.db (0 of 1 entries)');
    expect.soft(result.err).toContain('Not removed:    nothing');
    expect
      .soft(await readFile(join(dataDir, 'graphgoblin.db'), 'utf8').catch(() => 'missing'))
      .toBe('replacement database');
    expect(await readFile(join(base, 'original.db'), 'utf8')).toBe('planned database');
    expect(await readFile(join(dataDir, 'master.key'), 'utf8')).toBe('key bytes');
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside database');
    const again = await run();
    expect(again.code).toBe(0);
    expect(again.err).toBe('');
    expect(again.out).toContain('  removed graphgoblin.db');
  });

  it('refuses a root junction pivot at Removing and preserves the unrelated store', async () => {
    const { base, dataDir, outside, run } = await fixture();
    const moved = join(base, 'original');
    const result = await run((text) => {
      if (text !== 'Removing:\n') return;
      renameSync(dataDir, moved);
      symlinkSync(outside, dataDir, process.platform === 'win32' ? 'junction' : 'dir');
    });
    expect.soft(result.code).toBe(1);
    expect(result.out).toContain('Removing:\n');
    expect.soft(result.out).not.toContain('  removed graphgoblin.db');
    expect.soft(result.out).not.toContain('Reset complete');
    expect
      .soft(result.err)
      .toContain('graphgoblin.db: data-directory root is now a link during the reset');
    expect.soft(result.err).toContain('Removed:        nothing');
    expect.soft(result.err).toContain('Partly removed: graphgoblin.db (0 of 1 entries)');
    expect.soft(result.err).toContain('Not removed:    nothing');
    expect
      .soft(await readFile(join(outside, 'graphgoblin.db'), 'utf8').catch(() => 'missing'))
      .toBe('outside database');
    expect(await readFile(join(outside, 'graphgoblin.lock'), 'utf8')).toBe('outside lock');
    expect((await lstat(dataDir)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(moved, 'graphgoblin.db'), 'utf8')).toBe('planned database');
    expect(await readFile(join(moved, 'master.key'), 'utf8')).toBe('key bytes');
  });

  it('stops after an earlier target when a kept ancestor is replaced, and a restored rerun finishes', async () => {
    const { base, dataDir, outside, folder, run } = await fixture(true);
    await mkdir(join(dataDir, 'artifacts'));
    await writeFile(join(folder, 'graphgoblin.db-wal'), 'planned WAL');
    const moved = join(base, 'original-database');
    const result = await run((text) => {
      if (!text.startsWith('  removed artifacts ')) return;
      renameSync(folder, moved);
      mkdirSync(folder);
      writeFileSync(join(folder, 'graphgoblin.db'), 'replacement database');
      writeFileSync(join(folder, 'graphgoblin.db-wal'), 'replacement WAL');
    });
    expect.soft(result.code).toBe(1);
    expect(result.out).toContain('  removed artifacts (0 files, 1 directory, 0 B)');
    expect.soft(result.out).not.toContain('  removed database/graphgoblin.db');
    expect.soft(result.out).not.toContain('Reset complete');
    expect
      .soft(result.err)
      .toContain('database/graphgoblin.db: ancestor database was replaced during the reset');
    expect.soft(result.err).toContain('Removed:        artifacts');
    expect.soft(result.err).toContain('Partly removed: database/graphgoblin.db (0 of 1 entries)');
    expect.soft(result.err).toContain('Not removed:    database/graphgoblin.db-wal');
    expect
      .soft(await readFile(join(folder, 'graphgoblin.db'), 'utf8').catch(() => 'missing'))
      .toBe('replacement database');
    expect
      .soft(await readFile(join(folder, 'graphgoblin.db-wal'), 'utf8').catch(() => 'missing'))
      .toBe('replacement WAL');
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside database');
    expect(await readdir(dataDir)).not.toContain('artifacts');
    await rename(folder, join(base, 'replacement'));
    await rename(moved, folder);
    const again = await run();
    expect(again.code).toBe(0);
    expect(again.err).toBe('');
    expect(again.out).toContain('  removed database/graphgoblin.db');
    expect(again.out).toContain('  removed database/graphgoblin.db-wal');
    expect(again.out).toContain('Reset complete');
    expect(await readdir(folder)).toEqual([]);
    expect(await readFile(join(dataDir, 'master.key'), 'utf8')).toBe('key bytes');
  });
});
