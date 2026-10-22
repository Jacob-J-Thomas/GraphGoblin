import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { acquireDataDirLock } from '../data-dir-lock.js';
import {
  assertDisjointManifest,
  CASE_INSENSITIVE_NAMES,
  executeReset,
  formatBytes,
  MANIFEST_LIST_LIMIT,
  parseResetArgs,
  planReset,
  runResetCli,
  type ResetCliOptions,
} from './reset.js';
import { readStoreFacts, type StoreFacts } from './store-facts.js';
import { identityOf, kindOf } from './tree.js';
import {
  copyStore,
  READER_ARGUMENTS,
  SEEDED_RUN_IDS,
  seedStores,
  snapshotTree,
} from './__fixtures__/stores.js';

const [RUN_A, RUN_B] = SEEDED_RUN_IDS as [string, string];
let seeded: string;
const bases: string[] = [];

beforeAll(async () => {
  seeded = await mkdtemp(join(tmpdir(), 'gg-reset-seeded-'));
  await seedStores(seeded);
}, 240_000);
afterEach(async () => {
  for (const base of bases.splice(0))
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
      () => undefined,
    );
});
afterAll(async () => {
  await rm(seeded, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

/** Directory links need no privilege on Windows as junctions; elsewhere they are symlinks. */
const linkDirectory = (target: string, path: string) =>
  symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');

/**
 * A data directory holding a copy of a seeded store, artifacts, both run workspaces, an unrelated
 * workspace, the master key and a note; plus an outside "repository" that links inside the data
 * directory point at. `base` holds both, so one snapshot covers everything a reset could touch.
 */
async function prepare(store: 'current' | 'format-3' | 'unmarked' | 'corrupt' | 'none') {
  const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
  bases.push(base);
  const dataDir = join(base, 'data');
  const outside = join(base, 'outside-repo');
  if (store === 'none') await mkdir(dataDir);
  else await copyStore(join(seeded, store), dataDir);
  await mkdir(join(outside, 'src'), { recursive: true });
  await writeFile(join(outside, 'src', 'precious.txt'), 'never removed');
  await mkdir(join(dataDir, 'artifacts', 'text'), { recursive: true });
  await writeFile(join(dataDir, 'artifacts', 'text', 'abc123'), 'artifact body');
  await linkDirectory(outside, join(dataDir, 'artifacts', 'linked'));
  for (const run of SEEDED_RUN_IDS) {
    await mkdir(join(dataDir, 'workspaces', run, 'src'), { recursive: true });
    await writeFile(join(dataDir, 'workspaces', run, 'src', 'out.txt'), run);
  }
  await linkDirectory(outside, join(dataDir, 'workspaces', RUN_A, 'repo'));
  await mkdir(join(dataDir, 'workspaces', 'my-notes'));
  await writeFile(join(dataDir, 'workspaces', 'my-notes', 'keep.txt'), 'user directory');
  await writeFile(join(dataDir, 'master.key'), 'secret key material');
  await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
  return { base, dataDir, outside };
}

const realReader = (file: string) => readStoreFacts(file, { readerArguments: READER_ARGUMENTS });
const facts = (value: StoreFacts) => (): Promise<StoreFacts> => Promise.resolve(value);
const currentFacts = facts({
  readable: true,
  format: 4,
  status: 'complete',
  runIds: SEEDED_RUN_IDS,
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One manifest row: its cells in order, separated by column padding. */
const row = (...cells: string[]) => new RegExp('\\n {2}' + cells.map(escape).join(' +') + '\\n');

async function reset(
  argv: string[],
  env: Record<string, string>,
  options: Partial<ResetCliOptions> = {},
) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv,
    env,
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
    readStore: currentFacts,
    ...options,
  });
  return { code, out, err };
}

describe('reset arguments', () => {
  it.each([
    [['--reset'], { confirmed: false }],
    [['--reset', '--data-dir', 'x'], { confirmed: false, dataDir: 'x' }],
    [['--reset', '--yes', '--data-dir=C:/data dir'], { confirmed: true, dataDir: 'C:/data dir' }],
    [['--yes', '--data-dir', 'x', '--reset'], { confirmed: true, dataDir: 'x' }],
  ])('accepts %j', (argv, expected) => {
    expect(parseResetArgs(argv)).toEqual(expected);
  });

  it.each([
    [[], '--reset is required'],
    [['--reset', '--reset'], '--reset is given more than once'],
    [['--reset', '--yes'], '--yes needs --data-dir <path> naming the data directory to reset'],
    [['--reset', '--yes', '--yes', '--data-dir', 'x'], '--yes is given more than once'],
    [['--reset', '--data-dir'], '--data-dir needs the path of the data directory'],
    [['--reset', '--data-dir', '--yes'], '--data-dir needs the path of the data directory'],
    [['--reset', '--data-dir='], '--data-dir needs the path of the data directory'],
    [['--reset', '--data-dir', 'a', '--data-dir', 'b'], '--data-dir is given more than once'],
    [['--reset', '--force'], 'unknown option --force'],
    [['--reset', 'now'], 'unexpected argument "now"'],
  ])('refuses %j', (argv, error) => {
    expect(parseResetArgs(argv)).toBe(error);
  });

  it('prints the usage and exits 2 before reading any configuration', async () => {
    const result = await reset(['--reset', '--yes'], {});
    expect(result).toEqual({
      code: 2,
      out: '',
      err: '--yes needs --data-dir <path> naming the data directory to reset\nusage: graphgoblin-api --reset [--yes --data-dir <path>]  (without --yes it only lists what a reset would remove)\n',
    });
  });
});

describe('reset dry run', () => {
  it('lists the manifest of a current store and changes nothing', async () => {
    const { base, dataDir } = await prepare('current');
    const before = await snapshotTree(base);
    const result = await reset(['--reset'], { GG_DATA_DIR: dataDir }, { readStore: realReader });
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const lines = result.out.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'GraphGoblin reset (dry run: nothing is removed)',
      '',
      `Data directory: ${dataDir}`,
      `Database:       ${join(dataDir, 'graphgoblin.db')} (format 4, the current format)`,
      '',
      'Removes:',
    ]);
    // Removal order: run workspaces, artifacts, the database and its sidecars, the lock last.
    expect(lines.slice(6, 12).map((line) => line.trim().split(/ {2,}/)[0])).toEqual([
      `workspaces/${RUN_A}`,
      `workspaces/${RUN_B}`,
      'artifacts',
      'graphgoblin.db',
      'graphgoblin.db-wal',
      'graphgoblin.lock',
    ]);
    expect(result.out).toMatch(
      row(`workspaces/${RUN_A}`, 'run workspace', '1 file, 2 directories, 1 link, 26 B'),
    );
    expect(result.out).toMatch(
      row(`workspaces/${RUN_B}`, 'run workspace', '1 file, 2 directories, 26 B'),
    );
    expect(result.out).toMatch(
      row('artifacts', 'artifacts', '1 file, 2 directories, 1 link, 13 B'),
    );
    expect(result.out).toMatch(/\n {2}graphgoblin\.db +database +1 file, [\d.]+ KB\n/);
    expect(result.out).toMatch(/\n {2}graphgoblin\.db-wal +SQLite write-ahead log +1 file, /);
    expect(result.out).toMatch(
      row('graphgoblin.lock', "the reset's own lock", 'removed last, on release'),
    );
    expect(result.out).toMatch(
      new RegExp(
        [
          '\\nKeeps:',
          ' {2}master\\.key +secret-store key; kept so the secrets in a backup of this store stay readable',
          ' {2}notes\\.txt +not part of the store',
          ' {2}workspaces/my-notes +not a stored run ID',
          ' {2}Browser device drafts stay in each browser; discard them from the loop editor\\.',
          '',
          'Total removed: 5 files, 6 directories, 2 links, [\\d.]+ KB in 5 items\\.',
          '',
          'Nothing was removed\\. To reset, stop every GraphGoblin process using this data directory and run:',
          ` {2}${escape(`node apps/api/dist/main.js --reset --yes --data-dir "${dataDir}"`)}`,
          '$',
        ].join('\\n'),
      ),
    );
    expect(await snapshotTree(base)).toEqual(before);
  }, 120_000);

  it('names an older store by what it found', async () => {
    const { dataDir } = await prepare('unmarked');
    const unmarked = await reset(['--reset'], { GG_DATA_DIR: dataDir }, { readStore: realReader });
    expect(unmarked.out).toContain(
      `Database:       ${join(dataDir, 'graphgoblin.db')} (no format marker (an older build wrote it))`,
    );
    expect(unmarked.out).toMatch(
      row(`workspaces/${RUN_A}`, 'run workspace', '1 file, 2 directories, 1 link, 26 B'),
    );
    const old = await reset(
      ['--reset'],
      { GG_DATA_DIR: dataDir },
      { readStore: facts({ readable: true, format: 3, status: 'complete', runIds: [] }) },
    );
    expect(old.out).toContain('(format 3; this build requires format 4)');
    expect(old.out).toMatch(row(`workspaces/${RUN_A}`, 'not a stored run ID'));
    const unfinished = await reset(
      ['--reset'],
      { GG_DATA_DIR: dataDir },
      { readStore: facts({ readable: true, format: 4, status: 'applying', runIds: [] }) },
    );
    expect(unfinished.out).toContain('(format 4, unfinished (status "applying"))');
  }, 120_000);

  it('keeps every run workspace when the store cannot be read', async () => {
    const { dataDir } = await prepare('corrupt');
    const result = await reset(['--reset'], { GG_DATA_DIR: dataDir }, { readStore: realReader });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/\(unreadable: .+\)\n/);
    expect(result.out).toMatch(
      row(`workspaces/${RUN_A}`, 'the store could not be read to match run IDs'),
    );
    expect(result.out).not.toMatch(/run workspace/);
  }, 120_000);

  it('bounds the manifest and still totals everything', async () => {
    const { dataDir } = await prepare('none');
    const runs = Array.from(
      { length: MANIFEST_LIST_LIMIT + 5 },
      (_, index) => `run-${String(index).padStart(3, '0')}`,
    );
    for (const run of runs) await mkdir(join(dataDir, 'workspaces', run));
    for (const run of runs) await writeFile(join(dataDir, `extra-${run}.txt`), '');
    await writeFile(join(dataDir, 'graphgoblin.db'), '');
    const result = await reset(
      ['--reset'],
      { GG_DATA_DIR: dataDir },
      { readStore: facts({ readable: true, runIds: runs }) },
    );
    // 25 run workspaces, artifacts and the database: 20 rows, then the other 7 summarised.
    expect(result.out).toContain('  ... and 7 more: 2 files, 7 directories, 1 link, 13 B\n');
    // 25 extra files, the key, the note and three unmatched workspaces: 20 rows, then 10.
    expect(result.out).toContain('  ... and 10 more entries\n');
    expect(result.out).toContain(
      'Total removed: 2 files, 27 directories, 1 link, 13 B in 27 items.',
    );
  });

  it('says there is nothing to reset when the data directory does not exist, and creates nothing', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-reset-missing-'));
    bases.push(base);
    const dataDir = join(base, 'never-created');
    for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
      const result = await reset(argv, { GG_DATA_DIR: dataDir });
      expect(result).toEqual({
        code: 0,
        out: `Nothing to reset: ${dataDir} does not exist.\n`,
        err: '',
      });
    }
    expect(await snapshotTree(base)).toEqual([]);
  });
});

