import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { databaseFilePath } from '@graphgoblin/infrastructure/sqlite';
import { loadConfig, type ApiConfig } from '../config.js';
import { acquireDataDirLock, dataDirLockState, type DataDirLock } from '../data-dir-lock.js';
import { dataDirArgument, RESET_COMMAND } from '../store-refusal.js';
import { readStoreFacts, type StoreFacts } from './store-facts.js';
import { hasCode, isInside, listEntry, removeEntry, statEntry, type TreeEntry } from './tree.js';

/**
 * `graphgoblin-api --reset` (ADR-0042): the explicit fresh start for a pre-1.0 store this build
 * cannot open. Without `--yes` it only lists what a reset would remove (a dry run, which reads and
 * changes nothing). With `--yes --data-dir <path>` naming the configured data directory it takes
 * the data-directory lock, lists the same manifest and removes exactly that: the database and its
 * SQLite sidecars, the artifact directory, and the run workspaces whose names are stored run IDs,
 * then the lock file last. It never follows links, never removes anything outside the data
 * directory, and keeps `master.key` and every other entry. Browser device drafts live in each
 * browser and are discarded from the editor.
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
}

export interface ResetPlan {
  /** Physical path of the data directory; every target is inside it. */
  dataDir: string;
  /** The configured database file, relative to the data directory, spelled as the directory lists it. */
  database: string;
  store: StoreFacts | { readable: false; reason: string; absent: true };
  targets: ResetTarget[];
  kept: KeptEntry[];
}

/** Refused before anything was removed. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetRefusedError';
  }
}

/** Removal stopped part of the way; the message says exactly what was and was not removed. */
export class ResetIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetIncompleteError';
  }
}

const LOCK_FILES = new Set(['graphgoblin.lock', 'graphgoblin.lock.reclaim']);
/** Directories a reset removes by name; a database may not be named like one or live inside one. */
const RESERVED_ROOTS = new Set(['artifacts', 'workspaces']);

/**
 * Names are compared the way the filesystem compares them. Windows and macOS volumes are
 * case-insensitive by default, so `ARTIFACTS` and `artifacts` are one entry there and a database
 * configured as `GRAPHGOBLIN.DB` is the stored `graphgoblin.db`. Over-refusing on a case-sensitive
 * macOS volume costs a rename; under-refusing would list one entry twice or both remove and keep it.
 */
export const CASE_INSENSITIVE_NAMES = process.platform === 'win32' || process.platform === 'darwin';

/** The comparison key of a path or name under the host's case rule. */
export function nameKey(path: string, caseInsensitive = CASE_INSENSITIVE_NAMES): string {
  return caseInsensitive ? path.toLowerCase() : path;
}

/**
 * The configured database path, segment by segment, as the data directory lists it. A segment that
 * matches a listed entry under the host's case rule takes that entry's spelling, so the manifest
 * names what the directory shows. A segment that names an existing entry under a spelling the
 * listing does not show (an NTFS short name such as `ARTIFA~1` or `GRAPHG~1.DB`) is refused:
 * every check here compares names, and an alias would slip past them. Segments below the deepest
 * existing entry are kept as configured; nothing exists there to alias.
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
    let names: string[];
    try {
      names = await readdir(parent);
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR'))
        return [...stored, ...configured.slice(index)];
      throw error;
    }
    const match = names.find((name) => nameKey(name) === nameKey(segment));
    if (match === undefined) {
      try {
        await lstat(resolve(parent, segment));
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return [...stored, ...configured.slice(index)];
        throw error;
      }
      throw new ResetRefusedError(
        `the database path ${database} names ${segment} by a spelling the data directory does not list (a Windows short name, for example); configure GG_DB_URL with the name as the directory lists it`,
      );
    }
    stored.push(match);
    parent = resolve(parent, match);
  }
  return stored;
}
const DATABASE_PARTS = [
  ['', 'database'],
  ['-wal', 'SQLite write-ahead log'],
  ['-shm', 'SQLite shared memory'],
  ['-journal', 'SQLite rollback journal'],
] as const;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface PlanResetOptions {
  /** Physical data directory. */
  dataDir: string;
  /** Database file relative to the data directory, `/` separated. */
  database: string;
  readStore: (databaseFile: string) => Promise<StoreFacts>;
}

