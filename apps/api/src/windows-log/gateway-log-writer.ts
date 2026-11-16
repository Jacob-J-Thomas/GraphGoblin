/**
 * Bounded private gateway log for a gateway started by the Windows desktop launcher (#438,
 * ADR-0081). Node built-ins only: the guarded entry loads it before any dependency.
 *
 * Exactly two fixed slots, `gateway.log` and `gateway.log.1`, of at most 4 MiB each. Every
 * record is complete UTF-8 ending in LF and at most 64 KiB; a larger record is replaced by a
 * fixed marker. One file operation is in flight at a time and queued plus in-flight encoded bytes
 * never exceed 256 KiB: excess records are dropped immediately. Across I/O the writer retains one
 * encoded copy of each such record, either queued or in the in-flight write's buffer, so the
 * budget bounds the encoded payload it holds. Logging never waits for I/O or capacity and a
 * logging fault never stops gateway work. There is no staging, spill or TEMP file.
 */
import { lstat, open, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const GATEWAY_LOG_ACTIVE = 'gateway.log';
export const GATEWAY_LOG_PREVIOUS = 'gateway.log.1';
/** Per-slot ceiling; two slots bound the private gateway log at 8 MiB. */
export const GATEWAY_LOG_SLOT_BYTES = 4 * 1024 * 1024;
/** One encoded record, including its LF delimiter. */
export const GATEWAY_LOG_RECORD_BYTES = 64 * 1024;
/** Combined queued and in-flight encoded bytes, including markers and drop summaries. */
export const GATEWAY_LOG_PENDING_BYTES = 256 * 1024;
/** Diagnostic flush allowed after graceful cleanup and a guarded startup failure. */
export const GATEWAY_LOG_EXIT_FLUSH_MS = 250;
/** Consecutive failed attempts after which the writer stops until the gateway restarts. */
export const GATEWAY_LOG_MAX_FAULTS = 8;
/** Retry delays after consecutive faults; records arriving meanwhile are dropped. */
export const GATEWAY_LOG_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000] as const;

const LF = 0x0a;

/** Full-width identity observed for one file: volume serial and file index. */
export interface LogFileIdentity {
  dev: bigint;
  ino: bigint;
}