describe('confirmed reset', () => {
  it('removes exactly the manifest of an old store, following no link, and keeps everything else', async () => {
    const { base, dataDir, outside } = await prepare('format-3');
    const outsideBefore = await snapshotTree(outside);
    const result = await reset(
      ['--reset', '--yes', '--data-dir', dataDir],
      { GG_DATA_DIR: dataDir },
      { readStore: realReader },
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out.split('\n')[0]).toBe('GraphGoblin reset');
    expect(result.out).toContain(
      `Database:       ${join(dataDir, 'graphgoblin.db')} (format 3; this build requires format 4)`,
    );
    const removing = result.out.slice(result.out.indexOf('Removing:\n'));
    expect(removing).toMatch(
      new RegExp(
        [
          '^Removing:',
          ` {2}removed workspaces/${RUN_A} \\(1 file, 2 directories, 1 link, 26 B\\)`,
          ` {2}removed workspaces/${RUN_B} \\(1 file, 2 directories, 26 B\\)`,
          ' {2}removed artifacts \\(1 file, 2 directories, 1 link, 13 B\\)',
          ' {2}removed graphgoblin\\.db \\(1 file, [\\d.]+ KB\\)',
          ' {2}removed graphgoblin\\.db-wal \\(1 file, [\\d.]+ (KB|B)\\)',
          ' {2}removed graphgoblin\\.lock',
          `Reset complete\\. The next start creates a new, empty format-4 store in ${escape(dataDir)}\\.`,
          '$',
        ].join('\\n'),
      ),
    );
    expect(await snapshotTree(base)).toEqual(
      [
        { path: 'data', kind: 'directory' },
        { path: 'data/master.key', kind: 'file', sha256: expect.any(String) },
        { path: 'data/notes.txt', kind: 'file', sha256: expect.any(String) },
        { path: 'data/workspaces', kind: 'directory' },
        { path: 'data/workspaces/my-notes', kind: 'directory' },
        { path: 'data/workspaces/my-notes/keep.txt', kind: 'file', sha256: expect.any(String) },
        { path: 'outside-repo', kind: 'directory' },
        ...outsideBefore.map((record) => ({ ...record, path: `outside-repo/${record.path}` })),
      ].sort((a, b) => a.path.localeCompare(b.path)),
    );
    expect(await snapshotTree(outside)).toEqual(outsideBefore);
  }, 120_000);

  it('removes the database and artifacts of an unreadable store and keeps its workspaces', async () => {
    const { dataDir } = await prepare('corrupt');
    const result = await reset(
      ['--reset', '--yes', '--data-dir', dataDir],
      { GG_DATA_DIR: dataDir },
      { readStore: realReader },
    );
    expect(result.code).toBe(0);
    expect((await snapshotTree(dataDir)).map((record) => record.path)).toEqual([
      'master.key',
      'notes.txt',
      'workspaces',
      `workspaces/${RUN_A}`,
      `workspaces/${RUN_A}/repo`,
      `workspaces/${RUN_A}/src`,
      `workspaces/${RUN_A}/src/out.txt`,
      `workspaces/${RUN_B}`,
      `workspaces/${RUN_B}/src`,
      `workspaces/${RUN_B}/src/out.txt`,
      'workspaces/my-notes',
      'workspaces/my-notes/keep.txt',
    ]);
  }, 120_000);

  it('accepts the configured directory however --data-dir spells it', async () => {
    const { dataDir } = await prepare('none');
    const result = await reset(
      ['--reset', '--yes', `--data-dir=${relative(process.cwd(), dataDir)}`],
      { GG_DATA_DIR: dataDir },
      { readStore: facts({ readable: false, reason: 'unused' }) },
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain('(no database file)');
    expect(result.out).toMatch(row(`workspaces/${RUN_A}`, 'no database to match run IDs against'));
    expect((await snapshotTree(dataDir)).map((record) => record.path)).not.toContain('artifacts');
  });

  it('reports exactly what was removed when removal stops part of the way, and a rerun finishes', async () => {
    const { dataDir } = await prepare('current');
    let out = '';
    const result = await reset(
      ['--reset', '--yes', '--data-dir', dataDir],
      { GG_DATA_DIR: dataDir },
      {
        write: (text) => {
          out += text;
          // A file appears in a listed directory after the reset started removing.
          if (text.startsWith(`  removed workspaces/${RUN_B}`))
            writeFileSync(join(dataDir, 'artifacts', 'text', 'late'), 'late');
        },
      },
    );
    expect(result.code).toBe(1);
    expect(out).toContain(`  removed workspaces/${RUN_B}`);
    expect(out).not.toContain('Reset complete');
    expect(result.err).toMatch(
      new RegExp(
        [
          '^Reset stopped: could not remove artifacts/text: .*ENOTEMPTY.*',
          ` {2}Removed: {8}workspaces/${RUN_A}, workspaces/${RUN_B}`,
          ' {2}Partly removed: artifacts \\(2 of 4 entries\\)',
          ' {2}Not removed: {4}graphgoblin\\.db, graphgoblin\\.db-wal',
          ' {2}Released graphgoblin\\.lock\\.',
          'Do not start GraphGoblin on this data directory until the reset finishes: fix the cause and run the reset again; it lists and removes what is left\\.',
          '$',
        ].join('\\n'),
      ),
    );
    expect((await snapshotTree(dataDir)).map((record) => record.path)).toEqual([
      'artifacts',
      'artifacts/text',
      'artifacts/text/late',
      'graphgoblin.db',
      'graphgoblin.db-wal',
      'master.key',
      'notes.txt',
      'workspaces',
      'workspaces/my-notes',
      'workspaces/my-notes/keep.txt',
    ]);
    const again = await reset(['--reset', '--yes', '--data-dir', dataDir], {
      GG_DATA_DIR: dataDir,
    });
    expect(again.code).toBe(0);
    expect((await snapshotTree(dataDir)).map((record) => record.path)).toEqual([
      'master.key',
      'notes.txt',
      'workspaces',
      'workspaces/my-notes',
      'workspaces/my-notes/keep.txt',
    ]);
  });

  it('refuses to follow a directory that became a link after it was listed', async () => {
    const { dataDir, outside } = await prepare('none');
    const outsideBefore = await snapshotTree(outside);
    const plan = await planReset({
      dataDir,
      database: 'graphgoblin.db',
      readStore: currentFacts,
    });
    await rm(join(dataDir, 'artifacts', 'text'), { recursive: true });
    await linkDirectory(outside, join(dataDir, 'artifacts', 'text'));
    await writeFile(join(outside, 'abc123'), 'same name as the listed artifact');
    await expect(executeReset(plan, () => undefined)).rejects.toThrow(
      /^Reset stopped: could not remove artifacts\/text\/abc123: artifacts[/\\]text is no longer a physical directory/,
    );
    expect(await snapshotTree(outside)).toEqual(
      [...outsideBefore, { path: 'abc123', kind: 'file', sha256: expect.any(String) }].sort(
        (a, b) => a.path.localeCompare(b.path),
      ),
    );
  });

  it('refuses to remove an entry whose kind changed after it was listed', async () => {
    const { dataDir } = await prepare('none');
    const plan = await planReset({
      dataDir,
      database: 'graphgoblin.db',
      readStore: currentFacts,
    });
    await rm(join(dataDir, 'artifacts', 'text', 'abc123'));
    await mkdir(join(dataDir, 'artifacts', 'text', 'abc123'));
    await expect(executeReset(plan, () => undefined)).rejects.toThrow(
      'could not remove artifacts/text/abc123: artifacts/text/abc123 changed from a file to a directory during the reset',
    );
  });
});

describe('refused resets change nothing', () => {
  async function holdLockInAnotherProcess(dataDir: string) {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
      stdio: 'ignore',
    });
    await writeFile(
      join(dataDir, 'graphgoblin.lock'),
      JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), token: 'running' }),
    );
    return child;
  }

  it.each([
    ['a directory named graphgoblin.db', {}, 'graphgoblin.db is a directory, not a database file'],
    [
      'a database reached through a link',
      { GG_DB_URL: '<linked-db>' },
      'the database path passes through linked-db',
    ],
    [
      'a database inside the artifact directory',
      { GG_DB_URL: '<artifact-db>' },
      'is inside artifacts/, which a reset removes',
    ],
    [
      'a database named artifacts',
      { GG_DB_URL: '<artifacts>' },
      'has the name of the artifacts directory, which a reset removes; rename it first',
    ],
    [
      'a database named workspaces',
      { GG_DB_URL: '<workspaces>' },
      'has the name of the workspaces directory, which a reset removes; rename it first',
    ],
    [
      'a database named like the lock file',
      { GG_DB_URL: '<lock-db>' },
      "has the name of the reset's lock file; rename it first",
    ],
    [
      'a database outside the data directory',
      { GG_DB_URL: '<outside-db>' },
      'is outside the data directory',
    ],
    [
      'a database that is not a local file',
      { GG_DB_URL: ':memory:' },
      'GG_DB_URL does not name a local database file',
    ],
    ['another directory named by --data-dir', { '--data-dir': '<other>' }, '--data-dir names'],
    ['invalid configuration', { GG_PORT: 'not a port' }, 'invalid configuration'],
  ] as const)(
    'refuses a confirmed reset with %s and leaves a stale lock and every other byte in place',
    async (_name, setup, error) => {
      const { base, dataDir, outside } = await prepare('none');
      await mkdir(join(dataDir, 'graphgoblin.db'));
      await linkDirectory(outside, join(dataDir, 'linked-db'));
      await mkdir(join(base, 'other'));
      // A lock left by a process that has exited: acquiring the lock would reclaim it.
      const dead = spawnSync(process.execPath, ['-e', '']);
      await writeFile(join(dataDir, 'graphgoblin.lock'), JSON.stringify({ pid: dead.pid }));
      const substitute = (value: string): string =>
        ({
          '<other>': join(base, 'other'),
          '<outside-db>': `file:${join(base, 'elsewhere.db').replaceAll('\\', '/')}`,
          '<artifact-db>': `file:${join(dataDir, 'artifacts', 'store.db').replaceAll('\\', '/')}`,
          '<artifacts>': `file:${join(dataDir, 'artifacts').replaceAll('\\', '/')}`,
          '<workspaces>': `file:${join(dataDir, 'workspaces').replaceAll('\\', '/')}`,
          '<lock-db>': `file:${join(dataDir, 'graphgoblin.lock.reclaim').replaceAll('\\', '/')}`,
          '<linked-db>': `file:${join(dataDir, 'linked-db', 'store.db').replaceAll('\\', '/')}`,
        })[value] ?? value;
      const env: Record<string, string> = { GG_DATA_DIR: dataDir };
      let target = dataDir;
      for (const [key, value] of Object.entries(setup))
        if (key === '--data-dir') target = substitute(value);
        else env[key] = substitute(value);
      const before = await snapshotTree(base);
      expect(before.map((record) => record.path)).toContain('data/graphgoblin.lock');
      const result = await reset(['--reset', '--yes', '--data-dir', target], env);
      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain(error);
      expect(result.err).toMatch(/Nothing was changed\.\n$/);
      expect(await snapshotTree(base)).toEqual(before);
    },
  );

  // The independent acceptance audit (2026-10-21) found a regular database file named `artifacts`
  // listed twice (once as the artifact target, once as the database), so a confirmed reset removed
  // it and then stopped on the duplicate; one named `workspaces` was listed under both Removes and
  // Keeps. Both configurations are refused before anything is listed or read.
  it.each([
    ['dry run', ['--reset']],
    ['confirmed reset', ['--reset', '--yes', '--data-dir', '<data>']],
  ])(
    'refuses a %s whose database is a regular file named like a directory the reset owns, reading nothing',
    async (_name, argv) => {
      const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
      bases.push(base);
      const dataDir = join(base, 'data');
      await mkdir(dataDir);
      await writeFile(join(dataDir, 'artifacts'), 'a database with a reserved name');
      await writeFile(join(dataDir, 'workspaces'), 'another one');
      await writeFile(join(dataDir, 'unrelated.txt'), 'kept');
      for (const name of ['artifacts', 'workspaces']) {
        const before = await snapshotTree(base);
        const result = await reset(
          argv.map((arg) => (arg === '<data>' ? dataDir : arg)),
          { GG_DATA_DIR: dataDir, GG_DB_URL: `file:${join(dataDir, name).replaceAll('\\', '/')}` },
          { readStore: () => Promise.reject(new Error('the store must not be read')) },
        );
        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain(
          `the database ${name} has the name of the ${name} directory, which a reset removes; rename it first`,
        );
        expect(result.err).toMatch(/Nothing was changed\.\n$/);
        expect(await snapshotTree(base)).toEqual(before);
      }
    },
  );

  // The Sol re-review (2026-10-21) found the reserved names and the manifest compared case-sensitive
  // strings, so on a case-insensitive volume `ARTIFACTS` named the same file as `artifacts` and
  // was listed twice, and `GRAPHGOBLIN.DB` was both removed and kept. Only a case-insensitive host
  // can show this; on a case-sensitive volume those are different files and legitimate names.
  it.runIf(CASE_INSENSITIVE_NAMES)(
    'compares names the way a case-insensitive volume does: reserved names in any case are refused and the database is listed once',
    async () => {
      const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
      bases.push(base);
      const dataDir = join(base, 'data');
      await mkdir(dataDir);
      await writeFile(join(dataDir, 'artifacts'), 'a database with a reserved name');
      await writeFile(join(dataDir, 'workspaces'), 'another one');
      for (const [spelling, reserved] of [
        ['ARTIFACTS', 'the artifacts directory'],
        ['Workspaces', 'the workspaces directory'],
        ['GraphGoblin.Lock', "the reset's lock file"],
      ] as const) {
        const before = await snapshotTree(base);
        const result = await reset(
          ['--reset', '--yes', '--data-dir', dataDir],
          {
            GG_DATA_DIR: dataDir,
            GG_DB_URL: `file:${join(dataDir, spelling).replaceAll('\\', '/')}`,
          },
          { readStore: () => Promise.reject(new Error('the store must not be read')) },
        );
        expect(result.code).toBe(1);
        expect(result.err).toContain(`the database ${spelling} has the name of ${reserved}`);
        expect(await snapshotTree(base)).toEqual(before);
      }
      // A current store whose configured spelling differs from the stored file's: the manifest
      // removes the database once and never also keeps it under its stored spelling.
      const { base: storeBase, dataDir: storeDir } = await prepare('current');
      const upper = `file:${join(storeDir, 'GRAPHGOBLIN.DB').replaceAll('\\', '/')}`;
      const dry = await reset(['--reset'], { GG_DATA_DIR: storeDir, GG_DB_URL: upper });
      expect(dry.code).toBe(0);
      // The manifest names the database as the directory lists it, whatever the configured case.
      expect(dry.out).toMatch(/\n {2}graphgoblin\.db +database +1 file/);
      expect(dry.out).not.toMatch(/graphgoblin\.db(-wal|-shm)? +not part of the store/);
      const before = await snapshotTree(storeBase);
      const confirmed = await reset(['--reset', '--yes', '--data-dir', storeDir], {
        GG_DATA_DIR: storeDir,
        GG_DB_URL: upper,
      });
      expect(confirmed.code).toBe(0);
      expect(confirmed.out).toContain('Reset complete');
      const after = await snapshotTree(storeBase);
      expect(after.map((record) => record.path)).not.toContain('data/graphgoblin.db');
      expect(after.length).toBeLessThan(before.length);
    },
  );

  /** The 8.3 short name NTFS generated for `name` in `dir`, when the volume keeps short names. */
  function shortNameOf(dir: string, name: string): string | undefined {
    const listing = spawnSync('cmd', ['/c', 'dir', '/x', '/a', dir], { encoding: 'utf8' });
    for (const line of listing.stdout.split(/\r?\n/)) {
      const match = /\s([^\s~]+~\d\S*)\s+(\S.*)$/.exec(line);
      if (match && match[2]!.trim().toLowerCase() === name.toLowerCase()) return match[1];
    }
    return undefined;
  }

  // The Sol re-review (round 2) reproduced NTFS short names passing the name checks: `ARTIFA~1`
  // named the `artifacts` database and `GRAPHG~1.DB` the stored `graphgoblin.db`, so the manifest
  // listed one file twice or kept what it removed. A short name now resolves, by filesystem
  // identity, to the entry the directory lists, so the reserved-name refusal and the manifest see
  // the real name.
  it.runIf(process.platform === 'win32')(
    'resolves a Windows short-name alias to the listed entry it identifies',
    async ({ skip }) => {
      const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
      bases.push(base);
      const dataDir = join(base, 'data');
      await mkdir(dataDir);
      await writeFile(join(dataDir, 'artifacts'), 'a database with a reserved name');
      await writeFile(join(dataDir, 'graphgoblin-store.db'), 'a database with a long name');
      const reservedAlias = shortNameOf(dataDir, 'artifacts');
      const longAlias = shortNameOf(dataDir, 'graphgoblin-store.db');
      // A volume with 8.3 name generation disabled has no aliases to resolve.
      if (reservedAlias === undefined || longAlias === undefined) skip();
      const url = (name: string) => `file:${join(dataDir, name).replaceAll('\\', '/')}`;
      const unread = { readStore: () => Promise.reject(new Error('the store must not be read')) };
      for (const [alias, refusal] of [
        [reservedAlias!, 'has the name of the artifacts directory, which a reset removes'],
        [
          `${reservedAlias!}/store.db`,
          'passes through artifacts, which is not a physical directory',
        ],
      ] as const) {
        const before = await snapshotTree(base);
        const result = await reset(
          ['--reset', '--yes', '--data-dir', dataDir],
          { GG_DATA_DIR: dataDir, GG_DB_URL: url(alias) },
          unread,
        );
        expect(result.code).toBe(1);
        expect(result.err).toContain(refusal);
        expect(result.err).toMatch(/Nothing was changed\.\n$/);
        expect(await snapshotTree(base)).toEqual(before);
      }
      // The short name of an ordinary database resolves to its listed spelling: planned once, under
      // that spelling, and never also kept.
      const dry = await reset(['--reset'], { GG_DATA_DIR: dataDir, GG_DB_URL: url(longAlias!) });
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/\n {2}graphgoblin-store\.db +database +1 file/);
      expect(dry.out).not.toMatch(/graphgoblin-store\.db +not part of the store/);
      // A regular file named `artifacts` is not the artifact store: kept, never removed.
      expect(dry.out).toMatch(row('artifacts', 'a file, not a directory'));
    },
  );

  // The database must lie under the configured data directory's own spelling or its physical
  // path: a link to the data directory that appears only in the database path is a link, and a
  // reset never follows links (the round-6 review withdrew the earlier acceptance of this case).
  it('refuses a database configured through a link to the data directory, which is reached through a link', async () => {
    const { base, dataDir } = await prepare('current');
    const alias = join(base, 'alias');
    await linkDirectory(dataDir, alias);
    const url = `file:${join(alias, 'graphgoblin.db').replaceAll('\\', '/')}`;
    const before = await snapshotTree(base);
    for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
      const result = await reset(argv, { GG_DATA_DIR: dataDir, GG_DB_URL: url });
      expect(result.code).toBe(1);
      expect(result.err).toContain('is outside the data directory');
      expect(await snapshotTree(base)).toEqual(before);
    }
  });

  // Links below the data directory are refused wherever they lead, even back to the data
  // directory or to its parent (the round-6 review's reproductions).
  it.each([
    [
      'the data directory itself',
      'linked',
      (dataDir: string, _base: string) => dataDir,
      'linked/graphgoblin.db',
    ],
    [
      'the parent of the data directory',
      'up',
      (_dataDir: string, base: string) => base,
      'up/data/graphgoblin.db',
    ],
  ])(
    'refuses a database path through a link below the data directory to %s',
    async (_name, linkName, target, dbPath) => {
      const { base, dataDir } = await prepare('current');
      await linkDirectory(target(dataDir, base), join(dataDir, linkName));
      const before = await snapshotTree(base);
      const result = await reset(['--reset', '--yes', '--data-dir', dataDir], {
        GG_DATA_DIR: dataDir,
        GG_DB_URL: `file:${join(dataDir, ...dbPath.split('/')).replaceAll('\\', '/')}`,
      });
      expect(result.code).toBe(1);
      expect(result.err).toContain(`passes through ${linkName}, which is not a physical directory`);
      expect(await snapshotTree(base)).toEqual(before);
    },
  );

  // A hard link leaves the database reachable under another name: the manifest would remove one
  // name and keep the other, so the configuration is refused.
  it('refuses a database that has a hard link under another name', async () => {
    const { base, dataDir } = await prepare('current');
    await link(join(dataDir, 'graphgoblin.db'), join(dataDir, 'backup.db'));
    const before = await snapshotTree(base);
    const result = await reset(['--reset', '--yes', '--data-dir', dataDir], {
      GG_DATA_DIR: dataDir,
    });
    expect(result.code).toBe(1);
    // The spelling resolution already sees two names for one file and refuses there.
    expect(result.err).toContain(
      'lists graphgoblin.db under more than one name (backup.db, graphgoblin.db)',
    );
    expect(await snapshotTree(base)).toEqual(before);
  });

  // The other name may live elsewhere in the tree, where the spelling resolution of the database
  // path never looks: the kept root file and the removed nested database are one file by identity.
  it('refuses a nested database whose hard link lies at the root of the data directory', async () => {
    const { base, dataDir } = await prepare('none');
    await mkdir(join(dataDir, 'db'));
    await writeFile(join(dataDir, 'db', 'store.db'), 'database bytes');
    await link(join(dataDir, 'db', 'store.db'), join(dataDir, 'backup.db'));
    const before = await snapshotTree(base);
    const result = await reset(['--reset', '--yes', '--data-dir', dataDir], {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'db', 'store.db').replaceAll('\\', '/')}`,
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('the manifest would both remove and keep backup.db');
    expect(await snapshotTree(base)).toEqual(before);
  });

  // A Windows stream of the data directory shares its identity but is a file, not the directory
  // (the round-6 review's reproduction confirmed a reset through `data:review`).
  it.runIf(process.platform === 'win32')(
    'refuses a stream of the data directory as --data-dir and as a database ancestor',
    async () => {
      const { base, dataDir } = await prepare('current');
      await writeFile(`${dataDir}:review`, 'a stream on the directory');
      const before = await snapshotTree(base);
      const confirmed = await reset(['--reset', '--yes', '--data-dir', `${dataDir}:review`], {
        GG_DATA_DIR: dataDir,
      });
      expect(confirmed.code).toBe(1);
      expect(confirmed.err).toContain('--data-dir names');
      const ancestor = await reset(['--reset', '--yes', '--data-dir', dataDir], {
        GG_DATA_DIR: dataDir,
        GG_DB_URL: `file:${dataDir.replaceAll('\\', '/')}:review/graphgoblin.db`,
      });
      expect(ancestor.code).toBe(1);
      expect(ancestor.err).toContain('is outside the data directory');
      expect(await snapshotTree(base)).toEqual(before);
    },
  );

  // A Windows alternate data stream shares its file's identity but is not the file (the Sol
  // re-review's round-4 reproduction removed the whole file when a stream was configured).
  it.runIf(process.platform === 'win32')(
    'refuses a database path that names a stream of a file',
    async () => {
      const { base, dataDir } = await prepare('current');
      await writeFile(join(dataDir, 'graphgoblin.db:review'), 'another database in a stream');
      const before = await snapshotTree(base);
      const result = await reset(
        ['--reset', '--yes', '--data-dir', dataDir],
        {
          GG_DATA_DIR: dataDir,
          GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db:review').replaceAll('\\', '/')}`,
        },
        { readStore: () => Promise.reject(new Error('the store must not be read')) },
      );
      expect(result.code).toBe(1);
      expect(result.err).toContain(
        'names a stream of a file (graphgoblin.db:review contains a colon)',
      );
      expect(await snapshotTree(base)).toEqual(before);
    },
  );

  // The manifest shows the reserved directories and sidecars as the directory spells them.
  it.runIf(CASE_INSENSITIVE_NAMES)(
    'lists the artifact directory and the sidecars under their stored spelling',
    async () => {
      const { dataDir } = await prepare('current');
      await rename(join(dataDir, 'artifacts'), join(dataDir, 'Artifacts'));
      await writeFile(join(dataDir, 'GRAPHGOBLIN.DB-journal'), 'a sidecar spelled differently');
      const dry = await reset(['--reset'], { GG_DATA_DIR: dataDir });
      expect(dry.code).toBe(0);
      expect(dry.out).toMatch(/\n {2}Artifacts +artifacts +/);
      expect(dry.out).not.toMatch(/\n {2}artifacts +artifacts +/);
      expect(dry.out).toMatch(/\n {2}GRAPHGOBLIN\.DB-journal +SQLite rollback journal/);
      expect(dry.out).not.toMatch(/GRAPHGOBLIN\.DB-journal +not part of the store/);
    },
  );

  // Two distinct files whose names fold alike (ASCII K and the Kelvin sign) must never be
  // confused: identity, not case folding, decides which entry a spelling names (the Sol
  // re-review's round-3 reproduction deleted the other file).
  it('plans exactly the configured file when another entry has a look-alike name', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
    bases.push(base);
    const dataDir = join(base, 'data');
    await mkdir(dataDir);
    const kelvin = 'K.db';
    await writeFile(join(dataDir, 'K.db'), 'the configured store');
    await writeFile(join(dataDir, kelvin), 'another file entirely');
    const url = `file:${join(dataDir, 'K.db').replaceAll('\\', '/')}`;
    const dry = await reset(['--reset'], { GG_DATA_DIR: dataDir, GG_DB_URL: url });
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/\n {2}K\.db +database +1 file/);
    expect(dry.out).toMatch(row(kelvin, 'not part of the store'));
    const confirmed = await reset(['--reset', '--yes', '--data-dir', dataDir], {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: url,
    });
    expect(confirmed.code).toBe(0);
    expect((await readdir(dataDir)).sort()).toEqual([kelvin]);
  });

  // Windows resolves `graphgoblin.db.` and `graphgoblin.db ` to `graphgoblin.db`, a spelling the
  // listing never shows (the Sol re-review's round-3 probe).
  it.runIf(process.platform === 'win32')(
    'refuses a database name with a trailing dot or space, which Windows resolves to another name',
    async () => {
      const { base, dataDir } = await prepare('current');
      for (const spelling of ['graphgoblin.db.', 'graphgoblin.db ']) {
        const before = await snapshotTree(base);
        const result = await reset(
          ['--reset', '--yes', '--data-dir', dataDir],
          {
            GG_DATA_DIR: dataDir,
            GG_DB_URL: `file:${join(dataDir, spelling).replaceAll('\\', '/')}`,
          },
          { readStore: () => Promise.reject(new Error('the store must not be read')) },
        );
        expect(result.code).toBe(1);
        expect(result.err).toContain(
          'with a trailing dot or space, which Windows resolves to another name',
        );
        expect(await snapshotTree(base)).toEqual(before);
      }
    },
  );

  // Node cannot create a FIFO itself; POSIX hosts (CI) use mkfifo, Windows has no FIFO files.
  it.skipIf(process.platform === 'win32')(
    'refuses a database that is a FIFO before reading it',
    async () => {
      const base = await mkdtemp(join(tmpdir(), 'gg-reset-'));
      bases.push(base);
      const dataDir = join(base, 'data');
      await mkdir(dataDir);
      const fifo = join(dataDir, 'graphgoblin.db');
      await writeFile(join(dataDir, 'notes.txt'), 'kept');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      // Reading a FIFO with no writer blocks, so the tree is compared by listing, not by hashing
      // (the hashing snapshot would hang exactly as a reader of the "database" would).
      const before = (await readdir(dataDir)).sort();
      for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
        const result = await reset(
          argv,
          { GG_DATA_DIR: dataDir, GG_DB_URL: `file:${fifo}` },
          { readStore: () => Promise.reject(new Error('the store must not be read')) },
        );
        expect(result.code).toBe(1);
        expect(result.err).toContain(
          'graphgoblin.db is a special file, not a database file; a reset removes only regular database files',
        );
        expect(result.err).toMatch(/Nothing was changed\.\n$/);
        expect((await readdir(dataDir)).sort()).toEqual(before);
        expect((await lstat(fifo)).isFIFO()).toBe(true);
      }
    },
  );

  it.each([
    ['dry run', ['--reset']],
    ['confirmed reset', ['--reset', '--yes', '--data-dir', '<data>']],
  ])('refuses a %s while a running instance holds the lock', async (_name, argv) => {
    const { base, dataDir } = await prepare('current');
    const child = await holdLockInAnotherProcess(dataDir);
    try {
      const before = await snapshotTree(base);
      const result = await reset(
        argv.map((arg) => (arg === '<data>' ? dataDir : arg)),
        { GG_DATA_DIR: dataDir },
      );
      expect(result).toEqual({
        code: 1,
        out: '',
        err: `reset refused: another GraphGoblin process holds ${join(dataDir, 'graphgoblin.lock')}; stop it before resetting\nNothing was changed.\n`,
      });
      expect(await snapshotTree(base)).toEqual(before);
    } finally {
      child.kill();
    }
  });

  it('refuses while this process holds the lock', async () => {
    const { base, dataDir } = await prepare('current');
    const lock = await acquireDataDirLock(dataDir);
    try {
      const before = await snapshotTree(base);
      for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
        const result = await reset(argv, { GG_DATA_DIR: dataDir });
        expect(result.code).toBe(1);
        expect(result.err).toMatch(/another GraphGoblin process holds .*graphgoblin\.lock/);
      }
      expect(await snapshotTree(base)).toEqual(before);
    } finally {
      await lock.release();
    }
  });

  it.each([
    [
      'names another directory',
      ['--reset', '--yes', '--data-dir', '<other>'],
      {},
      /--data-dir names .*other, but this environment's data directory is /,
    ],
    [
      'names another directory in a dry run',
      ['--reset', '--data-dir', '<other>'],
      {},
      /--data-dir names /,
    ],
    [
      'keeps the database outside the data directory',
      ['--reset', '--yes', '--data-dir', '<data>'],
      { GG_DB_URL: '<outside-db>' },
      /is outside the data directory .*; a reset removes only paths inside it/,
    ],
    [
      'uses a database that is not a local file',
      ['--reset'],
      { GG_DB_URL: ':memory:' },
      /GG_DB_URL does not name a local database file/,
    ],
    [
      'puts the database inside the artifact directory',
      ['--reset', '--yes', '--data-dir', '<data>'],
      { GG_DB_URL: '<artifact-db>' },
      /the database artifacts\/store\.db is inside artifacts\/, which a reset removes/,
    ],
    [
      'reaches the database through a link',
      ['--reset', '--yes', '--data-dir', '<data>'],
      { GG_DB_URL: '<linked-db>' },
      /the database path passes through linked-db, which is not a physical directory/,
    ],
    [
      'has a directory where the database should be',
      ['--reset'],
      { GG_DB_URL: '<directory-db>' },
      /directory-db is a directory, not a database file/,
    ],
    ['has invalid configuration', ['--reset'], { GG_PORT: 'not a port' }, /invalid configuration/],
  ])('refuses a reset that %s', async (_name, argv, extraEnv, error) => {
    const { base, dataDir, outside } = await prepare('current');
    await mkdir(join(base, 'other'));
    await linkDirectory(outside, join(dataDir, 'linked-db'));
    await mkdir(join(dataDir, 'directory-db'));
    const substitute = (value: string): string =>
      ({
        '<data>': dataDir,
        '<other>': join(base, 'other'),
        '<outside-db>': `file:${join(base, 'elsewhere.db').replaceAll('\\', '/')}`,
        '<artifact-db>': `file:${join(dataDir, 'artifacts', 'store.db').replaceAll('\\', '/')}`,
        '<linked-db>': `file:${join(dataDir, 'linked-db', 'store.db').replaceAll('\\', '/')}`,
        '<directory-db>': `file:${join(dataDir, 'directory-db').replaceAll('\\', '/')}`,
      })[value] ?? value;
    const before = await snapshotTree(base);
    const env: Record<string, string> = { GG_DATA_DIR: dataDir };
    for (const [key, value] of Object.entries(extraEnv)) env[key] = substitute(value);
    const result = await reset(argv.map(substitute), env);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toMatch(error);
    expect(result.err).toMatch(/Nothing was changed\.\n$/);
    expect(await snapshotTree(base)).toEqual(before);
  });

  it('refuses a data directory that is a file', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-reset-file-'));
    bases.push(base);
    await writeFile(join(base, 'data'), 'not a directory');
    const result = await reset(['--reset'], { GG_DATA_DIR: join(base, 'data') });
    expect(result).toEqual({
      code: 1,
      out: '',
      err: `reset refused: ${join(base, 'data')} is not a directory\nNothing was changed.\n`,
    });
  });

  it('keeps a workspaces link without following it', async () => {
    const { dataDir, outside } = await prepare('none');
    await rm(join(dataDir, 'workspaces'), { recursive: true });
    await linkDirectory(outside, join(dataDir, 'workspaces'));
    const result = await reset(['--reset'], { GG_DATA_DIR: dataDir });
    expect(result.out).toMatch(row('workspaces', 'a link; a reset never follows links'));
  });
});