/** Read-only: what a reset of this data directory would remove, and what it keeps. */
export async function planReset({
  dataDir,
  database,
  readStore,
}: PlanResetOptions): Promise<ResetPlan> {
  // Every later check compares names, so the path is first spelled as the directory lists it (an
  // alias the listing does not show is refused there).
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
  // The reset owns artifacts/, workspaces/ and the lock files by name. A database named like one of
  // them, or inside one of them, would be listed twice or under both Removes and Keeps, so the
  // configuration is refused before anything is listed.
  const root = segments[0] ?? '';
  if (RESERVED_ROOTS.has(nameKey(root)))
    throw new ResetRefusedError(
      segments.length > 1
        ? `the database ${database} is inside ${nameKey(root)}/, which a reset removes; move it first`
        : `the database ${database} has the name of the ${nameKey(root)} directory, which a reset removes; rename it first`,
    );
  if (segments.length === 1 && LOCK_FILES.has(nameKey(stored)))
    throw new ResetRefusedError(
      `the database ${database} has the name of the reset's lock file; rename it first`,
    );
  const databaseTargets: ResetTarget[] = [];
  for (const [suffix, what] of DATABASE_PARTS) {
    const entry = await statEntry(dataDir, stored + suffix);
    if (!entry) continue;
    // Only a regular file: a directory, a link, a FIFO, a socket or a device is never a database
    // file, and reading the store from one could block or remove something that was never data.
    if (entry.kind !== 'file')
      throw new ResetRefusedError(
        `${entry.path} is a ${NOUNS[entry.kind][0]}, not a database file; a reset removes only regular database files`,
      );
    databaseTargets.push({ path: entry.path, what, entries: [entry] });
  }
  const store: ResetPlan['store'] =
    databaseTargets[0]?.path === stored
      ? await readStore(resolve(dataDir, ...segments))
      : { readable: false, reason: 'there is no database file', absent: true };
  // Removal order: the run workspaces and artifacts first and the database last, so a reset that
  // stops part of the way still has the run IDs it needs when it is run again.
  const targets: ResetTarget[] = [];
  const kept: KeptEntry[] = [];
  const workspaces = await statEntry(dataDir, 'workspaces');
  if (workspaces?.kind === 'directory') {
    const runIds = new Set(store.readable ? store.runIds : []);
    for (const name of (await readdir(resolve(dataDir, 'workspaces'))).sort()) {
      const path = 'workspaces/' + name;
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
        });
    }
  } else if (workspaces)
    kept.push({
      path: 'workspaces',
      why:
        workspaces.kind === 'link'
          ? 'a link; a reset never follows links'
          : `a ${NOUNS[workspaces.kind][0]}, not a directory`,
    });
  const artifacts = await listEntry(dataDir, 'artifacts');
  if (artifacts.length) targets.push({ path: 'artifacts', what: 'artifacts', entries: artifacts });
  targets.push(...databaseTargets);
  const owned = new Set([...RESERVED_ROOTS, ...LOCK_FILES].map((name) => nameKey(name)));
  if (segments.length > 1) owned.add(nameKey(root));
  else for (const [suffix] of DATABASE_PARTS) owned.add(nameKey(stored + suffix));
  for (const name of (await readdir(dataDir)).sort())
    if (!owned.has(nameKey(name)))
      kept.push({
        path: name,
        why:
          nameKey(name) === 'master.key'
            ? 'secret-store key; kept so the secrets in a backup of this store stay readable'
            : 'not part of the store',
      });
  kept.sort((a, b) => (a.path < b.path ? -1 : 1));
  assertDisjointManifest(targets, kept);
  return { dataDir, database: stored, store, targets, kept };
}

