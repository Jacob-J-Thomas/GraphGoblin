import { realpathSync } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { databaseFilePath } from '@graphgoblin/infrastructure/sqlite';
import { canonicalPath } from '../canonical-path.js';
import { loadConfig, type ApiConfig } from '../config.js';
import {
  acquireDataDirLock,
  acquireDatabaseLock,
  DATA_DIR_LOCK_FILE,
  databaseLockFileName,
  dataDirLockState,
  databaseLockState,
  RECLAIM_GUARD_SUFFIX,
  type DataDirLock,
  type ReleaseOutcome,
} from '../data-dir-lock.js';
import { dataDirArgument, RESET_COMMAND } from '../store-refusal.js';
import { readStoreFacts, type StoreFacts } from './store-facts.js';
import { cleanupStaleStoreCopies } from './store-copy.js';
import { hasCode, identityOf, listEntry, removeEntry, statEntry, type TreeEntry } from './tree.js';

/**
 * `graphgoblin-api --reset` (ADR-0042): the explicit fresh start for a pre-1.0 store this build
 * cannot open. Without `--yes` it only lists what a reset would remove (a dry run, which changes
 * no data-directory byte). With `--yes --data-dir <path>` naming the configured data directory it takes
 * the data-directory and database locks (reclaiming a stale lock file or reclamation guard on the
 * way), lists the same manifest and removes exactly that: the database and its
 * SQLite sidecars, the artifact and private chat-audio directories, and the run workspaces whose
 * names are stored run IDs, then its own database lock and, last, its data-directory lock when it
 * releases them. Planned identities are rechecked before each removal (see tree.ts for
 * the remaining external-process race). Links are removed themselves; `master.key` and every
 * other entry are kept, including another hard-link name of a removed sidecar. Browser device
 * drafts live in each browser and are discarded from the editor.
 */

export const RESET_USAGE =
  'usage: graphgoblin-api --reset [--yes --data-dir <path>]  (without --yes it only lists what a reset would remove)';

/** Manifest lines per section before the rest is summarised; totals always cover everything. */
export const MANIFEST_LIST_LIMIT = 20;

export interface ResetArgs {
  confirmed: boolean;
  /** The data directory the operator named; with `--yes` it must be the configured one. */
  dataDir?: string;
}

/**
 * Parse strictly: `--reset` once, at most one `--yes`, at most one `--data-dir <path>` (or
 * `--data-dir=<path>`), and `--yes` only together with `--data-dir`. Anything else is an error,
 * so a typo can never reach a removal.
 */
export function parseResetArgs(argv: readonly string[]): ResetArgs | string {
  let reset = false;
  let confirmed = false;
  let dataDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--reset') {
      if (reset) return '--reset is given more than once';
      reset = true;
    } else if (arg === '--yes') {
      if (confirmed) return '--yes is given more than once';
      confirmed = true;
    } else if (arg === '--data-dir' || arg.startsWith('--data-dir=')) {
      if (dataDir !== undefined) return '--data-dir is given more than once';
      const value = arg === '--data-dir' ? argv[i + 1] : arg.slice('--data-dir='.length);
      if (
        value === undefined ||
        value.trim() === '' ||
        (arg === '--data-dir' && value.startsWith('-'))
      )
        return '--data-dir needs the path of the data directory';
      dataDir = value;
      if (arg === '--data-dir') i += 1;
    } else if (arg.startsWith('-')) {
      return `unknown option ${arg}`;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }
  if (!reset) return '--reset is required';
  if (confirmed && dataDir === undefined)
    return '--yes needs --data-dir <path> naming the data directory to reset';
  return { confirmed, ...(dataDir !== undefined ? { dataDir } : {}) };
}

export interface ResetTarget {
  /** Relative to the data directory, with `/` separators. */
  path: string;
  what: string;
  /** Removal order: every child before its directory, the target itself last. */
  entries: TreeEntry[];
}

export interface KeptEntry {
  path: string;
  why: string;
  /** Filesystem identity when the entry exists; compared against the removed entries. */
  identity?: string | undefined;
}

/** A confirmed reset releases the database lock first and the data-directory lock last. */
export type LockRole = 'database lock' | 'data-directory lock';

/**
 * A lock file or its reclamation guard (ADR-0069) at the path the lock module uses, spelled as the
 * directory lists it. A confirmed reset takes both locks before its locked plan, which reclaims a
 * stale lock file or guard, and removes its own lock files when it releases them; none of these
 * entries is ever listed under Keeps as unrelated data.
 */
export interface OwnershipEntry {
  /** Relative to the data directory, with `/` separators. */
  path: string;
  role: LockRole;
  /** The `.reclaim` guard directory rather than the lock file. */
  guard: boolean;
  present: boolean;
}

export interface ResetPlan {
  /** Physical path of the data directory; every target is inside it. */
  dataDir: string;
  /** The configured database file, relative to the data directory, spelled as the directory lists it. */
  database: string;
  store: StoreFacts | { readable: false; reason: string; absent: true };
  targets: ResetTarget[];
  kept: KeptEntry[];
  /** The database lock's guard and file, then the data-directory lock's guard and file. */
  ownership: OwnershipEntry[];
}

/**
 * What a refused reset did to the data directory. Nothing before removal changes store data or any
 * entry other than the reset's lock files and guards, so only those can differ.
 */
export type OwnershipEffect =
  /**
   * Nothing in the data directory changed: refused before taking a lock, or every lock taken was
   * removed on release and taking them reclaimed nothing.
   */
  | { kind: 'unchanged' }
  /**
   * The locks were taken: the stale entries taking them reclaimed, those the preview listed that
   * were already gone when the lock was taken, and what each release did.
   */
  | { kind: 'changed'; lines: readonly string[] }
  /**
   * Taking `failed` threw. The lock module reports no more than the error, and the attempt can
   * create or reclaim that lock's file, guard or guard staging directory and leave any of them, so
   * the lines give that lock file and guard as found now and just before the attempt (never who
   * changed them), then the rest as for `changed`.
   */
  | { kind: 'uncertain'; failed: LockRole; lines: readonly string[] };

const UNCHANGED: OwnershipEffect = { kind: 'unchanged' };

/** Refused before any store data was removed; `ownership` says what happened to the lock files. */
export class ResetRefusedError extends Error {
  readonly ownership: OwnershipEffect;
  constructor(message: string, ownership: OwnershipEffect = UNCHANGED) {
    super(message);
    this.name = 'ResetRefusedError';
    this.ownership = ownership;
  }
}

/** Removal stopped part of the way; the message says exactly what was and was not removed. */
export class ResetIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetIncompleteError';
  }
}