describe('data directory layouts', () => {
  it('lists an empty data directory as nothing but the lock', async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-reset-empty-'));
    bases.push(base);
    const result = await reset(['--reset'], { GG_DATA_DIR: base });
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      "  nothing but the lock file\n  graphgoblin.lock                       the reset's own lock     removed last, on release\n\nKeeps:\n  nothing else is in the data directory\n",
    );
    expect(result.out).toContain('Total removed: 0 files, 0 B in 0 items.');
    expect(await snapshotTree(base)).toEqual([]);
  });

  it('removes a database configured in a subdirectory and keeps that directory', async () => {
    const { dataDir } = await prepare('none');
    await mkdir(join(dataDir, 'db'));
    await writeFile(join(dataDir, 'db', 'store.db'), 'database bytes');
    await writeFile(join(dataDir, 'db', 'store.db-wal'), 'wal bytes');
    await writeFile(join(dataDir, 'db', 'readme.txt'), 'kept');
    const env = {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'db', 'store.db').replaceAll('\\', '/')}`,
    };
    const result = await reset(['--reset', '--yes', '--data-dir', dataDir], env);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(row('db/store.db', 'database', '1 file, 14 B'));
    expect(result.out).toMatch(row('db/store.db-wal', 'SQLite write-ahead log', '1 file, 9 B'));
    expect(result.out).not.toMatch(/\n {2}db +/);
    const after = (await snapshotTree(dataDir)).map((record) => record.path);
    expect(after).toContain('db/readme.txt');
    expect(after).not.toContain('db/store.db');
    expect(after).not.toContain('db/store.db-wal');
  });

  it('follows a link that is the data directory itself, and says where it leads', async () => {
    const { base, dataDir } = await prepare('none');
    const alias = join(base, 'alias');
    await linkDirectory(dataDir, alias);
    const result = await reset(['--reset'], { GG_DATA_DIR: alias });
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Data directory: ${alias} (physical path `);
    expect(result.out).toContain(`--reset --yes --data-dir "${alias}"`);
  });

  it('refuses a plan entry outside the data directory', async () => {
    const { dataDir } = await prepare('none');
    await expect(
      executeReset(
        {
          dataDir,
          database: 'graphgoblin.db',
          store: { readable: false, reason: 'unused' },
          targets: [
            {
              path: '../outside-repo',
              what: 'artifacts',
              entries: [{ path: '../outside-repo', kind: 'directory', bytes: 0, identity: '0:0' }],
            },
          ],
          kept: [],
        },
        () => undefined,
      ),
    ).rejects.toThrow('../outside-repo is not inside the data directory');
  });
});

