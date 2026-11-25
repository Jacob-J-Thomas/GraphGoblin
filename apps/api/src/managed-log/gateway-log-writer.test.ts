import { spawn } from 'node:child_process';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_LOG_BACKOFF_MS,
  GATEWAY_LOG_MAX_FAULTS,
  GATEWAY_LOG_PENDING_BYTES,
  GATEWAY_LOG_RECORD_BYTES,
  GATEWAY_LOG_SLOT_BYTES,
  GatewayLogAdmissionError,
  dropSummary,
  nodeLogFileSystem,
  openGatewayLog,
  oversizedMarker,
  type GatewayLogEvent,
  type GatewayLogWriter,
  type LogFileHandle,
  type LogFileSystem,
} from './gateway-log-writer.js';

const roots: string[] = [];
const writers: GatewayLogWriter[] = [];
afterEach(async () => {
  for (const writer of writers.splice(0)) await writer.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gg-gateway-log-'));
  roots.push(root);
  return root;
}

const fatal = new TextDecoder('utf-8', { fatal: true });
/** Every byte is complete UTF-8 and every record ends with LF. */
function records(bytes: Buffer): string[] {
  const text = fatal.decode(bytes);
  if (text.length === 0) return [];
  expect(text.endsWith('\n')).toBe(true);
  return text.slice(0, -1).split('\n');
}

/** An LF-terminated record of exactly `bytes` encoded bytes ending with `last` before the delimiter suffix. */
function recordOfBytes(bytes: number, last = 'x'): string {
  const prefix = '{"msg":"';
  const suffix = '"}\n';
  const fill = bytes - Buffer.byteLength(prefix + last + suffix);
  expect(fill).toBeGreaterThanOrEqual(0);
  const record = prefix + 'a'.repeat(fill) + last + suffix;
  expect(Buffer.byteLength(record)).toBe(bytes);
  return record;
}

/** Complete LF records totalling exactly `bytes`. */
function seed(bytes: number): Buffer {
  const lines: string[] = [];
  let remaining = bytes;
  while (remaining > 0) {
    const length = Math.min(remaining, 1000);
    lines.push('s'.repeat(length - 1) + '\n');
    remaining -= length;
  }
  return Buffer.from(lines.join(''));
}

interface Gate {
  promise: Promise<void>;
  release(): void;
}
function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Real files; each fault is injected only at the operation the production writer reaches. */
function controlled() {
  const operations: string[] = [];
  /** Each buffer the writer handed to a write, held weakly so the seam never retains it. */
  const writeBuffers: WeakRef<Buffer>[] = [];
  const control: {
    stallWrite?: Gate;
    failWrite?: string;
    partialWrite?: number;
    failRename?: string;
    stallTruncate?: Gate;
    failTruncate?: string;
  } = {};
  const wrap = (path: string, handle: LogFileHandle): LogFileHandle => ({
    stat: () => handle.stat(),
    read: (...args) => handle.read(...args),
    async write(buffer, offset, length, position) {
      operations.push(`write ${position}+${length}`);
      writeBuffers.push(new WeakRef(buffer));
      if (control.stallWrite) await control.stallWrite.promise;
      if (control.failWrite)
        throw Object.assign(new Error('injected'), { code: control.failWrite });
      if (control.partialWrite !== undefined) {
        // A real partial write: these bytes land on disk before the short count is returned.
        const landed = Math.min(control.partialWrite, length);
        await handle.write(buffer, offset, landed, position);
        return { bytesWritten: landed };
      }
      return handle.write(buffer, offset, length, position);
    },
    async truncate(length) {
      operations.push(`truncate ${length}`);
      if (control.stallTruncate) await control.stallTruncate.promise;
      if (control.failTruncate)
        throw Object.assign(new Error('injected'), { code: control.failTruncate });
      return handle.truncate(length);
    },
    close: () => handle.close(),
  });
  const fs: LogFileSystem = {
    lstat: (path) => nodeLogFileSystem.lstat(path),
    async open(path, mode) {
      operations.push(`open ${mode}`);
      return wrap(path, await nodeLogFileSystem.open(path, mode));
    },
    async rename(from, to) {
      operations.push('rename');
      if (control.failRename)
        throw Object.assign(new Error('injected'), { code: control.failRename });
      return nodeLogFileSystem.rename(from, to);
    },
  };
  return { fs, control, operations, writeBuffers };
}

/** Wait for the writer to reach an operation that completes on libuv's thread pool. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the writer operation');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Weak references to the buffers `Buffer.from` creates while `act` runs: the encoded records. */
function encodedDuring(act: () => void): WeakRef<Buffer>[] {
  const encoded: WeakRef<Buffer>[] = [];
  const original = Buffer.from;
  const from = Buffer.from.bind(Buffer) as (...args: unknown[]) => Buffer;
  Buffer.from = ((...args: unknown[]) => {
    const bytes = from(...args);
    encoded.push(new WeakRef(bytes));
    return bytes;
  }) as typeof Buffer.from;
  try {
    act();
  } finally {
    Buffer.from = original;
  }
  return encoded;
}

/** Full collection after the current job, which otherwise keeps every new WeakRef target. */
async function collect(): Promise<void> {
  const gc = globalThis.gc;
  if (!gc) throw new Error('This test needs Node started with --expose-gc (vitest.config.ts)');
  await new Promise((resolve) => setImmediate(resolve));
  gc();
}

const reachable = (refs: WeakRef<Buffer>[]) => refs.map((ref) => ref.deref() !== undefined);

/** Deterministic backoff: the test decides when a suspended writer may retry. */
function manualSchedule() {
  const timers: { ms: number; run(): void; cancelled: boolean }[] = [];
  return {
    timers,
    schedule(callback: () => void, ms: number) {
      const timer = { ms, run: callback, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    },
    fire(ms: number) {
      const timer = timers.find((entry) => entry.ms === ms && !entry.cancelled);
      expect(timer).toBeDefined();
      timer!.cancelled = true;
      timer!.run();
    },
  };
}

async function writer(root: string, extra: Parameters<typeof openGatewayLog>[0] | object = {}) {
  const events: GatewayLogEvent[] = [];
  const opened = await openGatewayLog({ root, observe: (event) => events.push(event), ...extra });
  writers.push(opened);
  return { writer: opened, events };
}

const active = (root: string) => join(root, 'gateway.log');
const previous = (root: string) => join(root, 'gateway.log.1');

describe('gateway log record boundaries', () => {
  it('writes Pino lines whole and creates only the active slot', async () => {
    const root = await scratch();
    const { writer: log, events } = await writer(root);
    expect(log.write('{"level":30,"msg":"GraphGoblin API listening"}\n')).toBe(true);
    expect(log.write('{"level":30,"msg":"no trailing delimiter"}')).toBe(true);
    expect(await log.settle(5_000)).toBe(true);
    expect(records(await readFile(active(root)))).toEqual([
      '{"level":30,"msg":"GraphGoblin API listening"}',
      '{"level":30,"msg":"no trailing delimiter"}',
    ]);
    await expect(lstat(previous(root))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.filter((event) => event.type === 'adopt').map((event) => event.action)).toEqual([
      'absent',
      'created',
    ]);
  });

  it.each(['é', '€', '😀'])(
    'keeps a %s-terminated record at, below and above the 64 KiB encoded edge whole or marked',
    async (character) => {
      const root = await scratch();
      const { writer: log } = await writer(root, { now: () => 7 });
      const below = recordOfBytes(GATEWAY_LOG_RECORD_BYTES - 1, character);
      const exact = recordOfBytes(GATEWAY_LOG_RECORD_BYTES, character);
      const above = recordOfBytes(GATEWAY_LOG_RECORD_BYTES + 1, character);
      for (const record of [below, exact, above, '{"msg":"sentinel"}\n']) log.write(record);
      expect(await log.settle(5_000)).toBe(true);
      const bytes = await readFile(active(root));
      expect(records(bytes)).toEqual([
        below.slice(0, -1),
        exact.slice(0, -1),
        oversizedMarker(7, process.pid).slice(0, -1),
        '{"msg":"sentinel"}',
      ]);
      expect(bytes.length).toBe(
        GATEWAY_LOG_RECORD_BYTES * 2 - 1 + Buffer.byteLength(oversizedMarker(7, process.pid)) + 19,
      );
    },
  );

  it('replaces a much larger record and keeps lone surrogates valid UTF-8', async () => {
    const root = await scratch();
    const { writer: log } = await writer(root, { now: () => 11 });
    log.write('x'.repeat(5 * GATEWAY_LOG_RECORD_BYTES));
    log.write('{"msg":"lone \ud800 surrogate"}\n');
    expect(await log.settle(5_000)).toBe(true);
    expect(records(await readFile(active(root)))).toEqual([
      oversizedMarker(11, process.pid).slice(0, -1),
      '{"msg":"lone \ufffd surrogate"}',
    ]);
  });
});

describe('gateway log slot edges and adoption', () => {
  it('fills an adopted nonempty active slot exactly to 4 MiB, then rotates by rename-replace', async () => {
    const root = await scratch();
    const record = recordOfBytes(1000, '€');
    const seeded = GATEWAY_LOG_SLOT_BYTES - 1000;
    await writeFile(active(root), seed(seeded));
    await writeFile(previous(root), seed(500));
    const before = await stat(active(root), { bigint: true });
    const { writer: log, events } = await writer(root);
    expect(log.size).toBe(seeded);
    log.write(record);
    expect(await log.settle(5_000)).toBe(true);
    expect((await stat(active(root))).size).toBe(GATEWAY_LOG_SLOT_BYTES);
    expect(events.some((event) => event.type === 'rotate')).toBe(false);

    log.write('{"msg":"after rotation"}\n');
    expect(await log.settle(5_000)).toBe(true);
    const rotated = await stat(previous(root), { bigint: true });
    expect(rotated.ino).toBe(before.ino);
    expect(rotated.size).toBe(BigInt(GATEWAY_LOG_SLOT_BYTES));
    expect(records(await readFile(active(root)))).toEqual(['{"msg":"after rotation"}']);
    expect(
      events
        .filter((event) => event.type === 'rotate')
        .map((event) => `${event.step}:${event.result}`),
    ).toEqual(['close:complete', 'rename:complete', 'create:complete']);
    const tail = (await readFile(previous(root))).subarray(-1000);
    expect(fatal.decode(tail)).toBe(record);
  });

  it('rotates before a record that would exceed the slot by one byte', async () => {
    const root = await scratch();
    const seeded = GATEWAY_LOG_SLOT_BYTES - 999;
    await writeFile(active(root), seed(seeded));
    const { writer: log } = await writer(root);
    log.write(recordOfBytes(1000, '😀'));
    expect(await log.settle(5_000)).toBe(true);
    expect((await stat(previous(root))).size).toBe(seeded);
    expect((await stat(active(root))).size).toBe(1000);
  });

  it('repairs an interrupted trailing record, including a split multibyte character', async () => {
    const root = await scratch();
    const complete = '{"msg":"one"}\n{"msg":"two"}\n';
    const partial = Buffer.concat([Buffer.from('{"msg":"cut '), Buffer.from('€').subarray(0, 2)]);
    await writeFile(active(root), Buffer.concat([Buffer.from(complete), partial]));
    await writeFile(previous(root), Buffer.from('no delimiter at all'));
    const { writer: log, events } = await writer(root);
    log.write('{"msg":"three"}\n');
    expect(await log.settle(5_000)).toBe(true);
    expect(records(await readFile(active(root)))).toEqual([
      '{"msg":"one"}',
      '{"msg":"two"}',
      '{"msg":"three"}',
    ]);
    expect((await readFile(previous(root))).length).toBe(0);
    expect(
      events.filter((event) => event.type === 'adopt').map((event) => [event.slot, event.action]),
    ).toEqual([
      ['previous', 'tail-repaired'],
      ['active', 'tail-repaired'],
    ]);
  });

  it('finds a boundary more than one record-limit back in under-cap legacy history', async () => {
    const root = await scratch();
    const legacy = Buffer.concat([
      seed(2000),
      Buffer.from('y'.repeat(GATEWAY_LOG_RECORD_BYTES * 2)),
    ]);
    await writeFile(active(root), legacy);
    const { writer: log } = await writer(root);
    expect(log.size).toBe(2000);
  });

  it('replaces oversized legacy slots only when admitted, after the old writer is gone', async () => {
    const root = await scratch();
    await writeFile(active(root), seed(GATEWAY_LOG_SLOT_BYTES + 1));
    await writeFile(previous(root), seed(GATEWAY_LOG_SLOT_BYTES + 4096));
    const { writer: log, events } = await writer(root);
    expect(log.size).toBe(0);
    expect((await stat(previous(root))).size).toBe(0);
    expect(
      events
        .filter((event) => event.type === 'adopt')
        .map((event) => [event.slot, event.action, event.sizeBefore, event.sizeAfter]),
    ).toEqual([
      ['previous', 'replaced-oversized', GATEWAY_LOG_SLOT_BYTES + 4096, 0],
      ['active', 'replaced-oversized', GATEWAY_LOG_SLOT_BYTES + 1, 0],
    ]);
  });

  it('keeps an oversized slot untouched when it cannot be replaced', async () => {
    const root = await scratch();
    const oversized = seed(GATEWAY_LOG_SLOT_BYTES + 10);
    await writeFile(active(root), oversized);
    const { fs, control } = controlled();
    control.failTruncate = 'EPERM';
    await expect(openGatewayLog({ root, fs })).rejects.toMatchObject({
      code: 'oversized-unreplaceable',
      slot: 'active',
    });
    // Exact byte equality; Buffer.equals avoids element-wise deep equality over 4 MiB.
    expect((await readFile(active(root))).equals(oversized)).toBe(true);
  });

  it('refuses unsafe managed names before opening or modifying them', async () => {
    const root = await scratch();
    const target = join(root, 'protected target');
    await writeFile(target, 'protected bytes');
    await link(target, active(root));
    await expect(openGatewayLog({ root })).rejects.toBeInstanceOf(GatewayLogAdmissionError);
    await expect(openGatewayLog({ root })).rejects.toMatchObject({ code: 'unsafe-entry' });
    expect(await readFile(target, 'utf8')).toBe('protected bytes');
    expect((await stat(target)).nlink).toBe(2);

    const directoryRoot = await scratch();
    await mkdir(previous(directoryRoot));
    await expect(openGatewayLog({ root: directoryRoot })).rejects.toMatchObject({
      code: 'unsafe-entry',
      slot: 'previous',
    });
    expect((await lstat(previous(directoryRoot))).isDirectory()).toBe(true);
    await expect(lstat(active(directoryRoot))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a dangling or live link at a managed name and preserves its target', async (context) => {
    const root = await scratch();
    const target = join(root, 'link target');
    await writeFile(target, 'kept');
    try {
      await symlink(target, active(root), 'file');
      await symlink(join(root, 'missing'), previous(root), 'file');
    } catch (error) {
      // Windows file symlinks need Developer Mode or the symlink privilege.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return context.skip();
      throw error;
    }
    await expect(openGatewayLog({ root })).rejects.toMatchObject({ code: 'unsafe-entry' });
    expect(await readFile(target, 'utf8')).toBe('kept');
    expect((await lstat(previous(root))).isSymbolicLink()).toBe(true);
  });
});

describe('gateway log queue, faults and acknowledgment', () => {
  it('caps combined in-flight and queued bytes at exactly 256 KiB without waiting', async () => {
    const root = await scratch();
    const { fs, control } = controlled();
    const { writer: log, events } = await writer(root, { fs });
    control.stallWrite = gate();
    const inFlight = recordOfBytes(64 * 1024);
    expect(log.write(inFlight)).toBe(true);
    // The first record is now in flight behind the stalled operation.
    await new Promise((resolve) => setImmediate(resolve));
    const queued = [
      recordOfBytes(64 * 1024),
      recordOfBytes(64 * 1024),
      recordOfBytes(64 * 1024 - 1),
    ];
    for (const record of queued) expect(log.write(record)).toBe(true);
    expect(log.pendingBytes).toBe(GATEWAY_LOG_PENDING_BYTES - 1);
    expect(log.write('\n')).toBe(true);
    expect(log.pendingBytes).toBe(GATEWAY_LOG_PENDING_BYTES);
    const started = performance.now();
    expect(log.write('{"msg":"excess"}\n')).toBe(false);
    expect(log.write('\n')).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
    expect(log.pendingBytes).toBe(GATEWAY_LOG_PENDING_BYTES);
    expect(events.filter((event) => event.type === 'drop')).toEqual([
      { type: 'drop', reason: 'pending-limit', bytes: 17, records: 1 },
      { type: 'drop', reason: 'pending-limit', bytes: 1, records: 1 },
    ]);
    control.stallWrite.release();
    expect(await log.settle(5_000)).toBe(true);
    expect(log.pendingBytes).toBe(0);
    log.write('{"msg":"after drain"}\n');
    expect(await log.settle(5_000)).toBe(true);
    const written = records(await readFile(active(root)));
    expect(written.slice(0, 5)).toEqual([
      inFlight.slice(0, -1),
      ...queued.map((record) => record.slice(0, -1)),
      '',
    ]);
    expect(JSON.parse(written[5]!)).toMatchObject({
      msg: 'gateway log records dropped',
      dropped: 2,
    });
    expect(written[6]).toBe('{"msg":"after drain"}');
  });

  it('retains one encoded copy of each record across a held multi-record write', async () => {
    const root = await scratch();
    const { fs, control, operations, writeBuffers } = controlled();
    const { writer: log } = await writer(root, { fs });
    const firstWrite = gate();
    const batchWrite = gate();
    control.stallWrite = firstWrite;
    try {
      const first = recordOfBytes(65_536);
      expect(log.write(first)).toBe(true);
      await until(() => operations.includes('write 0+65536'));
      // Three records queue behind the held write; the next cycle writes them as one batch.
      const queued = [recordOfBytes(65_536), recordOfBytes(65_437), recordOfBytes(100)];
      let acknowledged: Promise<boolean> = Promise.resolve(false);
      const encoded = encodedDuring(() => {
        expect(log.write(queued[0]!)).toBe(true);
        expect(log.write(queued[1]!)).toBe(true);
        acknowledged = log.writeAcknowledged(queued[2]!);
      });
      expect(encoded).toHaveLength(3);
      // 131,073 B: retaining both the records and their concatenation would exceed 256 KiB.
      const batch = 65_536 + 65_437 + 100;
      expect(log.pendingBytes).toBe(65_536 + batch);
      control.stallWrite = batchWrite;
      firstWrite.release();
      await until(() => operations.includes(`write 65536+${batch}`));
      expect(log.pendingBytes).toBe(batch);
      await collect();
      // The write's own buffer is the one retained copy; the dequeued records are unreachable.
      expect(reachable(encoded)).toEqual([false, false, false]);
      expect(reachable(writeBuffers.slice(-1))).toEqual([true]);
      expect(writeBuffers.at(-1)?.deref()?.length).toBe(batch);
      // The rest of the combined budget remains available, and nothing beyond it.
      expect(log.write(recordOfBytes(65_536))).toBe(true);
      expect(log.write(recordOfBytes(GATEWAY_LOG_PENDING_BYTES - batch - 65_536))).toBe(true);
      expect(log.pendingBytes).toBe(GATEWAY_LOG_PENDING_BYTES);
      expect(log.write('\n')).toBe(false);
      // Acknowledged only once its own batch completes.
      expect(await Promise.race([acknowledged, Promise.resolve('held')])).toBe('held');
      batchWrite.release();
      expect(await acknowledged).toBe(true);
      expect(await log.settle(5_000)).toBe(true);
      expect(operations.filter((operation) => operation.startsWith('write'))).toEqual([
        'write 0+65536',
        `write 65536+${batch}`,
        `write ${65_536 + batch}+${GATEWAY_LOG_PENDING_BYTES - batch}`,
      ]);
      expect(records(await readFile(active(root)))).toEqual([
        first.slice(0, -1),
        ...queued.map((record) => record.slice(0, -1)),
        recordOfBytes(65_536).slice(0, -1),
        recordOfBytes(GATEWAY_LOG_PENDING_BYTES - batch - 65_536).slice(0, -1),
      ]);
    } finally {
      // A failed assertion must not leave a write held for the afterEach close.
      firstWrite.release();
      batchWrite.release();
    }
  });

  it('releases a short multi-record write before its rollback and keeps the rollback safe', async () => {
    const root = await scratch();
    const { fs, control, operations, writeBuffers } = controlled();
    const clock = manualSchedule();
    const { writer: log, events } = await writer(root, { fs, schedule: clock.schedule });
    const firstWrite = gate();
    const batchWrite = gate();
    const truncation = gate();
    control.stallWrite = firstWrite;
    try {
      log.write('{"msg":"kept"}\n');
      await until(() => operations.includes('write 0+15'));
      const queued = [recordOfBytes(65_536), recordOfBytes(65_536)];
      let lost: Promise<boolean>[] = [];
      const encoded = encodedDuring(() => {
        lost = queued.map((record) => log.writeAcknowledged(record));
      });
      control.stallWrite = batchWrite;
      firstWrite.release();
      await until(() => operations.includes('write 15+131072'));
      // The batch lands 5 bytes and returns short; its rollback truncation is held.
      control.partialWrite = 5;
      control.stallTruncate = truncation;
      batchWrite.release();
      await until(() => operations.includes('truncate 15'));
      expect(await Promise.all(lost)).toEqual([false, false]);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'write', result: 'partial', records: 2, bytesWritten: 5 }),
      );
      expect(log.pendingBytes).toBe(0);
      await collect();
      // Neither the records nor the write's buffer outlive the charge released with their drop.
      expect(reachable([...encoded, ...writeBuffers.slice(-1)])).toEqual([false, false, false]);
      truncation.release();
      expect(await log.settle(5_000)).toBe(true);
      expect(events).toContainEqual({
        type: 'rollback',
        path: active(root),
        size: 15,
        result: 'complete',
      });
      expect(log.state).toBe('suspended');
      expect(records(await readFile(active(root)))).toEqual(['{"msg":"kept"}']);
    } finally {
      // A failed assertion must not leave an operation held for the afterEach close.
      firstWrite.release();
      batchWrite.release();
      truncation.release();
    }
  });

  it('acknowledges only the specific completed record and bounds the exit wait at 250 ms', async () => {
    const root = await scratch();
    const { fs, control } = controlled();
    const { writer: log } = await writer(root, { fs });
    control.stallWrite = gate();
    const acknowledged = log.writeAcknowledged('{"msg":"startup failed"}\n');
    const deadline = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250));
    const started = performance.now();
    expect(await Promise.race([acknowledged, deadline])).toBe(false);
    expect(await log.settle(250)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect((await readFile(active(root))).length).toBe(0);
    control.stallWrite.release();
    expect(await acknowledged).toBe(true);
    expect(records(await readFile(active(root)))).toEqual(['{"msg":"startup failed"}']);
    expect(await log.settle(250)).toBe(true);
  });

  it('rolls a real partial write back to the last complete boundary and recovers', async () => {
    const root = await scratch();
    const { fs, control } = controlled();
    const clock = manualSchedule();
    const { writer: log, events } = await writer(root, { fs, schedule: clock.schedule });
    log.write('{"msg":"kept"}\n');
    expect(await log.settle(5_000)).toBe(true);
    control.partialWrite = 5;
    const lost = log.writeAcknowledged('{"msg":"partial ✓"}\n');
    expect(await lost).toBe(false);
    expect(await log.settle(5_000)).toBe(true);
    expect(records(await readFile(active(root)))).toEqual(['{"msg":"kept"}']);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'write', result: 'partial', bytesWritten: 5 }),
    );
    expect(events).toContainEqual({
      type: 'rollback',
      path: active(root),
      size: 15,
      result: 'complete',
    });
    expect(log.state).toBe('suspended');
    expect(log.write('{"msg":"while suspended"}\n')).toBe(false);
    delete control.partialWrite;
    clock.fire(GATEWAY_LOG_BACKOFF_MS[0]);
    expect(log.state).toBe('open');
    log.write('{"msg":"recovered"}\n');
    expect(await log.settle(5_000)).toBe(true);
    const written = records(await readFile(active(root)));
    expect(written[0]).toBe('{"msg":"kept"}');
    expect(JSON.parse(written[1]!)).toMatchObject({ dropped: 2 });
    expect(written[2]).toBe('{"msg":"recovered"}');
  });

  it('disables the target when a partial write cannot be rolled back', async () => {
    const root = await scratch();
    const { fs, control, operations } = controlled();
    const { writer: log, events } = await writer(root, { fs });
    control.partialWrite = 3;
    control.failTruncate = 'EIO';
    expect(await log.writeAcknowledged('{"msg":"x"}\n')).toBe(false);
    expect(await log.settle(5_000)).toBe(true);
    expect(log.state).toBe('disabled');
    expect(events).toContainEqual({ type: 'disable', reason: 'rollback-failed' });
    const count = operations.length;
    expect(log.write('{"msg":"later"}\n')).toBe(false);
    expect(operations.length).toBe(count);
  });

  it('drops on disk full with finite backoff and stops after the fault limit', async () => {
    const root = await scratch();
    const { fs, control, operations } = controlled();
    const clock = manualSchedule();
    const { writer: log, events } = await writer(root, { fs, schedule: clock.schedule });
    control.failWrite = 'ENOSPC';
    for (let fault = 1; fault <= GATEWAY_LOG_MAX_FAULTS; fault++) {
      expect(await log.writeAcknowledged(`{"msg":"attempt ${fault}"}\n`)).toBe(false);
      expect(await log.settle(5_000)).toBe(true);
      if (fault < GATEWAY_LOG_MAX_FAULTS) {
        const delay = GATEWAY_LOG_BACKOFF_MS[Math.min(fault, GATEWAY_LOG_BACKOFF_MS.length) - 1]!;
        expect(log.state).toBe('suspended');
        clock.fire(delay);
      }
    }
    expect(log.state).toBe('disabled');
    expect(events).toContainEqual({ type: 'disable', reason: 'fault-limit' });
    expect(
      events.filter((event) => event.type === 'suspend').map((event) => event.delayMs),
    ).toEqual([...GATEWAY_LOG_BACKOFF_MS]);
    const count = operations.length;
    expect(log.write('{"msg":"no more attempts"}\n')).toBe(false);
    expect(operations.length).toBe(count);
    expect((await readFile(active(root))).length).toBe(0);
  });

  it('drops on denied rotation and never truncates the full active slot', async () => {
    const root = await scratch();
    await writeFile(active(root), seed(GATEWAY_LOG_SLOT_BYTES - 10));
    await writeFile(previous(root), seed(100));
    const previousBefore = await readFile(previous(root));
    const { fs, control, operations } = controlled();
    const clock = manualSchedule();
    const { writer: log, events } = await writer(root, { fs, schedule: clock.schedule });
    control.failRename = 'EPERM';
    expect(await log.writeAcknowledged(recordOfBytes(100))).toBe(false);
    expect(await log.settle(5_000)).toBe(true);
    expect(operations.filter((operation) => operation.startsWith('truncate'))).toEqual([]);
    expect((await stat(active(root))).size).toBe(GATEWAY_LOG_SLOT_BYTES - 10);
    expect(await readFile(previous(root))).toEqual(previousBefore);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'rotate', step: 'rename', result: 'failed', code: 'EPERM' }),
    );
    delete control.failRename;
    clock.fire(GATEWAY_LOG_BACKOFF_MS[0]);
    log.write('{"msg":"rotated later"}\n');
    expect(await log.settle(5_000)).toBe(true);
    expect((await stat(previous(root))).size).toBe(GATEWAY_LOG_SLOT_BYTES - 10);
    expect(records(await readFile(active(root))).at(-1)).toBe('{"msg":"rotated later"}');
  });

  it('stops writing and preserves a foreign entry that replaced the active name', async () => {
    const root = await scratch();
    const { writer: log, events } = await writer(root);
    log.write('{"msg":"before"}\n');
    expect(await log.settle(5_000)).toBe(true);
    await rename(active(root), join(root, 'moved away'));
    await writeFile(active(root), 'foreign');
    expect(await log.writeAcknowledged('{"msg":"after"}\n')).toBe(false);
    expect(await readFile(active(root), 'utf8')).toBe('foreign');
    expect(events).toContainEqual({ type: 'disable', reason: 'active-slot-changed' });
    expect(log.state).toBe('disabled');
  });

  it('refuses rotation onto a previous slot it did not admit', async () => {
    const root = await scratch();
    await writeFile(active(root), seed(GATEWAY_LOG_SLOT_BYTES - 5));
    const { writer: log, events } = await writer(root);
    await writeFile(previous(root), 'foreign previous');
    expect(await log.writeAcknowledged(recordOfBytes(64))).toBe(false);
    expect(await readFile(previous(root), 'utf8')).toBe('foreign previous');
    expect((await stat(active(root))).size).toBe(GATEWAY_LOG_SLOT_BYTES - 5);
    expect(events).toContainEqual({ type: 'disable', reason: 'previous-slot-changed' });
  });

  it('recreates a removed active name at the fixed path', async () => {
    const root = await scratch();
    const { writer: log } = await writer(root);
    log.write('{"msg":"first"}\n');
    expect(await log.settle(5_000)).toBe(true);
    await rm(active(root));
    expect(await log.writeAcknowledged('{"msg":"second"}\n')).toBe(true);
    expect(records(await readFile(active(root)))).toEqual(['{"msg":"second"}']);
  });

  it('is a plain Pino destination: Pino finds no emit, flush or end hook to call', async () => {
    const root = await scratch();
    const { writer: log, events } = await writer(root);
    const surface = log as unknown as Record<string, unknown>;
    for (const hook of ['emit', 'flush', 'flushSync', 'end', 'destroy'])
      expect(surface[hook]).toBeUndefined();
    const { pino } = await import('pino');
    pino({ level: 'info' }, log).info('through pino');
    expect(await log.settle(5_000)).toBe(true);
    expect(events.every((event) => typeof event === 'object')).toBe(true);
    expect(JSON.parse(records(await readFile(active(root)))[0]!)).toMatchObject({
      msg: 'through pino',
    });
  });

  it('closes idempotently and refuses later records', async () => {
    const root = await scratch();
    const { writer: log } = await writer(root);
    await log.close();
    await log.close();
    expect(log.state).toBe('closed');
    expect(log.write('{"msg":"late"}\n')).toBe(false);
    expect(dropSummary(1, 2, 3)).toBe(
      '{"level":40,"time":1,"pid":2,"msg":"gateway log records dropped","dropped":3}\n',
    );
  });
});

