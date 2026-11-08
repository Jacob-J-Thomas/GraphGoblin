import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_AUDIO_MAX_BYTES, ChatAudioStore, ChatAudioStoreError } from './chat-audio.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    lstat: vi.fn(actual.lstat),
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
  };
});
const actualFs = await vi.importActual<typeof fs>('node:fs/promises');

const id = (suffix = '0') => `01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`;
const temporaryName = (audioId: string) => `.${audioId}.00000000-0000-0000-0000-000000000000.tmp`;
const old = new Date('2020-01-01T00:00:00Z');
let dataDir: string;
let store: ChatAudioStore;

beforeEach(async () => {
  vi.mocked(fs.open).mockReset().mockImplementation(actualFs.open);
  vi.mocked(fs.lstat).mockReset().mockImplementation(actualFs.lstat);
  vi.mocked(fs.rename).mockReset().mockImplementation(actualFs.rename);
  vi.mocked(fs.unlink).mockReset().mockImplementation(actualFs.unlink);
  dataDir = await fs.mkdtemp(join(tmpdir(), 'gg-chat-audio-'));
  store = new ChatAudioStore(dataDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('ChatAudioStore', () => {
  it('preserves binary bytes, hashes the bounded stream, and derives an absolute internal path', async () => {
    const bytes = Buffer.from([0, 255, 128, 1, 13, 10]);
    const result = await store.write(id(), bytes);
    expect(result).toEqual({
      id: id(),
      path: join(dataDir, 'chat-audio', `${id()}.audio`),
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(await fs.readFile(result.path)).toEqual(bytes);
    expect(store.resolve(id())).toBe(result.path);
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([`${id()}.audio`]);
  });

  it('creates private storage and tightens an existing directory before writing', async () => {
    const directory = join(dataDir, 'chat-audio');
    await fs.mkdir(directory, { mode: 0o777 });
    await fs.chmod(directory, 0o777);
    const result = await store.write(id(), Buffer.of(1));
    if (process.platform !== 'win32') {
      expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(result.path)).mode & 0o777).toBe(0o600);
    }
  });

  it('publishes a complete file after streaming and excludes concurrent same-ID writes and cleanup', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const streaming = new Promise<void>((resolve) => {
      started = resolve;
    });
    async function* chunks() {
      yield Buffer.of(0, 255);
      started();
      await gate;
      yield Buffer.of(128, 1);
    }
    const pending = store.write(id(), chunks());
    await streaming;
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toHaveLength(2);
    await expect(fs.stat(store.resolve(id()))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.write(id(), Buffer.of(4))).rejects.toMatchObject({ code: 'exists' });
    const otherStore = new ChatAudioStore(dataDir);
    await expect(otherStore.write(id(), Buffer.of(4))).rejects.toMatchObject({ code: 'exists' });
    await expect(store.remove(id())).rejects.toMatchObject({ code: 'exists' });
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now() + 1_000, limit: 100 }),
    ).toMatchObject({ complete: true, removed: [] });
    release();
    expect(await pending).toMatchObject({ byteLength: 4 });
    expect(await fs.readFile(store.resolve(id()))).toEqual(Buffer.of(0, 255, 128, 1));
  });

  it('refuses to replace existing files, directories, and symlinks', async () => {
    await store.write(id(), Buffer.of(1));
    await expect(store.write(id(), Buffer.of(2))).rejects.toMatchObject({ code: 'exists' });
    expect(await fs.readFile(store.resolve(id()))).toEqual(Buffer.of(1));
    await fs.mkdir(store.resolve(id('1')));
    await expect(store.write(id('1'), Buffer.of(2))).rejects.toMatchObject({ code: 'exists' });
    const outside = join(dataDir, 'outside');
    await fs.writeFile(outside, 'untouched');
    await fs.symlink(outside, store.resolve(id('2')));
    await expect(store.write(id('2'), Buffer.of(2))).rejects.toMatchObject({ code: 'exists' });
    expect(await fs.readFile(outside, 'utf8')).toBe('untouched');
  });

  it.each(['../outside', id().toLowerCase(), `${id()}\n`, `${id()}\\x`, 'O'.repeat(26), ''])(
    'rejects noncanonical identifiers before any filesystem access: %j',
    async (invalid) => {
      expect(() => store.resolve(invalid)).toThrow(ChatAudioStoreError);
      await expect(store.write(invalid, Buffer.of(1))).rejects.toMatchObject({
        code: 'invalid_id',
      });
      await expect(store.remove(invalid)).rejects.toMatchObject({ code: 'invalid_id' });
      expect(await fs.readdir(dataDir)).toEqual([]);
    },
  );

  it.each([0, -1, 1.5, Infinity, CHAT_AUDIO_MAX_BYTES + 1])(
    'refuses an invalid byte limit %s',
    (maxBytes) => {
      expect(() => new ChatAudioStore(dataDir, { maxBytes })).toThrow(RangeError);
    },
  );

  it('accepts the exact size limit, and stops an oversized stream before reading more bytes', async () => {
    store = new ChatAudioStore(dataDir, { maxBytes: 4 });
    await expect(store.write(id(), Buffer.of(0, 1, 2, 3))).resolves.toMatchObject({
      byteLength: 4,
    });
    let reads = 0;
    async function* chunks() {
      reads++;
      yield await Promise.resolve(Buffer.of(0, 1, 2));
      reads++;
      yield Buffer.of(3, 4);
      reads++;
      yield Buffer.of(5);
    }
    await expect(store.write(id('1'), chunks())).rejects.toMatchObject({ code: 'too_large' });
    expect(reads).toBe(2);
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([`${id()}.audio`]);
    await expect(store.write(id('1'), Buffer.of(1))).resolves.toMatchObject({ byteLength: 1 });
  });

  it('rejects empty bodies and empty streams without leaving files', async () => {
    await expect(store.write(id(), Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty' });
    async function* chunks() {
      yield await Promise.resolve(Buffer.alloc(0));
    }
    await expect(store.write(id(), chunks())).rejects.toMatchObject({ code: 'empty' });
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([]);
  });

  it('cleans up an interrupted body and preserves its cause behind a bounded message', async () => {
    const cause = new Error('sensitive stream diagnostic');
    async function* chunks() {
      yield await Promise.resolve(Buffer.of(1));
      throw cause;
    }
    await expect(store.write(id(), chunks())).rejects.toMatchObject({
      code: 'storage',
      cause,
      message: 'Chat audio storage is unavailable',
    });
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([]);
  });

  it('reports ENOSPC during publication, removes temporary bytes, and allows a retry', async () => {
    const cause = Object.assign(new Error('no space on private volume'), { code: 'ENOSPC' });
    vi.mocked(fs.rename).mockRejectedValueOnce(cause);
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage', cause });
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([]);
    await expect(store.write(id(), Buffer.of(2))).resolves.toMatchObject({ byteLength: 1 });
  });

  it('does not hide publication failures when best-effort temporary cleanup also fails', async () => {
    const cause = Object.assign(new Error('full'), { code: 'ENOSPC' });
    vi.mocked(fs.rename).mockRejectedValueOnce(cause);
    const unlink = vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage', cause });
    expect(unlink).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toHaveLength(1);
  });

  it('leaves a failed lock cleanup for the protected orphan scanner without losing successful bytes', async () => {
    const unlink = vi.mocked(fs.unlink);
    unlink.mockImplementation(async (path) => {
      if (path.toString().endsWith('.lock')) throw new Error('lock cleanup failed');
      await actualFs.unlink(path);
    });
    await expect(store.write(id(), Buffer.of(1))).resolves.toMatchObject({ byteLength: 1 });
    unlink.mockImplementation(actualFs.unlink);
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toHaveLength(2);
    expect(
      await store.cleanup({
        protectedIds: new Set([id()]),
        olderThanMs: Date.now() + 1_000,
        limit: 100,
      }),
    ).toMatchObject({ complete: true, removed: [] });
    expect(await fs.readFile(store.resolve(id()))).toEqual(Buffer.of(1));
  });

  it('reports unexpected exclusive-lock and destination inspection errors', async () => {
    const cause = Object.assign(new Error('disk failed'), { code: 'EIO' });
    vi.mocked(fs.open).mockRejectedValueOnce(cause);
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage', cause });
    const lstat = actualFs.lstat;
    vi.mocked(fs.lstat).mockImplementation(async (...args) => {
      if (args[0] === store.resolve(id())) throw cause;
      return lstat(...args);
    });
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage', cause });
    expect(await fs.readdir(join(dataDir, 'chat-audio'))).toEqual([]);
  });

  it('refuses a non-directory or symlink dedicated storage root', async () => {
    const directory = join(dataDir, 'chat-audio');
    await fs.writeFile(directory, 'blocked');
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage' });
    await expect(store.remove(id())).rejects.toMatchObject({ code: 'storage' });
    await fs.unlink(directory);
    const outside = join(dataDir, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, directory, 'dir');
    await expect(store.write(id(), Buffer.of(1))).rejects.toMatchObject({ code: 'storage' });
    await expect(store.remove(id())).rejects.toMatchObject({ code: 'storage' });
    await expect(
      store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 1 }),
    ).rejects.toMatchObject({ code: 'storage' });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('deletes only the exact ID, is idempotent, and never follows a file symlink', async () => {
    expect(await store.remove(id())).toBe(false);
    expect(await fs.readdir(dataDir)).toEqual([]);
    await store.write(id(), Buffer.of(1));
    await store.write(id('1'), Buffer.of(2));
    expect(await store.remove(id())).toBe(true);
    expect(await store.remove(id())).toBe(false);
    const outside = join(dataDir, 'outside');
    await fs.writeFile(outside, 'untouched');
    await fs.symlink(outside, store.resolve(id('2')));
    expect(await store.remove(id('2'))).toBe(true);
    expect(await fs.readFile(outside, 'utf8')).toBe('untouched');
    expect(await fs.readFile(store.resolve(id('1')))).toEqual(Buffer.of(2));
  });

  it('reports a failed exact deletion without recursively removing directories', async () => {
    await store.write(id(), Buffer.of(1));
    const cause = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.mocked(fs.unlink).mockRejectedValueOnce(cause);
    await expect(store.remove(id())).rejects.toMatchObject({ code: 'storage', cause });
    await fs.mkdir(store.resolve(id('1')));
    await expect(store.remove(id('1'))).rejects.toMatchObject({ code: 'storage' });
    expect((await fs.stat(store.resolve(id('1')))).isDirectory()).toBe(true);
  });
});

describe('bounded chat audio orphan cleanup', () => {
  it('does not create a directory when there are no uploads', async () => {
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 1 }),
    ).toEqual({ examined: 0, removed: [], complete: true });
    expect(await fs.readdir(dataDir)).toEqual([]);
    await store.close();
  });

  it('continues bounded batches and removes only old recognized regular files without metadata', async () => {
    await store.write(id(), Buffer.of(1));
    await store.write(id('1'), Buffer.of(2));
    await store.write(id('2'), Buffer.of(3));
    const directory = join(dataDir, 'chat-audio');
    const temporary = temporaryName(id('3'));
    const lock = `.${id('4')}.lock`;
    await fs.writeFile(join(directory, temporary), 'partial');
    await fs.writeFile(join(directory, lock), '');
    await fs.writeFile(join(directory, 'unknown-file'), 'preserved');
    await fs.writeFile(join(directory, `${id('5')}.audio\n`), 'preserved');
    await fs.mkdir(store.resolve(id('6')));
    const outside = join(dataDir, 'outside');
    await fs.writeFile(outside, 'preserved');
    await fs.symlink(outside, store.resolve(id('7')));
    for (const name of [`${id()}.audio`, `${id('1')}.audio`, temporary, lock])
      await fs.utimes(join(directory, name), old, old);
    const removed: string[] = [];
    let complete = false;
    let batches = 0;
    while (!complete) {
      const batch = await store.cleanup({
        protectedIds: new Set([id('1')]),
        olderThanMs: Date.now() - 60_000,
        limit: 1,
      });
      expect(batch.examined).toBeLessThanOrEqual(1);
      removed.push(...batch.removed);
      complete = batch.complete;
      batches++;
      expect(batches).toBeLessThan(20);
    }
    expect(removed.sort()).toEqual([`${id()}.audio`, temporary, lock].sort());
    expect(await fs.readFile(store.resolve(id('1')))).toEqual(Buffer.of(2));
    expect(await fs.readFile(store.resolve(id('2')))).toEqual(Buffer.of(3));
    expect(await fs.readFile(outside, 'utf8')).toBe('preserved');
    expect((await fs.lstat(store.resolve(id('7')))).isSymbolicLink()).toBe(true);
    expect((await fs.stat(store.resolve(id('6')))).isDirectory()).toBe(true);
  });

  it('rechecks the current file before deletion and tolerates concurrent exact deletion', async () => {
    await store.write(id(), Buffer.of(1));
    await fs.utimes(store.resolve(id()), old, old);
    const lstat = actualFs.lstat;
    let replace = true;
    vi.mocked(fs.lstat).mockImplementation(async (...args) => {
      if (args[0] === store.resolve(id()) && replace) {
        replace = false;
        await fs.unlink(store.resolve(id()));
        await fs.mkdir(store.resolve(id()));
      }
      return lstat(...args);
    });
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).toMatchObject({ removed: [], complete: true });
    await fs.rmdir(store.resolve(id()));
    await store.write(id('1'), Buffer.of(2));
    await fs.utimes(store.resolve(id('1')), old, old);
    vi.mocked(fs.unlink).mockRejectedValueOnce(
      Object.assign(new Error('gone'), { code: 'ENOENT' }),
    );
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).toMatchObject({ removed: [], complete: true });
  });

  it('closes a cursor after a filesystem failure and can start another bounded scan', async () => {
    await store.write(id(), Buffer.of(1));
    await fs.utimes(store.resolve(id()), old, old);
    const cause = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.mocked(fs.unlink).mockRejectedValueOnce(cause);
    await expect(
      store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).rejects.toMatchObject({ code: 'storage', cause });
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).toMatchObject({ complete: true, removed: [`${id()}.audio`] });
  });

  it('preserves the cleanup failure if closing its directory cursor also fails', async () => {
    await store.write(id(), Buffer.of(1));
    await fs.utimes(store.resolve(id()), old, old);
    const cause = Object.assign(new Error('disk failure'), { code: 'EIO' });
    vi.mocked(fs.unlink).mockRejectedValueOnce(cause);
    const close = vi
      .spyOn(store, 'close')
      .mockRejectedValueOnce(new Error('directory close failed'));
    await expect(
      store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).rejects.toMatchObject({ code: 'storage', cause });
    close.mockRestore();
    await store.close();
    expect(
      await store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit: 100 }),
    ).toMatchObject({ complete: true, removed: [`${id()}.audio`] });
  });

  it('releases an unfinished directory cursor explicitly at shutdown', async () => {
    await store.write(id(), Buffer.of(1));
    expect(
      await store.cleanup({ protectedIds: new Set([id()]), olderThanMs: Date.now(), limit: 1 }),
    ).toMatchObject({ complete: false, examined: 1 });
    await store.close();
    expect(
      await store.cleanup({ protectedIds: new Set([id()]), olderThanMs: Date.now(), limit: 100 }),
    ).toMatchObject({ complete: true, examined: 1 });
  });

  it.each([0, -1, 1.5, 1_001, Infinity])(
    'refuses an unbounded or invalid batch limit %s',
    async (limit) => {
      await expect(
        store.cleanup({ protectedIds: new Set(), olderThanMs: Date.now(), limit }),
      ).rejects.toThrow(RangeError);
    },
  );

  it.each([NaN, Infinity, -Infinity])('refuses an invalid cutoff %s', async (olderThanMs) => {
    await expect(store.cleanup({ protectedIds: new Set(), olderThanMs, limit: 1 })).rejects.toThrow(
      RangeError,
    );
  });
});
