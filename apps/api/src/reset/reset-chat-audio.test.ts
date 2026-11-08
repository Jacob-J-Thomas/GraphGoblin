import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { READER_ARGUMENTS, snapshotTree } from './__fixtures__/stores.js';
import { runResetCli, type ResetCliOptions } from './reset.js';
import { readStoreFacts } from './store-facts.js';

const ID = '01J00000000000000000000001';
const bases: string[] = [];
afterEach(async () => {
  for (const base of bases.splice(0))
    await rm(base, { recursive: true, force: true, maxRetries: 10 });
});

const linkDirectory = (target: string, path: string) =>
  symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-reset-chat-audio-')));
  bases.push(base);
  const dataDir = join(base, 'data');
  const outside = join(base, 'outside');
  const audio = join(dataDir, 'chat-audio');
  await mkdir(audio, { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'private.audio'), 'external bytes');
  await writeFile(join(audio, `${ID}.audio`), 'voice');
  await writeFile(join(audio, `.${ID}.lock`), 'lock');
  await writeFile(join(audio, `.${ID}.00000000-0000-4000-8000-000000000000.tmp`), 'partial');
  await linkDirectory(outside, join(audio, 'external-link'));
  await writeFile(join(dataDir, 'graphgoblin.db'), 'deliberately not a SQLite database');
  await writeFile(join(dataDir, 'master.key'), 'retained key');
  await writeFile(join(dataDir, 'notes.txt'), 'retained notes');
  await mkdir(join(dataDir, 'chat-audio-backup'));
  await writeFile(join(dataDir, 'chat-audio-backup', 'keep.audio'), 'retained copy');
  return { base, dataDir, outside, audio };
}

async function reset(dataDir: string, confirmed: boolean, options: Partial<ResetCliOptions> = {}) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv: ['--reset', ...(confirmed ? ['--yes', '--data-dir', dataDir] : [])],
    env: { GG_DATA_DIR: dataDir },
    readStore: () => Promise.resolve({ readable: true, format: 4, runIds: [] }),
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
    ...options,
  });
  return { code, out, err };
}

it('previews private audio files and bytes without changing any store or external byte', async () => {
  const { base, dataDir } = await fixture();
  const before = await snapshotTree(base);
  const result = await reset(dataDir, false);
  expect(result.code).toBe(0);
  expect(result.err).toBe('');
  expect(result.out).toMatch(
    /\n {2}chat-audio +private chat audio +3 files, 1 directory, 1 link, 16 B\n/,
  );
  expect(result.out.indexOf('  chat-audio ')).toBeLessThan(result.out.indexOf('  graphgoblin.db '));
  expect(result.out).not.toMatch(/\n {2}chat-audio +not part of the store/);
  expect(await snapshotTree(base)).toEqual(before);
});

it('removes private audio before the database while preserving interior link targets, keys and unrelated copies', async () => {
  const { dataDir, outside } = await fixture();
  const external = await snapshotTree(outside);
  const result = await reset(dataDir, true);
  expect(result.code).toBe(0);
  expect(result.err).toBe('');
  expect(result.out.indexOf('  removed chat-audio ')).toBeLessThan(
    result.out.indexOf('  removed graphgoblin.db '),
  );
  expect((await readdir(dataDir)).sort()).toEqual(['chat-audio-backup', 'master.key', 'notes.txt']);
  expect(await snapshotTree(outside)).toEqual(external);
  expect(await readFile(join(dataDir, 'master.key'), 'utf8')).toBe('retained key');
  expect(await readFile(join(dataDir, 'chat-audio-backup', 'keep.audio'), 'utf8')).toBe(
    'retained copy',
  );
});

it.each(['unreadable', 'absent'] as const)(
  'removes owned audio independently of an %s database',
  async (kind) => {
    const { dataDir, audio, outside } = await fixture();
    if (kind === 'absent') await unlink(join(dataDir, 'graphgoblin.db'));
    const reader = vi.fn((file: string) =>
      readStoreFacts(file, { readerArguments: READER_ARGUMENTS }),
    );
    const result = await reset(dataDir, true, { readStore: reader });
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toContain(kind === 'absent' ? '(no database file)' : '(unreadable:');
    expect(reader).toHaveBeenCalledTimes(kind === 'absent' ? 0 : 2);
    await expect(lstat(audio)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(outside, 'private.audio'), 'utf8')).toBe('external bytes');
    expect(await readFile(join(dataDir, 'master.key'), 'utf8')).toBe('retained key');
  },
);