describe.skipIf(process.platform !== 'win32')('gateway log with real Windows sharing', () => {
  it('drops on a native delete-sharing denial during rotation and keeps both slots', async () => {
    const root = await scratch();
    await writeFile(active(root), seed(GATEWAY_LOG_SLOT_BYTES - 10));
    await writeFile(previous(root), seed(200));
    const { writer: log, events } = await writer(root);
    // .NET FileShare.Read omits FILE_SHARE_DELETE, so MoveFileEx cannot replace this name.
    const holder = spawn(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$f=[IO.File]::Open($env:GG_TEST_HELD,'Open','Read','Read'); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadToEnd(); $f.Dispose()",
      ],
      { env: { ...process.env, GG_TEST_HELD: previous(root) }, windowsHide: true },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('held')) resolve();
        });
        holder.once('exit', (code) => reject(new Error(`holder exited ${code}`)));
      });
      expect(await log.writeAcknowledged(recordOfBytes(100))).toBe(false);
      const failed = events.find(
        (event) => event.type === 'rotate' && event.step === 'rename' && event.result === 'failed',
      );
      expect(failed).toBeDefined();
      expect((await stat(active(root))).size).toBe(GATEWAY_LOG_SLOT_BYTES - 10);
      expect((await stat(previous(root))).size).toBe(200);
    } finally {
      holder.stdin.end();
      await new Promise((resolve) => holder.once('close', resolve));
    }
  });
});
