import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as canonical from '../canonical-path.js';
import * as ownership from '../data-dir-lock.js';
import { CASE_INSENSITIVE_NAMES, planReset, runResetCli } from './reset.js';
import type { StoreFacts } from './store-facts.js';
import * as tree from './tree.js';
import { identityOf } from './tree.js';
import { snapshotTree, type TreeRecord } from './__fixtures__/stores.js';

// #434: a reset's manifest and output account for the database lock, the data-directory lock and
// both `.reclaim` guards exactly as the lock module treats them, and remove nothing else.

const bases: string[] = [];
afterEach(async () => {
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
const STAGING_TOKEN = '0d1f6f0e-6a55-4b8e-9d7c-2b1f9a3c4e5d';
/** An abandoned guard staging directory (ADR-0069): the lock module ignores it, so a reset keeps it. */
const STAGING = `graphgoblin.lock.reclaim.${STAGING_TOKEN}.tmp`;
const oldStore: StoreFacts = { readable: true, format: 3, status: 'complete', runIds: ['run-a'] };

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/** A guard an interrupted acquisition left: one UUID marker naming its exited owner. */
async function staleGuard(path: string): Promise<void> {
  const token = randomUUID();
  await mkdir(path);
  await writeFile(join(path, `${token}.json`), JSON.stringify({ pid: DEAD_PID, token }));
}

/**
 * A format-3 store with one run workspace, artifacts, the key, owner files and look-alikes the
 * reset never owns; with `stale`, also a stale database lock and guard and a stale data-directory
 * lock and (empty) guard, as crashed GraphGoblin processes leave them.
 */
async function fixture(stale: boolean) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
  bases.push(base);
  const dataDir = join(base, 'data');
  await writeTree(dataDir, {
    'graphgoblin.db': 'database bytes',
    'graphgoblin.db-wal': 'wal bytes',
    'workspaces/run-a/out.txt': 'run output',
    'workspaces/my-notes/keep.txt': 'user directory',
    'artifacts/text/abc': 'artifact body',
    'master.key': 'synthetic key material',
    'notes.txt': 'owner notes',
    'graphgoblin.db.graphgoblin.lock.bak': 'a copy the owner made',
    // Another database's lock record: not this store's, so never reclaimed or removed here.
    'other.db.graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'another database' }),
    [`${STAGING}/${STAGING_TOKEN}.json`]: 'abandoned staging marker',
  });
  if (stale) {
    await writeTree(dataDir, {
      'graphgoblin.db.graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale db' }),
      'graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
    });
    await staleGuard(join(dataDir, 'graphgoblin.db.graphgoblin.lock.reclaim'));
    await mkdir(join(dataDir, 'graphgoblin.lock.reclaim'));
  }
  return { base, dataDir };
}

/** Everything the reset must leave byte for byte. */
const UNRELATED = [
  'graphgoblin.db.graphgoblin.lock.bak',
  STAGING,
  `${STAGING}/${STAGING_TOKEN}.json`,
  'master.key',
  'notes.txt',
  'other.db.graphgoblin.lock',
  'workspaces',
  'workspaces/my-notes',
  'workspaces/my-notes/keep.txt',
];
/** The store data a confirmed reset removes. */
const STORE_DATA = [
  'artifacts',
  'artifacts/text',
  'artifacts/text/abc',
  'graphgoblin.db',
  'graphgoblin.db-wal',
  'workspaces/run-a',
  'workspaces/run-a/out.txt',
];
const only = (records: TreeRecord[], paths: readonly string[]) =>
  records.filter((record) => paths.includes(record.path));

async function reset(
  dataDir: string,
  argv: string[],
  options: {
    env?: Record<string, string>;
    readStore?: (file: string) => Promise<StoreFacts>;
    onWrite?: (text: string) => void;
  } = {},
) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv: argv.map((arg) => (arg === '<data>' ? dataDir : arg)),
    env: { GG_DATA_DIR: dataDir, ...options.env },
    readStore: options.readStore ?? (() => Promise.resolve(oldStore)),
    write: (text) => {
      out += text;
      options.onWrite?.(text);
    },
    writeError: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

const CONFIRM = ['--reset', '--yes', '--data-dir', '<data>'];

