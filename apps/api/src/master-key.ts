import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The secret-store master key: 32 bytes. Taken from `GG_MASTER_KEY` (base64) when set, otherwise
 * read from `<dataDir>/master.key`, which is created on first run with owner-only permissions.
 */
export async function loadMasterKey(options: {
  dataDir: string;
  masterKey?: string;
}): Promise<Buffer> {
  if (options.masterKey) {
    const key = Buffer.from(options.masterKey, 'base64');
    if (key.length !== 32) throw new Error('GG_MASTER_KEY must decode to exactly 32 bytes');
    return key;
  }
  await mkdir(options.dataDir, { recursive: true });
  const file = join(options.dataDir, 'master.key');
  try {
    const existing = Buffer.from((await readFile(file, 'utf8')).trim(), 'base64');
    if (existing.length !== 32) throw new Error(`${file} does not contain a 32-byte key`);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const generated = randomBytes(32);
  await writeFile(file, generated.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  return generated;
}