export interface LogFileStats extends LogFileIdentity {
  size: bigint;
  nlink: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** The production operations the writer performs on one opened slot. */
export interface LogFileHandle {
  stat(): Promise<LogFileStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>;
  truncate(length: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Production filesystem seam. `existing` opens read/write without creating; `create` creates
 * exclusively and fails when any entry already has the name. Tests and QA wrap the real
 * implementation to observe or fault the exact operation the writer reaches.
 */
export interface LogFileSystem {
  lstat(path: string): Promise<LogFileStats>;
  open(path: string, mode: 'existing' | 'create'): Promise<LogFileHandle>;
  rename(from: string, to: string): Promise<void>;
}

export const nodeLogFileSystem: LogFileSystem = {
  lstat: (path) => lstat(path, { bigint: true }),
  async open(path, mode) {
    // r+ keeps FILE_WRITE_DATA for boundary rollback; libuv append mode would remove it.
    const handle = await open(path, mode === 'create' ? 'wx+' : 'r+', 0o600);
    return {
      stat: () => handle.stat({ bigint: true }),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      write: (buffer, offset, length, position) => handle.write(buffer, offset, length, position),
      truncate: (length) => handle.truncate(length),
      close: () => handle.close(),
    };
  },
  rename: (from, to) => rename(from, to),
};

/** Exact writer transitions, for tests and independent QA. Observers never affect the writer. */
export type GatewayLogEvent =
  | {
      type: 'adopt';
      slot: 'active' | 'previous';
      path: string;
      action: 'absent' | 'created' | 'kept' | 'tail-repaired' | 'replaced-oversized';
      sizeBefore: number;
      sizeAfter: number;
    }
  | {
      type: 'write';
      path: string;
      position: number;
      bytes: number;
      records: number;
      bytesWritten: number;
      result: 'complete' | 'partial' | 'failed';
      code?: string;
    }
  | { type: 'rollback'; path: string; size: number; result: 'complete' | 'failed'; code?: string }
  | {
      type: 'rotate';
      step: 'close' | 'rename' | 'create';
      path: string;
      result: 'complete' | 'failed';
      code?: string;
    }
  | { type: 'drop'; reason: GatewayLogDropReason; bytes: number; records: number }
  | { type: 'suspend'; faults: number; delayMs: number }
  | { type: 'disable'; reason: GatewayLogDisableReason };

export type GatewayLogDropReason = 'pending-limit' | 'suspended' | 'disabled' | 'fault' | 'closed';
export type GatewayLogDisableReason =
  | 'fault-limit'
  | 'active-slot-changed'
  | 'previous-slot-changed'
  | 'active-slot-occupied'
  | 'rollback-failed';

export type GatewayLogState = 'open' | 'suspended' | 'disabled' | 'closed';

export interface GatewayLogWriterOptions {
  /** The admitted canonical private log root. */
  root: string;
  fs?: LogFileSystem;
  observe?: (event: GatewayLogEvent) => void;
  /** Timer for backoff and settle deadlines. The default never keeps the process alive. */
  schedule?: (callback: () => void, ms: number) => { cancel(): void };
  now?: () => number;
}

/** A managed name or slot cannot be admitted. The caller refuses managed admission. */
export class GatewayLogAdmissionError extends Error {
  constructor(
    readonly code:
      | 'unsafe-entry'
      | 'identity-mismatch'
      | 'oversized-unreplaceable'
      | 'repair-failed'
      | 'unavailable',
    readonly slot: string,
  ) {
    super(`gateway log admission refused (${code}) at ${slot}`);
    this.name = 'GatewayLogAdmissionError';
  }
}

interface Pending {
  bytes: Buffer;
  ack?: (written: boolean) => void;
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN';
}

function sameIdentity(a: LogFileIdentity, b: LogFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function defaultSchedule(callback: () => void, ms: number) {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}

/** A regular, single-link, non-link entry. Other kinds are never opened or modified. */
function safeEntry(stats: LogFileStats): boolean {
  return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1n;
}

async function lstatOrAbsent(fs: LogFileSystem, path: string): Promise<LogFileStats | undefined> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/** Fixed marker that replaces a record over the encoded record limit. */
export function oversizedMarker(time: number, pid: number): string {
  return `{"level":40,"time":${time},"pid":${pid},"msg":"gateway log record omitted: it exceeded the ${GATEWAY_LOG_RECORD_BYTES}-byte record limit"}\n`;
}

/** Bounded summary emitted before the next accepted record after drops. */
export function dropSummary(time: number, pid: number, dropped: number): string {
  return `{"level":40,"time":${time},"pid":${pid},"msg":"gateway log records dropped","dropped":${dropped}}\n`;
}

/**
 * The private gateway destination. `write` is the Pino stream method: synchronous, never
 * waiting, returning whether the record was accepted into the bounded queue.
 */
export class GatewayLogWriter {
  private readonly fs: LogFileSystem;
  private readonly observer: ((event: GatewayLogEvent) => void) | undefined;
  private readonly schedule: NonNullable<GatewayLogWriterOptions['schedule']>;
  private readonly now: () => number;
  private readonly activePath: string;
  private readonly previousPath: string;
  private readonly queue: Pending[] = [];
  private queuedBytes = 0;
  private inFlightBytes = 0;
  private busy = false;
  private dropped = 0;
  private faults = 0;
  private phase: 'ready' | 'rename' | 'create' = 'ready';
  private current: GatewayLogState = 'open';
  private resume: { cancel(): void } | undefined;
  private idleWaiters: (() => void)[] = [];

  /** @internal Use {@link openGatewayLog}, which performs admission first. */
  constructor(
    options: GatewayLogWriterOptions,
    private handle: LogFileHandle | undefined,
    private activeIdentity: LogFileIdentity,
    private activeSize: number,
    private previousIdentity: LogFileIdentity | undefined,
  ) {
    this.fs = options.fs ?? nodeLogFileSystem;
    this.observer = options.observe;
    this.schedule = options.schedule ?? defaultSchedule;
    this.now = options.now ?? Date.now;
    this.activePath = join(options.root, GATEWAY_LOG_ACTIVE);
    this.previousPath = join(options.root, GATEWAY_LOG_PREVIOUS);
  }

  get state(): GatewayLogState {
    return this.current;
  }

  /**
   * Encoded bytes queued or in flight; never above {@link GATEWAY_LOG_PENDING_BYTES}. The
   * writer holds exactly one encoded copy of these bytes across I/O.
   */
  get pendingBytes(): number {
    return this.queuedBytes + this.inFlightBytes;
  }

  /** Bytes in the active slot after the last committed write. */
  get size(): number {
    return this.activeSize;
  }

  /** Pino destination entry point. Never waits; returns whether the record was accepted. */
  write(chunk: string): boolean {
    return this.enqueue(this.encode(chunk));
  }

  /** Resolve true only once this exact record's bytes are committed to the active slot. */
  writeAcknowledged(record: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.enqueue(this.encode(record), resolve);
    });
  }

  /** Resolve true when everything accepted so far has settled, or false at the deadline. */
  settle(timeoutMs: number): Promise<boolean> {
    if (this.isIdle()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let finished = false;
      const timer = this.schedule(() => {
        if (finished) return;
        finished = true;
        resolve(false);
      }, timeoutMs);
      this.idleWaiters.push(() => {
        if (finished) return;
        finished = true;
        timer.cancel();
        resolve(true);
      });
    });
  }