/** A database at the root may not be named like the data-directory lock or its guard. */
const LOCK_FILES = new Set([DATA_DIR_LOCK_FILE, DATA_DIR_LOCK_FILE + RECLAIM_GUARD_SUFFIX]);
const OWNED_DIRECTORIES = [
  ['artifacts', 'artifacts'],
  ['chat-audio', 'private chat audio'],
] as const;
/** Directories a reset removes by name; a database may not be named like one or live inside one. */
const RESERVED_ROOTS = new Set(['workspaces', ...OWNED_DIRECTORIES.map(([name]) => name)]);

/**
 * Whether the host folds letter case in names by default (Windows and macOS volumes). Used only
 * where nothing exists yet to compare by identity; everything that exists is compared by the
 * filesystem's own identity, never by folding, because folding can equate two distinct files.
 */
export const CASE_INSENSITIVE_NAMES = process.platform === 'win32' || process.platform === 'darwin';

/** The comparison key of a name under the host's default case rule, for entries that do not exist. */
export function nameKey(path: string, caseInsensitive = CASE_INSENSITIVE_NAMES): string {
  return caseInsensitive ? path.toLowerCase() : path;
}

/**
 * The configured database path, segment by segment, as the data directory lists it. Each existing
 * segment is matched to the directory entry with the same filesystem identity, so a different
 * letter case or a Windows short name resolves to the entry's own spelling while two distinct files
 * whose names merely fold alike (`K.db` and the Kelvin-sign `K.db`, or two names in a case-sensitive
 * directory) stay distinct; a spelling that identifies no listed entry, or more than one, is
 * refused. Every ancestor is checked to be a physical directory before it is entered, so a link is
 * never followed on the way. Segments below the deepest existing entry are kept as configured.
 */
export async function storedSpelling(dataDir: string, database: string): Promise<string[]> {
  const configured = database.split('/');
  const stored: string[] = [];
  let parent = dataDir;
  for (const [index, segment] of configured.entries()) {
    // Windows resolves a name with a trailing dot or space to the name without it, so such a
    // spelling would name a listed entry under a form the listing never shows.
    if (process.platform === 'win32' && /[. ]$/.test(segment))
      throw new ResetRefusedError(
        `the database path ${database} names ${segment} with a trailing dot or space, which Windows resolves to another name; configure GG_DB_URL with the name as the directory lists it`,
      );
    // A colon inside a Windows name denotes an alternate data stream: it shares the file's identity
    // but is not the file, so it is refused rather than resolved to the file and removed with it.
    if (process.platform === 'win32' && segment.includes(':'))
      throw new ResetRefusedError(
        `the database path ${database} names a stream of a file (${segment} contains a colon); configure GG_DB_URL with the file itself`,
      );
    const identity = await identityOf(resolve(parent, segment));
    if (identity === undefined) return [...stored, ...configured.slice(index)];
    const matches: string[] = [];
    for (const name of await readdir(parent))
      if ((await identityOf(resolve(parent, name))) === identity) matches.push(name);
    if (matches.length !== 1)
      throw new ResetRefusedError(
        matches.length === 0
          ? `the database path ${database} names ${segment} by a spelling the data directory does not list; configure GG_DB_URL with the name as the directory lists it`
          : `the data directory lists ${segment} under more than one name (${matches.sort().join(', ')}); a reset cannot tell which one the configuration means`,
      );
    const spelling = matches[0]!;
    stored.push(spelling);
    if (index < configured.length - 1) {
      // Entered only when it is a physical directory: a link or a file on the way is refused here,
      // before anything below it is listed.
      const ancestor = await statEntry(dataDir, stored.join('/'));
      if (ancestor?.kind !== 'directory')
        throw new ResetRefusedError(
          `the database path passes through ${stored.join('/')}, which is not a physical directory; a reset never follows links`,
        );
    }
    parent = resolve(parent, spelling);
  }
  return stored;
}

/** The directory's own spelling of `name` (the entry with the same identity), or `name` when absent. */
async function listedName(dir: string, name: string): Promise<string> {
  const identity = await identityOf(resolve(dir, name));
  if (identity === undefined) return name;
  for (const entry of await readdir(dir))
    if ((await identityOf(resolve(dir, entry))) === identity) return entry;
  return name;
}

/**
 * The directory's spelling of the lock file or guard the lock module opens as `name` in `parent`,
 * decided by filesystem facts and never by case or Unicode folding: the exact name when the
 * directory lists it; else the one listed entry with the same identity, whatever rule made the
 * volume equate the spellings (NTFS opens `οσ-1.db.graphgoblin.lock` as a listed
 * `ΟΣ-1.DB.GRAPHGOBLIN.LOCK`, whose `Σ` JavaScript lowercases to a final `ς`); else, when hard
 * links share that identity, the one the filesystem's canonical path for `name` names. A hard link
 * under another name is never taken for the lock, so it stays listed under Keeps. When the
 * filesystem does not say which listed link `name` opens, the reset refuses rather than list one
 * entry under both Removes and Keeps. Absent: `name`.
 */
async function ownershipName(
  dataDir: string,
  parent: readonly string[],
  name: string,
): Promise<string> {
  const dir = resolve(dataDir, ...parent);
  const identity = await identityOf(resolve(dir, name));
  if (identity === undefined) return name;
  const names = await readdir(dir);
  if (names.includes(name)) return name;
  const matches: string[] = [];
  for (const entry of names)
    if ((await identityOf(resolve(dir, entry))) === identity) matches.push(entry);
  if (matches.length < 2) return matches[0] ?? name;
  const canonical = basename(canonicalPath(resolve(dir, name)));
  if (matches.includes(canonical)) return canonical;
  throw new ResetRefusedError(
    `the data directory lists ${[...parent, name].join('/')} under more than one name (${matches.sort().join(', ')}), and the filesystem does not say which one the lock module opens; verify that no GraphGoblin process uses this store, then move the other names yourself`,
  );
}

/**
 * The segments of `path` below `root` when `root` is an exact prefix of the resolved path (drive
 * letter normalised, no case folding): a parent that keeps `Data` and `data` apart must never have
 * one directory's database planned against the other, a stream of the directory (`data:review`) is
 * not the directory, and a link to the data directory that appears only in the database path is
 * not the data directory either (a reset never follows links). Undefined otherwise. The segments
 * are then resolved by identity, ancestor by ancestor, by `storedSpelling`.
 */
function segmentsBelow(root: string, path: string): string[] | undefined {
  const normalise = (p: string) => (/^[a-z]:/i.test(p) ? p[0]!.toLowerCase() + p.slice(1) : p);
  const base = normalise(resolve(root));
  const target = normalise(resolve(path));
  const prefix = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(prefix) || target.length === prefix.length) return undefined;
  const rest = target.slice(prefix.length).split(sep);
  return rest.some((segment) => segment === '' || segment === '.' || segment === '..')
    ? undefined
    : rest;
}

