import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { link, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ownership from '../data-dir-lock.js';
import { runResetCli } from './reset.js';
import type { StoreFacts } from './store-facts.js';
import { snapshotTree, type TreeRecord } from './__fixtures__/stores.js';

// #434: taking a lock can itself create, reclaim or leave that lock's file and `.reclaim` guard.
// A refusal at either acquisition stage therefore never says that nothing in the data directory
// changed: it names the stage, lists that lock's file and guard as found now and just before the
// attempt, and says what releasing a lock it already held did. Store data and unrelated entries
// are never touched. Faults are injected only into `unlink` of a guard's owner marker and, in one
// case, `lstat` of that guard afterwards; every other filesystem call is real.

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, unlink: vi.fn(actual.unlink), lstat: vi.fn(actual.lstat) };
});
const actual = await vi.importActual<typeof fs>('node:fs/promises');

const bases: string[] = [];
afterEach(async () => {
  vi.mocked(fs.unlink).mockImplementation(actual.unlink);
  vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  vi.restoreAllMocks();
  for (const base of bases.splice(0))
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/**
 * A PID far above any these platforms assign (Linux caps PIDs at 2^22), so a lock record naming it
 * is stale. A process that has exited is not used: Windows can hand its PID to another process
 * within seconds, and a PID-only record naming a live process is (correctly) refused as unverifiable.
 */
const DEAD_PID = 2147483644;
const STAGING = `graphgoblin.lock.reclaim.${randomUUID()}.tmp`;
const store: StoreFacts = { readable: true, format: 3, status: 'complete', runIds: ['run-a'] };

type Role = 'data-directory lock' | 'database lock';
const LOCK: Record<Role, string> = {
  'data-directory lock': 'graphgoblin.lock',
  'database lock': 'graphgoblin.db.graphgoblin.lock',
};
/** The reset's lock files and guards (with their markers); everything else must keep its bytes. */
const OWNERSHIP = /^graphgoblin(\.db\.graphgoblin)?\.lock(\.reclaim(\/.*)?)?$/;
/** The lock file, its guard and the guard's marker; never a look-alike such as a staging directory. */
const ofRole = (role: Role) => (record: TreeRecord) =>
  [LOCK[role], `${LOCK[role]}.reclaim`].includes(record.path) ||
  record.path.startsWith(`${LOCK[role]}.reclaim/`);
const unrelated = (records: TreeRecord[]) => records.filter((r) => !OWNERSHIP.test(r.path));

/**
 * A format-3 store with a run workspace, artifacts, the key, owner files and look-alikes the reset
 * never owns (an abandoned guard staging directory among them); with `stale`, also the stale lock
 * files and guards crashed GraphGoblin processes leave.
 */
async function fixture(stale: boolean) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-acquisition-')));
  bases.push(base);
  const dataDir = join(base, 'data');
  const files: Record<string, string> = {
    'graphgoblin.db': 'database bytes',
    'graphgoblin.db-wal': 'wal bytes',
    'workspaces/run-a/out.txt': 'run output',
    'workspaces/my-notes/keep.txt': 'user directory',
    'artifacts/text/abc': 'artifact body',
    'master.key': 'synthetic key material',
    'notes.txt': 'owner notes',
    'graphgoblin.db.graphgoblin.lock.bak': 'a copy the owner made',
    'other.db.graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'another database' }),
    [`${STAGING}/${randomUUID()}.json`]: 'abandoned staging marker',
  };
  if (stale) {
    const token = randomUUID();
    Object.assign(files, {
      'graphgoblin.db.graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale db' }),
      'graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
      [`graphgoblin.db.graphgoblin.lock.reclaim/${token}.json`]: JSON.stringify({
        pid: DEAD_PID,
        token,
      }),
    });
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dataDir, path)), { recursive: true });
    await writeFile(join(dataDir, path), content);
  }
  if (stale) await mkdir(join(dataDir, 'graphgoblin.lock.reclaim'));
  return { base, dataDir };
}

async function reset(dataDir: string, argv: string[]) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv: argv.map((arg) => (arg === '<data>' ? dataDir : arg)),
    env: { GG_DATA_DIR: dataDir },
    readStore: () => Promise.resolve(store),
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

const CONFIRM = ['--reset', '--yes', '--data-dir', '<data>'];
const uncertain = (role: Role) =>
  `No store data was removed. Taking the ${role} failed, and the attempt may have created, reclaimed or left that lock's file, guard or guard staging directory. Lock files and guards:`;
/** A lock file or guard of the failed lock, as the reset must report it from what is on disk. */
function observed(after: TreeRecord[], path: string, what: string, before: boolean): string {
  const now = after.some((record) => record.path === path);
  const state = (present: boolean) => (present ? 'present' : 'absent');
  return `  ${path} (${what}): ${
    now === before
      ? `${state(now)} now and before the attempt`
      : `${state(now)} now, ${state(before)} before the attempt`
  }`;
}