  /** Stop accepting records, finish the operation in flight and close the active slot. */
  async close(): Promise<void> {
    if (this.current === 'closed') return;
    this.current = 'closed';
    this.resume?.cancel();
    this.dropQueued('closed');
    await new Promise<void>((resolve) => {
      if (!this.busy) resolve();
      else this.idleWaiters.push(resolve);
    });
    await this.closeHandle();
  }

  /** Named apart from `emit`, `flush` and `end`, which Pino duck-types on destinations. */
  private notify(event: GatewayLogEvent): void {
    try {
      this.observer?.(event);
    } catch {
      // An observer is diagnostic only.
    }
  }

  private encode(chunk: string): Buffer {
    const text = chunk.endsWith('\n') ? chunk : chunk + '\n';
    // Replacement characters keep lone surrogates valid UTF-8; never slice a record.
    if (Buffer.byteLength(text, 'utf8') > GATEWAY_LOG_RECORD_BYTES)
      return Buffer.from(oversizedMarker(this.now(), process.pid), 'utf8');
    return Buffer.from(text, 'utf8');
  }

  private enqueue(bytes: Buffer, ack?: (written: boolean) => void): boolean {
    const refusal: GatewayLogDropReason | undefined =
      this.current === 'disabled' || this.current === 'closed'
        ? this.current === 'closed'
          ? 'closed'
          : 'disabled'
        : this.current === 'suspended'
          ? 'suspended'
          : this.pendingBytes + bytes.length > GATEWAY_LOG_PENDING_BYTES
            ? 'pending-limit'
            : undefined;
    if (refusal) {
      this.dropped++;
      this.notify({ type: 'drop', reason: refusal, bytes: bytes.length, records: 1 });
      ack?.(false);
      return false;
    }
    if (this.dropped > 0) {
      const summary = Buffer.from(dropSummary(this.now(), process.pid, this.dropped), 'utf8');
      if (this.pendingBytes + summary.length + bytes.length <= GATEWAY_LOG_PENDING_BYTES) {
        this.dropped = 0;
        this.queue.push({ bytes: summary });
        this.queuedBytes += summary.length;
      }
    }
    this.queue.push(ack ? { bytes, ack } : { bytes });
    this.queuedBytes += bytes.length;
    this.pump();
    return true;
  }