/**
 * The reserved name (one of `names`) that the configured first segment denotes: by filesystem
 * identity when both exist, by exact spelling, or, when nothing exists yet to compare, by the
 * host's default case rule (over-refusing an absent name costs a rename; under-refusing would list
 * one entry twice once the file exists).
 */
async function reservedNameOf(
  dataDir: string,
  segment: string,
  names: ReadonlySet<string>,
): Promise<string | undefined> {
  const identity = await identityOf(resolve(dataDir, segment));
  for (const name of names) {
    if (name === segment) return name;
    if (identity !== undefined && identity === (await identityOf(resolve(dataDir, name))))
      return name;
    if (identity === undefined && nameKey(name) === nameKey(segment)) return name;
  }
  return undefined;
}
const DATABASE_PARTS = [
  ['', 'database'],
  ['-wal', 'SQLite write-ahead log'],
  ['-shm', 'SQLite shared memory'],
  ['-journal', 'SQLite rollback journal'],
] as const;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The listed names in `dir` whose entry has `identity`, without following links. */
async function namesOf(dir: string, names: readonly string[], identity: string) {
  const matches: string[] = [];
  for (const name of names)
    if ((await identityOf(resolve(dir, name))) === identity) matches.push(name);
  return matches;
}

/** Whether two entries lie under the same physical directories, root first. */
const sameRoute = (a: TreeEntry, b: TreeEntry): boolean =>
  a.ancestors.length === b.ancestors.length &&
  a.ancestors.every((ancestor, index) => ancestor.identity === b.ancestors[index]?.identity);

/**
 * The directory entry that the SQLite sidecar name `name` opens in the database's physical
 * directory `parent`, or undefined when nothing is there. A file identity is shared by every hard
 * link of the file; a directory entry is a physical parent plus a listed name, and only an entry
 * is removed. So the selection rests on directory facts, never on letter-case or Unicode folding:
 *
 * - present but not a regular file: refused with the special-file message, never resolved further
 *   (the name it shows is diagnostic only);
 * - the directory lists `name` itself: that entry, whatever other names the file has;
 * - else the one listed name in that directory with the same identity (a spelling the volume
 *   equates, such as another letter case);
 * - else, on Windows only, the listed name of the filesystem's own final path for `name` (see
 *   `nativeChoice`);
 * - otherwise refused. A chosen name other than `name` is observed again and must still be the same
 *   regular file under the same physical directories.
 */
async function sidecarEntry(
  dataDir: string,
  parent: readonly string[],
  name: string,
): Promise<TreeEntry | undefined> {
  const shown = [...parent, name].join('/');
  const requested = await statEntry(dataDir, shown);
  if (!requested) return undefined;
  const dir = resolve(dataDir, ...parent);
  const names = await readdir(dir);
  const exact = names.includes(name);
  if (requested.kind !== 'file') {
    // Only regular files are database files; a link or special file is never followed or resolved
    // by the filesystem's final path.
    const listed = exact ? [name] : await namesOf(dir, names, requested.identity);
    const path = [...parent, listed.length === 1 ? listed[0]! : name].join('/');
    throw new ResetRefusedError(
      `${path} is a ${NOUNS[requested.kind][0]}, not a database file; a reset removes only regular database files`,
    );
  }
  if (exact) return requested;
  const matches = await namesOf(dir, names, requested.identity);
  if (matches.length === 0)
    throw new ResetRefusedError(
      `${shown} is present, but the data directory lists no name for it; a reset removes only an entry the directory lists, so verify that no GraphGoblin process uses this store, then run the reset again`,
    );
  const chosen = matches.length === 1 ? matches[0]! : nativeChoice(dir, name, matches, shown);
  const entry = await statEntry(dataDir, [...parent, chosen].join('/'));
  if (
    entry?.kind !== 'file' ||
    entry.identity !== requested.identity ||
    !sameRoute(entry, requested)
  )
    throw new ResetRefusedError(
      `${shown} changed while the reset was listing it; verify that no GraphGoblin process uses this store, then run the reset again`,
    );
  return entry;
}

/**
 * Which of several listed hard links in `dir` the spelling `name` opens. Only Windows reports it:
 * the native final path of the opened name (GetFinalPathNameByHandleW) names the link that was
 * opened, with the directory's own spelling. It is taken only when it lies in the same physical
 * directory as resolved separately and names one of the listed candidates. Elsewhere, or when the
 * query fails (including a name that is gone by now) or names anything else, the reset refuses
 * rather than choose; the missing-path fallback of `canonicalPath` is never used here.
 */
function nativeChoice(
  dir: string,
  name: string,
  matches: readonly string[],
  shown: string,
): string {
  const refuse = (detail: string) =>
    new ResetRefusedError(
      `the data directory lists ${shown} under more than one name (${[...matches].sort().join(', ')}), and ${detail}; verify that no GraphGoblin process uses this store, then move the other names yourself`,
    );
  if (process.platform !== 'win32')
    throw refuse('the filesystem does not say which one SQLite opens');
  let parent: string;
  let final: string;
  try {
    parent = realpathSync.native(dir);
    final = realpathSync.native(resolve(dir, name));
  } catch (error) {
    throw refuse(`the filesystem could not say which one SQLite opens (${message(error)})`);
  }
  const chosen = basename(final);
  if (dirname(final) !== parent || !matches.includes(chosen))
    throw refuse(`the filesystem names ${final}, which is not one of them`);
  return chosen;
}

/**
 * Refuse when a selected sidecar is the same file as `other`, a name the reset owns in another
 * role: removing the sidecar under one name while owning the file under another would remove or
 * replace data the manifest does not show.
 */
function refuseShared(
  sidecars: readonly ResetTarget[],
  identity: string,
  other: string,
  role: string,
): void {
  const sidecar = sidecars.find((target) => target.entries[0]?.identity === identity);
  if (sidecar)
    throw new ResetRefusedError(
      `${sidecar.path} (${sidecar.what}) is the same file as ${other}, ${role}; a reset cannot remove a file under one name while it owns another, so verify that no GraphGoblin process uses this store, then move ${other} yourself`,
    );
}

/** What a reserved top-level name holds, for a refusal that names it. */
const RESERVED_ROLES: Record<string, string> = {
  workspaces: 'the reserved name of the run workspaces directory',
  artifacts: 'the reserved name of the artifacts directory',
  'chat-audio': 'the reserved name of the private chat audio directory',
};

/**
 * A hard link the planner proved: `kept` is another listed top-level name of the regular file
 * whose sidecar entry `removed` the reset removes, a distinct entry with the same identity. The
 * manifest check allows exactly these pairs to share an identity across Removes and Keeps.
 */