const head = (dataDir: string, dryRun: boolean) => [
  dryRun ? 'GraphGoblin reset (dry run: nothing is removed)' : 'GraphGoblin reset',
  '',
  `Data directory: ${dataDir}`,
  `Database:       ${join(dataDir, 'graphgoblin.db')} (format 3; this build requires format 4)`,
  '',
  'Removes:',
  '  workspaces/run-a                       run workspace            1 file, 1 directory, 10 B',
  '  artifacts                              artifacts                1 file, 2 directories, 13 B',
  '  graphgoblin.db                         database                 1 file, 14 B',
  '  graphgoblin.db-wal                     SQLite write-ahead log   1 file, 9 B',
];
const KEEPS = [
  '',
  'Keeps:',
  '  graphgoblin.db.graphgoblin.lock.bak    not part of the store',
  `  ${STAGING} not part of the store`,
  '  master.key                             secret-store key; kept so the secrets in a backup of this store stay readable',
  '  notes.txt                              not part of the store',
  '  other.db.graphgoblin.lock              not part of the store',
  '  workspaces/my-notes                    not a stored run ID',
  '  Browser device drafts stay in each browser; discard them from the loop editor.',
  '',
  'Total removed: 4 files, 3 directories, 46 B in 4 items.',
  '',
  '',
];
const dryRunTail = (dataDir: string) =>
  [
    'Nothing was removed. To reset, stop every GraphGoblin process using this data directory and run:',
    `  node apps/api/dist/main.js --reset --yes --data-dir "${dataDir}"`,
    '',
  ].join('\n');
const removing = (dataDir: string, releases: string[]) =>
  [
    'Removing:',
    '  removed workspaces/run-a (1 file, 1 directory, 10 B)',
    '  removed artifacts (1 file, 2 directories, 13 B)',
    '  removed graphgoblin.db (1 file, 14 B)',
    '  removed graphgoblin.db-wal (1 file, 9 B)',
    ...releases,
    `Reset complete. The next start creates a new, empty format-4 store in ${dataDir}.`,
    '',
  ].join('\n');
const RELEASED_BOTH = [
  '  removed graphgoblin.db.graphgoblin.lock (database lock)',
  '  removed graphgoblin.lock (data-directory lock)',
];
/** A manifest row, padded as the reset pads it. */
const row = (path: string, what: string, detail: string) =>
  `  ${path.padEnd(38)} ${what.padEnd(24)} ${detail}`;
/** The paths a manifest section lists, in order. */
function section(out: string, title: 'Removes:' | 'Keeps:'): string[] {
  const lines = out.split('\n');
  const start = lines.indexOf(title) + 1;
  return lines
    .slice(start, lines.indexOf('', start))
    .filter((line) => !line.startsWith('  Browser device drafts'))
    .map((line) => line.trim().split(' ')[0]!);
}

