import { spawnSync } from 'node:child_process';
import { realpathSync, type PathLike } from 'node:fs';
import * as fs from 'node:fs/promises';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDisjointManifest, CASE_INSENSITIVE_NAMES, runResetCli } from './reset.js';
import type { StoreFacts } from './store-facts.js';
import { identityOf } from './tree.js';
import { snapshotTree, type TreeRecord } from './__fixtures__/stores.js';

// #538: a SQLite sidecar is removed as the directory entry its name opens. A file identity is
// shared by every hard link of the file, so another listed name of a sidecar is a separate entry:
// it is kept, with its bytes, under Keeps when it is at the top level. Disposable hard links are
// real throughout. `readdir` and `lstat` pass through to the real calls unless a case says it
// controls them: listing order is controlled only by reordering the real names of one directory,
// and a spelling alias the host cannot produce (a short name) is simulated by one lstat mapping.

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, readdir: vi.fn(actual.readdir), lstat: vi.fn(actual.lstat) };
});
const actual = await vi.importActual<typeof fs>('node:fs/promises');
const native = realpathSync.native;

const bases: string[] = [];
afterEach(async () => {
  vi.mocked(fs.readdir).mockImplementation(actual.readdir);
  vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  vi.restoreAllMocks();
  for (const base of bases.splice(0))
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A PID far above any these platforms assign, so a lock record naming it is stale. */
const DEAD_PID = 2147483644;
const staleRecord = (token: string) => JSON.stringify({ pid: DEAD_PID, token });
const oldStore: StoreFacts = { readable: true, format: 3, status: 'complete', runIds: [] };
const DRY = ['--reset'];
const CONFIRM = ['--reset', '--yes', '--data-dir', '<data>'];
const SUFFIXES = [
  ['-wal', 'SQLite write-ahead log'],
  ['-shm', 'SQLite shared memory'],
  ['-journal', 'SQLite rollback journal'],
] as const;
const UNCHANGED = 'Nothing in the data directory was changed.\n';

async function newBase(): Promise<{ base: string; dataDir: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-538-sidecars-')));
  bases.push(base);
  return { base, dataDir: join(base, 'data') };
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, ...path.split('/'))), { recursive: true });
    await writeFile(join(root, ...path.split('/')), content);
  }
}

const at = (dataDir: string, path: string) => join(dataDir, ...path.split('/'));
const nlink = async (path: string) => (await actual.lstat(path)).nlink;

async function reset(
  dataDir: string,
  argv: readonly string[],
  options: { env?: Record<string, string>; readStore?: (file: string) => Promise<StoreFacts> } = {},
) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv: argv.map((arg) => (arg === '<data>' ? dataDir : arg)),
    env: { GG_DATA_DIR: dataDir, ...options.env },
    readStore: options.readStore ?? (() => Promise.resolve(oldStore)),
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** A store reader that fails the case if the reset reads the store at all. */
const unread = () => Promise.reject(new Error('the store must not be read'));

/** The paths a manifest section lists, in order. */
function section(out: string, title: 'Removes:' | 'Keeps:'): string[] {
  const lines = out.split('\n');
  const start = lines.indexOf(title) + 1;
  return lines
    .slice(start, lines.indexOf('', start))
    .filter((line) => !line.startsWith('  Browser device drafts'))
    .map((line) => line.trim().split(' ')[0]!);
}
/** A Removes row and a Keeps row, padded as the reset pads them. */
const removeRow = (path: string, what: string, detail: string) =>
  `\n  ${path.padEnd(38)} ${what.padEnd(24)} ${detail}\n`;
const keepRow = (path: string, why: string) => `\n  ${path.padEnd(38)} ${why}\n`;
const anotherName = (sidecar: string) =>
  `another name for ${sidecar}; the file stays under this name`;
const only = (records: TreeRecord[], paths: readonly string[]) =>
  records.filter((record) => paths.includes(record.path));

/**
 * List `dir` with `alias` first or last. The names are the real listing's names, compared as a set;
 * every real order seen is recorded, so a case can also state what the host itself listed.
 */
function controlOrder(dir: string, alias: string, first: boolean): string[][] {
  const seen: string[][] = [];
  vi.mocked(fs.readdir).mockImplementation((async (path: PathLike, options?: object) => {
    const names = await actual.readdir(path, options);
    if (options !== undefined || resolve(String(path)) !== dir) return names;
    seen.push([...names]);
    expect(names).toContain(alias);
    const rest = names.filter((name) => name !== alias);
    return first ? [alias, ...rest] : [...rest, alias];
  }) as typeof fs.readdir);
  return seen;
}

/** Simulate spellings the volume would equate: lstat of each key observes the mapped entry. */
function aliasLstat(map: ReadonlyMap<string, string>): void {
  vi.mocked(fs.lstat).mockImplementation((path, options) =>
    actual.lstat(map.get(String(path)) ?? path, options),
  );
}

/** Answer the native final-path query for `path` only; every other query is the real one. */
function nativeAnswer(path: string, answer: () => string) {
  return vi
    .spyOn(realpathSync, 'native')
    .mockImplementation(((queried: PathLike, options?: never) =>
      resolve(String(queried)) === path ? answer() : native(queried, options)) as typeof native);
}

const LAYOUTS = {
  root: { parent: [] as string[], name: 'graphgoblin.db' },
  nested: { parent: ['db'], name: 'store.db' },
} as const;
type LayoutName = keyof typeof LAYOUTS;