/**
 * A manifest names every path once and never both removes and keeps one; a reset that could
 * remove an entry twice would stop part of the way, and one that keeps what it removes would lie.
 * Paths are compared under the host's case rule. The refusals above make this unreachable for any
 * configuration; it stays as the final guard.
 */
export function assertDisjointManifest(
  targets: readonly ResetTarget[],
  kept: readonly KeptEntry[],
  caseInsensitive = CASE_INSENSITIVE_NAMES,
): void {
  const removed = new Set<string>();
  for (const target of targets)
    for (const entry of target.entries) {
      const key = nameKey(entry.path, caseInsensitive);
      if (removed.has(key))
        throw new ResetRefusedError(`the manifest would list ${entry.path} twice`);
      removed.add(key);
    }
  for (const entry of kept)
    if (removed.has(nameKey(entry.path, caseInsensitive)))
      throw new ResetRefusedError(`the manifest would both remove and keep ${entry.path}`);
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

/** The bounded manifest: every target and kept entry up to the limit, then totals. */
export function formatPlan(plan: ResetPlan, options: { dryRun: boolean; configured: string }) {
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
  if (!plan.targets.length) lines.push('  nothing but the lock file');
  lines.push(columns('graphgoblin.lock', "the reset's own lock", 'removed last, on release'));
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

async function sameDirectory(a: string, b: string): Promise<boolean> {
  const [first, second] = [await physicalPath(a), await physicalPath(b)];
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

export interface ResetIo {
  write: (text: string) => void;
  readStore: (databaseFile: string) => Promise<StoreFacts>;
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
  if (!isInside(configured, databaseFile))
    throw new ResetRefusedError(
      `the database ${databaseFile} is outside the data directory ${configured}; a reset removes only paths inside it, so remove that database yourself or point GG_DB_URL inside the data directory`,
    );
  const dataDir = await realpath(configured);
  const database = relative(configured, databaseFile).split(sep).join('/');
  // Check the lock and plan the whole reset read-only first: every refusal happens here, before
  // the lock (or a stale lock file left by a dead process) is touched.
  const state = await dataDirLockState(dataDir);
  if (state.state === 'held')
    throw new ResetRefusedError(
      `another GraphGoblin process holds ${state.path}; stop it before resetting`,
    );
  const preview = await planReset({ dataDir, database, readStore: io.readStore });
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
  let lock: DataDirLock;
  try {
    lock = await acquireDataDirLock(dataDir);
  } catch (error) {
    throw new ResetRefusedError(`${message(error)}; stop it before resetting`);
  }
  let failure: unknown;
  try {
    // Plan again under the lock, so the manifest removed is the one no other process can change.
    const plan = await planReset({ dataDir, database, readStore: io.readStore });
    io.write(formatPlan(plan, { dryRun: false, configured }));
    io.write('Removing:\n');
    try {
      await executeReset(plan, io.write);
    } catch (error) {
      failure = error;
    }
  } catch (error) {
    // The store changed between the read-only plan and the lock: nothing has been removed.
    await lock.release();
    throw new ResetRefusedError(message(error));
  }
  try {
    await lock.release();
  } catch (error) {
    throw new ResetIncompleteError(
      `${failure ? message(failure) + '\n' : ''}  Could not remove graphgoblin.lock: ${message(error)}`,
    );
  }
  if (failure)
    throw new ResetIncompleteError(
      `${message(failure)}\n  Released graphgoblin.lock.\nDo not start GraphGoblin on this data directory until the reset finishes: fix the cause and run the reset again; it lists and removes what is left.`,
    );
  io.write(
    [
      '  removed graphgoblin.lock',
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
    writeError(`reset refused: ${message(error)}\nNothing was changed.\n`);
    return 1;
  }
  try {
    return await resetDataDirectory(config, args, {
      write,
      readStore: options.readStore ?? ((file) => readStoreFacts(file)),
    });
  } catch (error) {
    if (error instanceof ResetIncompleteError) {
      writeError(`${error.message}\n`);
      return 1;
    }
    writeError(`reset refused: ${message(error)}\nNothing was changed.\n`);
    return 1;
  }
}
