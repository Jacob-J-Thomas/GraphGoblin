import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/**
 * Filesystem entries of a reset (ADR-0042). An entry identified as a symbolic link or Windows
 * junction is listed without descending into it and unlinked itself. See removeEntry for the
 * remaining external-process race. Anything that is neither a regular file, a directory nor a
 * link (a FIFO, a socket, a device) is `other`: it is never accepted as a database file, and inside
 * a removed directory it is unlinked like any other non-directory entry.
 */
export type EntryKind = 'file' | 'directory' | 'link' | 'other';

export interface TreeEntry {
  /** Relative to the data directory, with `/` separators. */
  path: string;
  kind: EntryKind;
  /** Size of a file; links and directories count 0. */
  bytes: number;
  /** Filesystem identity (device and file index), so two spellings of one entry compare equal. */
  identity: string;
  /** Physical directories from the root (`path: ''`) inward, including kept ancestors. */
  ancestors: { path: string; identity: string }[];
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * The identity of the entry at `path` without following links: the volume root of the path, the
 * device and the file index as 64-bit values, which is how the filesystem itself tells one file
 * from another. Two spellings of one entry (letter case on a case-insensitive volume, a Windows
 * short name) share it; two files whose names merely fold alike never do. The volume root is part
 * of the key because Windows reports the same device number for every volume, so a file index alone
 * can repeat across `C:\` and `D:\`; two drive letters for one volume therefore compare as
 * different, which only ever refuses more. Undefined when nothing is there.
 */
export async function identityOf(path: string): Promise<string | undefined> {
  try {
    return identityFrom(path, await lstat(path, { bigint: true }));
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return undefined;
    throw error;
  }
}

/** The one identity construction every entry uses, so identities from any source compare. */
function identityFrom(path: string, stats: { dev: bigint; ino: bigint }): string {
  const root = parse(resolve(path)).root.toLowerCase();
  return `${root}|${String(stats.dev)}:${String(stats.ino)}`;
}

/** Whether `path` lies strictly inside `root` (both absolute and normalized). */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export function kindOf(stats: {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}): EntryKind {
  if (stats.isSymbolicLink()) return 'link';
  if (stats.isDirectory()) return 'directory';
  return stats.isFile() ? 'file' : 'other';
}

const absolute = (root: string, path: string): string => join(root, ...path.split('/'));

/** The entry at `path` (relative to `root`), or undefined when nothing is there. */
export async function statEntry(root: string, path: string): Promise<TreeEntry | undefined> {
  try {
    const full = absolute(root, path);
    if (!isInside(root, full)) throw new Error(`${path} is not inside the data directory`);
    const segments = path.split('/');
    const ancestors: TreeEntry['ancestors'] = [];
    // Snapshot the whole route before inspecting the leaf, without entering a link. In a confirmed
    // reset these identities come from the fresh plan made while holding the data-directory lock.
    for (let depth = 0; depth < segments.length; depth += 1) {
      const parent = segments.slice(0, depth).join('/');
      const parentFull = absolute(root, parent);
      const stats = await lstat(parentFull, { bigint: true });
      if (kindOf(stats) !== 'directory')
        throw new Error(`${parent || 'data-directory root'} is not a physical directory`);
      ancestors.push({ path: parent, identity: identityFrom(parentFull, stats) });
    }
    const stats = await lstat(full, { bigint: true });
    const kind = kindOf(stats);
    return {
      path,
      kind,
      bytes: kind === 'file' ? Number(stats.size) : 0,
      identity: identityFrom(full, stats),
      ancestors,
    };
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return undefined;
    throw error;
  }
}

/**
 * The entry at `path` and, when it is a physical directory, everything below it, in removal order:
 * every child before its directory. Names are sorted so a manifest is stable. Missing: empty.
 */
export async function listEntry(root: string, path: string): Promise<TreeEntry[]> {
  const entry = await statEntry(root, path);
  if (!entry) return [];
  if (entry.kind !== 'directory') return [entry];
  const below: TreeEntry[] = [];
  for (const name of (await readdir(absolute(root, path))).sort())
    below.push(...(await listEntry(root, path + '/' + name)));
  return [...below, entry];
}

/**
 * Remove one listed entry. Recheck the planned identity of the physical root, every physical
 * ancestor (including kept directories), and the entry, root first, immediately before removal.
 * Node offers no handle-relative removal: these checks narrow but cannot eliminate a race with
 * an external process changing the tree between a check and unlink/rmdir. The reset holds the
 * data-directory lock, so GraphGoblin itself does not change it concurrently. Only empty physical
 * directories are removed; links are unlinked themselves.
 */
export async function removeEntry(root: string, entry: TreeEntry): Promise<void> {
  const full = absolute(root, entry.path);
  if (!isInside(root, full)) throw new Error(`${entry.path} is not inside the data directory`);
  for (const parent of entry.ancestors) {
    const parentFull = absolute(root, parent.path);
    const description = `${entry.path}: ${parent.path ? `ancestor ${parent.path}` : 'data-directory root'}`;
    const stats = await removalStat(parentFull, description);
    const kind = kindOf(stats);
    if (kind !== 'directory')
      throw new Error(
        `${description} is now a ${kind} during the reset; no longer a physical directory`,
      );
    if (identityFrom(parentFull, stats) !== parent.identity)
      throw new Error(`${description} was replaced during the reset`);
  }
  const stats = await removalStat(full, entry.path);
  const now = kindOf(stats);
  if (now !== entry.kind)
    throw new Error(`${entry.path} changed from a ${entry.kind} to a ${now} during the reset`);
  if (identityFrom(full, stats) !== entry.identity)
    throw new Error(`${entry.path} was replaced during the reset`);
  // `unlink` removes a symbolic link or Windows junction itself (libuv uses RemoveDirectory for a
  // directory link), never its target.
  if (entry.kind === 'directory') await rmdir(full);
  else await unlink(full);
}

/** Missing paths are a changed plan too; identify what moved instead of reporting only ENOENT. */
async function removalStat(path: string, description: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR'))
      throw new Error(`${description} was moved or removed during the reset`, { cause: error });
    throw error;
  }
}