interface SidecarLink {
  removed: string;
  kept: string;
  identity: string;
}

export interface PlanResetOptions {
  /** Physical data directory. */
  dataDir: string;
  /** Database file relative to the data directory, `/` separated. */
  database: string;
  readStore: (databaseFile: string) => Promise<StoreFacts>;
  /**
   * The caller holds both locks: a reclamation guard present now is listed under Keeps as present,
   * and the reset leaves it. The listing cannot show who published it, so the row never says.
   * Otherwise a present lock or guard is one the reset would reclaim.
   */
  locked?: boolean;
}

/** Read-only: what a reset of this data directory would remove, and what it keeps. */
export async function planReset({
  dataDir,
  database,
  readStore,
  locked = false,
}: PlanResetOptions): Promise<ResetPlan> {
  // The path is first spelled as the directory lists it, by filesystem identity, with every
  // ancestor checked to be a physical directory before it is entered; the later checks compare
  // those spellings and identities.
  const segments = await storedSpelling(dataDir, database);
  const stored = segments.join('/');
  // The database must be reached without links, or its files could live outside the directory.
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = await statEntry(dataDir, segments.slice(0, depth).join('/'));
    if (ancestor && ancestor.kind !== 'directory')
      throw new ResetRefusedError(
        `the database path passes through ${ancestor.path}, which is not a physical directory; a reset never follows links`,
      );
  }
  // The reset owns artifacts/, chat-audio/, workspaces/ and the lock files. A database that is one
  // of them, or inside one of them, would be listed twice or under both Removes and Keeps, so the
  // configuration is refused before anything is listed.
  const root = segments[0] ?? '';
  const reservedRoot = await reservedNameOf(dataDir, root, RESERVED_ROOTS);
  if (reservedRoot !== undefined)
    throw new ResetRefusedError(
      segments.length > 1
        ? `the database ${database} is inside ${reservedRoot}/, which a reset removes; move it first`
        : `the database ${database} has the name of the ${reservedRoot} directory, which a reset removes; rename it first`,
    );
  if (segments.length === 1 && (await reservedNameOf(dataDir, stored, LOCK_FILES)) !== undefined)
    throw new ResetRefusedError(
      `the database ${database} has the name of the reset's lock file; rename it first`,
    );
  const databaseTargets: ResetTarget[] = [];
  const sidecars: ResetTarget[] = [];
  const databaseParent = segments.slice(0, -1);
  const storedName = segments.at(-1)!;
  // The writer passes the configured path to SQLite, which derives its sidecar names from that
  // spelling; the reset and its store reader use the stored one.
  const configuredName = database.split('/').at(-1)!;
  for (const [suffix, what] of DATABASE_PARTS) {
    // The database is its stored spelling, which the resolution above found as the one listed
    // name of its file; each sidecar is the directory entry its name opens (`sidecarEntry`).
    const entry =
      suffix === ''
        ? await statEntry(dataDir, stored)
        : await sidecarEntry(dataDir, databaseParent, storedName + suffix);
    if (suffix !== '' && configuredName !== storedName) {
      // Both spellings are resolved in the same physical directory and must name one entry, or
      // none, before the store is read: otherwise the store reader could borrow the wrong file and
      // the reset could remove one while the writer's stays.
      const writer = await sidecarEntry(dataDir, databaseParent, configuredName + suffix);
      if (writer?.path !== entry?.path) {
        const found = (spelling: string, listed: TreeEntry | undefined) =>
          `${[...databaseParent, spelling].join('/')} names ${listed ? `the listed entry ${listed.path}` : 'no entry'}`;
        throw new ResetRefusedError(
          `the database is configured as ${configuredName} but listed as ${storedName}, and ${found(configuredName + suffix, writer)} while ${found(storedName + suffix, entry)}; a reset cannot tell which ${what} belongs to this store, so configure GG_DB_URL with the name as the directory lists it`,
        );
      }
    }
    if (!entry) continue;
    // Only a regular file: a directory, a link, a FIFO, a socket or a device is never a database
    // file, and reading the store from one could block or remove something that was never data.
    if (entry.kind !== 'file')
      throw new ResetRefusedError(
        `${entry.path} is a ${NOUNS[entry.kind][0]}, not a database file; a reset removes only regular database files`,
      );
    const target: ResetTarget = { path: entry.path, what, entries: [entry] };
    databaseTargets.push(target);
    if (suffix !== '') sidecars.push(target);
  }
  const store: ResetPlan['store'] =
    databaseTargets[0]?.path === stored
      ? await readStore(resolve(dataDir, ...segments))
      : { readable: false, reason: 'there is no database file', absent: true };
  // Removal order: the run workspaces, artifacts and private audio first and the database last,
  // so a reset that stops part of the way still has the run IDs it needs when it is run again.
  const targets: ResetTarget[] = [];
  const kept: KeptEntry[] = [];
  // The reserved directories are named as the directory lists them (`Artifacts` on a volume that
  // folds case), so the manifest shows the stored spelling.
  const workspacesName = await listedName(dataDir, 'workspaces');
  const workspaces = await statEntry(dataDir, workspacesName);
  if (workspaces?.kind === 'directory') {
    const runIds = new Set(store.readable ? store.runIds : []);
    for (const name of (await readdir(resolve(dataDir, workspacesName))).sort()) {
      const path = workspacesName + '/' + name;
      if (runIds.has(name))
        targets.push({ path, what: 'run workspace', entries: await listEntry(dataDir, path) });
      else
        kept.push({
          path,
          why: store.readable
            ? 'not a stored run ID'
            : 'absent' in store
              ? 'no database to match run IDs against'
              : 'the store could not be read to match run IDs',
          identity: (await statEntry(dataDir, path))?.identity,
        });
    }
  } else if (workspaces)
    kept.push({
      path: workspacesName,
      why:
        workspaces.kind === 'link'
          ? 'a link; a reset never follows links'
          : `a ${NOUNS[workspaces.kind][0]}, not a directory`,
      identity: workspaces.identity,
    });
  // Only physical directories are store-owned; a file or link at a reserved root is kept.
  for (const [name, what] of OWNED_DIRECTORIES) {
    const path = await listedName(dataDir, name);
    const entry = await statEntry(dataDir, path);
    if (entry?.kind === 'directory')
      targets.push({ path, what, entries: await listEntry(dataDir, path) });
    else if (entry)
      kept.push({
        path,
        why:
          entry.kind === 'link'
            ? 'a link; a reset never follows links'
            : `a ${NOUNS[entry.kind][0]}, not a directory`,
        identity: entry.identity,
      });
  }
  targets.push(...databaseTargets);
  // Everything else at the top level is kept. The reserved directories and the database are owned
  // by identity, so an `Artifacts` directory on a case-insensitive volume is never listed under
  // Keeps while its entries are removed. A sidecar is owned by its listed name only: another hard
  // link of it is a separate entry, kept below. A sidecar that is also a name the reset owns in
  // another role is refused before that name can hide it.
  const owned = new Set<string>();
  for (const name of RESERVED_ROOTS) {
    owned.add(name);
    const identity = await identityOf(resolve(dataDir, name));
    if (identity === undefined) continue;
    refuseShared(sidecars, identity, name, RESERVED_ROLES[name]!);
    owned.add(identity);
  }
  // The locks a confirmed reset takes, where the lock module keeps them: the database lock beside
  // the database (in its subdirectory, when it has one) and the data-directory lock at the root,
  // each with its `.reclaim` guard. Listed after the store read, so a guard created meanwhile is
  // seen; the lock module reads only regular lock files and directory guards.
  const ownership: OwnershipEntry[] = [];
  const locks: [LockRole, string[], string][] = [
    ['database lock', segments.slice(0, -1), databaseLockFileName(segments.at(-1)!)],
    ['data-directory lock', [], DATA_DIR_LOCK_FILE],
  ];
  for (const [role, parent, lockName] of locks)
    for (const guard of [true, false]) {
      const name = await ownershipName(
        dataDir,
        parent,
        guard ? lockName + RECLAIM_GUARD_SUFFIX : lockName,
      );
      const path = [...parent, name].join('/');
      const entry = await statEntry(dataDir, path);
      if (entry && entry.kind !== (guard ? 'directory' : 'file'))
        throw new ResetRefusedError(
          `${path} is a ${NOUNS[entry.kind][0]}, not ${guard ? 'a lock reclamation guard directory' : 'a lock file'}; verify that no GraphGoblin process uses this store, then move it yourself`,
        );
      // Taking a lock replaces a stale lock file and releasing it removes the file, so a sidecar
      // under a lock name would be changed by the locks rather than by the manifest.
      if (entry)
        refuseShared(sidecars, entry.identity, path, `the ${role}${guard ? ' guard' : ''}`);
      ownership.push({ path, role, guard, present: entry !== undefined });
      if (parent.length === 0) owned.add(name);
      if (entry && guard && locked)
        kept.push({
          path,
          why: `${role} guard, present now; the reset leaves it`,
          identity: entry.identity,
        });
    }
  if (segments.length > 1) {
    owned.add(root);
    const identity = await identityOf(resolve(dataDir, root));
    if (identity !== undefined) owned.add(identity);
  } else
    for (const target of databaseTargets)
      for (const entry of target.entries) {
        owned.add(entry.path);
        // The database's spelling resolution refused any other listed name of its file.
        if (!sidecars.includes(target)) owned.add(entry.identity);
      }
  const links: SidecarLink[] = [];
  for (const name of (await readdir(dataDir)).sort()) {
    const identity = await identityOf(resolve(dataDir, name));
    if (owned.has(name) || (identity !== undefined && owned.has(identity))) continue;
    // Another listed name of a removed sidecar's file, at the top level or above a nested database:
    // a distinct entry (another name in the same directory, or another physical directory) that
    // the reset keeps. Anything less certain is left to the manifest check, which refuses it.
    const sidecar = sidecars.find((target) => target.entries[0]?.identity === identity);
    const removed = sidecar?.entries[0];
    const other = removed && (await statEntry(dataDir, name));
    if (
      removed &&
      other?.kind === 'file' &&
      other.identity === removed.identity &&
      (other.path !== removed.path ||
        other.ancestors.at(-1)?.identity !== removed.ancestors.at(-1)?.identity)
    ) {
      links.push({ removed: removed.path, kept: name, identity: removed.identity });
      kept.push({
        path: name,
        why: `another name for ${removed.path}; the file stays under this name`,
        identity,
      });
      continue;
    }
    kept.push({
      path: name,
      why:
        name === 'master.key' || nameKey(name) === 'master.key'
          ? 'secret-store key; kept so the secrets in a backup of this store stay readable'
          : 'not part of the store',
      identity,
    });
  }
  kept.sort((a, b) => (a.path < b.path ? -1 : 1));
  checkManifest(targets, kept, links);
  return { dataDir, database: stored, store, targets, kept, ownership };
}

