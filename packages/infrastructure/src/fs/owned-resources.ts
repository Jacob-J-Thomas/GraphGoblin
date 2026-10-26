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
import { setImmediate as yieldTurn } from 'node:timers/promises';
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
  physicalPath?: string | null;
}
export interface ResourceRemovalPlan {
  target: string;
  entries: { rel: string; directory: boolean; identity: string; bytes: number }[];
}
export interface ResourceCleanupPort {
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  inspect(resource: OwnedRunResource): Promise<ResourceRemovalPlan | undefined>;
  stage(resource: OwnedRunResource, plan: ResourceRemovalPlan): Promise<boolean>;
  remove(
    resource: OwnedRunResource,
    plan: ResourceRemovalPlan,
    signal?: AbortSignal,
  ): Promise<{ removed: boolean; bytes: number }>;
}
/** A quarantined generation is separate from a later publication at its original key. */
export function originalResource(resource: OwnedRunResource): OwnedRunResource {
  if (!resource.key.startsWith('quarantine:')) return resource;
  const key = resource.key.slice(76);
  if (quarantinedKey({ ...resource, key }) !== resource.key)
    throw new Error('Invalid quarantine job');
  return { ...resource, key };
}
export function quarantinedKey(resource: OwnedRunResource): string {
  return (
    'quarantine:' +
    createHash('sha256')
      .update(resource.key + resource.identity)
      .digest('hex') +
    ':' +
    resource.key
  );
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

  /** Inventory is bounded and runs outside every SQLite transaction and publication gate. */
  async inspect(job: OwnedRunResource): Promise<ResourceRemovalPlan | undefined> {
    const resource = originalResource(job);
    const root = await this.directory(resource.kind === 'workspace' ? 'workspaces' : 'artifacts');
    const rel = relative(root, resource.path);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.startsWith('..') ||
      resolve(root, rel) !== resolve(resource.path)
    )
      return undefined;
    const quarantine = await this.directory('cleanup-pending');
    const target = join(
      quarantine,
      createHash('sha256')
        .update(resource.key + resource.identity)
        .digest('hex'),
    );
    const staged = await exists(target);
    const stat =
      staged ?? (job.key.startsWith('quarantine:') ? undefined : await exists(resource.path));
    const plan: ResourceRemovalPlan = { target, entries: [] };
    if (!stat) return plan;
    const source = staged ? target : resource.path;
    if (
      stat.isSymbolicLink() ||
      identity(stat) !== resource.identity ||
      (resource.kind === 'artifact' ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
    )
      return undefined;
    if (canonical(await realpath(source)) !== canonical(source)) return undefined;
    const inventory = async (path: string): Promise<boolean> => {
      if (plan.entries.length >= 2000) return false;
      const item = await info(path);
      if (item.isSymbolicLink() || (!item.isDirectory() && (!item.isFile() || item.nlink !== 1n)))
        return false;
      plan.entries.push({
        rel: relative(source, path),
        directory: item.isDirectory(),
        identity: identity(item),
        bytes: item.isFile() ? Number(item.size) : 0,
      });
      if (plan.entries.length % 32 === 0) await yieldTurn();
      if (item.isDirectory())
        for await (const entry of await opendir(path))
          if (!(await inventory(join(path, entry.name)))) return false;
      return true;
    };
    return (await inventory(source)) ? plan : undefined;
  }

  /** Constant-size ownership recheck and rename only; the caller holds its short transaction. */
  async stage(job: OwnedRunResource, plan: ResourceRemovalPlan): Promise<boolean> {
    const resource = originalResource(job);
    const expected = join(
      resolve(this.dataDir, 'cleanup-pending'),
      createHash('sha256')
        .update(resource.key + resource.identity)
        .digest('hex'),
    );
    if (plan.target !== expected) return false;
    for (const path of [this.dataDir, dirname(expected)])
      if (canonical(await realpath(path)) !== canonical(path)) return false;
    const staged = await exists(expected);
    const stat =
      staged ?? (job.key.startsWith('quarantine:') ? undefined : await exists(resource.path));
    if (!stat) return true;
    const source = staged ? expected : resource.path;
    if (
      stat.isSymbolicLink() ||
      identity(stat) !== resource.identity ||
      (resource.kind === 'artifact' ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory()) ||
      canonical(await realpath(source)) !== canonical(source)
    )
      return false;
    if (!staged) await rename(source, expected);
    return true;
  }

  /** Quarantine-only unlinking, after commit; a new original-path generation is never touched. */
  async remove(
    job: OwnedRunResource,
    prepared: ResourceRemovalPlan,
    signal?: AbortSignal,
  ): Promise<{ removed: boolean; bytes: number }> {
    const plan = prepared;
    const resource = originalResource(job);
    const expected = join(
      resolve(this.dataDir, 'cleanup-pending'),
      createHash('sha256')
        .update(resource.key + resource.identity)
        .digest('hex'),
    );
    if (plan.target !== expected) return { removed: false, bytes: 0 };
    let bytes = 0;
    for (const entry of [...plan.entries].reverse()) {
      if (signal?.aborted) return { removed: false, bytes };
      const path = join(plan.target, entry.rel);
      const current = await info(path);
      if (
        canonical(await realpath(path)) !== canonical(path) ||
        current.isSymbolicLink() ||
        (!entry.directory && (!current.isFile() || current.nlink !== 1n)) ||
        identity(current) !== entry.identity
      )
        throw new Error('Owned resource changed during cleanup');
      if (entry.directory) await rmdir(path);
      else {
        await unlink(path);
        bytes += Number(current.size);
      }
      await yieldTurn();
    }
    return { removed: true, bytes };
  }
}