  private isIdle(): boolean {
    return !this.busy && this.queue.length === 0;
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private pump(): void {
    if (this.busy || this.queue.length === 0 || this.current !== 'open') return;
    this.busy = true;
    void this.cycle().then(
      () => this.afterCycle(),
      () => this.afterCycle(),
    );
  }

  private afterCycle(): void {
    this.busy = false;
    if (this.current === 'open' && this.queue.length > 0) this.pump();
    else this.notifyIdle();
  }

  private dropQueued(reason: GatewayLogDropReason): void {
    if (this.queue.length === 0) return;
    const discarded = this.queue.splice(0);
    const bytes = discarded.reduce((sum, item) => sum + item.bytes.length, 0);
    this.queuedBytes -= bytes;
    this.dropped += discarded.length;
    this.notify({ type: 'drop', reason, bytes, records: discarded.length });
    for (const item of discarded) item.ack?.(false);
  }

  /** One sequence of file operations, each awaited before the next: one operation in flight. */
  private async cycle(): Promise<void> {
    try {
      if (this.phase !== 'ready') {
        if (!(await this.completeRotation())) return;
      }
      // Only the length: a queued record stays referenced by the queue alone across rotation.
      const next = this.queue[0]?.bytes.length;
      if (next === undefined) return;
      if (this.activeSize > 0 && this.activeSize + next > GATEWAY_LOG_SLOT_BYTES) {
        if (!(await this.rotate())) return;
      }
      const failed = await this.writeBatch();
      // The failed batch's bytes and their in-flight charge were released before this rollback.
      if (failed && (await this.rollback(failed.handle, failed.position))) this.fault(failed.code);
    } catch (error) {
      // Defensive: every expected fault is handled where it occurs.
      this.fault(errorCode(error));
    }
  }

  /**
   * Dequeue the records for the next write, in order, up to the slot boundary. One record is
   * written from its own bytes; several are concatenated once. The dequeued records are released
   * on return, so across I/O the writer holds one encoded copy of each in-flight record, which is
   * exactly the `inFlightBytes` charge. Only this synchronous copy briefly holds both.
   */
  private takeBatch(): { buffer: Buffer; records: number; acks: ((written: boolean) => void)[] } {
    let records = 0;
    let length = 0;
    for (const item of this.queue) {
      if (records > 0 && this.activeSize + length + item.bytes.length > GATEWAY_LOG_SLOT_BYTES)
        break;
      records++;
      length += item.bytes.length;
    }
    const taken = this.queue.splice(0, records);
    this.queuedBytes -= length;
    this.inFlightBytes = length;
    const only = taken.length === 1 ? taken[0] : undefined;
    return {
      buffer: only
        ? only.bytes
        : Buffer.concat(
            taken.map((item) => item.bytes),
            length,
          ),
      records,
      acks: taken.flatMap((item) => (item.ack ? [item.ack] : [])),
    };
  }

  /**
   * Write the next batch. Its buffer is released with its in-flight charge when the write settles
   * and no await follows, so a failed batch returns where to roll back to instead of holding its
   * bytes through the rollback.
   */
  private async writeBatch(): Promise<
    { handle: LogFileHandle; position: number; code: string } | undefined
  > {
    const { buffer, records, acks } = this.takeBatch();
    const length = buffer.length;
    const settle = (written: boolean) => {
      this.inFlightBytes = 0;
      for (const ack of acks) ack(written);
    };
    const discard = (reason: GatewayLogDropReason) => {
      this.dropped += records;
      this.notify({ type: 'drop', reason, bytes: length, records });
      settle(false);
    };
    const handle = (await this.verifyActiveName()) ? this.handle : undefined;
    if (!handle) {
      discard(this.current === 'disabled' ? 'disabled' : 'fault');
      return undefined;
    }
    const position = this.activeSize;
    let bytesWritten = 0;
    let code: string | undefined;
    try {
      ({ bytesWritten } = await handle.write(buffer, 0, length, position));
    } catch (error) {
      code = errorCode(error);
    }
    const complete = code === undefined && bytesWritten === length;
    this.notify({
      type: 'write',
      path: this.activePath,
      position,
      bytes: length,
      records,
      bytesWritten,
      result: complete ? 'complete' : code === undefined ? 'partial' : 'failed',
      ...(code === undefined ? {} : { code }),
    });
    if (complete) {
      this.activeSize += length;
      this.faults = 0;
      settle(true);
      return undefined;
    }
    discard('fault');
    return { handle, position, code: code ?? 'PARTIAL_WRITE' };
  }

  /** Restore the last complete record boundary, or stop writing this target. */
  private async rollback(handle: LogFileHandle, size: number): Promise<boolean> {
    try {
      const stats = await handle.stat();
      if (stats.size !== BigInt(size)) {
        const named = await lstatOrAbsent(this.fs, this.activePath);
        // A removed name is recreated empty by the next cycle; nothing remains to repair.
        if (named === undefined) return true;
        if (!safeEntry(named) || !sameIdentity(named, this.activeIdentity)) {
          await this.disable('active-slot-changed');
          return false;
        }
        await handle.truncate(size);
        this.notify({ type: 'rollback', path: this.activePath, size, result: 'complete' });
      }
      return true;
    } catch (error) {
      this.notify({
        type: 'rollback',
        path: this.activePath,
        size,
        result: 'failed',
        code: errorCode(error),
      });
      await this.disable('rollback-failed');
      return false;
    }
  }

  /** The active name must still be the opened file. A vanished name is recreated. */
  private async verifyActiveName(): Promise<boolean> {
    let named: LogFileStats | undefined;
    try {
      named = await lstatOrAbsent(this.fs, this.activePath);
    } catch (error) {
      this.fault(errorCode(error));
      return false;
    }
    if (named === undefined) {
      // Removed while open: release the orphaned handle and recreate at the fixed name.
      await this.closeHandle();
      this.phase = 'create';
      return this.completeRotation();
    }
    if (!safeEntry(named) || !sameIdentity(named, this.activeIdentity)) {
      await this.disable('active-slot-changed');
      return false;
    }
    return true;
  }

  /** Close active, rename-replace it onto previous and recreate active at the fixed name. */
  private async rotate(): Promise<boolean> {
    const previous = await this.checkPreviousSlot();
    if (!previous) return false;
    try {
      const named = await lstatOrAbsent(this.fs, this.activePath);
      if (!named || !safeEntry(named) || !sameIdentity(named, this.activeIdentity)) {
        await this.disable('active-slot-changed');
        return false;
      }
    } catch (error) {
      this.fault(errorCode(error));
      return false;
    }
    await this.closeHandle();
    this.notify({ type: 'rotate', step: 'close', path: this.activePath, result: 'complete' });
    this.phase = 'rename';
    return this.completeRotation();
  }

  /** The previous name is absent or still the file this writer admitted or rotated there. */
  private async checkPreviousSlot(): Promise<boolean> {
    try {
      const named = await lstatOrAbsent(this.fs, this.previousPath);
      if (named === undefined) return true;
      if (
        safeEntry(named) &&
        this.previousIdentity !== undefined &&
        sameIdentity(named, this.previousIdentity)
      )
        return true;
      await this.disable('previous-slot-changed');
      return false;
    } catch (error) {
      this.fault(errorCode(error));
      return false;
    }
  }

  private async completeRotation(): Promise<boolean> {
    if (this.phase === 'rename') {
      if (!(await this.checkPreviousSlot())) return false;
      try {
        const named = await lstatOrAbsent(this.fs, this.activePath);
        if (named === undefined) {
          // Interrupted after the rename: only the previous slot remains.
          this.phase = 'create';
        } else if (!safeEntry(named) || !sameIdentity(named, this.activeIdentity)) {
          await this.disable('active-slot-changed');
          return false;
        } else {
          await this.fs.rename(this.activePath, this.previousPath);
          this.notify({
            type: 'rotate',
            step: 'rename',
            path: this.previousPath,
            result: 'complete',
          });
          this.previousIdentity = this.activeIdentity;
          this.phase = 'create';
        }
      } catch (error) {
        const code = errorCode(error);
        this.notify({
          type: 'rotate',
          step: 'rename',
          path: this.previousPath,
          result: 'failed',
          code,
        });
        // A denied rotation drops records. It never truncates the full active slot.
        this.dropQueued('fault');
        this.fault(code);
        return false;
      }
    }
    if (this.phase === 'create') {
      let handle: LogFileHandle | undefined;
      try {
        handle = await this.fs.open(this.activePath, 'create');
        const opened = await handle.stat();
        const named = await this.fs.lstat(this.activePath);
        if (!safeEntry(named) || !sameIdentity(named, opened) || opened.size !== 0n) {
          await handle.close().catch(() => undefined);
          await this.disable('active-slot-changed');
          return false;
        }
        this.handle = handle;
        this.activeIdentity = { dev: opened.dev, ino: opened.ino };
        this.activeSize = 0;
        this.phase = 'ready';
        this.notify({ type: 'rotate', step: 'create', path: this.activePath, result: 'complete' });
      } catch (error) {
        const code = errorCode(error);
        this.notify({
          type: 'rotate',
          step: 'create',
          path: this.activePath,
          result: 'failed',
          code,
        });
        if (handle) await handle.close().catch(() => undefined);
        if (code === 'EEXIST') {
          // Another entry took the fixed name: preserve it and stop writing.
          await this.disable('active-slot-occupied');
          return false;
        }
        this.dropQueued('fault');
        this.fault(code);
        return false;
      }
    }
    return true;
  }

  private fault(_code: string): void {
    if (this.current !== 'open') return;
    this.faults++;
    if (this.faults >= GATEWAY_LOG_MAX_FAULTS) {
      void this.disable('fault-limit');
      return;
    }
    const delayMs =
      GATEWAY_LOG_BACKOFF_MS[Math.min(this.faults, GATEWAY_LOG_BACKOFF_MS.length) - 1] ?? 60_000;
    this.current = 'suspended';
    this.dropQueued('suspended');
    this.notify({ type: 'suspend', faults: this.faults, delayMs });
    this.resume = this.schedule(() => {
      this.resume = undefined;
      if (this.current !== 'suspended') return;
      this.current = 'open';
      this.pump();
    }, delayMs);
  }

  private async disable(reason: GatewayLogDisableReason): Promise<void> {
    if (this.current === 'disabled' || this.current === 'closed') return;
    this.current = 'disabled';
    this.resume?.cancel();
    this.notify({ type: 'disable', reason });
    this.dropQueued('disabled');
    await this.closeHandle();
  }

  private async closeHandle(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    if (handle) await handle.close().catch(() => undefined);
  }
}

/** Find the last complete-record boundary at or before `size`, reading backwards in chunks. */
async function completeBoundary(handle: LogFileHandle, size: number): Promise<number> {
  if (size === 0) return 0;
  const last = Buffer.alloc(1);
  await handle.read(last, 0, 1, size - 1);
  if (last[0] === LF) return size;
  const chunk = Buffer.alloc(GATEWAY_LOG_RECORD_BYTES);
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - chunk.length);
    const { bytesRead } = await handle.read(chunk, 0, end - start, start);
    const index = chunk.subarray(0, bytesRead).lastIndexOf(LF);
    if (index >= 0) return start + index + 1;
    end = start;
  }
  return 0;
}

