import { createHash, randomUUID } from 'node:crypto';
import type { Dir } from 'node:fs';
import { chmod, lstat, mkdir, open, opendir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const CHAT_AUDIO_MAX_BYTES = 10 * 1024 * 1024;
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const ID_PATTERN = new RegExp(`^${ULID}$`);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OWNED_FILE_PATTERN = new RegExp(
  `^(?:(${ULID})\\.audio|\\.(${ULID})\\.(?:lock|${UUID}\\.tmp))$`,
);

export type ChatAudioStoreErrorCode = 'invalid_id' | 'empty' | 'too_large' | 'exists' | 'storage';

const ERROR_MESSAGES: Record<ChatAudioStoreErrorCode, string> = {
  invalid_id: 'Chat audio identifier is invalid',
  empty: 'Chat audio body is empty',
  too_large: 'Chat audio exceeds the size limit',
  exists: 'Chat audio identifier is already in use',
  storage: 'Chat audio storage is unavailable',
};

/** Messages contain neither local paths nor source errors; the cause retains filesystem diagnostics. */
export class ChatAudioStoreError extends Error {
  override readonly name = 'ChatAudioStoreError';

  constructor(
    readonly code: ChatAudioStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
  }
}

export interface StoredChatAudio {
  id: string;
  /** Internal workflow payload only; never expose this path through a public response. */
  path: string;
  byteLength: number;
  sha256: string;
}

export interface ChatAudioCleanupOptions {
  /** Every current metadata row, including reservations, consumed audio, and pending deletion. */
  protectedIds: ReadonlySet<string>;
  /** Remove only files last modified strictly before this Unix timestamp in milliseconds. */
  olderThanMs: number;
  /** Maximum entries examined in one batch, between 1 and 1,000. */
  limit: number;
}

export interface ChatAudioCleanupResult {
  examined: number;
  /** Names are diagnostics only, never accepted as deletion selectors by this store. */
  removed: string[];
  complete: boolean;
}

/**
 * Private binary storage. SQLite owns authorization, quotas, expiration, and retention.
 * Callers reserve metadata before writing, and commit it only after write succeeds.
 * A same-directory exclusive lock serializes writers for an ID across store instances.
 */
export class ChatAudioStore {
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly activeIds = new Set<string>();
  private scan: Dir | undefined;

  constructor(dataDir: string, options: { maxBytes?: number } = {}) {
    this.directory = join(resolve(dataDir), 'chat-audio');
    this.maxBytes = options.maxBytes ?? CHAT_AUDIO_MAX_BYTES;
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      this.maxBytes > CHAT_AUDIO_MAX_BYTES
    )
      throw new RangeError('Chat audio size limit must be between 1 and 10485760 bytes');
  }

  /** Derive a trusted internal path from a canonical ID; this does not authorize access. */
  resolve(id: string): string {
    validateId(id);
    return join(this.directory, `${id}.audio`);
  }

  async write(
    id: string,
    source: AsyncIterable<Uint8Array> | Uint8Array,
  ): Promise<StoredChatAudio> {
    const path = this.resolve(id);
    if (this.activeIds.has(id)) throw new ChatAudioStoreError('exists');
    this.activeIds.add(id);
    const temporary = join(this.directory, `.${id}.${randomUUID()}.tmp`);
    const lock = join(this.directory, `.${id}.lock`);
    let ownsLock = false;
    let ownsTemporary = false;
    try {
      await this.prepareDirectory(true);
      try {
        const handle = await open(lock, 'wx', 0o600);
        ownsLock = true;
        await handle.close();
      } catch (cause) {
        if (errno(cause) === 'EEXIST') throw new ChatAudioStoreError('exists');
        throw cause;
      }
      try {
        await lstat(path);
        throw new ChatAudioStoreError('exists');
      } catch (cause) {
        if (errno(cause) !== 'ENOENT') throw cause;
      }
      const handle = await open(temporary, 'wx', 0o600);
      ownsTemporary = true;
      const hash = createHash('sha256');
      let byteLength = 0;
      try {
        const chunks = source instanceof Uint8Array ? [source] : source;
        for await (const chunk of chunks) {
          if (chunk.byteLength > this.maxBytes - byteLength)
            throw new ChatAudioStoreError('too_large');
          byteLength += chunk.byteLength;
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (byteLength === 0) throw new ChatAudioStoreError('empty');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      return { id, path, byteLength, sha256: hash.digest('hex') };
    } catch (cause) {
      throw storageError(cause);
    } finally {
      // An interrupted/failed write has no committed metadata. Orphan scanning retries cleanup
      // if these best-effort removals fail, without hiding the useful original error (e.g. ENOSPC).
      if (ownsTemporary) await unlink(temporary).catch(() => undefined);
      if (ownsLock) await unlink(lock).catch(() => undefined);
      this.activeIds.delete(id);
    }
  }

  /** Exact-ID deletion only. The caller first makes the metadata ineligible for admission. */
  async remove(id: string): Promise<boolean> {
    const path = this.resolve(id);
    if (this.activeIds.has(id)) throw new ChatAudioStoreError('exists');
    try {
      if (!(await this.prepareDirectory(false))) return false;
      await unlink(path);
      return true;
    } catch (cause) {
      if (errno(cause) === 'ENOENT') return false;
      throw storageError(cause);
    }
  }

  /**
   * Bounded orphan batches, continuing the same directory cursor until complete. Serialize calls.
   * Use a conservative cutoff to protect writes reserved after the protected-ID snapshot.
   * Expired committed audio is removed through remove(id), after its metadata transition.
   */
  async cleanup(options: ChatAudioCleanupOptions): Promise<ChatAudioCleanupResult> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1_000)
      throw new RangeError('Chat audio cleanup limit must be between 1 and 1000 entries');
    if (!Number.isFinite(options.olderThanMs))
      throw new RangeError('Chat audio cleanup cutoff must be a finite timestamp');
    const result: ChatAudioCleanupResult = { examined: 0, removed: [], complete: false };
    try {
      if (!(await this.prepareDirectory(false))) return { ...result, complete: true };
      this.scan ??= await opendir(this.directory);
      while (result.examined < options.limit) {
        const entry = await this.scan.read();
        if (!entry) {
          await this.close();
          return { ...result, complete: true };
        }
        result.examined++;
        const match = OWNED_FILE_PATTERN.exec(entry.name);
        if (!entry.isFile() || !match || match[0] !== entry.name) continue;
        const id = (match[1] ?? match[2])!;
        if (options.protectedIds.has(id) || this.activeIds.has(id)) continue;
        const path = join(this.directory, entry.name);
        try {
          const info = await lstat(path);
          if (!info.isFile() || info.mtimeMs >= options.olderThanMs) continue;
          await unlink(path);
          result.removed.push(entry.name);
        } catch (cause) {
          // Another exact-ID cleanup may already have removed this entry.
          if (errno(cause) !== 'ENOENT') throw cause;
        }
      }
      return result;
    } catch (cause) {
      await this.close().catch(() => undefined);
      throw storageError(cause);
    }
  }

  /** Release a partially consumed cleanup cursor at shutdown. Does not delete data. */
  async close(): Promise<void> {
    const scan = this.scan;
    this.scan = undefined;
    if (scan) await scan.close();
  }

  private async prepareDirectory(create: boolean): Promise<boolean> {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ChatAudioStoreError('storage');
      await chmod(this.directory, 0o700);
      return true;
    } catch (cause) {
      if (!create && errno(cause) === 'ENOENT') return false;
      throw cause;
    }
  }
}

function validateId(id: string): void {
  if (id.length !== 26 || !ID_PATTERN.test(id)) throw new ChatAudioStoreError('invalid_id');
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function storageError(cause: unknown): ChatAudioStoreError {
  return cause instanceof ChatAudioStoreError
    ? cause
    : new ChatAudioStoreError('storage', { cause });
}