describe('a failed acquisition that leaves lock metadata is never reported as no change', () => {
  /** A filesystem that refuses to remove the owner marker inside `guard`, and nothing else. */
  function refuseMarkerRemoval(guard: string): void {
    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      if (basename(dirname(String(path))) === guard)
        throw Object.assign(new Error('synthetic refusal to remove a guard marker'), {
          code: 'EPERM',
        });
      return actual.unlink(path);
    });
  }

  it.each([
    ['data-directory lock', false],
    ['data-directory lock', true],
    ['database lock', false],
    ['database lock', true],
  ] as const)(
    'taking the %s fails after changing its metadata (stale metadata: %s)',
    async (role, stale) => {
      const { dataDir } = await fixture(stale);
      const before = await snapshotTree(dataDir);
      refuseMarkerRemoval(`${LOCK[role]}.reclaim`);
      const result = await reset(dataDir, CONFIRM);
      vi.mocked(fs.unlink).mockImplementation(actual.unlink);
      const after = await snapshotTree(dataDir);

      // The injected fault leaves the guard behind (a real change the output must not deny).
      expect(after.some((record) => record.path === `${LOCK[role]}.reclaim`)).toBe(true);
      expect(result.err).not.toContain('Nothing in the data directory was changed');
      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      const [first, ...rest] = result.err.split('\n');
      expect(first).toMatch(new RegExp(`^reset refused: could not take the ${role}: \\S`));
      expect(result.err).not.toContain('stop it before resetting');
      expect(rest).toEqual([
        uncertain(role),
        observed(after, `${LOCK[role]}.reclaim`, `${role} guard`, stale),
        observed(after, LOCK[role], role, stale),
        ...(role === 'database lock'
          ? [
              ...(stale
                ? [
                    '  reclaimed stale graphgoblin.lock.reclaim (data-directory lock guard)',
                    '  reclaimed stale graphgoblin.lock (data-directory lock)',
                  ]
                : []),
              '  removed graphgoblin.lock (data-directory lock)',
            ]
          : []),
        '',
      ]);

      // No store data and no unrelated byte changed, whatever happened to the lock metadata.
      expect(unrelated(after)).toEqual(unrelated(before));
      if (role === 'data-directory lock')
        // The database lock was never attempted: its stale metadata is exactly as it was.
        expect(after.filter(ofRole('database lock'))).toEqual(
          before.filter(ofRole('database lock')),
        );
      // The data-directory lock was taken, then released (and any stale one reclaimed).
      else expect(after.filter(ofRole('data-directory lock'))).toEqual([]);
    },
  );

  it('says when the guard left behind cannot be inspected, without claiming its state', async () => {
    const { dataDir } = await fixture(false);
    const before = await snapshotTree(dataDir);
    const guard = join(dataDir, 'graphgoblin.lock.reclaim');
    refuseMarkerRemoval('graphgoblin.lock.reclaim');
    // Once removing the marker has failed, the guard itself can no longer be inspected.
    const unlink = vi.mocked(fs.unlink).getMockImplementation()!;
    let denied = false;
    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      try {
        await unlink(path);
      } catch (error) {
        denied = true;
        throw error;
      }
    });
    vi.mocked(fs.lstat).mockImplementation((async (path: string, options?: object) => {
      if (denied && String(path) === guard)
        throw Object.assign(new Error('EACCES: synthetic denial, lstat'), { code: 'EACCES' });
      return actual.lstat(path, options);
    }) as typeof fs.lstat);
    const result = await reset(dataDir, CONFIRM);
    vi.mocked(fs.unlink).mockImplementation(actual.unlink);
    vi.mocked(fs.lstat).mockImplementation(actual.lstat);
    const after = await snapshotTree(dataDir);
    expect(after.some((record) => record.path === 'graphgoblin.lock.reclaim')).toBe(true);
    expect(result.code).toBe(1);
    expect(result.err.split('\n').slice(1)).toEqual([
      uncertain('data-directory lock'),
      '  graphgoblin.lock.reclaim (data-directory lock guard): could not be inspected now (EACCES: synthetic denial, lstat), absent before the attempt',
      observed(after, 'graphgoblin.lock', 'data-directory lock', false),
      '',
    ]);
    // Never advise removing an entry whose ownership was not verified.
    expect(result.err).not.toMatch(/remove (it|that entry) yourself/);
    expect(unrelated(after)).toEqual(unrelated(before));
  });

  it('passes every removal through when no fault is injected: a confirmed reset still completes', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    const result = await reset(dataDir, CONFIRM);
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toContain(
      [
        '  removed graphgoblin.db.graphgoblin.lock (database lock)',
        '  removed graphgoblin.lock (data-directory lock)',
        `Reset complete. The next start creates a new, empty format-4 store in ${dataDir}.`,
        '',
      ].join('\n'),
    );
    expect(await snapshotTree(dataDir)).toEqual(
      unrelated(before).filter(
        (record) =>
          !/^(graphgoblin\.db(-wal)?|artifacts(\/.*)?|workspaces\/run-a(\/.*)?)$/.test(record.path),
      ),
    );
  });
});