describe('entry kinds and manifest invariants', () => {
  const stats = (flags: { link?: boolean; directory?: boolean; file?: boolean }) => ({
    isSymbolicLink: () => flags.link ?? false,
    isDirectory: () => flags.directory ?? false,
    isFile: () => flags.file ?? false,
  });

  // Windows reports device 0 for every volume, so the identity carries the volume root (the Sol
  // re-review's round-5 observation: four volume roots shared one device and file index).
  it.runIf(process.platform === 'win32')(
    'tells the roots of two volumes apart',
    async ({ skip }) => {
      const roots: string[] = [];
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`;
        if ((await identityOf(root)) !== undefined) roots.push(root);
        if (roots.length === 2) break;
      }
      if (roots.length < 2) skip();
      expect(await identityOf(roots[0]!)).not.toBe(await identityOf(roots[1]!));
    },
  );

  it('classifies anything that is neither a file, a directory nor a link as other', () => {
    expect(kindOf(stats({ file: true }))).toBe('file');
    expect(kindOf(stats({ directory: true }))).toBe('directory');
    expect(kindOf(stats({ link: true, directory: true }))).toBe('link');
    // A FIFO, socket or device: lstat reports none of the three.
    expect(kindOf(stats({}))).toBe('other');
  });

  it('refuses a manifest that lists an entry twice or both removes and keeps it', () => {
    const entry = { path: 'artifacts', kind: 'file' as const, bytes: 1, identity: '1:7' };
    expect(() =>
      assertDisjointManifest(
        [
          { path: 'artifacts', what: 'artifacts', entries: [entry] },
          { path: 'artifacts', what: 'database', entries: [entry] },
        ],
        [],
      ),
    ).toThrow('the manifest would list artifacts twice');
    expect(() =>
      assertDisjointManifest(
        [{ path: 'workspaces', what: 'database', entries: [{ ...entry, path: 'workspaces' }] }],
        [{ path: 'workspaces', why: 'a file, not a directory' }],
      ),
    ).toThrow('the manifest would both remove and keep workspaces');
    expect(() =>
      assertDisjointManifest([{ path: 'artifacts', what: 'artifacts', entries: [entry] }], []),
    ).not.toThrow();
    // Two spellings of one entry share an identity; two entries with look-alike names do not.
    const mixed = [
      { path: 'Artifacts', what: 'database', entries: [{ ...entry, path: 'Artifacts' }] },
    ];
    expect(() =>
      assertDisjointManifest(mixed, [
        { path: 'artifacts', why: 'not part of the store', identity: '1:7' },
      ]),
    ).toThrow('the manifest would both remove and keep artifacts');
    expect(() =>
      assertDisjointManifest(mixed, [
        { path: 'artifacts', why: 'not part of the store', identity: '1:8' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertDisjointManifest(
        [
          {
            path: 'a.db',
            what: 'database',
            entries: [{ ...entry, path: 'a.db', identity: '1:9' }],
          },
          {
            path: 'A.db',
            what: 'database',
            entries: [{ ...entry, path: 'A.db', identity: '1:9' }],
          },
        ],
        [],
      ),
    ).toThrow('the manifest would list A.db twice');
  });
});

describe('formatting', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3 * 1024 ** 4, '3.0 TB'],
    [2 * 1024 ** 5, '2048.0 TB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