describe('reset manifests classify both locks and both reclamation guards', () => {
  it('lists the locks a dry run would take as the reset’s own and changes nothing', async () => {
    const { base, dataDir } = await fixture(false);
    const before = await snapshotTree(base);
    const result = await reset(dataDir, ['--reset']);
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          ...head(dataDir, true),
          "  graphgoblin.db.graphgoblin.lock        database lock            the reset's own; removed on release",
          "  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release",
          ...KEEPS,
        ].join('\n') + dryRunTail(dataDir),
    });
    expect(await snapshotTree(base)).toEqual(before);
  });

  it('lists stale locks and guards a dry run found as reclaimed, never as kept, and changes nothing', async () => {
    const { base, dataDir } = await fixture(true);
    const before = await snapshotTree(base);
    const result = await reset(dataDir, ['--reset']);
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          ...head(dataDir, true),
          '  graphgoblin.db.graphgoblin.lock.reclaim stale lock guard         reclaimed when the reset takes the database lock',
          "  graphgoblin.db.graphgoblin.lock        database lock            stale; replaced by the reset's own, removed on release",
          '  graphgoblin.lock.reclaim               stale lock guard         reclaimed when the reset takes the data-directory lock',
          "  graphgoblin.lock                       data-directory lock      stale; replaced by the reset's own, removed last, on release",
          ...KEEPS,
        ].join('\n') + dryRunTail(dataDir),
    });
    expect(await snapshotTree(base)).toEqual(before);
  });

  it('confirmed: lists its own locks, removes exactly the store and its locks, and keeps every unrelated byte', async () => {
    const { dataDir } = await fixture(false);
    const before = await snapshotTree(dataDir);
    const result = await reset(dataDir, CONFIRM);
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          ...head(dataDir, false),
          "  graphgoblin.db.graphgoblin.lock        database lock            the reset's own; removed on release",
          "  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release",
          ...KEEPS,
        ].join('\n') + removing(dataDir, RELEASED_BOTH),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, UNRELATED));
  });

  it('confirmed: names the stale locks and guards it reclaimed and removes no other metadata', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    const result = await reset(dataDir, CONFIRM);
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          ...head(dataDir, false),
          '  graphgoblin.db.graphgoblin.lock.reclaim stale lock guard         reclaimed when the reset took the database lock',
          "  graphgoblin.db.graphgoblin.lock        database lock            the reset's own, replacing a stale one; removed on release",
          '  graphgoblin.lock.reclaim               stale lock guard         reclaimed when the reset took the data-directory lock',
          "  graphgoblin.lock                       data-directory lock      the reset's own, replacing a stale one; removed last, on release",
          ...KEEPS,
        ].join('\n') + removing(dataDir, RELEASED_BOTH),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, UNRELATED));
  });

  // The listing shows only that a guard is present, never who published it, so each row says only that.
  it.each([
    {
      role: 'database lock',
      name: 'graphgoblin.db.graphgoblin.lock.reclaim',
      kept: '  graphgoblin.db.graphgoblin.lock.reclaim database lock guard, present now; the reset leaves it',
    },
    {
      role: 'data-directory lock',
      name: 'graphgoblin.lock.reclaim',
      kept: '  graphgoblin.lock.reclaim               data-directory lock guard, present now; the reset leaves it',
    },
  ])(
    'keeps a $role guard published while the reset holds the locks and says only that it is present',
    async ({ name, kept }) => {
      const { dataDir } = await fixture(false);
      const guard = join(dataDir, name);
      const token = randomUUID();
      let reads = 0;
      const result = await reset(dataDir, CONFIRM, {
        readStore: async () => {
          // The locked plan's read: a guard is published meanwhile; the listing cannot show by whom.
          if (++reads === 2) {
            await mkdir(guard);
            await writeFile(
              join(guard, `${token}.json`),
              JSON.stringify({ pid: process.pid, token }),
            );
          }
          return oldStore;
        },
      });
      expect(result.code).toBe(0);
      expect(result.out).toContain(
        [
          "  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release",
          '',
          'Keeps:',
          '  graphgoblin.db.graphgoblin.lock.bak    not part of the store',
          kept,
          `  ${STAGING} not part of the store`,
        ].join('\n'),
      );
      expect(result.out).not.toContain('stale lock guard');
      expect(result.out).not.toContain('another process');
      expect(result.out).toContain(removing(dataDir, RELEASED_BOTH));
      expect(JSON.parse(await readFile(join(guard, `${token}.json`), 'utf8'))).toEqual({
        pid: process.pid,
        token,
      });
    },
  );

  it('classifies the locks of a database in a subdirectory where the lock module keeps them', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
    bases.push(base);
    const dataDir = join(base, 'data');
    await writeTree(dataDir, {
      'db/store.db': 'database bytes',
      'db/store.db.graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale db' }),
      'db/readme.txt': 'kept beside the database',
      'notes.txt': 'owner notes',
    });
    await staleGuard(join(dataDir, 'db', 'store.db.graphgoblin.lock.reclaim'));
    const env = { GG_DB_URL: `file:${join(dataDir, 'db', 'store.db').replaceAll('\\', '/')}` };
    const readStore = () => Promise.resolve<StoreFacts>({ ...oldStore, runIds: [] });
    const before = await snapshotTree(dataDir);
    const manifest = (dryRun: boolean) =>
      [
        dryRun ? 'GraphGoblin reset (dry run: nothing is removed)' : 'GraphGoblin reset',
        '',
        `Data directory: ${dataDir}`,
        `Database:       ${join(dataDir, 'db', 'store.db')} (format 3; this build requires format 4)`,
        '',
        'Removes:',
        '  db/store.db                            database                 1 file, 14 B',
        `  db/store.db.graphgoblin.lock.reclaim   stale lock guard         reclaimed when the reset ${dryRun ? 'takes' : 'took'} the database lock`,
        dryRun
          ? "  db/store.db.graphgoblin.lock           database lock            stale; replaced by the reset's own, removed on release"
          : "  db/store.db.graphgoblin.lock           database lock            the reset's own, replacing a stale one; removed on release",
        "  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release",
        '',
        'Keeps:',
        '  notes.txt                              not part of the store',
        '  Browser device drafts stay in each browser; discard them from the loop editor.',
        '',
        'Total removed: 1 file, 14 B in 1 item.',
        '',
        '',
      ].join('\n');
    const dry = await reset(dataDir, ['--reset'], { env, readStore });
    expect(dry).toEqual({ code: 0, err: '', out: manifest(true) + dryRunTail(dataDir) });
    expect(await snapshotTree(dataDir)).toEqual(before);
    const confirmed = await reset(dataDir, CONFIRM, { env, readStore });
    expect(confirmed).toEqual({
      code: 0,
      err: '',
      out:
        manifest(false) +
        [
          'Removing:',
          '  removed db/store.db (1 file, 14 B)',
          '  removed db/store.db.graphgoblin.lock (database lock)',
          '  removed graphgoblin.lock (data-directory lock)',
          `Reset complete. The next start creates a new, empty format-4 store in ${dataDir}.`,
          '',
        ].join('\n'),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, ['db', 'db/readme.txt', 'notes.txt']));
  });

  it('never takes a hard link of a stale lock for the lock, and keeps it', async () => {
    const { dataDir } = await fixture(false);
    const stale = JSON.stringify({ pid: DEAD_PID, token: 'stale directory' });
    await writeFile(join(dataDir, 'graphgoblin.lock'), stale);
    await link(join(dataDir, 'graphgoblin.lock'), join(dataDir, 'backup.lock'));
    const dry = await reset(dataDir, ['--reset']);
    expect(dry.out).toContain(
      "\n  graphgoblin.lock                       data-directory lock      stale; replaced by the reset's own, removed last, on release\n",
    );
    expect(dry.out).toContain('\n  backup.lock                            not part of the store\n');
    const before = await snapshotTree(dataDir);
    const confirmed = await reset(dataDir, CONFIRM);
    expect(confirmed.code).toBe(0);
    expect(confirmed.out).toContain(removing(dataDir, RELEASED_BOTH));
    expect(await snapshotTree(dataDir)).toEqual(only(before, [...UNRELATED, 'backup.lock']));
    expect(await readFile(join(dataDir, 'backup.lock'), 'utf8')).toBe(stale);
  });

  it.runIf(CASE_INSENSITIVE_NAMES)(
    'lists a stale lock under the spelling the directory shows on a volume that folds case',
    async () => {
      const { dataDir } = await fixture(false);
      await writeFile(
        join(dataDir, 'GraphGoblin.Lock'),
        JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
      );
      const dry = await reset(dataDir, ['--reset']);
      expect(dry.out).toContain(
        "\n  GraphGoblin.Lock                       data-directory lock      stale; replaced by the reset's own, removed last, on release\n",
      );
      expect(dry.out).not.toMatch(/GraphGoblin\.Lock +not part of the store/);
      const before = await snapshotTree(dataDir);
      const confirmed = await reset(dataDir, CONFIRM);
      expect(confirmed.out).toContain(
        "\n  graphgoblin.lock                       data-directory lock      the reset's own, replacing a stale one; removed last, on release\n",
      );
      expect(confirmed.out).toContain(removing(dataDir, RELEASED_BOTH));
      expect(await snapshotTree(dataDir)).toEqual(only(before, UNRELATED));
    },
  );

  // #531 audit: NTFS opens `οσ-1.db.graphgoblin.lock` (σ, U+03C3) as a listed
  // `ΟΣ-1.DB.GRAPHGOBLIN.LOCK`, whose Σ JavaScript lowercases to a final ς (U+03C2). Spellings are
  // matched by filesystem identity, never by folding, so each entry is listed once as the directory
  // lists it, while a hard link and a look-alike JavaScript folds to the lock name stay distinct.
  it.runIf(process.platform === 'win32')(
    'lists aliased locks and guards of both writers once, as listed, and keeps a hard link and a look-alike',
    async () => {
      const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
      bases.push(base);
      const dataDir = join(base, 'data');
      const databaseLock = 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK';
      // A Kelvin sign: JavaScript lowercases it to `k`; NTFS keeps it a distinct name.
      const lookAlike = 'graphgoblin.locK';
      await writeTree(dataDir, {
        'οσ-1.db': 'database bytes',
        [databaseLock]: JSON.stringify({ pid: DEAD_PID, token: 'stale db' }),
        'GRAPHGOBLIN.LOCK': JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
        [lookAlike]: 'not a lock',
        'notes.txt': 'owner notes',
      });
      await mkdir(join(dataDir, `${databaseLock}.RECLAIM`));
      await staleGuard(join(dataDir, 'GRAPHGOBLIN.LOCK.RECLAIM'));
      await link(join(dataDir, databaseLock), join(dataDir, 'backup.lock'));
      // The filesystem facts this case rests on.
      const same = async (a: string, b: string) =>
        (await identityOf(join(dataDir, a))) === (await identityOf(join(dataDir, b)));
      expect(await same('οσ-1.db.graphgoblin.lock', databaseLock)).toBe(true);
      expect(await same('οσ-1.db.graphgoblin.lock.reclaim', `${databaseLock}.RECLAIM`)).toBe(true);
      expect(await same('graphgoblin.lock.reclaim', 'GRAPHGOBLIN.LOCK.RECLAIM')).toBe(true);
      expect(await same(lookAlike, 'GRAPHGOBLIN.LOCK')).toBe(false);
      expect(databaseLock.toLowerCase()).not.toBe('οσ-1.db.graphgoblin.lock');
      expect(lookAlike.toLowerCase()).toBe('graphgoblin.lock');

      const env = { GG_DB_URL: `file:${join(dataDir, 'οσ-1.db').replaceAll('\\', '/')}` };
      const readStore = () => Promise.resolve<StoreFacts>({ ...oldStore, runIds: [] });
      const before = await snapshotTree(dataDir);
      const dry = await reset(dataDir, ['--reset'], { env, readStore });
      expect(dry.code).toBe(0);
      expect(await snapshotTree(dataDir)).toEqual(before);
      const removes = section(dry.out, 'Removes:');
      const keeps = section(dry.out, 'Keeps:');
      expect(removes).toEqual([
        'οσ-1.db',
        `${databaseLock}.RECLAIM`,
        databaseLock,
        'GRAPHGOBLIN.LOCK.RECLAIM',
        'GRAPHGOBLIN.LOCK',
      ]);
      expect(keeps).toEqual(['backup.lock', lookAlike, 'notes.txt']);
      // Every entry the directory lists appears once, under its listed spelling.
      expect([...removes, ...keeps].sort()).toEqual((await readdir(dataDir)).sort());

      const confirmed = await reset(dataDir, CONFIRM, { env, readStore });
      expect(confirmed.code).toBe(0);
      expect(confirmed.err).toBe('');
      expect(confirmed.out).toContain(
        [
          row('οσ-1.db', 'database', '1 file, 14 B'),
          row(
            `${databaseLock}.RECLAIM`,
            'stale lock guard',
            'reclaimed when the reset took the database lock',
          ),
          row(
            'οσ-1.db.graphgoblin.lock',
            'database lock',
            "the reset's own, replacing a stale one; removed on release",
          ),
          row(
            'GRAPHGOBLIN.LOCK.RECLAIM',
            'stale lock guard',
            'reclaimed when the reset took the data-directory lock',
          ),
          row(
            'graphgoblin.lock',
            'data-directory lock',
            "the reset's own, replacing a stale one; removed last, on release",
          ),
          '',
          'Keeps:',
        ].join('\n'),
      );
      expect(section(confirmed.out, 'Keeps:')).toEqual(keeps);
      expect(confirmed.out).toContain(
        [
          '  removed οσ-1.db.graphgoblin.lock (database lock)',
          '  removed graphgoblin.lock (data-directory lock)',
        ].join('\n'),
      );
      // The disk agrees with both sections: exactly the kept entries remain, byte for byte.
      expect(await snapshotTree(dataDir)).toEqual(only(before, keeps));
    },
  );

  it.runIf(process.platform === 'win32')(
    'refuses, changing nothing, when the filesystem does not say which hard link a lock spelling opens',
    async () => {
      const { base, dataDir } = await fixture(false);
      await writeFile(
        join(dataDir, 'GraphGoblin.Lock'),
        JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
      );
      await link(join(dataDir, 'GraphGoblin.Lock'), join(dataDir, 'backup.lock'));
      // The filesystem's canonical path names the link that `graphgoblin.lock` opens.
      const dry = await reset(dataDir, ['--reset']);
      expect(dry.out).toContain(
        `\n${row('GraphGoblin.Lock', 'data-directory lock', "stale; replaced by the reset's own, removed last, on release")}\n`,
      );
      expect(section(dry.out, 'Keeps:')).toContain('backup.lock');
      // A canonical path that keeps the spelling it was given names neither link.
      vi.spyOn(canonical, 'canonicalPath').mockImplementation((path) => resolve(path));
      const before = await snapshotTree(base);
      for (const argv of [['--reset'], CONFIRM])
        expect(await reset(dataDir, argv)).toEqual({
          code: 1,
          out: '',
          err: 'reset refused: the data directory lists graphgoblin.lock under more than one name (GraphGoblin.Lock, backup.lock), and the filesystem does not say which one the lock module opens; verify that no GraphGoblin process uses this store, then move the other names yourself\nNothing in the data directory was changed.\n',
        });
      expect(await snapshotTree(base)).toEqual(before);
    },
  );

  it('lists the lock as its own when the stale lock is removed after its identity was read', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
    bases.push(base);
    const dataDir = join(base, 'data');
    const lock = join(dataDir, 'graphgoblin.lock');
    await writeTree(dataDir, {
      'graphgoblin.db': 'database bytes',
      'graphgoblin.lock': JSON.stringify({ pid: DEAD_PID, token: 'stale directory' }),
      'notes.txt': 'owner notes',
    });
    const before = await snapshotTree(dataDir);
    // After the store read, another process removes the stale lock once the reset has read its
    // identity and before the reset lists the directory.
    let stored = false;
    let observed: string | undefined;
    const identity = tree.identityOf;
    vi.spyOn(tree, 'identityOf').mockImplementation(async (path) => {
      const found = await identity(path);
      if (stored && observed === undefined && path === lock) {
        observed = found;
        unlinkSync(lock);
      }
      return found;
    });
    const readStore = () => {
      stored = true;
      return Promise.resolve<StoreFacts>({ ...oldStore, runIds: [] });
    };
    const result = await reset(dataDir, ['--reset'], { readStore });
    expect(observed).toBeDefined();
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          'GraphGoblin reset (dry run: nothing is removed)',
          '',
          `Data directory: ${dataDir}`,
          `Database:       ${join(dataDir, 'graphgoblin.db')} (format 3; this build requires format 4)`,
          '',
          'Removes:',
          '  graphgoblin.db                         database                 1 file, 14 B',
          "  graphgoblin.db.graphgoblin.lock        database lock            the reset's own; removed on release",
          "  graphgoblin.lock                       data-directory lock      the reset's own; removed last, on release",
          '',
          'Keeps:',
          '  notes.txt                              not part of the store',
          '  Browser device drafts stay in each browser; discard them from the loop editor.',
          '',
          'Total removed: 1 file, 14 B in 1 item.',
          '',
          '',
        ].join('\n') + dryRunTail(dataDir),
    });
    // Only the other process's removal changed the directory.
    expect(await snapshotTree(dataDir)).toEqual(
      before.filter((record) => record.path !== 'graphgoblin.lock'),
    );
  });
});