it.each(['link', 'file'] as const)(
  'preserves a top-level chat-audio %s with an explicit reason',
  async (kind) => {
    const { dataDir, audio, outside } = await fixture();
    await rm(audio, { recursive: true });
    if (kind === 'link') await linkDirectory(outside, audio);
    else await writeFile(audio, 'unmanaged file');
    const external = await snapshotTree(outside);
    for (const confirmed of [false, true]) {
      const result = await reset(dataDir, confirmed);
      expect(result.code).toBe(0);
      expect(result.err).toBe('');
      expect(result.out).toContain(
        kind === 'link' ? 'a link; a reset never follows links' : 'a file, not a directory',
      );
      expect(result.out).not.toContain('  removed chat-audio ');
      expect((await lstat(audio)).isSymbolicLink()).toBe(kind === 'link');
      if (kind === 'file') expect(await readFile(audio, 'utf8')).toBe('unmanaged file');
      expect(await snapshotTree(outside)).toEqual(external);
    }
  },
);

it('resets through a configured directory alias using the physical owned audio tree', async () => {
  const { base, dataDir, outside } = await fixture();
  const alias = join(base, 'data-alias');
  await linkDirectory(dataDir, alias);
  const result = await reset(alias, true);
  expect(result.code).toBe(0);
  expect(result.err).toBe('');
  expect(result.out).toContain(`(physical path ${dataDir})`);
  expect(result.out).toContain('  removed chat-audio ');
  expect((await readdir(dataDir)).sort()).toEqual(['chat-audio-backup', 'master.key', 'notes.txt']);
  expect(await readFile(join(outside, 'private.audio'), 'utf8')).toBe('external bytes');
});

it.each(['chat-audio', `chat-audio/${ID}.audio`])(
  'refuses a database overlapping %s before reads, locks or deletion',
  async (database) => {
    const { base, dataDir } = await fixture();
    const reader = vi.fn(() => Promise.reject(new Error('overlapping database must not be read')));
    const before = await snapshotTree(base);
    for (const confirmed of [false, true]) {
      const result = await reset(dataDir, confirmed, {
        env: {
          GG_DATA_DIR: dataDir,
          GG_DB_URL: pathToFileURL(join(dataDir, database)).href,
        },
        readStore: reader,
      });
      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain(
        database === 'chat-audio'
          ? 'has the name of the chat-audio directory, which a reset removes'
          : 'is inside chat-audio/, which a reset removes',
      );
      expect(await snapshotTree(base)).toEqual(before);
    }
    expect(reader).not.toHaveBeenCalled();
  },
);

it('refuses a removed audio file hard-linked to a kept root entry without changing either name', async () => {
  const { base, dataDir, audio } = await fixture();
  await link(join(audio, `${ID}.audio`), join(dataDir, 'private-copy.audio'));
  const before = await snapshotTree(base);
  const result = await reset(dataDir, true);
  expect(result.code).toBe(1);
  expect(result.out).toBe('');
  expect(result.err).toContain('the manifest would both remove and keep private-copy.audio');
  expect(await snapshotTree(base)).toEqual(before);
});

it('refuses an audio directory replaced by an external link after the locked plan', async () => {
  const { base, dataDir, audio, outside } = await fixture();
  const plannedAudio = await snapshotTree(audio);
  const external = await snapshotTree(outside);
  const moved = join(base, 'original-audio');
  const result = await reset(dataDir, true, {
    write: (text) => {
      if (text !== 'Removing:\n') return;
      renameSync(audio, moved);
      symlinkSync(outside, audio, process.platform === 'win32' ? 'junction' : 'dir');
    },
  });
  expect(result.code).toBe(1);
  expect(result.err).toContain('ancestor chat-audio is now a link during the reset');
  expect(result.err).toContain('Removed:        nothing');
  expect(result.err).toContain('Not removed:    graphgoblin.db');
  expect(await snapshotTree(moved)).toEqual(plannedAudio);
  expect(await snapshotTree(outside)).toEqual(external);
  expect((await lstat(audio)).isSymbolicLink()).toBe(true);
  expect(await readFile(join(dataDir, 'graphgoblin.db'), 'utf8')).toBe(
    'deliberately not a SQLite database',
  );
});

it('reports a partial audio removal before touching the database, and a retry finishes', async () => {
  const { dataDir, audio, outside } = await fixture();
  let out = '';
  const result = await reset(dataDir, true, {
    write: (text) => {
      out += text;
      if (text === 'Removing:\n') writeFileSync(join(audio, 'late.audio'), 'late private audio');
    },
  });
  expect(result.code).toBe(1);
  expect(result.err).toContain('Reset stopped: could not remove chat-audio:');
  expect(result.err).toContain('Partly removed: chat-audio (4 of 5 entries)');
  expect(result.err).toContain('Not removed:    graphgoblin.db');
  expect(out).not.toContain('Reset complete');
  expect(await readdir(audio)).toEqual(['late.audio']);
  expect(await readFile(join(dataDir, 'graphgoblin.db'), 'utf8')).toBe(
    'deliberately not a SQLite database',
  );
  expect(await readFile(join(outside, 'private.audio'), 'utf8')).toBe('external bytes');
  const retry = await reset(dataDir, true);
  expect(retry.code).toBe(0);
  expect(retry.err).toBe('');
  expect(retry.out).toContain('Reset complete');
  expect((await readdir(dataDir)).sort()).toEqual(['chat-audio-backup', 'master.key', 'notes.txt']);
});
