import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

/**
 * Filesystem entries of a reset, read and removed without following links (ADR-0042). A symbolic
 * link or Windows junction is an entry of its own: listing never descends into it and removal
 * removes the link, never its target. Anything that is neither a regular file, a directory nor a
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
    const stats = await lstat(path, { bigint: true });
    const root = parse(resolve(path)).root.toLowerCase();
    return `${root}|${String(stats.dev)}:${String(stats.ino)}`;
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return undefined;
    throw error;
  }
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
    const stats = await lstat(absolute(root, path), { bigint: true });
    const kind = kindOf(stats);
    return {
      path,
      kind,
      bytes: kind === 'file' ? Number(stats.size) : 0,
      identity: `${String(stats.dev)}:${String(stats.ino)}`,
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
 * Remove one listed entry. Immediately before the change, every ancestor up to `root` must still
 * be a physical directory and the entry must still be what was listed, so a directory swapped for
 * a link after listing is refused rather than followed. Directories are removed only when empty.
 */
export async function removeEntry(root: string, entry: TreeEntry): Promise<void> {
  const full = absolute(root, entry.path);
  if (!isInside(root, full)) throw new Error(`${entry.path} is not inside the data directory`);
  for (let parent = dirname(full); parent !== root; parent = dirname(parent)) {
    const stats = await lstat(parent);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error(`${relative(root, parent)} is no longer a physical directory`);
  }
  const now = kindOf(await lstat(full));
  if (now !== entry.kind)
    throw new Error(`${entry.path} changed from a ${entry.kind} to a ${now} during the reset`);
  // `unlink` removes a symbolic link or Windows junction itself (libuv uses RemoveDirectory for a
  // directory link), never its target.
  if (entry.kind === 'directory') await rmdir(full);
  else await unlink(full);
}
