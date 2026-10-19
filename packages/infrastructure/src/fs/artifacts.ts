import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ArtifactStoreError, type ArtifactStorePort } from '@graphgoblin/engine';

const REF_PREFIX = 'artifact:';
const REF_PATTERN = /^artifact:([a-z0-9_-]+)\/([a-f0-9]{64})$/i;

/** Content-addressed UTF-8 artifacts, published by same-directory atomic replacement. */
export class FsArtifactStore implements ArtifactStorePort {
  constructor(private readonly dataDir: string) {}

  async put(kind: string, content: string): Promise<{ ref: string; bytes: number }> {
    const safeKind = kind.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'blob';
    const bytes = Buffer.from(content, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const ref = `${REF_PREFIX}${safeKind}/${hash}`;
    const stored = { ref, bytes: bytes.length };
    const dir = join(this.dataDir, 'artifacts', safeKind);
    const file = join(dir, hash);
    const temporary = join(dir, `.${hash}.${randomUUID()}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      try {
        if ((await this.get(ref)) !== undefined) return stored;
      } catch (error) {
        if (!(error instanceof ArtifactStoreError) || error.code !== 'ARTIFACT_CORRUPT')
          throw error;
        // A crash/older writer may have left partial final bytes. Replace rather than trust them.
      }
      const handle = await open(temporary, 'wx');
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await publish(temporary, file);
      return stored;
    } catch (cause) {
      throw new ArtifactStoreError('ARTIFACT_WRITE_FAILED', ref, { cause });
    } finally {
      // ENOENT after rename is expected. A cleanup fault must not mask the publication result.
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(ref: string): Promise<string | undefined> {
    const match = REF_PATTERN.exec(ref);
    if (!match) return undefined;
    const [, kind, hash] = match as unknown as [string, string, string];
    let bytes: Buffer;
    try {
      bytes = await readFile(
        join(this.dataDir, 'artifacts', kind.toLowerCase(), hash.toLowerCase()),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (createHash('sha256').update(bytes).digest('hex') !== hash.toLowerCase())
      throw new ArtifactStoreError('ARTIFACT_CORRUPT', ref);
    return bytes.toString('utf8');
  }
}

async function publish(temporary: string, file: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows scanners/open handles can briefly prevent replacement. Six attempts, at most
      // 310 ms backoff, tolerate those short locks without unlinking the visible final path.
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY') || attempt >= 5)
        throw error;
      await setTimeout(10 * 2 ** attempt);
    }
  }
}
