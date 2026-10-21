import type { Stats } from 'node:fs';
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

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
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Whether `path` lies strictly inside `root` (both absolute and normalized). */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

export function kindOf(stats: Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile'>): EntryKind {
  if (stats.isSymbolicLink()) return 'link';
  if (stats.isDirectory()) return 'directory';
  return stats.isFile() ? 'file' : 'other';
}

const absolute = (root: string, path: string): string => join(root, ...path.split('/'));

/** The entry at `path` (relative to `root`), or undefined when nothing is there. */
export async function statEntry(root: string, path: string): Promise<TreeEntry | undefined> {
  try {
    const stats = await lstat(absolute(root, path));
    const kind = kindOf(stats);
    return { path, kind, bytes: kind === 'file' ? stats.size : 0 };
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
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
