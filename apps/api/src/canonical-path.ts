import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Resolve aliases even for a not-yet-created file, without creating anything. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalPath(parent), basename(absolute));
  }
}
