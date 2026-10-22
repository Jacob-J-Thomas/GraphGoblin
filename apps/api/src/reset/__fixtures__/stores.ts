import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** Run IDs stored in every seeded store; their workspaces are what a reset removes. */
export const SEEDED_RUN_IDS = ['01JRESETRUNAAAAAAAAAAAAAAA', '01JRESETRUNBBBBBBBBBBBBBBB'];

/** Node arguments that run a TypeScript entry of this package through tsx. */
export function tsxArguments(entry: URL): string[] {
  return ['--import', import.meta.resolve('tsx'), '--conditions=development', fileURLToPath(entry)];
}

/** The store reader as `readStoreFacts` runs it in tests: the source entry through tsx. */
export const READER_ARGUMENTS = tsxArguments(new URL('../store-facts-reader.ts', import.meta.url));

/**
 * Seed `current`, `format-3`, `unmarked` and `corrupt` stores under `root` in a child process, so
 * no native handle in the test process keeps their files open.
 */
export async function seedStores(root: string): Promise<void> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [...tsxArguments(new URL('./seed-stores.ts', import.meta.url)), root],
    { timeout: 180_000, windowsHide: true },
  );
  if (stdout !== 'seeded') throw new Error(`store seeding printed ${JSON.stringify(stdout)}`);
}

/** Copy a seeded store's files into a data directory. */
export async function copyStore(seeded: string, dataDir: string): Promise<void> {
  await cp(seeded, dataDir, { recursive: true, errorOnExist: true, force: false });
}

export interface TreeRecord {
  path: string;
  kind: 'file' | 'directory' | 'link';
  sha256?: string;
  target?: string;
}

/** Every entry below `root`, byte for byte: file hashes and link targets, never following links. */
export async function snapshotTree(root: string, prefix = ''): Promise<TreeRecord[]> {
  const records: TreeRecord[] = [];
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const full = join(root, path);
    const stats = await lstat(full);
    if (stats.isSymbolicLink()) records.push({ path, kind: 'link', target: await readlink(full) });
    else if (stats.isDirectory()) {
      records.push({ path, kind: 'directory' });
      records.push(...(await snapshotTree(root, path)));
    } else
      records.push({
        path,
        kind: 'file',
        sha256: createHash('sha256')
          .update(await readFile(full))
          .digest('hex'),
      });
  }
  return records;
}
