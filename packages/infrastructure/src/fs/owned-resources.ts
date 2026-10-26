import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ArtifactStorePort, WorkspacePort } from '@graphgoblin/engine';
import { ArtifactStoreError } from '@graphgoblin/engine';
import { Mutex } from '../sqlite/db.js';
import { FsArtifactStore } from './artifacts.js';
import { FsWorkspace } from './workspace.js';

export interface OwnedRunResource {
  key: string;
  ownerRunId: string;
  kind: 'workspace' | 'artifact';
  path: string;
  identity: string;
}
export interface RunResourceJournal {
  find(key: string): Promise<OwnedRunResource | undefined>;
  claim(resource: OwnedRunResource): Promise<void>;
  use(runId: string, key: string, path: string): Promise<void>;
}

const canonical = (path: string) =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const identity = (stat: Awaited<ReturnType<typeof info>>) =>
  JSON.stringify([String(stat.dev), String(stat.ino), String(stat.birthtimeNs)]);
const info = (path: string) => lstat(path, { bigint: true });
async function exists(path: string) {
  try {
    return await info(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** One process holds the data-directory lock. This gate also excludes publication during reaping. */
export class OwnedRunResources {
  private readonly gate = new Mutex();
  readonly workspace: WorkspacePort;
  readonly artifacts: ArtifactStorePort;
  constructor(
    private readonly dataDir: string,
    private readonly journal: RunResourceJournal,
  ) {
    const workspace = new FsWorkspace(dataDir);
    const artifacts = new FsArtifactStore(dataDir);
    this.workspace = {
      resolve: (spec, view, runId) =>
        this.exclusive(async () => {
          let path: string;
          if (spec.kind === 'temp') {
            const root = await this.directory('workspaces');
            path = join(root, runId);
            if (dirname(path) !== root) throw new Error('Invalid workspace identity');
            let created = false;
            try {
              await mkdir(path);
              created = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
            if (!created) await workspace.resolve(spec, view, runId);
            if (created)
              await this.journal.claim({
                key: `workspace:${canonical(path)}`,
                ownerRunId: runId,
                kind: 'workspace',
                path,
                identity: identity(await info(path)),
              });
          } else path = await workspace.resolve(spec, view, runId);
          // Record canonical use even for a user-owned/shared directory, without claiming it.
          const actual = await realpath(path);
          await this.journal.use(runId, `workspace:${canonical(actual)}`, canonical(actual));
          return path;
        }),
      writeFile: (dir, path, content) => workspace.writeFile(dir, path, content),
    };
    this.artifacts = {
      get: (ref) => artifacts.get(ref),
      put: (kind, content, runId) =>
        this.exclusive(async () => {
          const safeKind = kind.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'blob';
          const hash = createHash('sha256').update(content, 'utf8').digest('hex');
          const ref = `artifact:${safeKind}/${hash}`;
          const root = await this.directory('artifacts');
          const directory = join(root, safeKind);
          await mkdir(directory, { recursive: true });
          if (canonical(await realpath(directory)) !== canonical(directory))
            throw new Error('Artifact directory is a link');
          const path = join(directory, hash);
          const temporary = join(directory, `.${hash}.${randomUUID()}.tmp`);
          try {
            let existing: string | undefined;
            try {
              existing = await artifacts.get(ref);
            } catch (error) {
              if (!(error instanceof ArtifactStoreError) || error.code !== 'ARTIFACT_CORRUPT')
                throw error;
              const before = await info(path);
              if (!before.isFile() || before.nlink !== 1n) throw error;
              const owned = await this.journal.find(ref);
              await artifacts.put(kind, content);
              if (owned && identity(before) === owned.identity)
                await this.journal.claim({ ...owned, identity: identity(await info(path)) });
              existing = content;
            }
            if (existing === undefined) {
              const file = await open(temporary, 'wx');
              try {
                await file.writeFile(content, 'utf8');
                await file.sync();
              } finally {
                await file.close();
              }
              let created = false;
              // Exclusive, atomic publication proves this process created these exact file bytes.
              try {
                await link(temporary, path);
                created = true;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
              }
              await unlink(temporary);
              if (created)
                await this.journal.claim({
                  key: ref,
                  ownerRunId: runId,
                  kind: 'artifact',
                  path,
                  identity: identity(await info(path)),
                });
            }
            if ((await artifacts.get(ref)) !== content)
              throw new Error('Artifact publication could not be verified');
            await this.journal.use(runId, ref, path);
            return { ref, bytes: Buffer.byteLength(content, 'utf8') };
          } catch (cause) {
            throw new ArtifactStoreError('ARTIFACT_WRITE_FAILED', ref, { cause });
          } finally {
            await unlink(temporary).catch(() => undefined);
          }
        }),
    };
  }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.gate.run(operation);
  }

  private async directory(name: string) {
    const root = resolve(this.dataDir, name);
    await mkdir(root, { recursive: true });
    if (
      canonical(await realpath(root)) !== canonical(root) ||
      canonical(await realpath(this.dataDir)) !== canonical(this.dataDir)
    )
      throw new Error('Managed resource root is a link');
    return root;
  }

  /** Called under exclusive() and the SQLite reference-check transaction. Never follows links. */
  async remove(resource: OwnedRunResource): Promise<{ removed: boolean; bytes: number }> {
    const root = await this.directory(resource.kind === 'workspace' ? 'workspaces' : 'artifacts');
    const rel = relative(root, resource.path);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.startsWith('..') ||
      resolve(root, rel) !== resolve(resource.path)
    )
      return { removed: false, bytes: 0 };
    const quarantine = await this.directory('cleanup-pending');
    const target = join(
      quarantine,
      createHash('sha256')
        .update(resource.key + resource.identity)
        .digest('hex'),
    );
    const staged = await exists(target);
    const original = staged ? undefined : await exists(resource.path);
    const stat = staged ?? original;
    if (!stat) return { removed: true, bytes: 0 };
    const source = staged ? target : resource.path;
    if (
      stat.isSymbolicLink() ||
      identity(stat) !== resource.identity ||
      (resource.kind === 'artifact' ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
    )
      return { removed: false, bytes: 0 };
    // A linked intermediate directory must never turn a recorded path into traversal elsewhere.
    if (canonical(await realpath(source)) !== canonical(source))
      return { removed: false, bytes: 0 };
    const entries: { rel: string; directory: boolean; identity: string; bytes: number }[] = [];
    const inventory = async (path: string): Promise<boolean> => {
      if (entries.length >= 2000) return false;
      const stat = await info(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n)))
        return false;
      entries.push({
        rel: relative(source, path),
        directory: stat.isDirectory(),
        identity: identity(stat),
        bytes: stat.isFile() ? Number(stat.size) : 0,
      });
      if (stat.isDirectory())
        for await (const entry of await opendir(path))
          if (!(await inventory(join(path, entry.name)))) return false;
      return true;
    };
    if (!(await inventory(source))) return { removed: false, bytes: 0 };
    if (!staged) await rename(source, target);
    let bytes = 0;
    for (const entry of entries.reverse()) {
      const path = join(target, entry.rel);
      if (
        canonical(await realpath(path)) !== canonical(path) ||
        identity(await info(path)) !== entry.identity
      )
        throw new Error('Owned resource changed during cleanup');
      if (entry.directory) await rmdir(path);
      else {
        await unlink(path);
        bytes += entry.bytes;
      }
    }
    return { removed: true, bytes };
  }
}