interface AdoptedSlot {
  handle: LogFileHandle | undefined;
  identity: LogFileIdentity | undefined;
  size: number;
}

/**
 * Admit one slot under verified ownership: refuse unsafe entries untouched, replace oversized
 * history, repair an incomplete trailing record and account the actual opened size.
 */
async function adoptSlot(
  fs: LogFileSystem,
  path: string,
  slot: 'active' | 'previous',
  emit: (event: GatewayLogEvent) => void,
): Promise<AdoptedSlot> {
  let named: LogFileStats | undefined;
  try {
    named = await lstatOrAbsent(fs, path);
  } catch {
    throw new GatewayLogAdmissionError('unavailable', slot);
  }
  if (named !== undefined && !safeEntry(named))
    throw new GatewayLogAdmissionError('unsafe-entry', slot);
  if (named === undefined && slot === 'previous') {
    emit({ type: 'adopt', slot, path, action: 'absent', sizeBefore: 0, sizeAfter: 0 });
    return { handle: undefined, identity: undefined, size: 0 };
  }
  let handle: LogFileHandle;
  try {
    handle = await fs.open(path, named === undefined ? 'create' : 'existing');
  } catch {
    throw new GatewayLogAdmissionError('unavailable', slot);
  }
  try {
    const opened = await handle.stat();
    const current = await fs.lstat(path);
    if (
      !safeEntry(current) ||
      !sameIdentity(current, opened) ||
      (named !== undefined && !sameIdentity(named, opened))
    )
      throw new GatewayLogAdmissionError('identity-mismatch', slot);
    const sizeBefore = Number(opened.size);
    let size = sizeBefore;
    let action: Extract<GatewayLogEvent, { type: 'adopt' }>['action'] =
      named === undefined ? 'created' : 'kept';
    if (size > GATEWAY_LOG_SLOT_BYTES) {
      // Oversized history from the unbounded writer is replaced only under verified ownership.
      try {
        await handle.truncate(0);
      } catch {
        throw new GatewayLogAdmissionError('oversized-unreplaceable', slot);
      }
      size = 0;
      action = 'replaced-oversized';
    } else {
      const boundary = await completeBoundary(handle, size).catch(() => {
        throw new GatewayLogAdmissionError('repair-failed', slot);
      });
      if (boundary !== size) {
        try {
          await handle.truncate(boundary);
        } catch {
          throw new GatewayLogAdmissionError('repair-failed', slot);
        }
        size = boundary;
        action = 'tail-repaired';
      }
    }
    emit({ type: 'adopt', slot, path, action, sizeBefore, sizeAfter: size });
    return { handle, identity: { dev: opened.dev, ino: opened.ino }, size };
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (error instanceof GatewayLogAdmissionError) throw error;
    throw new GatewayLogAdmissionError('unavailable', slot);
  }
}

/**
 * Admit both fixed slots and open the active one. Call only while the root reservation is held.
 * Throws {@link GatewayLogAdmissionError} without modifying a refused entry or its target.
 */
export async function openGatewayLog(options: GatewayLogWriterOptions): Promise<GatewayLogWriter> {
  const fs = options.fs ?? nodeLogFileSystem;
  const emit = (event: GatewayLogEvent) => {
    try {
      options.observe?.(event);
    } catch {
      // Diagnostic only.
    }
  };
  const previous = await adoptSlot(fs, join(options.root, GATEWAY_LOG_PREVIOUS), 'previous', emit);
  await previous.handle?.close().catch(() => undefined);
  const active = await adoptSlot(fs, join(options.root, GATEWAY_LOG_ACTIVE), 'active', emit);
  if (!active.handle || !active.identity)
    throw new GatewayLogAdmissionError('unavailable', 'active');
  return new GatewayLogWriter(
    options,
    active.handle,
    active.identity,
    active.size,
    previous.identity,
  );
}