describe('a confirmed reset claims only the stale entries its own acquisition reclaimed', () => {
  /**
   * Before the reset takes `role`, another GraphGoblin operation takes and releases that lock, as
   * `--create-api-key` does, reclaiming its stale file and guard first.
   */
  function anotherOperationTakesFirst(role: 'data-directory lock' | 'database lock'): void {
    if (role === 'data-directory lock') {
      const acquire = ownership.acquireDataDirLock;
      vi.spyOn(ownership, 'acquireDataDirLock').mockImplementationOnce(async (dir, name) => {
        await (await acquire(dir, name)).release();
        return acquire(dir, name);
      });
    } else {
      const acquire = ownership.acquireDatabaseLock;
      vi.spyOn(ownership, 'acquireDatabaseLock').mockImplementationOnce(async (file) => {
        await (await acquire(file)).release();
        return acquire(file);
      });
    }
  }

  it('says which stale entries were already gone when it took a lock and which it reclaimed', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    anotherOperationTakesFirst('data-directory lock');
    const result = await reset(dataDir, CONFIRM);
    expect(result).toEqual({
      code: 0,
      err: '',
      out:
        [
          ...head(dataDir, false),
          '  graphgoblin.db.graphgoblin.lock.reclaim stale lock guard         reclaimed when the reset took the database lock',
          "  graphgoblin.db.graphgoblin.lock        database lock            the reset's own, replacing a stale one; removed on release",
          '  graphgoblin.lock.reclaim               stale lock guard         already gone when the reset took the data-directory lock',
          "  graphgoblin.lock                       data-directory lock      the reset's own; the stale one was already gone when the reset took the data-directory lock; removed last, on release",
          ...KEEPS,
        ].join('\n') + removing(dataDir, RELEASED_BOTH),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, UNRELATED));
  });

  it('a refusal after taking the locks never claims entries that were already gone', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    anotherOperationTakesFirst('database lock');
    let reads = 0;
    const result = await reset(dataDir, CONFIRM, {
      readStore: () =>
        Promise.resolve<StoreFacts>(
          ++reads === 1 ? oldStore : { readable: false, reason: 'store reader exited with 1' },
        ),
    });
    expect(result).toEqual({
      code: 1,
      out: '',
      err: [
        'reset refused: the store was readable in the preview but could not be read under the data-directory lock (store reader exited with 1); run the reset again before removing the database or run workspaces',
        'No store data was removed. Lock files and guards:',
        '  graphgoblin.db.graphgoblin.lock.reclaim (database lock guard): stale in the preview, already gone when the reset took that lock',
        '  graphgoblin.db.graphgoblin.lock (database lock): stale in the preview, already gone when the reset took that lock',
        '  reclaimed stale graphgoblin.lock.reclaim (data-directory lock guard)',
        '  reclaimed stale graphgoblin.lock (data-directory lock)',
        '  removed graphgoblin.db.graphgoblin.lock (database lock)',
        '  removed graphgoblin.lock (data-directory lock)',
        '',
      ].join('\n'),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, [...UNRELATED, ...STORE_DATA]));
  });
});