/**
 * A manifest names every entry once and never both removes and keeps one; a reset that could
 * remove an entry twice would stop part of the way, and one that keeps what it removes would lie.
 * Entries are compared by path, and by filesystem identity when both sides carry one. This exported
 * check has no exception. `planReset` ends with the same check plus its proved sidecar links; the
 * refusals before it name the cause where they can, and one file reached as two removed entries
 * (a sidecar hard-linked into a removed directory) is refused only by that final check.
 */
export function assertDisjointManifest(
  targets: readonly ResetTarget[],
  kept: readonly KeptEntry[],
): void {
  checkManifest(targets, kept, []);
}

/**
 * The manifest check `planReset` runs. Removed entries never repeat a path or an identity, and a
 * kept path is never a removed one. A kept identity may equal a removed one only as a planned
 * `SidecarLink`: that exact kept name, the one removed entry with that identity being its sidecar.
 */
function checkManifest(
  targets: readonly ResetTarget[],
  kept: readonly KeptEntry[],
  links: readonly SidecarLink[],
): void {
  const removedPaths = new Set<string>();
  const removedIdentities = new Map<string, string>();
  for (const target of targets)
    for (const entry of target.entries) {
      if (removedPaths.has(entry.path) || removedIdentities.has(entry.identity))
        throw new ResetRefusedError(`the manifest would list ${entry.path} twice`);
      removedPaths.add(entry.path);
      removedIdentities.set(entry.identity, entry.path);
    }
  for (const entry of kept) {
    if (removedPaths.has(entry.path))
      throw new ResetRefusedError(`the manifest would both remove and keep ${entry.path}`);
    if (entry.identity === undefined) continue;
    const removed = removedIdentities.get(entry.identity);
    if (
      removed !== undefined &&
      !links.some(
        (link) =>
          link.kept === entry.path && link.identity === entry.identity && link.removed === removed,
      )
    )
      throw new ResetRefusedError(`the manifest would both remove and keep ${entry.path}`);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]!}`;
}

const NOUNS: Record<TreeEntry['kind'], [string, string]> = {
  file: ['file', 'files'],
  directory: ['directory', 'directories'],
  link: ['link', 'links'],
  other: ['special file', 'special files'],
};

function counts(entries: readonly TreeEntry[]): string {
  const parts: string[] = [];
  for (const kind of ['file', 'directory', 'link', 'other'] as const) {
    const count = entries.filter((entry) => entry.kind === kind).length;
    if (count || kind === 'file')
      parts.push(`${String(count)} ${NOUNS[kind][count === 1 ? 0 : 1]}`);
  }
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return `${parts.join(', ')}, ${formatBytes(bytes)}`;
}

function describeStore(store: ResetPlan['store']): string {
  if (!store.readable)
    return 'absent' in store ? 'no database file' : `unreadable: ${store.reason}`;
  if (store.format === undefined) return 'no format marker (an older build wrote it)';
  if (store.format !== CURRENT_DEFINITION_FORMAT)
    return `format ${String(store.format)}; this build requires format ${String(CURRENT_DEFINITION_FORMAT)}`;
  return store.status === 'complete'
    ? `format ${String(store.format)}, the current format`
    : `format ${String(store.format)}, unfinished (status ${JSON.stringify(store.status)})`;
}

/** Aligned manifest columns; a run workspace path (`workspaces/<26-character ULID>`) fits. */
function columns(left: string, middle: string, right = ''): string {
  return `  ${left.padEnd(38)} ${middle.padEnd(24)} ${right}`.trimEnd();
}

/** A lock the confirmed reset took; `lock.reclaimed` is what taking it removed itself. */
export interface HeldLock {
  role: LockRole;
  lock: DataDirLock;
}

/** What a manifest is printed for: a dry run, or a confirmed reset holding both locks. */
export type ManifestStage =
  | { dryRun: true; configured: string }
  | { dryRun: false; configured: string; preview: ResetPlan; held: readonly HeldLock[] };

/**
 * The Removes rows for the reset's locks. A dry run takes no lock: a lock file or guard it finds is
 * stale (a held one refuses the reset), and taking that lock is what would reclaim it. A confirmed
 * reset says it reclaimed an entry only when the lock module reports that taking the lock removed
 * it. A stale entry its read-only preview found is otherwise reported as already gone when the lock
 * was taken: the preview cannot show who removed it.
 */
function ownershipRows(plan: ResetPlan, stage: ManifestStage): string[] {
  const rows: string[] = [];
  const before = stage.dryRun ? plan : stage.preview;
  for (const role of ['database lock', 'data-directory lock'] as const) {
    const found = (guard: boolean) =>
      before.ownership.find((entry) => entry.role === role && entry.guard === guard)!;
    const taken = stage.dryRun
      ? undefined
      : stage.held.find((held) => held.role === role)!.lock.reclaimed;
    const guard = found(true);
    if (taken?.guard || guard.present)
      rows.push(
        columns(
          guard.path,
          'stale lock guard',
          taken === undefined
            ? `reclaimed when the reset takes the ${role}`
            : taken.guard
              ? `reclaimed when the reset took the ${role}`
              : `already gone when the reset took the ${role}`,
        ),
      );
    const release = role === 'database lock' ? 'removed on release' : 'removed last, on release';
    const lock = plan.ownership.find((entry) => entry.role === role && !entry.guard)!;
    const stale = found(false).present;
    rows.push(
      columns(
        lock.path,
        role,
        taken === undefined
          ? stale
            ? `stale; replaced by the reset's own, ${release}`
            : `the reset's own; ${release}`
          : taken.file
            ? `the reset's own, replacing a stale one; ${release}`
            : stale
              ? `the reset's own; the stale one was already gone when the reset took the ${role}; ${release}`
              : `the reset's own; ${release}`,
      ),
    );
  }
  return rows;
}