/** A data directory with one database, one sidecar of `suffix` and an owner note. */
async function sidecarStore(layoutName: LayoutName, suffix: string) {
  const { base, dataDir } = await newBase();
  const layout = LAYOUTS[layoutName];
  const database = [...layout.parent, layout.name].join('/');
  const sidecar = database + suffix;
  const bytes = `${suffix} sidecar bytes`;
  await writeTree(dataDir, {
    [database]: 'database bytes',
    [sidecar]: bytes,
    'notes.txt': 'owner notes',
  });
  const env: Record<string, string> =
    layout.parent.length === 0
      ? {}
      : { GG_DB_URL: `file:${at(dataDir, database).replaceAll('\\', '/')}` };
  return {
    base,
    dataDir,
    dir: join(dataDir, ...layout.parent),
    parent: layout.parent,
    database,
    sidecar,
    leaf: layout.name + suffix,
    bytes,
    env,
  };
}

/** The Removes paths of a store whose sidecar is listed as `sidecar`. */
const removes = (database: string, sidecar: string) => [
  database,
  sidecar,
  `${database}.graphgoblin.lock`,
  'graphgoblin.lock',
];

describe('a sidecar is the entry its name opens, never another hard link of its file', () => {
  const cases = (['root', 'nested'] as const).flatMap((layout) =>
    SUFFIXES.flatMap(([suffix, what]) =>
      (['none', '00-unrelated', 'zz-unrelated'] as const).map((alias) => ({
        layout,
        suffix,
        what,
        alias,
      })),
    ),
  );

  it.each(cases)(
    '$layout $suffix, other hard link: $alias',
    async ({ layout, suffix, what, alias }) => {
      const store = await sidecarStore(layout, suffix);
      const { base, dataDir, dir, database, sidecar, leaf, bytes, env } = store;
      const sidecarPath = at(dataDir, sidecar);
      const identity = await identityOf(sidecarPath);
      const aliasPath = join(dir, alias);
      const aliasRel = [...store.parent, alias].join('/');
      let seen: string[][] = [];
      if (alias !== 'none') {
        await link(sidecarPath, aliasPath);
        // Two actual names of one file, not a copy: one identity, two links.
        expect(await identityOf(aliasPath)).toBe(identity);
        expect(await nlink(sidecarPath)).toBe(2);
        seen = controlOrder(dir, alias, alias.startsWith('00'));
      }
      const before = await snapshotTree(base);

      const dry = await reset(dataDir, DRY, { env });
      // Together, so an unexpected refusal shows its text.
      expect({ code: dry.code, err: dry.err }).toEqual({ code: 0, err: '' });
      expect(section(dry.out, 'Removes:')).toEqual(removes(database, sidecar));
      expect(dry.out).toContain(removeRow(sidecar, what, `1 file, ${String(bytes.length)} B`));
      const keeps =
        layout === 'root' && alias !== 'none' ? [alias, 'notes.txt'].sort() : ['notes.txt'];
      expect(section(dry.out, 'Keeps:')).toEqual(keeps);
      if (layout === 'root' && alias !== 'none')
        expect(dry.out).toContain(keepRow(alias, anotherName(sidecar)));
      expect(await snapshotTree(base)).toEqual(before);
      if (alias !== 'none') {
        // The listing order was the one this case names; on NTFS it is the host's own order.
        expect(seen.length).toBeGreaterThan(0);
        if (process.platform === 'win32') {
          const real = seen[0]!;
          expect(real.indexOf(alias) < real.indexOf(leaf)).toBe(alias.startsWith('00'));
        }
      }

      const confirmed = await reset(dataDir, CONFIRM, { env });
      expect({ code: confirmed.code, err: confirmed.err }).toEqual({ code: 0, err: '' });
      expect(section(confirmed.out, 'Removes:')).toEqual(removes(database, sidecar));
      expect(section(confirmed.out, 'Keeps:')).toEqual(keeps);
      expect(confirmed.out).toContain(
        `\n  removed ${sidecar} (1 file, ${String(bytes.length)} B)\n`,
      );
      expect(confirmed.out).toContain('Reset complete.');
      // Exactly the planned entry is gone; the other name keeps the file, its bytes and identity.
      expect(await identityOf(sidecarPath)).toBeUndefined();
      const survivors = [
        'notes.txt',
        ...(layout === 'nested' ? ['db'] : []),
        ...(alias === 'none' ? [] : [aliasRel]),
      ];
      expect(await snapshotTree(dataDir)).toEqual(only(before.map(relative('data')), survivors));
      if (alias !== 'none') {
        expect(await readFile(aliasPath, 'utf8')).toBe(bytes);
        expect(await identityOf(aliasPath)).toBe(identity);
        expect(await nlink(aliasPath)).toBe(1);
      }
    },
  );

  it.each(SUFFIXES)(
    'keeps a top-level name of a nested %s sidecar, removing only the sidecar',
    async (suffix, what) => {
      const store = await sidecarStore('nested', suffix);
      const { dataDir, sidecar, bytes, env } = store;
      const external = `00-${suffix.slice(1)}-copy`;
      await link(at(dataDir, sidecar), join(dataDir, external));
      const identity = await identityOf(join(dataDir, external));
      expect(await identityOf(at(dataDir, sidecar))).toBe(identity);
      const before = await snapshotTree(dataDir);

      for (const argv of [DRY, CONFIRM]) {
        const result = await reset(dataDir, argv, { env });
        expect(result.code).toBe(0);
        expect(result.err).toBe('');
        expect(section(result.out, 'Removes:')).toEqual(removes('db/store.db', sidecar));
        expect(result.out).toContain(removeRow(sidecar, what, `1 file, ${String(bytes.length)} B`));
        expect(section(result.out, 'Keeps:')).toEqual([external, 'notes.txt']);
        expect(result.out).toContain(keepRow(external, anotherName(sidecar)));
        if (argv === DRY) expect(await snapshotTree(dataDir)).toEqual(before);
      }
      expect(await snapshotTree(dataDir)).toEqual(only(before, ['db', external, 'notes.txt']));
      expect(await readFile(join(dataDir, external), 'utf8')).toBe(bytes);
      expect(await identityOf(join(dataDir, external))).toBe(identity);
      expect(await nlink(join(dataDir, external))).toBe(1);
    },
  );

  it('keeps a copy with the same bytes as an ordinary file, never as another name', async () => {
    const { dataDir, sidecar, bytes } = await sidecarStore('root', '-wal');
    await writeFile(join(dataDir, '00-copy'), bytes);
    const identity = await identityOf(join(dataDir, '00-copy'));
    expect(identity).not.toBe(await identityOf(at(dataDir, sidecar)));
    const result = await reset(dataDir, CONFIRM);
    expect(result.code).toBe(0);
    expect(result.out).toContain(keepRow('00-copy', 'not part of the store'));
    expect(result.out).toContain(`\n  removed ${sidecar} (1 file, ${String(bytes.length)} B)\n`);
    expect(await readFile(join(dataDir, '00-copy'), 'utf8')).toBe(bytes);
    expect(await identityOf(join(dataDir, '00-copy'))).toBe(identity);
  });

  it('keeps a hard link whose name differs only in letter case in a case-sensitive directory', async ({
    skip,
  }) => {
    const { dataDir, sidecar, bytes } = await sidecarStore('root', '-wal');
    // Only a directory that keeps letter case apart can list both names.
    if ((await identityOf(join(dataDir, 'GRAPHGOBLIN.DB-WAL'))) !== undefined) skip();
    await link(at(dataDir, sidecar), join(dataDir, 'GRAPHGOBLIN.DB-WAL'));
    expect((await actual.readdir(dataDir)).sort()).toEqual(
      ['GRAPHGOBLIN.DB-WAL', 'graphgoblin.db', 'graphgoblin.db-wal', 'notes.txt'].sort(),
    );
    const result = await reset(dataDir, CONFIRM);
    expect(result.code).toBe(0);
    expect(section(result.out, 'Removes:')).toEqual(
      removes('graphgoblin.db', 'graphgoblin.db-wal'),
    );
    expect(result.out).toContain(keepRow('GRAPHGOBLIN.DB-WAL', anotherName('graphgoblin.db-wal')));
    expect(await readFile(join(dataDir, 'GRAPHGOBLIN.DB-WAL'), 'utf8')).toBe(bytes);
    expect(await identityOf(join(dataDir, 'graphgoblin.db-wal'))).toBeUndefined();
  });

  it('keeps a look-alike sidecar name that only JavaScript folds to the sidecar name', async ({
    skip,
  }) => {
    const { dataDir } = await newBase();
    // A Kelvin sign (U+212A): JavaScript lowercases it to `k`; the filesystem keeps it a distinct
    // name. Escaped, so no editor or formatter can turn it into an ASCII `K`.
    const lookAlike = '\u212A.db-wal';
    expect(lookAlike).not.toBe('K.db-wal');
    await writeTree(dataDir, {
      'K.db': 'database bytes',
      [lookAlike]: 'not a sidecar',
      'notes.txt': 'owner notes',
    });
    expect(lookAlike.toLowerCase()).toBe('k.db-wal');
    if ((await identityOf(join(dataDir, 'K.db-wal'))) !== undefined) skip();
    const env = { GG_DB_URL: `file:${join(dataDir, 'K.db').replaceAll('\\', '/')}` };
    const result = await reset(dataDir, CONFIRM, { env });
    expect(result.code).toBe(0);
    expect(section(result.out, 'Removes:')).toEqual([
      'K.db',
      'K.db.graphgoblin.lock',
      'graphgoblin.lock',
    ]);
    expect(section(result.out, 'Keeps:')).toEqual(['notes.txt', lookAlike]);
    expect(await readFile(join(dataDir, lookAlike), 'utf8')).toBe('not a sidecar');
  });
});

