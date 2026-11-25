import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  acquireDataDirLock,
  acquireDatabaseLock,
  databaseLockFileName,
  databaseLockState,
  dataDirLockState,
  DATA_DIR_LOCK_FILE,
  RECLAIM_GUARD_SUFFIX,
  type AttestedDataDirLock,
  type DataDirLock,
} from './data-dir-lock.js';

// Functional POSIX controls only: actual Windows files/bytes/ino/dev/nlink remain real.
// No native Mac, uid/mode trust or GUI acceptance is established by this overlay.
const io = vi.hoisted(() => ({
  primary: '',
  posix: false,
  creates: 0,
  lstatCalls: 0,
  gateAt: 0,
  observed: undefined as (() => void) | undefined,
  completion: undefined as Promise<void> | undefined,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  function metadata<
    T extends { dev: number | bigint; uid: number | bigint; mode: number | bigint },
  >(value: T): T {
    if (io.posix && typeof value.dev === 'bigint')
      Object.assign(value, { uid: 0n, mode: (BigInt(value.mode) & ~0o777n) | 0o600n });
    return value;
  }
  return {
    ...actual,
    // Proxies preserve Node's overloads while forwarding the original filesystem operation.
    lstat: new Proxy(actual.lstat, {
      async apply(target, _this: unknown, args: Parameters<typeof actual.lstat>) {
        const info = await target(...args);
        if (resolve(String(args[0])) !== io.primary) return info;
        metadata(info);
        if (++io.lstatCalls === io.gateAt) {
          io.observed?.();
          await io.completion;
        }
        return info;
      },
    }),
    open: new Proxy(actual.open, {
      async apply(target, _this: unknown, args: Parameters<typeof actual.open>) {
        const handle = await target(...args);
        if (resolve(String(args[0])) !== io.primary) return handle;
        if (args[1] === 'wx') io.creates++;
        const underlying = handle.stat.bind(handle);
        handle.stat = new Proxy(handle.stat, {
          async apply(_target, _receiver: unknown, options: Parameters<typeof handle.stat>) {
            return metadata(await underlying(...options));
          },
        });
        return handle;
      },
    }),
  };
});
const native = await vi.importActual<typeof fs>('node:fs/promises');
const attest = { attestLocalArtifact: true } as const;
const savedGeteuid = Object.getOwnPropertyDescriptor(process, 'geteuid');
const roots: string[] = [];
const leases: DataDirLock[] = [];
const children: OwnedChild[] = [];
const observations: unknown[] = [];
let temporaryParent: string;
let directory: string;
let primary: string;

function controlPosix() {
  io.posix = true;
  Object.defineProperty(process, 'geteuid', { configurable: true, value: () => 0 });
}
function hasProof(lease: DataDirLock): lease is AttestedDataDirLock {
  return 'verifyOwnedArtifact' in lease && typeof lease.verifyOwnedArtifact === 'function';
}
async function acquire(kind: 'ordinary' | 'attested', dir = directory) {
  const lease =
    kind === 'attested'
      ? await acquireDataDirLock(dir, undefined, attest)
      : await acquireDataDirLock(dir);
  leases.push(lease);
  return lease;
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

// Each child imports the built, immutable public module. Faults target only this sandbox's
// published guard marker / primary unlink. No private lock-record writer or verifier exists here.
const childProgram = String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const [moduleURL, encoded] = process.argv.slice(1);
const cfg = JSON.parse(encoded);
const native = { open: fs.open, lstat: fs.lstat, unlink: fs.unlink, readFile: fs.readFile, readdir: fs.readdir, access: fs.access };
let phase = 'acquire';
let matchingOwnerAtFailure = false;
function fault(message) { return Object.assign(new Error(message), { code: 'EACCES' }); }
function metadata(info) { if (cfg.mode === 'release-fault' && typeof info.dev === 'bigint') Object.assign(info, { uid: 0n, mode: (info.mode & ~0o777n) | 0o600n }); return info; }
if (cfg.mode === 'release-fault') {
  Object.defineProperty(process, 'geteuid', { configurable: true, value: () => 0 });
  fs.lstat = async (...args) => metadata(await native.lstat(...args));
  fs.open = async (...args) => { const handle = await native.open(...args); const original = handle.stat.bind(handle); handle.stat = async (...options) => metadata(await original(...options)); return handle; };
}
fs.unlink = async (target, ...rest) => {
  const current = path.resolve(String(target));
  if (cfg.mode === 'rollback' && path.dirname(current) === cfg.guard) {
    matchingOwnerAtFailure = (await native.readFile(cfg.primary, 'utf8')) === (await native.readFile(current, 'utf8'));
    throw fault('D237 guard cleanup fault');
  }
  if (current === cfg.primary && ((cfg.mode === 'rollback' && cfg.doubleFault) || (cfg.mode === 'release-fault' && phase === 'release'))) throw fault('D237 primary cleanup fault');
  return native.unlink(target, ...rest);
};
syncBuiltinESMExports();
function errorShape(error) { if (!(error instanceof Error)) return { message: String(error) }; return { name: error.name, message: error.message, code: error.code, operation: error.operation, cause: error.cause ? errorShape(error.cause) : undefined, errors: error instanceof AggregateError ? error.errors.map(errorShape) : undefined }; }
function send(type, result) { return new Promise((yes, no) => process.send({ type, pid: process.pid, result }, (error) => error ? no(error) : yes())); }
function exists(file) { return native.access(file).then(() => true, () => false); }
let lease;
process.on('message', (message) => {
  if (message?.type !== 'finish') return;
  Promise.resolve(lease?.release()).then(() => process.exit(0), () => process.exit(1));
});
process.on('disconnect', () => process.exit(0));
try {
  const locks = await import(moduleURL);
  const take = () => cfg.kind === 'attested' ? locks.acquireDataDirLock(cfg.directory, undefined, { attestLocalArtifact: true }) : locks.acquireDataDirLock(cfg.directory);
  if (cfg.mode === 'rollback') {
    let error;
    let escaped = false;
    try { lease = await take(); escaped = true; } catch (caught) { error = caught; }
    let contenderRefused = false;
    try { await locks.acquireDataDirLock(cfg.directory); } catch { contenderRefused = true; }
    await send('done', { error: errorShape(error), escaped, matchingOwnerAtFailure, contenderRefused, primaryPresent: await exists(cfg.primary), guardPresent: await exists(cfg.guard), state: await locks.dataDirLockState(cfg.directory) });
    process.exit(0);
  }
  lease = await take();
  const owner = JSON.parse(await native.readFile(cfg.primary, 'utf8'));
  if (cfg.mode === 'release-fault') {
    const proofBefore = (await lease.verifyOwnedArtifact()) !== undefined;
    phase = 'release';
    let error;
    try { await lease.release(); } catch (caught) { error = caught; }
    const proofAfterUndefined = (await lease.verifyOwnedArtifact()) === undefined;
    let contenderRefused = false;
    try { await locks.acquireDataDirLock(cfg.directory); } catch { contenderRefused = true; }
    await send('done', { proofBefore, proofAfterUndefined, error: errorShape(error), contenderRefused, primaryPresent: await exists(cfg.primary), state: await locks.dataDirLockState(cfg.directory), creationTime: owner.windowsCreationTime });
    process.exit(0);
  }
  await send('ready', { creationTime: owner.windowsCreationTime, primary: cfg.primary });
  if (cfg.mode === 'stale') process.exit(0);
} catch (error) { await send('done', { fatal: errorShape(error) }); process.exit(1); }
`;

const ChildMessage = z.object({
  type: z.enum(['ready', 'done']),
  pid: z.number().int().positive(),
  result: z.unknown(),
});
interface OwnedChild {
  process: ChildProcess;
  message: Promise<z.infer<typeof ChildMessage>>;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdout: string[];
  stderr: string[];
  mode: string;
  journaled: boolean;
}
function child(
  mode: 'stale' | 'hold' | 'rollback' | 'release-fault',
  kind: 'ordinary' | 'attested',
  doubleFault = false,
): OwnedChild {
  const moduleURL = pathToFileURL(resolve(import.meta.dirname, '../dist/data-dir-lock.js')).href;
  const config = JSON.stringify({
    mode,
    kind,
    doubleFault,
    directory,
    primary,
    guard: primary + RECLAIM_GUARD_SUFFIX,
  });
  const process = spawn(
    globalThis.process.execPath,
    ['--input-type=module', '--eval', childProgram, '--', moduleURL, config],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, timeout: 15_000 },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  process.stdout!.setEncoding('utf8').on('data', (data: string) => stdout.push(data));
  process.stderr!.setEncoding('utf8').on('data', (data: string) => stderr.push(data));
  let received = false;
  const message = new Promise<z.infer<typeof ChildMessage>>((yes, no) => {
    process.once('message', (value) => {
      received = true;
      try {
        yes(ChildMessage.parse(value));
      } catch (error) {
        no(error);
      }
    });
    process.once('error', no);
    process.once('exit', () => {
      if (!received) no(new Error('Owned child exited before its result: ' + stderr.join('')));
    });
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((yes) =>
    process.once('close', (code, signal) => yes({ code, signal })),
  );
  const owned = { process, message, closed, stdout, stderr, mode, journaled: false };
  children.push(owned);
  return owned;
}
async function journal(owned: OwnedChild) {
  if (owned.journaled) return;
  owned.journaled = true;
  const exit = await owned.closed;
  observations.push({
    kind: 'owned-child',
    pid: owned.process.pid,
    mode: owned.mode,
    exit,
    stdout: owned.stdout.join(''),
    stderr: owned.stderr.join(''),
    message: await owned.message.catch((error: unknown) => ({ failure: String(error) })),
  });
  expect(exit).toEqual({ code: 0, signal: null });
}
async function finish(owned: OwnedChild) {
  if (owned.process.connected) owned.process.send({ type: 'finish' });
  await journal(owned);
}

beforeEach(async () => {
  temporaryParent = await native.realpath(tmpdir());
  directory = await native.mkdtemp(join(temporaryParent, 'gg-d237-independent-'));
  directory = await native.realpath(directory);
  roots.push(directory);
  primary = join(directory, DATA_DIR_LOCK_FILE);
  Object.assign(io, {
    primary,
    posix: false,
    creates: 0,
    lstatCalls: 0,
    gateAt: 0,
    observed: undefined,
    completion: undefined,
  });
});
afterEach(async () => {
  for (const owned of children.splice(0)) await finish(owned);
  for (const lease of leases.splice(0)) await lease.release();
  if (savedGeteuid) Object.defineProperty(process, 'geteuid', savedGeteuid);
  else Reflect.deleteProperty(process, 'geteuid');
  io.posix = false;
  for (const root of roots.splice(0)) {
    const physical = await native.realpath(root);
    const within = relative(temporaryParent, physical);
    if (
      !isAbsolute(physical) ||
      within.startsWith('..') ||
      isAbsolute(within) ||
      dirname(physical) !== temporaryParent ||
      !basename(physical).startsWith('gg-d237-independent-')
    )
      throw new Error('Refusing cleanup outside the owned sandbox: ' + physical);
    await native.rm(physical, { recursive: true, force: true });
    await expect(native.lstat(physical)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  console.log('D237 independent observation ' + JSON.stringify(observations.splice(0)));
});

describe('independent D237 public lock composition delta', () => {
  it.each(['ordinary', 'attested'] as const)(
    'L1 keeps one primary acquisition and its real %s release',
    async (kind) => {
      const lease = await acquire(kind);
      expect(io.creates).toBe(1);
      expect(lease.reclaimed).toEqual({ file: false, guard: false });
      await expect(acquireDataDirLock(directory)).rejects.toThrow(
        'another GraphGoblin process holds',
      );
      if (kind === 'ordinary') expect(lease).not.toHaveProperty('verifyOwnedArtifact');
      else {
        if (!hasProof(lease))
          throw new Error('Attested overload did not expose its public verifier');
        if (!savedGeteuid) expect(await lease.verifyOwnedArtifact()).toBeUndefined();
        controlPosix();
        const physical = await native.lstat(primary, { bigint: true });
        expect(await lease.verifyOwnedArtifact()).toEqual({
          path: primary,
          dev: physical.dev,
          ino: physical.ino,
        });
      }
      await expect(lease.release()).resolves.toBe('removed');
      await expect(lease.release()).resolves.toBe('removed');
      if (hasProof(lease)) expect(await lease.verifyOwnedArtifact()).toBeUndefined();
      expect(await dataDirLockState(directory)).toEqual({ state: 'free' });
      const next = await acquire('ordinary');
      await expect(next.release()).resolves.toBe('removed');
    },
  );

  it.each(['ordinary', 'attested'] as const)(
    'L2 reclaims a real exited child owner through the %s overload',
    async (kind) => {
      const former = child('stale', kind);
      const ready = await former.message;
      expect(ready.type).toBe('ready');
      expect(ready.pid).toBe(former.process.pid);
      await journal(former);
      const before: unknown = JSON.parse(await native.readFile(primary, 'utf8'));
      expect(before).toMatchObject({ pid: ready.pid });
      if (kind === 'attested') controlPosix();
      const lease = await acquire(kind);
      expect(lease.reclaimed).toEqual({ file: true, guard: false });
      expect(io.creates).toBe(1);
      expect(await native.readFile(primary, 'utf8')).not.toEqual(JSON.stringify(before));
      if (hasProof(lease))
        expect(await lease.verifyOwnedArtifact()).toMatchObject({ path: primary });
      await expect(lease.release()).resolves.toBe('removed');
      expect(await native.readdir(directory)).toEqual([]);
    },
  );

  it.each(['ordinary', 'attested'] as const)(
    'L3 rolls back the %s primary after recovery release fails without publishing a lease',
    async (kind) => {
      const failed = child('rollback', kind);
      const result = await failed.message;
      await journal(failed);
      expect(result).toMatchObject({
        type: 'done',
        result: {
          escaped: false,
          matchingOwnerAtFailure: true,
          contenderRefused: true,
          primaryPresent: false,
          guardPresent: true,
          state: { state: 'held', path: primary + RECLAIM_GUARD_SUFFIX },
          error: {
            message: expect.stringContaining('rolled back'),
            cause: {
              operation: 'recovery-marker-unlink',
              code: 'EACCES',
              cause: { message: 'D237 guard cleanup fault' },
            },
          },
        },
      });
      await expect(native.lstat(primary)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await native.readdir(primary + RECLAIM_GUARD_SUFFIX)).toHaveLength(1);
    },
  );

  it.each(['ordinary', 'attested'] as const)(
    'L4 keeps both errors and ownership when %s rollback also fails',
    async (kind) => {
      const failed = child('rollback', kind, true);
      const result = await failed.message;
      await journal(failed);
      expect(result).toMatchObject({
        type: 'done',
        result: {
          escaped: false,
          matchingOwnerAtFailure: true,
          contenderRefused: true,
          primaryPresent: true,
          guardPresent: true,
          state: { state: 'held' },
          error: {
            name: 'AggregateError',
            message: expect.stringContaining('ownership remains held'),
            errors: [
              {
                code: 'EACCES',
                operation: 'recovery-marker-unlink',
                cause: { message: 'D237 guard cleanup fault' },
              },
              { code: 'EACCES', message: 'D237 primary cleanup fault' },
            ],
          },
        },
      });
      expect(await native.readFile(primary, 'utf8')).toContain(String(result.pid));
    },
  );

  it.each(['absent', 'successor', 'removal-fault'] as const)(
    'L5 forwards attested release ownership after %s and retires proof',
    async (scenario) => {
      if (scenario === 'removal-fault') {
        const owned = child('release-fault', 'attested');
        const message = await owned.message;
        await journal(owned);
        expect(message).toMatchObject({
          type: 'done',
          result: {
            proofBefore: true,
            proofAfterUndefined: true,
            contenderRefused: true,
            primaryPresent: true,
            state: { state: 'held', path: primary },
            error: { code: 'EACCES', message: 'D237 primary cleanup fault' },
          },
        });
        return;
      }
      controlPosix();
      const lease = await acquire('attested');
      if (!hasProof(lease)) throw new Error('Missing attested public verifier');
      expect(await lease.verifyOwnedArtifact()).toMatchObject({ path: primary });
      await native.unlink(primary);
      if (scenario === 'absent') {
        await expect(lease.release()).resolves.toBe('missing');
        expect(await lease.verifyOwnedArtifact()).toBeUndefined();
        return;
      }
      const successor = child('hold', 'ordinary');
      expect((await successor.message).type).toBe('ready');
      const successorRecord = await native.readFile(primary);
      expect(await lease.verifyOwnedArtifact()).toBeUndefined();
      await expect(lease.release()).resolves.toBe('kept');
      expect(await native.readFile(primary)).toEqual(successorRecord);
      expect(await dataDirLockState(directory)).toMatchObject({ state: 'held', path: primary });
      await finish(successor);
      await expect(native.lstat(primary)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('L6 retires an already verified result whose final filesystem observation completes after release begins', async () => {
    controlPosix();
    const lease = await acquire('attested');
    if (!hasProof(lease)) throw new Error('Missing attested public verifier');
    expect(await lease.verifyOwnedArtifact()).toMatchObject({ path: primary });
    const observed = barrier();
    const complete = barrier();
    Object.assign(io, {
      lstatCalls: 0,
      gateAt: 2,
      observed: observed.resolve,
      completion: complete.promise,
    });
    const held = lease.verifyOwnedArtifact();
    try {
      await observed.promise;
      const release = lease.release();
      expect(await lease.verifyOwnedArtifact()).toBeUndefined();
      await expect(release).resolves.toBe('removed');
      complete.resolve();
      expect(await held).toBeUndefined();
      expect(io.lstatCalls).toBe(2);
    } finally {
      complete.resolve();
      await held;
    }
  });

  it('L7 shares canonical database ownership across overloads and refuses real hard-link aliases', async () => {
    const database = join(directory, 'shared.sqlite');
    await native.writeFile(database, 'owned database fixture');
    await native.mkdir(join(directory, 'nested'));
    const alias = directory + '/nested/../shared.sqlite';
    io.primary = join(directory, databaseLockFileName(basename(database)));
    const ordinary = await acquireDatabaseLock(database);
    leases.push(ordinary);
    await expect(acquireDatabaseLock(alias, attest)).rejects.toThrow(
      'another GraphGoblin process holds',
    );
    expect(await databaseLockState(alias)).toMatchObject({ state: 'held', path: io.primary });
    await expect(ordinary.release()).resolves.toBe('removed');
    controlPosix();
    const attested = await acquireDatabaseLock(alias, attest);
    leases.push(attested);
    expect(await attested.verifyOwnedArtifact()).toMatchObject({ path: io.primary });
    await expect(acquireDatabaseLock(database)).rejects.toThrow(
      'another GraphGoblin process holds',
    );
    await expect(attested.release()).resolves.toBe('removed');
    const hardAlias = join(directory, 'hard-alias.sqlite');
    await native.link(database, hardAlias);
    expect((await native.stat(database)).nlink).toBeGreaterThan(1);
    await expect(acquireDatabaseLock(database)).rejects.toThrow('multiple hard links');
    await expect(acquireDatabaseLock(hardAlias, attest)).rejects.toThrow('multiple hard links');
    expect(await native.readdir(directory)).not.toContain(
      databaseLockFileName(basename(hardAlias)),
    );
    expect(await databaseLockState(database)).toEqual({ state: 'free' });
  });
});