/**
 * The bounded manifest: every target and kept entry up to the limit, the reset's locks, then totals.
 * A confirmed reset passes its preview and held locks, so the lock rows say what taking each lock
 * reclaimed and which stale entries the preview found were already gone.
 */
export function formatPlan(plan: ResetPlan, options: ManifestStage) {
  const lines = [
    options.dryRun ? 'GraphGoblin reset (dry run: nothing is removed)' : 'GraphGoblin reset',
    '',
    `Data directory: ${options.configured}${options.configured === plan.dataDir ? '' : ` (physical path ${plan.dataDir})`}`,
    `Database:       ${resolve(options.configured, plan.database)} (${describeStore(plan.store)})`,
    '',
    'Removes:',
  ];
  const shown = plan.targets.slice(0, MANIFEST_LIST_LIMIT);
  for (const target of shown) lines.push(columns(target.path, target.what, counts(target.entries)));
  const hidden = plan.targets.slice(MANIFEST_LIST_LIMIT);
  if (hidden.length)
    lines.push(
      `  ... and ${String(hidden.length)} more: ${counts(hidden.flatMap((target) => target.entries))}`,
    );
  if (!plan.targets.length) lines.push('  no store data');
  lines.push(...ownershipRows(plan, options));
  lines.push('', 'Keeps:');
  for (const entry of plan.kept.slice(0, MANIFEST_LIST_LIMIT))
    lines.push(columns(entry.path, entry.why));
  if (plan.kept.length > MANIFEST_LIST_LIMIT)
    lines.push(`  ... and ${String(plan.kept.length - MANIFEST_LIST_LIMIT)} more entries`);
  if (!plan.kept.length) lines.push('  nothing else is in the data directory');
  lines.push(
    '  Browser device drafts stay in each browser; discard them from the loop editor.',
    '',
    `Total removed: ${counts(plan.targets.flatMap((target) => target.entries))} in ${String(plan.targets.length)} item${plan.targets.length === 1 ? '' : 's'}.`,
    '',
    '',
  );
  return lines.join('\n');
}

function listed(targets: readonly ResetTarget[]): string {
  if (!targets.length) return 'nothing';
  const names = targets.slice(0, MANIFEST_LIST_LIMIT).map((target) => target.path);
  const more = targets.length - names.length;
  return names.join(', ') + (more ? `, and ${String(more)} more` : '');
}

/** Remove the plan's targets in order, reporting each. Throws ResetIncompleteError on a failure. */
export async function executeReset(plan: ResetPlan, write: (text: string) => void): Promise<void> {
  for (const [index, target] of plan.targets.entries()) {
    let removed = 0;
    try {
      for (const entry of target.entries) {
        await removeEntry(plan.dataDir, entry);
        removed += 1;
      }
    } catch (error) {
      throw new ResetIncompleteError(
        [
          `Reset stopped: could not remove ${target.entries[removed]!.path}: ${message(error)}`,
          `  Removed:        ${listed(plan.targets.slice(0, index))}`,
          `  Partly removed: ${target.path} (${String(removed)} of ${String(target.entries.length)} entries)`,
          `  Not removed:    ${listed(plan.targets.slice(index + 1))}`,
        ].join('\n'),
      );
    }
    write(`  removed ${target.path} (${counts(target.entries)})\n`);
  }
}

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Two paths name one physical directory when both resolve to directories with one identity,
 * whatever the spelling; a stream or file that shares a directory's identity is not that directory.
 * When neither exists there is nothing a reset could remove, and the resolved spellings decide only
 * which message the caller sees.
 */
