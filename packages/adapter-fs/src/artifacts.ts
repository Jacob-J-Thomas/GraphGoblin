import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactStorePort } from '@graphgoblin/engine';

const REF_PREFIX = 'artifact:';
const REF_PATTERN = /^artifact:([a-z0-9_-]+)\/([a-f0-9]{64})$/i;

/**
 * Content-addressed artifact store under `<dataDir>/artifacts/<kind>/<sha256>`. Identical content
 * is stored once. References look like `artifact:transcript/<hash>`.
 */
export class FsArtifactStore implements ArtifactStorePort {
  constructor(private readonly dataDir: string) {}

  async put(kind: string, content: string): Promise<{ ref: string; bytes: number }> {
    const safeKind = kind.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'blob';
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    const dir = join(this.dataDir, 'artifacts', safeKind);
    await mkdir(dir, { recursive: true });
    const file = join(dir, hash);
    if (!(await exists(file))) await writeFile(file, content, 'utf8');
    return { ref: `${REF_PREFIX}${safeKind}/${hash}`, bytes: Buffer.byteLength(content, 'utf8') };
  }

  async get(ref: string): Promise<string | undefined> {
    const match = REF_PATTERN.exec(ref);
    if (!match) return undefined;
    const [, kind, hash] = match as unknown as [string, string, string];
    try {
      return await readFile(
        join(this.dataDir, 'artifacts', kind.toLowerCase(), hash.toLowerCase()),
        'utf8',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