describe('a sidecar that is also a name the reset owns in another role', () => {
  // The shared file holds a valid stale lock record (its owner PID cannot be running), so the
  // read-only lock checks find the lock stale and only the planner can see the overlap.
  it.each([
    {
      layout: 'root',
      suffix: '-wal',
      other: 'graphgoblin.lock',
      role: 'the data-directory lock',
    },
    {
      layout: 'root',
      suffix: '-shm',
      other: 'graphgoblin.db.graphgoblin.lock',
      role: 'the database lock',
    },
    {
      layout: 'nested',
      suffix: '-journal',
      other: 'db/store.db.graphgoblin.lock',
      role: 'the database lock',
    },
    {
      layout: 'nested',
      suffix: '-wal',
      other: 'graphgoblin.lock',
      role: 'the data-directory lock',
    },
  ] as const)(
    'refuses a $layout $suffix sidecar that is also $other, changing nothing',
    async ({ layout, suffix, other, role }) => {
      const { base, dataDir, sidecar, env } = await sidecarStore(layout, suffix);
      const what = SUFFIXES.find(([candidate]) => candidate === suffix)![1];
      await writeFile(at(dataDir, sidecar), staleRecord('stale lock shared with a sidecar'));
      await link(at(dataDir, sidecar), at(dataDir, other));
      const before = await snapshotTree(base);
      let reads = 0;
      for (const argv of [DRY, CONFIRM]) {
        const result = await reset(dataDir, argv, {
          env,
          readStore: () => {
            reads += 1;
            return Promise.resolve(oldStore);
          },
        });
        expect(result).toEqual({
          code: 1,
          out: '',
          err: `reset refused: ${sidecar} (${what}) is the same file as ${other}, ${role}; a reset cannot remove a file under one name while it owns another, so verify that no GraphGoblin process uses this store, then move ${other} yourself\n${UNCHANGED}`,
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
      // The planner itself refused: both previews passed the read-only lock checks.
      expect(reads).toBe(2);
    },
  );

  it.each([
    ['workspaces', 'run workspaces'],
    ['artifacts', 'artifacts'],
    ['chat-audio', 'private chat audio'],
  ])(
    'refuses a sidecar that is also the reserved name %s, changing nothing',
    async (name, what) => {
      const { base, dataDir } = await sidecarStore('root', '-wal');
      await link(join(dataDir, 'graphgoblin.db-wal'), join(dataDir, name));
      const before = await snapshotTree(base);
      for (const argv of [DRY, CONFIRM]) {
        expect(await reset(dataDir, argv)).toEqual({
          code: 1,
          out: '',
          err: `reset refused: graphgoblin.db-wal (SQLite write-ahead log) is the same file as ${name}, the reserved name of the ${what} directory; a reset cannot remove a file under one name while it owns another, so verify that no GraphGoblin process uses this store, then move ${name} yourself\n${UNCHANGED}`,
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
    },
  );

  // A lock name whose record cannot be verified is refused by the earlier read-only lock check,
  // with its own diagnostic, before the planner sees the shared file.
  it.each([
    { layout: 'root', other: 'graphgoblin.lock' },
    { layout: 'nested', other: 'db/store.db.graphgoblin.lock' },
  ] as const)(
    'keeps the earlier lock refusal when $other shares a sidecar holding no lock record',
    async ({ layout, other }) => {
      const { base, dataDir, sidecar, env } = await sidecarStore(layout, '-wal');
      await link(at(dataDir, sidecar), at(dataDir, other));
      const before = await snapshotTree(base);
      for (const argv of [DRY, CONFIRM]) {
        const result = await reset(dataDir, argv, { env });
        expect(result).toEqual({
          code: 1,
          out: '',
          err: `reset refused: Store ownership could not be verified (malformed or incomplete owner record): ${at(dataDir, other)}; verify ownership before resetting\n${UNCHANGED}`,
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
    },
  );

  it.each([
    {
      name: 'another SQLite part',
      link: 'graphgoblin.db-shm',
      runIds: [] as string[],
      twice: 'graphgoblin.db-shm',
    },
    {
      name: 'a removed run workspace',
      link: 'workspaces/run-a/copy',
      runIds: ['run-a'],
      twice: 'graphgoblin.db-wal',
    },
    {
      name: 'the removed artifacts directory',
      link: 'artifacts/copy',
      runIds: [] as string[],
      twice: 'graphgoblin.db-wal',
    },
  ])('refuses a sidecar that is also an entry in $name, changing nothing', async (entry) => {
    const { base, dataDir } = await sidecarStore('root', '-wal');
    await mkdir(dirname(at(dataDir, entry.link)), { recursive: true });
    await link(join(dataDir, 'graphgoblin.db-wal'), at(dataDir, entry.link));
    const before = await snapshotTree(base);
    const readStore = () => Promise.resolve<StoreFacts>({ ...oldStore, runIds: entry.runIds });
    for (const argv of [DRY, CONFIRM]) {
      expect(await reset(dataDir, argv, { readStore })).toEqual({
        code: 1,
        out: '',
        err: `reset refused: the manifest would list ${entry.twice} twice\n${UNCHANGED}`,
      });
      expect(await snapshotTree(base)).toEqual(before);
    }
  });

  it('keeps the exported manifest check strict for a kept name of a removed sidecar', () => {
    const removed = {
      path: 'graphgoblin.db-wal',
      kind: 'file' as const,
      bytes: 1,
      identity: 'g:\\|0:5',
      ancestors: [],
    };
    expect(() =>
      assertDisjointManifest(
        [{ path: removed.path, what: 'SQLite write-ahead log', entries: [removed] }],
        [{ path: '00-unrelated', why: anotherName(removed.path), identity: removed.identity }],
      ),
    ).toThrow('the manifest would both remove and keep 00-unrelated');
  });
});

describe('sidecars that are not regular files', () => {
  it('refuses a link at the sidecar name before reading the store', async () => {
    const { base, dataDir } = await sidecarStore('root', '-shm');
    await rm(join(dataDir, 'graphgoblin.db-shm'));
    await mkdir(join(base, 'elsewhere'));
    await symlink(
      join(base, 'elsewhere'),
      join(dataDir, 'graphgoblin.db-shm'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const before = await snapshotTree(base);
    for (const argv of [DRY, CONFIRM]) {
      expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
        code: 1,
        out: '',
        err: `reset refused: graphgoblin.db-shm is a link, not a database file; a reset removes only regular database files\n${UNCHANGED}`,
      });
      expect(await snapshotTree(base)).toEqual(before);
    }
  });

  it.runIf(CASE_INSENSITIVE_NAMES)(
    'refuses a link listed under another spelling without resolving it',
    async () => {
      const { base, dataDir } = await sidecarStore('root', '-wal');
      await rm(join(dataDir, 'graphgoblin.db-wal'));
      await mkdir(join(base, 'elsewhere'));
      await symlink(
        join(base, 'elsewhere'),
        join(dataDir, 'GRAPHGOBLIN.DB-WAL'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const query = vi.spyOn(realpathSync, 'native');
      const before = await snapshotTree(base);
      for (const argv of [DRY, CONFIRM]) {
        expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
          code: 1,
          out: '',
          err: `reset refused: GRAPHGOBLIN.DB-WAL is a link, not a database file; a reset removes only regular database files\n${UNCHANGED}`,
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
      const sidecarQueries = query.mock.calls.filter(([path]) =>
        resolve(String(path)).toLowerCase().endsWith('-wal'),
      );
      expect(sidecarQueries).toEqual([]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'refuses a FIFO at the sidecar name before reading it',
    async () => {
      const { dataDir } = await sidecarStore('root', '-wal');
      await rm(join(dataDir, 'graphgoblin.db-wal'));
      expect(spawnSync('mkfifo', [join(dataDir, 'graphgoblin.db-wal')]).status).toBe(0);
      // Reading a FIFO with no writer blocks, so the tree is compared by listing.
      const before = (await actual.readdir(dataDir)).sort();
      for (const argv of [DRY, CONFIRM]) {
        expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
          code: 1,
          out: '',
          err: `reset refused: graphgoblin.db-wal is a special file, not a database file; a reset removes only regular database files\n${UNCHANGED}`,
        });
        expect((await actual.readdir(dataDir)).sort()).toEqual(before);
        expect((await actual.lstat(join(dataDir, 'graphgoblin.db-wal'))).isFIFO()).toBe(true);
      }
    },
  );
});

/**
 * A root store whose write-ahead log is listed only as `GRAPHGOBLIN.DB-WAL`, so its stored name
 * `graphgoblin.db-wal` is another spelling of it, plus a hard link `alias` of that file.
 */
async function spelledWal(alias: string) {
  const { base, dataDir } = await newBase();
  await writeTree(dataDir, {
    'graphgoblin.db': 'database bytes',
    'GRAPHGOBLIN.DB-WAL': 'wal bytes',
    'notes.txt': 'owner notes',
  });
  await link(join(dataDir, 'GRAPHGOBLIN.DB-WAL'), join(dataDir, alias));
  const identity = await identityOf(join(dataDir, alias));
  return { base, dataDir, identity, requested: join(dataDir, 'graphgoblin.db-wal') };
}

const ambiguity = (names: string, detail: string) =>
  `reset refused: the data directory lists graphgoblin.db-wal under more than one name (${names}), and ${detail}; verify that no GraphGoblin process uses this store, then move the other names yourself\n`;

describe.runIf(process.platform === 'win32')(
  'Windows: several hard links for a sidecar spelling the directory does not list',
  () => {
    it.each(['00-unrelated', 'zz-unrelated'])(
      'removes the listed link the native final path names and keeps %s (real NTFS)',
      async (alias) => {
        const { base, dataDir, identity, requested } = await spelledWal(alias);
        expect(await identityOf(requested)).toBe(identity);
        expect(await actual.readdir(dataDir)).not.toContain('graphgoblin.db-wal');
        // Observed, not answered: the real native query runs.
        const query = vi.spyOn(realpathSync, 'native');
        const before = await snapshotTree(base);
        const dry = await reset(dataDir, DRY);
        expect(dry.code).toBe(0);
        expect(section(dry.out, 'Removes:')).toEqual(
          removes('graphgoblin.db', 'GRAPHGOBLIN.DB-WAL'),
        );
        expect(section(dry.out, 'Keeps:')).toEqual([alias, 'notes.txt'].sort());
        expect(dry.out).toContain(keepRow(alias, anotherName('GRAPHGOBLIN.DB-WAL')));
        expect(await snapshotTree(base)).toEqual(before);
        const index = query.mock.calls.findIndex(([path]) => String(path) === requested);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(query.mock.results[index]).toEqual({
          type: 'return',
          value: join(dataDir, 'GRAPHGOBLIN.DB-WAL'),
        });

        const confirmed = await reset(dataDir, CONFIRM);
        expect(confirmed.code).toBe(0);
        expect(confirmed.out).toContain('\n  removed GRAPHGOBLIN.DB-WAL (1 file, 9 B)\n');
        expect(confirmed.out).toContain(keepRow(alias, anotherName('GRAPHGOBLIN.DB-WAL')));
        expect((await actual.readdir(dataDir)).sort()).toEqual([alias, 'notes.txt'].sort());
        expect(await readFile(join(dataDir, alias), 'utf8')).toBe('wal bytes');
        expect(await identityOf(join(dataDir, alias))).toBe(identity);
        expect(await nlink(join(dataDir, alias))).toBe(1);
      },
    );

    // #531 audit: NTFS opens `οσ-1.db-wal` as a listed `ΟΣ-1.DB-WAL`, whose Σ JavaScript lowercases
    // to a final ς. Both the configured and the stored spelling name that one entry.
    it('removes a Unicode-aliased sidecar under its listed name and keeps its other link', async ({
      skip,
    }) => {
      const { base, dataDir } = await newBase();
      await writeTree(dataDir, {
        'ΟΣ-1.DB': 'database bytes',
        'ΟΣ-1.DB-WAL': 'wal bytes',
        'notes.txt': 'owner notes',
      });
      await link(join(dataDir, 'ΟΣ-1.DB-WAL'), join(dataDir, '00-unrelated'));
      const identity = await identityOf(join(dataDir, '00-unrelated'));
      // The filesystem facts this case rests on; another volume may not equate these spellings.
      if (
        (await identityOf(join(dataDir, 'οσ-1.db-wal'))) !== identity ||
        (await identityOf(join(dataDir, 'οσ-1.db'))) !==
          (await identityOf(join(dataDir, 'ΟΣ-1.DB')))
      )
        skip();
      expect('ΟΣ-1.DB-WAL'.toLowerCase()).not.toBe('οσ-1.db-wal');
      const env = { GG_DB_URL: `file:${join(dataDir, 'οσ-1.db').replaceAll('\\', '/')}` };
      const query = vi.spyOn(realpathSync, 'native');
      const before = await snapshotTree(base);
      const dry = await reset(dataDir, DRY, { env });
      expect(dry.code).toBe(0);
      expect(section(dry.out, 'Removes:')).toEqual(removes('ΟΣ-1.DB', 'ΟΣ-1.DB-WAL'));
      expect(section(dry.out, 'Keeps:')).toEqual(['00-unrelated', 'notes.txt']);
      expect(dry.out).toContain(keepRow('00-unrelated', anotherName('ΟΣ-1.DB-WAL')));
      expect(await snapshotTree(base)).toEqual(before);
      // Both spellings were answered by the real native query with the listed link.
      for (const spelling of ['ΟΣ-1.DB-wal', 'οσ-1.db-wal']) {
        const index = query.mock.calls.findIndex(
          ([path]) => String(path) === join(dataDir, spelling),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(query.mock.results[index]).toEqual({
          type: 'return',
          value: join(dataDir, 'ΟΣ-1.DB-WAL'),
        });
      }
      const confirmed = await reset(dataDir, CONFIRM, { env });
      expect(confirmed.code).toBe(0);
      expect(confirmed.out).toContain('\n  removed ΟΣ-1.DB-WAL (1 file, 9 B)\n');
      expect(confirmed.out).toContain('\n  removed ΟΣ-1.DB.graphgoblin.lock (database lock)\n');
      expect((await actual.readdir(dataDir)).sort()).toEqual(['00-unrelated', 'notes.txt']);
      expect(await readFile(join(dataDir, '00-unrelated'), 'utf8')).toBe('wal bytes');
      expect(await identityOf(join(dataDir, '00-unrelated'))).toBe(identity);
    });

    const failures: [string, (dataDir: string, base: string) => () => string, string][] = [
      [
        'a path in another directory',
        (_dataDir, base) => () => join(base, 'elsewhere', 'GRAPHGOBLIN.DB-WAL'),
        'the filesystem names <elsewhere>, which is not one of them',
      ],
      [
        'a name the directory does not list',
        (dataDir) => () => join(dataDir, 'graphgoblin.db-wal'),
        'the filesystem names <requested>, which is not one of them',
      ],
      [
        'EPERM',
        () => () => {
          throw Object.assign(new Error('EPERM: operation not permitted, realpath'), {
            code: 'EPERM',
          });
        },
        'the filesystem could not say which one SQLite opens (EPERM: operation not permitted, realpath)',
      ],
      [
        'ENOENT after the name was found',
        () => () => {
          throw Object.assign(new Error('ENOENT: no such file or directory, realpath'), {
            code: 'ENOENT',
          });
        },
        'the filesystem could not say which one SQLite opens (ENOENT: no such file or directory, realpath)',
      ],
    ];

    it.each(failures)(
      'refuses, changing nothing, when the native query answers %s',
      async (_name, answer, detail) => {
        const { base, dataDir, requested } = await spelledWal('00-unrelated');
        nativeAnswer(requested, answer(dataDir, base));
        const expected = detail
          .replace('<elsewhere>', join(base, 'elsewhere', 'GRAPHGOBLIN.DB-WAL'))
          .replace('<requested>', requested);
        const before = await snapshotTree(base);
        for (const argv of [DRY, CONFIRM]) {
          expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
            code: 1,
            out: '',
            err: ambiguity('00-unrelated, GRAPHGOBLIN.DB-WAL', expected) + UNCHANGED,
          });
          expect(await snapshotTree(base)).toEqual(before);
        }
      },
    );

    it.each([false, true])(
      'refuses an ambiguity first seen under the locks and releases them (stale locks: %s)',
      async (stale) => {
        const { base, dataDir, requested } = await spelledWal('00-unrelated');
        if (stale)
          await writeTree(dataDir, {
            'graphgoblin.lock': staleRecord('stale directory'),
            'graphgoblin.db.graphgoblin.lock': staleRecord('stale db'),
          });
        const before = await snapshotTree(base);
        let reads = 0;
        const result = await reset(dataDir, CONFIRM, {
          readStore: () => {
            // The preview's read: from here the native query answers a name the directory does not
            // list, so only the locked plan sees the ambiguity.
            if (++reads === 1) nativeAnswer(requested, () => requested);
            return Promise.resolve(oldStore);
          },
        });
        expect(reads).toBe(1);
        expect(result).toEqual({
          code: 1,
          out: '',
          err:
            ambiguity(
              '00-unrelated, GRAPHGOBLIN.DB-WAL',
              `the filesystem names ${requested}, which is not one of them`,
            ) +
            (stale
              ? [
                  'No store data was removed. Lock files and guards:',
                  '  reclaimed stale graphgoblin.db.graphgoblin.lock (database lock)',
                  '  reclaimed stale graphgoblin.lock (data-directory lock)',
                  '  removed graphgoblin.db.graphgoblin.lock (database lock)',
                  '  removed graphgoblin.lock (data-directory lock)',
                  '',
                ].join('\n')
              : UNCHANGED),
        });
        // Every store byte and the other link stay; only the stale locks were reclaimed.
        expect(await snapshotTree(base)).toEqual(
          before.filter(
            (record) =>
              !['data/graphgoblin.lock', 'data/graphgoblin.db.graphgoblin.lock'].includes(
                record.path,
              ),
          ),
        );
      },
    );
  },
);

describe.skipIf(process.platform === 'win32')(
  'outside Windows: a sidecar spelling with several listed links (controlled case-folding lookup)',
  () => {
    it('refuses, changing nothing, rather than choose a link', async () => {
      const { base, dataDir, requested } = await spelledWal('00-unrelated');
      // A volume that equates the spellings: lstat of the stored spelling observes the listed file.
      aliasLstat(new Map([[requested, join(dataDir, 'GRAPHGOBLIN.DB-WAL')]]));
      const query = vi.spyOn(realpathSync, 'native');
      const before = await snapshotTree(base);
      for (const argv of [DRY, CONFIRM]) {
        expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
          code: 1,
          out: '',
          err:
            ambiguity(
              '00-unrelated, GRAPHGOBLIN.DB-WAL',
              'the filesystem does not say which one SQLite opens',
            ) + UNCHANGED,
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
      expect(query.mock.calls.filter(([path]) => String(path) === requested)).toEqual([]);
    });
  },
);

describe('a present sidecar name the reset cannot tie to one listed entry (controlled lstat)', () => {
  it('refuses a spelling that opens a file the directory does not list', async () => {
    const { base, dataDir } = await newBase();
    await writeTree(dataDir, { 'graphgoblin.db': 'database bytes', 'notes.txt': 'owner notes' });
    await writeFile(join(base, 'outside-wal'), 'outside bytes');
    // The stored spelling observes a regular file that no name in the directory lists.
    aliasLstat(new Map([[join(dataDir, 'graphgoblin.db-wal'), join(base, 'outside-wal')]]));
    const before = await snapshotTree(base);
    for (const argv of [DRY, CONFIRM]) {
      expect(await reset(dataDir, argv, { readStore: unread })).toEqual({
        code: 1,
        out: '',
        err: `reset refused: graphgoblin.db-wal is present, but the data directory lists no name for it; a reset removes only an entry the directory lists, so verify that no GraphGoblin process uses this store, then run the reset again\n${UNCHANGED}`,
      });
      expect(await snapshotTree(base)).toEqual(before);
    }
  });

  it('refuses when the listed name it chose is gone when observed again', async () => {
    const { base, dataDir } = await newBase();
    await writeTree(dataDir, {
      'graphgoblin.db': 'database bytes',
      'GRAPHGOBLIN.DB-WAL': 'wal bytes',
      'notes.txt': 'owner notes',
    });
    const requested = join(dataDir, 'graphgoblin.db-wal');
    const chosen = join(dataDir, 'GRAPHGOBLIN.DB-WAL');
    const moved = join(base, 'moved-wal');
    // The stored spelling observes the one listed file; another process moves that file after the
    // listing matched it and before the reset observes the chosen name again.
    let armed = false;
    let observed = 0;
    vi.mocked(fs.lstat).mockImplementation(async (path, options) => {
      if (String(path) === requested) armed = true;
      else if (armed && String(path) === chosen && ++observed === 2) await fs.rename(chosen, moved);
      return actual.lstat(String(path) === requested ? chosen : path, options);
    });
    const result = await reset(dataDir, DRY, { readStore: unread });
    expect(observed).toBe(2);
    expect(result).toEqual({
      code: 1,
      out: '',
      err: `reset refused: graphgoblin.db-wal changed while the reset was listing it; verify that no GraphGoblin process uses this store, then run the reset again\n${UNCHANGED}`,
    });
    expect(await readFile(moved, 'utf8')).toBe('wal bytes');
    expect((await actual.readdir(dataDir)).sort()).toEqual(['graphgoblin.db', 'notes.txt']);
  });
});

describe('configured and stored database names that differ (controlled short-name alias)', () => {
  // The writer gives SQLite the configured spelling, which here is a simulated short name of the
  // listed database: lstat of `GRAPHG~1.DB` observes `graphgoblin.db`. The host's short-name
  // setting is neither used nor changed, and no real 8.3 alias is assumed.
  const SHORT = 'GRAPHG~1.DB';

  async function shortNameStore(files: Record<string, string>, aliases: [string, string][] = []) {
    const { base, dataDir } = await newBase();
    await writeTree(dataDir, {
      'graphgoblin.db': 'database bytes',
      'notes.txt': 'owner notes',
      ...files,
    });
    aliasLstat(
      new Map(
        [[SHORT, 'graphgoblin.db'] as const, ...aliases].map(([from, to]) => [
          join(dataDir, from),
          join(dataDir, to),
        ]),
      ),
    );
    expect(await identityOf(join(dataDir, SHORT))).toBe(
      await identityOf(join(dataDir, 'graphgoblin.db')),
    );
    expect(await actual.readdir(dataDir)).not.toContain(SHORT);
    const env = { GG_DB_URL: `file:${join(dataDir, SHORT).replaceAll('\\', '/')}` };
    return { base, dataDir, env };
  }

  const refusal = (what: string, writer: string, stored: string) =>
    `reset refused: the database is configured as ${SHORT} but listed as graphgoblin.db, and ${writer} while ${stored}; a reset cannot tell which ${what} belongs to this store, so configure GG_DB_URL with the name as the directory lists it\n${UNCHANGED}`;

  const disagreements = SUFFIXES.flatMap(([suffix, what]) => {
    const writer = SHORT + suffix;
    const stored = 'graphgoblin.db' + suffix;
    const listed = (name: string) => `${name} names the listed entry ${name}`;
    const none = (name: string) => `${name} names no entry`;
    return [
      {
        name: `only the writer's ${suffix}`,
        what,
        setup: (dataDir: string) => writeFile(join(dataDir, writer), 'writer sidecar'),
        detail: [listed(writer), none(stored)] as const,
      },
      {
        name: `only the reader's ${suffix}`,
        what,
        setup: (dataDir: string) => writeFile(join(dataDir, stored), 'reader sidecar'),
        detail: [none(writer), listed(stored)] as const,
      },
      {
        name: `two different ${suffix} files`,
        what,
        setup: async (dataDir: string) => {
          await writeFile(join(dataDir, writer), 'writer sidecar');
          await writeFile(join(dataDir, stored), 'reader sidecar');
          expect(await identityOf(join(dataDir, writer))).not.toBe(
            await identityOf(join(dataDir, stored)),
          );
        },
        detail: [listed(writer), listed(stored)] as const,
      },
      {
        name: `two hard links of one ${suffix} file`,
        what,
        setup: async (dataDir: string) => {
          await writeFile(join(dataDir, stored), 'one sidecar');
          await link(join(dataDir, stored), join(dataDir, writer));
          expect(await identityOf(join(dataDir, writer))).toBe(
            await identityOf(join(dataDir, stored)),
          );
        },
        detail: [listed(writer), listed(stored)] as const,
      },
    ];
  });

  it.each(disagreements)(
    'refuses before reading the store when the spellings name $name',
    async ({ what, setup, detail }) => {
      const { base, dataDir, env } = await shortNameStore({});
      await setup(dataDir);
      const before = await snapshotTree(base);
      for (const argv of [DRY, CONFIRM]) {
        expect(await reset(dataDir, argv, { env, readStore: unread })).toEqual({
          code: 1,
          out: '',
          err: refusal(what, ...detail),
        });
        expect(await snapshotTree(base)).toEqual(before);
      }
    },
  );

  it('lists the one entry both spellings name and reads the stored spelling', async () => {
    const { base, dataDir, env } = await shortNameStore({ 'graphgoblin.db-wal': 'wal bytes' }, [
      [`${SHORT}-wal`, 'graphgoblin.db-wal'],
    ]);
    const before = await snapshotTree(base);
    const read: string[] = [];
    const dry = await reset(dataDir, DRY, {
      env,
      readStore: (file) => {
        read.push(file);
        return Promise.resolve(oldStore);
      },
    });
    expect(dry.code).toBe(0);
    expect(dry.err).toBe('');
    expect(section(dry.out, 'Removes:')).toEqual(removes('graphgoblin.db', 'graphgoblin.db-wal'));
    expect(section(dry.out, 'Keeps:')).toEqual(['notes.txt']);
    expect(read).toEqual([join(dataDir, 'graphgoblin.db')]);
    expect(await snapshotTree(base)).toEqual(before);
  });

  it('refuses a writer sidecar first seen under the locks and releases them', async () => {
    const { base, dataDir, env } = await shortNameStore({});
    const before = await snapshotTree(base);
    let reads = 0;
    const result = await reset(dataDir, CONFIRM, {
      env,
      readStore: async () => {
        // The preview's read: the writer's spelling of the log appears before the locks are taken.
        if (++reads === 1) await writeFile(join(dataDir, `${SHORT}-wal`), 'writer sidecar');
        return oldStore;
      },
    });
    expect(reads).toBe(1);
    expect(result).toEqual({
      code: 1,
      out: '',
      err: refusal(
        'SQLite write-ahead log',
        `${SHORT}-wal names the listed entry ${SHORT}-wal`,
        'graphgoblin.db-wal names no entry',
      ),
    });
    const after = await snapshotTree(base);
    expect(after.filter((record) => record.path !== `data/${SHORT}-wal`)).toEqual(before);
    expect(await readFile(join(dataDir, `${SHORT}-wal`), 'utf8')).toBe('writer sidecar');
  });
});

/** Snapshot records of `base`, re-rooted at its `prefix` directory. */
function relative(prefix: string) {
  return (record: TreeRecord): TreeRecord => ({
    ...record,
    path: record.path.startsWith(prefix + '/') ? record.path.slice(prefix.length + 1) : '',
  });
}