async function sameDirectory(a: string, b: string): Promise<boolean> {
  const [first, second] = [await physicalPath(a), await physicalPath(b)];
  const [firstId, secondId] = [await identityOf(first), await identityOf(second)];
  if (firstId !== undefined || secondId !== undefined) {
    if (firstId !== secondId) return false;
    const isDirectory = async (path: string) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    };
    return (await isDirectory(first)) && (await isDirectory(second));
  }
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

export interface ResetIo {
  write: (text: string) => void;
  readStore: (databaseFile: string) => Promise<StoreFacts>;
}

const describeOwnership = (entry: OwnershipEntry): string =>
  `${entry.path} (${entry.guard ? `${entry.role} guard` : entry.role})`;

const RELEASED: Record<ReleaseOutcome, (name: string) => string> = {
  removed: (name) => `removed ${name}`,
  missing: (name) => `${name} was already gone`,
  kept: (name) => `kept ${name}: it holds another process's record`,
};

/**
 * Release the held locks, the database lock first and the data-directory lock last, attempting
 * each even when another fails: one line per lock, saying what its release did to its file.
 */
async function releaseLocks(held: readonly HeldLock[], ownership: readonly OwnershipEntry[]) {
  const lines: string[] = [];
  let failed = false;
  let allRemoved = true;
  for (const { role, lock } of [...held].reverse()) {
    const name = describeOwnership(ownership.find((entry) => entry.role === role && !entry.guard)!);
    try {
      const outcome = await lock.release();
      if (outcome !== 'removed') allRemoved = false;
      lines.push(RELEASED[outcome](name));
    } catch (error) {
      failed = true;
      allRemoved = false;
      lines.push(`could not remove ${name}: ${message(error)}`);
    }
  }
  return { lines, failed, allRemoved };
}

/**
 * For each lock the reset took, the stale lock file and guard that taking it removed, as the lock
 * module reports, and those the preview found that were already gone when it was taken. Absence
 * after a snapshot never counts as this reset's reclamation: the preview cannot show who removed it.
 */
function reclaimedLines(preview: ResetPlan, held: readonly HeldLock[]): string[] {
  const lines: string[] = [];
  for (const entry of preview.ownership) {
    const taken = held.find(({ role }) => role === entry.role)?.lock.reclaimed;
    if (!taken) continue;
    if (entry.guard ? taken.guard : taken.file)
      lines.push(`reclaimed stale ${describeOwnership(entry)}`);
    else if (entry.present)
      lines.push(
        `${describeOwnership(entry)}: stale in the preview, already gone when the reset took that lock`,
      );
  }
  return lines;
}

/** Whether an entry exists, or why it could not be inspected. */
type Presence = 'present' | 'absent' | { uninspectable: string };

interface ObservedEntry {
  entry: OwnershipEntry;
  presence: Presence;
}

/**
 * The guard and lock file of `role` where the preview names them, as they are now. Read-only. An
 * inspection failure is reported by its own message, with no advice to move or remove the entry.
 */
async function observeLock(preview: ResetPlan, role: LockRole): Promise<ObservedEntry[]> {
  const observed: ObservedEntry[] = [];
  for (const entry of preview.ownership.filter((candidate) => candidate.role === role)) {
    let presence: Presence;
    try {
      await lstat(resolve(preview.dataDir, ...entry.path.split('/')));
      presence = 'present';
    } catch (error) {
      presence =
        hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')
          ? 'absent'
          : { uninspectable: message(error) };
    }
    observed.push({ entry, presence });
  }
  return observed;
}

const presenceText = (presence: Presence, when: string): string =>
  typeof presence === 'string'
    ? `${presence} ${when}`
    : `could not be inspected ${when} (${presence.uninspectable})`;

/**
 * After taking a lock failed: its guard and lock file as found now and just before the attempt.
 * Presence only; no line says who created or removed an entry, or that it is the same entry.
 */
function attemptLines(before: readonly ObservedEntry[], after: readonly ObservedEntry[]): string[] {
  return after.map(({ entry, presence: now }, index) => {
    const then = before[index]!.presence;
    return `${describeOwnership(entry)}: ${
      typeof now === 'string' && now === then
        ? `${now} now and before the attempt`
        : `${presenceText(now, 'now')}, ${presenceText(then, 'before the attempt')}`
    }`;
  });
}

