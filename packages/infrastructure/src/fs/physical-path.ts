import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** Directory keys include their separator, so prefix ranges cannot confuse sibling names. */
export const directoryKey = (path: string): string => {
  const absolute = resolve(path);
  const value = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  return value.endsWith(sep) ? value : value + sep;
};

/** Native realpath resolves junctions/short names; missing suffixes inherit their physical ancestor. */
export async function physicalDirectory(path: string): Promise<string | null> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      const actual = await realpath(ancestor);
      if (!(await stat(actual)).isDirectory()) return null;
      return directoryKey(join(actual, ...missing));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const parent = dirname(ancestor);
      if (parent === ancestor) return null;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  return null;
}
