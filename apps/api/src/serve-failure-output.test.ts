import { access, link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalPath } from './canonical-path.js';
import {
  acquireDatabaseLock,
  databaseLockFileName,
  databaseLockState,
  HardLinkedDatabaseRefusedError,
  RECLAIM_GUARD_SUFFIX,
  StoreOwnershipRefusedError,
} from './data-dir-lock.js';
import { ProcessDefaultsRefusedError } from './defaults-refusal.js';
import { MacosKeySourceError } from './macos-local-key.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';
import {
  cleanupStep,
  StartupCleanupError,
  vettedCode,
  withStartupCleanup,
} from './startup-cleanup.js';
import { StoreRefusedError } from './store-refusal.js';

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

describe('startup failures whose cleanup also failed (#560)', () => {
  const secondaryText = 'secondary text must stay off the console';
  const secondary = Object.assign(new Error(secondaryText), { code: 'EIO' });
  const steps = [
    cleanupStep('database-close', secondary),
    cleanupStep('directory-lease-release', new Error(secondaryText)),
  ];
  const retained = [{ resource: 'directory-lease', path: '/store' }] as const;
  const detail =
    'cleanup also failed: database-close (EIO), directory-lease-release (UNKNOWN); ownership retained: data-directory lease /store';

  const described = (message: string, prototype: object) => {
    const refusal = Object.create(prototype) as Error;
    Object.defineProperty(refusal, 'message', { value: message });
    return refusal;
  };

  it.each([
    [
      'held ownership',
      () =>
        new StoreOwnershipRefusedError('another GraphGoblin process holds /store/graphgoblin.lock'),
      'store-held',
      'another GraphGoblin process holds /store/graphgoblin.lock',
    ],
    [
      'unverifiable ownership',
      () => new StoreOwnershipRefusedError('Store ownership could not be verified (x): /a\nb'),
      'store-ownership-unverified',
      'Store ownership could not be verified (x): /a\\u000ab',
    ],
    [
      'a hard-linked database',
      () => new HardLinkedDatabaseRefusedError('/store/graphgoblin.db'),
      'store-unavailable',
      `database /store/graphgoblin.db ${hardLinkAction}`,
    ],
    [
      'an unsupported store',
      () => described('store\nexplanation', StoreRefusedError.prototype),
      'store-refused',
      'store\nexplanation',
    ],
    [
      'refused GG_DEFAULTS',
      () => described('defaults\nexplanation', ProcessDefaultsRefusedError.prototype),
      'defaults-refused',
      'defaults\nexplanation',
    ],
  ] as const)(
    'classifies and renders %s as the primary with one bounded cleanup line',
    (_name, primary, cause, rendering) => {
      const refusal = primary();
      const error = withStartupCleanup(refusal, steps, retained);
      expect(error).toBeInstanceOf(StartupCleanupError);
      expect(startupFailureCause('store', error)).toBe(cause);
      const output = shellFailureOutput(error);
      expect(output).toBe(`${rendering}\n${detail}`);
      expect(output).not.toContain(secondaryText);
      // The original objects stay inspectable through the aggregate.
      expect((error as StartupCleanupError).errors).toEqual([
        refusal,
        ...steps.map((s) => s.error),
      ]);
    },
  );

  it('keeps an unknown primary diagnostic, never secondary messages, and its stage category', () => {
    for (const primary of [
      new MacosKeySourceError(),
      Object.assign(new Error('Cannot establish Windows process identity: x'), { code: 'X' }),
      new Error('SQLITE_IOERR'),
    ]) {
      const error = withStartupCleanup(primary, steps, retained);
      const output = shellFailureOutput(error);
      expect(output).toBe(`${inspect(primary)}\n${detail}`);
      expect(output).not.toContain(secondaryText);
      expect(startupFailureCause('store', error)).toBe(startupFailureCause('store', primary));
      expect(startupFailureCause('recovery', error)).toBe(startupFailureCause('recovery', primary));
    }
    expect(
      startupFailureCause('store', withStartupCleanup(new MacosKeySourceError(), steps, [])),
    ).toBe('key-source-unavailable');
  });

  it('does not interpret an arbitrary AggregateError', () => {
    const arbitrary = new AggregateError(
      [Object.create(StoreRefusedError.prototype) as Error, secondary],
      'not a startup cleanup failure',
    );
    expect(startupFailureCause('store', arbitrary)).toBe('store-unavailable');
    expect(shellFailureOutput(arbitrary)).toBe(arbitrary);
  });

  it('escapes controls in the cleanup line while keeping the original path', () => {
    const path = '/store/a\nb /graphgoblin.lock';
    const error = withStartupCleanup(new Error('primary'), [], [{ resource: 'lock-record', path }]);
    expect((error as StartupCleanupError).retained).toEqual([{ resource: 'lock-record', path }]);
    expect(String(shellFailureOutput(error)).split('\n').at(-1)).toBe(
      'ownership retained: lock record /store/a\\u000ab\\u2028/graphgoblin.lock',
    );
  });

  it('returns the exact primary when nothing needs reporting, and flattens a tagged primary', () => {
    const primary = new Error('primary');
    expect(withStartupCleanup(primary, [], [])).toBe(primary);
    const first = withStartupCleanup(primary, [steps[0]!], []) as StartupCleanupError;
    expect(withStartupCleanup(first, [], [])).toBe(first);
    const flat = withStartupCleanup(first, [steps[1]!], retained) as StartupCleanupError;
    expect(flat.primary).toBe(primary);
    expect(flat.cause).toBe(primary);
    expect(flat.cleanup).toEqual(steps);
    expect(flat.errors).toEqual([primary, ...steps.map((step) => step.error)]);
    expect(flat.message).toBe(`primary; ${detail}`);
    const thrownValue = withStartupCleanup('not an error', [], retained) as StartupCleanupError;
    expect(thrownValue.message).toBe(
      'GraphGoblin startup failed; ownership retained: data-directory lease /store',
    );
    expect(shellFailureOutput(thrownValue)).toBe(
      'not an error\nownership retained: data-directory lease /store',
    );
  });

  it.each([
    ['EPERM', 'EPERM'],
    ['SQLITE_BUSY', 'SQLITE_BUSY'],
    ['ERR_FS_FILE_TOO_LARGE', 'ERR_FS_FILE_TOO_LARGE'],
    ['eperm', 'UNKNOWN'],
    ['EPERM: free text', 'UNKNOWN'],
    [`E${'X'.repeat(64)}`, 'UNKNOWN'],
    [5, 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
  ])('vets error code %j as %s', (code, vetted) => {
    expect(vettedCode(Object.assign(new Error('x'), { code }))).toBe(vetted);
    expect(vettedCode({ code })).toBe('UNKNOWN');
  });
});