/** Plan (and, confirmed, perform) the reset of the configured data directory. Returns the exit code. */
export async function resetDataDirectory(
  config: Pick<ApiConfig, 'dataDir' | 'dbUrl'>,
  args: ResetArgs,
  io: ResetIo,
): Promise<number> {
  const configured = resolve(config.dataDir);
  if (args.dataDir !== undefined && !(await sameDirectory(args.dataDir, configured)))
    throw new ResetRefusedError(
      `--data-dir names ${resolve(args.dataDir)}, but this environment's data directory is ${configured} (GG_DATA_DIR, or ~/.graphgoblin when it is unset); run the reset with the environment that serves that directory`,
    );
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(configured)).isDirectory();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      io.write(`Nothing to reset: ${configured} does not exist.\n`);
      return 0;
    }
    throw error;
  }
  if (!isDirectory) throw new ResetRefusedError(`${configured} is not a directory`);
  const databaseFile = databaseFilePath(config.dbUrl);
  if (!databaseFile)
    throw new ResetRefusedError(
      'GG_DB_URL does not name a local database file; a reset removes only files inside the data directory',
    );
  const dataDir = await realpath(configured);
  // Under the configured spelling or under the physical directory, compared exactly.
  const segments = segmentsBelow(configured, databaseFile) ?? segmentsBelow(dataDir, databaseFile);
  if (!segments)
    throw new ResetRefusedError(
      `the database ${databaseFile} is outside the data directory ${configured}; a reset removes only paths inside it, so remove that database yourself or point GG_DB_URL inside the data directory`,
    );
  const database = segments.join('/');
  // Validate the locks and preview read-only before touching even a stale lock. The fresh plan
  // can still refuse after acquisition; in that case the reset releases its own locks.
  const refuseHeld = (state: Awaited<ReturnType<typeof dataDirLockState>>): void => {
    if (state.state === 'held')
      throw new ResetRefusedError(
        `${state.detail}: ${state.path}; verify ownership before resetting`,
      );
  };
  refuseHeld(await dataDirLockState(dataDir));
  const preview = await planReset({
    dataDir,
    database,
    readStore: async (file) => {
      // The plan first validates the physical ancestors and regular file without following
      // links. Preserve that refusal guidance before canonical ownership lookup or store reads.
      refuseHeld(await databaseLockState(file));
      return io.readStore(file);
    },
  });
  // A missing database never invokes readStore, but a live creator may already own its sidecar.
  // Both locks are checked again after the listing, so a lock file or guard it lists was not held.
  refuseHeld(await databaseLockState(databaseFile));
  refuseHeld(await dataDirLockState(dataDir));
  if (!args.confirmed) {
    io.write(formatPlan(preview, { dryRun: true, configured }));
    io.write(
      [
        'Nothing was removed. To reset, stop every GraphGoblin process using this data directory and run:',
        `  ${RESET_COMMAND} --yes ${dataDirArgument(configured)}`,
        '',
      ].join('\n'),
    );
    return 0;
  }
  // Taking a lock reclaims a stale lock file or guard, and the lock module reports which ones that
  // acquisition removed itself; a stale entry the preview listed may instead have been removed by
  // another process first. From here a refusal says which were reclaimed or already gone and how
  // each held lock was released, instead of that nothing changed. An attempt that throws may
  // itself have created, reclaimed or left that lock's entries, so its guard and lock file are
  // observed just before each attempt and again after a failure.
  const held: HeldLock[] = [];
  let attempt: { role: LockRole; before: ObservedEntry[] } | undefined;
  let plan: ResetPlan | undefined;
  let failure: unknown;
  try {
    for (const role of ['data-directory lock', 'database lock'] as const) {
      attempt = { role, before: await observeLock(preview, role) };
      try {
        held.push({
          role,
          lock:
            role === 'data-directory lock'
              ? await acquireDataDirLock(dataDir)
              : await acquireDatabaseLock(databaseFile),
        });
      } catch (error) {
        throw new ResetRefusedError(`could not take the ${role}: ${message(error)}`);
      }
      attempt = undefined;
    }
    // Plan again under the locks, so GraphGoblin cannot change the manifest concurrently. External
    // processes do not obey them; removeEntry rechecks the planned filesystem identities.
    const lockedPlan = await planReset({
      dataDir,
      database,
      readStore: io.readStore,
      locked: true,
    });
    plan = lockedPlan;
    // Never discard the run IDs after a transient reader failure or keep a workspace that the
    // preview identified for removal. Refuse before executing any target, so a retry can still
    // identify those workspaces. A store unreadable in both plans retains the damaged-store reset.
    if (preview.store.readable && !lockedPlan.store.readable)
      throw new ResetRefusedError(
        `the store was readable in the preview but could not be read under the data-directory lock (${lockedPlan.store.reason}); run the reset again before removing the database or run workspaces`,
      );
    const newlyKept = preview.targets.find(
      (target) =>
        target.what === 'run workspace' &&
        lockedPlan.kept.some(
          (entry) => entry.path === target.path || target.path.startsWith(entry.path + '/'),
        ),
    );
    if (newlyKept)
      throw new ResetRefusedError(
        `${newlyKept.path} was a run workspace in the preview but would be kept by the plan under the data-directory lock; run the reset again before removing its database`,
      );
    io.write(formatPlan(lockedPlan, { dryRun: false, configured, preview, held }));
    io.write('Removing:\n');
    try {
      await executeReset(lockedPlan, io.write);
    } catch (error) {
      failure = error;
    }
  } catch (error) {
    // Refused before any store data was removed: a lock could not be taken, or the store changed
    // after the preview. The failed lock's entries are observed before any held lock is released.
    const observed =
      attempt && attemptLines(attempt.before, await observeLock(preview, attempt.role));
    const released = await releaseLocks(held, (plan ?? preview).ownership);
    const reclaimed = reclaimedLines(preview, held);
    const lines = [...(observed ?? []), ...reclaimed, ...released.lines];
    throw new ResetRefusedError(
      message(error),
      attempt
        ? { kind: 'uncertain', failed: attempt.role, lines }
        : reclaimed.length || !released.allRemoved
          ? { kind: 'changed', lines }
          : UNCHANGED,
    );
  }
  const released = await releaseLocks(held, plan.ownership);
  if (failure || released.failed)
    throw new ResetIncompleteError(
      [
        failure
          ? message(failure)
          : 'Reset stopped: every listed item was removed, but not every lock file was released:',
        ...released.lines.map((line) => `  ${line}`),
        ...(failure
          ? [
              'Do not start GraphGoblin on this data directory until the reset finishes: fix the cause and run the reset again; it lists and removes what is left.',
            ]
          : []),
      ].join('\n'),
    );
  io.write(
    [
      ...released.lines.map((line) => `  ${line}`),
      `Reset complete. The next start creates a new, empty format-${String(CURRENT_DEFINITION_FORMAT)} store in ${configured}.`,
      '',
    ].join('\n'),
  );
  return 0;
}

export interface ResetCliOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
  writeError?: (text: string) => void;
  /** Reads the store's format marker and run IDs; default: a child process reads a private copy. */
  readStore?: (databaseFile: string) => Promise<StoreFacts>;
}

/** Run the command; returns the process exit code (0 done, 1 refused or incomplete, 2 usage). */
export async function runResetCli(options: ResetCliOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(text));
  const args = parseResetArgs(options.argv ?? process.argv.slice(2));
  if (typeof args === 'string') {
    writeError(`${args}\n${RESET_USAGE}\n`);
    return 2;
  }
  let config: ApiConfig;
  try {
    config = loadConfig(options.env ?? process.env);
  } catch (error) {
    writeError(`reset refused: ${message(error)}\nNothing in the data directory was changed.\n`);
    return 1;
  }
  try {
    await cleanupStaleStoreCopies();
    return await resetDataDirectory(config, args, {
      write,
      readStore: options.readStore ?? ((file) => readStoreFacts(file)),
    });
  } catch (error) {
    if (error instanceof ResetIncompleteError) {
      writeError(`${error.message}\n`);
      return 1;
    }
    writeError(
      `reset refused: ${message(error)}\n${effectText(error instanceof ResetRefusedError ? error.ownership : UNCHANGED)}`,
    );
    return 1;
  }
}

/** What a refusal says about the data directory: store data first, then the lock metadata. */
function effectText(effect: OwnershipEffect): string {
  if (effect.kind === 'unchanged') return 'Nothing in the data directory was changed.\n';
  const head =
    effect.kind === 'changed'
      ? 'No store data was removed. Lock files and guards:'
      : `No store data was removed. Taking the ${effect.failed} failed, and the attempt may have created, reclaimed or left that lock's file, guard or guard staging directory. Lock files and guards:`;
  return [head, ...effect.lines.map((line) => `  ${line}`), ''].join('\n');
}