describe('ordinary refusals', () => {
  it.each(['data-directory lock', 'database lock'] as const)(
    'names the stage when another owner takes the %s first, and leaves that owner’s record',
    async (role) => {
      const { dataDir } = await fixture(false);
      const before = await snapshotTree(dataDir);
      let contender: ownership.DataDirLock | undefined;
      if (role === 'data-directory lock') {
        const acquire = ownership.acquireDataDirLock;
        vi.spyOn(ownership, 'acquireDataDirLock').mockImplementationOnce(async (dir, name) => {
          contender = await acquire(dir, name);
          return acquire(dir, name);
        });
      } else {
        const acquire = ownership.acquireDatabaseLock;
        vi.spyOn(ownership, 'acquireDatabaseLock').mockImplementationOnce(async (file) => {
          contender = await acquire(file);
          return acquire(file);
        });
      }
      const result = await reset(dataDir, CONFIRM);
      expect(result).toEqual({
        code: 1,
        out: '',
        err: [
          `reset refused: could not take the ${role}: another GraphGoblin process holds ${join(dataDir, LOCK[role])}; check its port/configuration; wait for the owning process to finish or stop it before retrying`,
          uncertain(role),
          `  ${LOCK[role]}.reclaim (${role} guard): absent now and before the attempt`,
          `  ${LOCK[role]} (${role}): present now, absent before the attempt`,
          ...(role === 'database lock' ? ['  removed graphgoblin.lock (data-directory lock)'] : []),
          '',
        ].join('\n'),
      });
      // The reset never removed or rewrote the other owner's record.
      expect(await contender!.release()).toBe('removed');
      expect(await snapshotTree(dataDir)).toEqual(before);
    },
  );

  it.each(['data-directory lock', 'database lock'] as const)(
    'gives one actionable refusal when the %s becomes unverifiable after preview',
    async (role) => {
      const { dataDir } = await fixture(false);
      const before = await snapshotTree(dataDir);
      const lockPath = join(dataDir, LOCK[role]);
      const incomplete = '{"pid":';
      const method = role === 'database lock' ? 'acquireDatabaseLock' : 'acquireDataDirLock';
      const acquire = ownership[method];
      vi.spyOn(ownership, method).mockImplementationOnce(async (path: string) => {
        await writeFile(lockPath, incomplete, { flag: 'wx' });
        return acquire(path);
      });

      expect(await reset(dataDir, CONFIRM)).toEqual({
        code: 1,
        out: '',
        err: [
          `reset refused: could not take the ${role}: Store ownership could not be verified (malformed or incomplete owner record): ${lockPath}; inspect the owner record and running GraphGoblin processes; resolve the ownership uncertainty before retrying`,
          uncertain(role),
          `  ${LOCK[role]}.reclaim (${role} guard): absent now and before the attempt`,
          `  ${LOCK[role]} (${role}): present now, absent before the attempt`,
          ...(role === 'database lock' ? ['  removed graphgoblin.lock (data-directory lock)'] : []),
          '',
        ].join('\n'),
      });
      expect(await fs.readFile(lockPath, 'utf8')).toBe(incomplete);
      const after = await snapshotTree(dataDir);
      expect(after.filter((entry) => entry.path !== LOCK[role])).toEqual(before);
    },
  );

  it('names the database stage when the lock module refuses a database with another hard link', async () => {
    const { base, dataDir } = await fixture(false);
    // Outside the data directory, where the manifest's identity checks do not look.
    await link(join(dataDir, 'graphgoblin.db'), join(base, 'outside.db'));
    const before = await snapshotTree(base);
    const result = await reset(dataDir, CONFIRM);
    expect(result).toEqual({
      code: 1,
      out: '',
      err: [
        `reset refused: could not take the database lock: database ${join(dataDir, 'graphgoblin.db')} has multiple hard links; use one ordinary SQLite file so GraphGoblin can establish exclusive ownership`,
        uncertain('database lock'),
        '  graphgoblin.db.graphgoblin.lock.reclaim (database lock guard): absent now and before the attempt',
        '  graphgoblin.db.graphgoblin.lock (database lock): absent now and before the attempt',
        '  removed graphgoblin.lock (data-directory lock)',
        '',
      ].join('\n'),
    });
    expect(await snapshotTree(base)).toEqual(before);
  });

  it.each([
    ['dry run', ['--reset']],
    ['confirmed reset', CONFIRM],
  ])(
    'a %s refused read-only while the database lock is held still says nothing changed',
    async (_name, argv) => {
      const { base, dataDir } = await fixture(false);
      const lock = await ownership.acquireDatabaseLock(join(dataDir, 'graphgoblin.db'));
      try {
        const before = await snapshotTree(base);
        const result = await reset(dataDir, argv);
        expect(result).toEqual({
          code: 1,
          out: '',
          err: `reset refused: another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish: ${join(dataDir, 'graphgoblin.db.graphgoblin.lock')}; verify ownership before resetting\nNothing in the data directory was changed.\n`,
        });
        expect(await snapshotTree(base)).toEqual(before);
      } finally {
        await lock.release();
      }
    },
  );
});
