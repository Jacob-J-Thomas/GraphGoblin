import { access, link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { canonicalPath } from './canonical-path.js';
import {
  acquireDatabaseLock,
  databaseLockFileName,
  databaseLockState,
  HardLinkedDatabaseRefusedError,
  RECLAIM_GUARD_SUFFIX,
  StoreOwnershipRefusedError,
} from './data-dir-lock.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const hardLinkAction =
  'has multiple hard links; use one ordinary SQLite file so GraphGoblin can establish exclusive ownership';

it.each([
  {
    message: 'another GraphGoblin process holds /store/graphgoblin.lock',
    cause: 'store-held',
  },
  {
    message:
      'Store ownership could not be verified (malformed or incomplete owner record): /store/graphgoblin.lock',
    cause: 'store-ownership-unverified',
  },
])('renders typed $cause refusals while retaining the managed category', ({ message, cause }) => {
  const refusal = new StoreOwnershipRefusedError(message);
  expect(shellFailureOutput(refusal)).toBe(message);
  expect(startupFailureCause('store', refusal)).toBe(cause);

  // Matching text alone must not discard an unexpected error's diagnostic object.
  const unexpected = new Error(message);
  expect(shellFailureOutput(unexpected)).toBe(unexpected);
  expect(startupFailureCause('store', unexpected)).toBe(cause);
});

it('escapes ownership display controls while preserving the original error message', () => {
  const message =
    'Store ownership could not be verified (test): /store/a\nb\r\t\u001b\u007f\u0085  /graphgoblin.lock';
  const refusal = new StoreOwnershipRefusedError(message);
  expect(shellFailureOutput(refusal)).toBe(
    'Store ownership could not be verified (test): /store/a\\u000ab\\u000d\\u0009\\u001b\\u007f\\u0085\\u2028\\u2029/graphgoblin.lock',
  );
  expect(refusal.message).toBe(message);
});

it('preserves process-identity diagnostics and their existing managed category', () => {
  const error = new Error('Cannot establish Windows process identity');
  expect(shellFailureOutput(error)).toBe(error);
  expect(startupFailureCause('store', error)).toBe('process-identity-unavailable');
});

it('renders a typed hard-linked database refusal as its complete message, keeping store-unavailable', () => {
  const refusal = new HardLinkedDatabaseRefusedError('/store/graphgoblin.db');
  const message = `database /store/graphgoblin.db ${hardLinkAction}`;
  expect(refusal.message).toBe(message);
  expect(refusal.database).toBe('/store/graphgoblin.db');
  expect(refusal.name).toBe('HardLinkedDatabaseRefusedError');
  // Never a held or unverifiable owner, and no new managed category.
  expect(refusal).not.toBeInstanceOf(StoreOwnershipRefusedError);
  expect(shellFailureOutput(refusal)).toBe(message);
  expect(startupFailureCause('store', refusal)).toBe('store-unavailable');

  // An impersonating plain Error keeps its diagnostic object, stack and the same category.
  const unexpected = new Error(message);
  expect(shellFailureOutput(unexpected)).toBe(unexpected);
  expect((shellFailureOutput(unexpected) as Error).stack).toBe(unexpected.stack);
  expect(startupFailureCause('store', unexpected)).toBe('store-unavailable');
});

it('keeps store-unavailable when a refused database path contains ownership prefixes', () => {
  for (const database of [
    '/another GraphGoblin process holds/graphgoblin.db',
    '/Store ownership could not be verified (x)/graphgoblin.db',
  ]) {
    const refusal = new HardLinkedDatabaseRefusedError(database);
    expect(startupFailureCause('store', refusal)).toBe('store-unavailable');
    expect(shellFailureOutput(refusal)).toBe(`database ${database} ${hardLinkAction}`);
  }
});

it('escapes hard-linked database display controls while preserving the original error message', () => {
  const database = '/store/a\nb\r\t\u001b\u007f\u0085  /graphgoblin.db';
  const refusal = new HardLinkedDatabaseRefusedError(database);
  const message = `database ${database} ${hardLinkAction}`;
  const output = shellFailureOutput(refusal);
  expect(output).toBe(
    `database /store/a\\u000ab\\u000d\\u0009\\u001b\\u007f\\u0085\\u2028\\u2029/graphgoblin.db ${hardLinkAction}`,
  );
  expect(output).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
  expect(refusal.message).toBe(message);
  expect(refusal.database).toBe(database);
});

it('refuses both real hard-link spellings with the typed canonical refusal and leaves no lock', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gg-hard-linked-display-'));
  roots.push(base);
  const database = join(base, 'store.db');
  const alias = join(base, 'alias.db');
  const bytes = Buffer.from('SQLite format 3\u0000 disposable fixture bytes');
  await writeFile(database, bytes);
  await link(database, alias);
  for (const spelling of [database, alias]) {
    const refusal: unknown = await acquireDatabaseLock(spelling).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(HardLinkedDatabaseRefusedError);
    const canonical = canonicalPath(spelling);
    expect((refusal as HardLinkedDatabaseRefusedError).database).toBe(canonical);
    expect(shellFailureOutput(refusal)).toBe(`database ${canonical} ${hardLinkAction}`);
    expect(startupFailureCause('store', refusal)).toBe('store-unavailable');
    const lock = join(dirname(canonical), databaseLockFileName(basename(canonical)));
    await expect(access(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${lock}${RECLAIM_GUARD_SUFFIX}`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await databaseLockState(spelling)).toEqual({ state: 'free' });
  }
  expect(await readFile(database)).toEqual(bytes);
  expect(await readFile(alias)).toEqual(bytes);
});