describe('reset output says what releasing each lock did', () => {
  /** Change the lock files after the manifest is printed, as an external program could. */
  async function confirmWhileRemoving(change: (dataDir: string) => void) {
    const { dataDir } = await fixture(false);
    const before = await snapshotTree(dataDir);
    const result = await reset(dataDir, CONFIRM, {
      onWrite: (text) => {
        if (text === 'Removing:\n') change(dataDir);
      },
    });
    return { dataDir, before, result };
  }

  it('keeps a lock file that holds another record and says so', async () => {
    const replacement = JSON.stringify({ pid: process.pid, token: 'replacement owner' });
    const { dataDir, result } = await confirmWhileRemoving((dir) =>
      writeFileSync(join(dir, 'graphgoblin.lock'), replacement),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toContain(
      removing(dataDir, [
        '  removed graphgoblin.db.graphgoblin.lock (database lock)',
        "  kept graphgoblin.lock (data-directory lock): it holds another process's record",
      ]),
    );
    expect(await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8')).toBe(replacement);
  });

  it('says when a lock file was already gone', async () => {
    const { dataDir, before, result } = await confirmWhileRemoving((dir) =>
      unlinkSync(join(dir, 'graphgoblin.db.graphgoblin.lock')),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      removing(dataDir, [
        '  graphgoblin.db.graphgoblin.lock (database lock) was already gone',
        '  removed graphgoblin.lock (data-directory lock)',
      ]),
    );
    expect(await snapshotTree(dataDir)).toEqual(only(before, UNRELATED));
  });

  // The database lock is released first, the data-directory lock last, whichever one fails.
  const failedRelease = (name: string, role: string): unknown =>
    expect.stringMatching(
      new RegExp(`^ {2}could not remove ${name.replaceAll('.', '\\.')} \\(${role}\\): EISDIR: `),
    );
  it.each([
    [
      'graphgoblin.lock',
      [
        '  removed graphgoblin.db.graphgoblin.lock (database lock)',
        failedRelease('graphgoblin.lock', 'data-directory lock'),
      ],
    ],
    [
      'graphgoblin.db.graphgoblin.lock',
      [
        failedRelease('graphgoblin.db.graphgoblin.lock', 'database lock'),
        '  removed graphgoblin.lock (data-directory lock)',
      ],
    ],
  ])(
    'names the lock whose release failed (%s) and still releases the other',
    async (failing, released) => {
      const { dataDir, before, result } = await confirmWhileRemoving((dir) => {
        unlinkSync(join(dir, failing));
        mkdirSync(join(dir, failing));
      });
      expect(result.code).toBe(1);
      expect(result.out).toContain('  removed graphgoblin.db-wal (1 file, 9 B)\n');
      expect(result.out).not.toContain('Reset complete');
      expect(result.err.split('\n')).toEqual([
        'Reset stopped: every listed item was removed, but not every lock file was released:',
        ...released,
        '',
      ]);
      const after = await snapshotTree(dataDir);
      expect(after).toEqual(
        [...only(before, UNRELATED), { path: failing, kind: 'directory' }].sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
      );
    },
  );
});

describe('a refusal after taking the locks says what changed', () => {
  it('names the stale locks and guards it reclaimed and keeps every store byte', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    let reads = 0;
    const result = await reset(dataDir, CONFIRM, {
      readStore: () =>
        Promise.resolve<StoreFacts>(
          ++reads === 1 ? oldStore : { readable: false, reason: 'store reader exited with 1' },
        ),
    });
    expect(result).toEqual({
      code: 1,
      out: '',
      err: [
        'reset refused: the store was readable in the preview but could not be read under the data-directory lock (store reader exited with 1); run the reset again before removing the database or run workspaces',
        'No store data was removed. Lock files and guards:',
        '  reclaimed stale graphgoblin.db.graphgoblin.lock.reclaim (database lock guard)',
        '  reclaimed stale graphgoblin.db.graphgoblin.lock (database lock)',
        '  reclaimed stale graphgoblin.lock.reclaim (data-directory lock guard)',
        '  reclaimed stale graphgoblin.lock (data-directory lock)',
        '  removed graphgoblin.db.graphgoblin.lock (database lock)',
        '  removed graphgoblin.lock (data-directory lock)',
        '',
      ].join('\n'),
    });
    expect(await snapshotTree(dataDir)).toEqual(only(before, [...UNRELATED, ...STORE_DATA]));
  });

  // A failed acquisition reports only the state of that lock's entries: it never claims that it, or
  // anyone else, removed them (#434; see reset-acquisition.test.ts).
  it('reports only the data-directory metadata, as found, when that lock cannot be taken', async () => {
    const { dataDir } = await fixture(true);
    const before = await snapshotTree(dataDir);
    const acquire = ownership.acquireDataDirLock;
    vi.spyOn(ownership, 'acquireDataDirLock').mockImplementationOnce(async (dir, name) => {
      // The real acquisition reclaims the stale guard and lock; a contender then wins.
      await (await acquire(dir, name)).release();
      throw new Error('simulated contender holds the data-directory lock');
    });
    const result = await reset(dataDir, CONFIRM);
    expect(result).toEqual({
      code: 1,
      out: '',
      err: [
        'reset refused: could not take the data-directory lock: simulated contender holds the data-directory lock',
        "No store data was removed. Taking the data-directory lock failed, and the attempt may have created, reclaimed or left that lock's file, guard or guard staging directory. Lock files and guards:",
        '  graphgoblin.lock.reclaim (data-directory lock guard): absent now, present before the attempt',
        '  graphgoblin.lock (data-directory lock): absent now, present before the attempt',
        '',
      ].join('\n'),
    });
    expect(await snapshotTree(dataDir)).toEqual(
      only(before, [
        ...UNRELATED,
        ...STORE_DATA,
        'graphgoblin.db.graphgoblin.lock',
        'graphgoblin.db.graphgoblin.lock.reclaim',
        ...before
          .filter((record) => record.path.startsWith('graphgoblin.db.graphgoblin.lock.reclaim/'))
          .map((record) => record.path),
      ]),
    );
  });

  it.each([true, false])(
    'releases the data-directory lock when the database lock cannot be taken (stale metadata: %s)',
    async (stale) => {
      const { dataDir } = await fixture(stale);
      const before = await snapshotTree(dataDir);
      const acquire = ownership.acquireDatabaseLock;
      vi.spyOn(ownership, 'acquireDatabaseLock').mockImplementationOnce(async (file) => {
        await (await acquire(file)).release();
        throw new Error('simulated contender holds the database lock');
      });
      const result = await reset(dataDir, CONFIRM);
      // Even when its entries are as they were, a failed attempt is not reported as no change: the
      // reset cannot tell an attempt that changed nothing from one that failed part of the way.
      const found = stale
        ? 'absent now, present before the attempt'
        : 'absent now and before the attempt';
      expect(result).toEqual({
        code: 1,
        out: '',
        err: [
          'reset refused: could not take the database lock: simulated contender holds the database lock',
          "No store data was removed. Taking the database lock failed, and the attempt may have created, reclaimed or left that lock's file, guard or guard staging directory. Lock files and guards:",
          `  graphgoblin.db.graphgoblin.lock.reclaim (database lock guard): ${found}`,
          `  graphgoblin.db.graphgoblin.lock (database lock): ${found}`,
          ...(stale
            ? [
                '  reclaimed stale graphgoblin.lock.reclaim (data-directory lock guard)',
                '  reclaimed stale graphgoblin.lock (data-directory lock)',
              ]
            : []),
          '  removed graphgoblin.lock (data-directory lock)',
          '',
        ].join('\n'),
      });
      expect(await snapshotTree(dataDir)).toEqual(only(before, [...UNRELATED, ...STORE_DATA]));
    },
  );
});

describe('lock paths a reset cannot classify', () => {
  it.each([
    [
      'graphgoblin.db.graphgoblin.lock',
      'directory',
      'graphgoblin.db.graphgoblin.lock is a directory, not a lock file',
    ],
    [
      'graphgoblin.db.graphgoblin.lock.reclaim',
      'file',
      'graphgoblin.db.graphgoblin.lock.reclaim is a file, not a lock reclamation guard directory',
    ],
  ] as const)('refuses when %s is a %s, changing nothing', async (name, kind, refusal) => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
    bases.push(base);
    const dataDir = join(base, 'data');
    await writeTree(dataDir, { 'notes.txt': 'owner notes' });
    if (kind === 'directory') await mkdir(join(dataDir, name));
    else await writeFile(join(dataDir, name), 'not a guard');
    const before = await snapshotTree(base);
    for (const argv of [['--reset'], CONFIRM]) {
      const result = await reset(dataDir, argv);
      expect(result).toEqual({
        code: 1,
        out: '',
        err: `reset refused: ${refusal}; verify that no GraphGoblin process uses this store, then move it yourself\nNothing in the data directory was changed.\n`,
      });
      expect(await snapshotTree(base)).toEqual(before);
    }
  });

  it('refuses a link where the data-directory lock belongs', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-i3-reset-ownership-')));
    bases.push(base);
    const dataDir = join(base, 'data');
    await mkdir(join(base, 'elsewhere'));
    await mkdir(dataDir);
    await symlink(
      join(base, 'elsewhere'),
      join(dataDir, 'graphgoblin.lock'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      planReset({
        dataDir,
        database: 'graphgoblin.db',
        readStore: () => Promise.resolve(oldStore),
      }),
    ).rejects.toThrow(
      'graphgoblin.lock is a link, not a lock file; verify that no GraphGoblin process uses this store, then move it yourself',
    );
  });
});
