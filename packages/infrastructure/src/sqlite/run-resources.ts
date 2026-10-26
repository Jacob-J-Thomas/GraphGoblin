import { eq } from 'drizzle-orm';
import {
  quarantinedKey,
  type RunResourceJournal,
  type OwnedRunResource,
} from '../fs/owned-resources.js';
import { physicalDirectory } from '../fs/physical-path.js';
import { recordWorkspacePhysical } from './workspace-references.js';
import { workspaceReferences } from './schema.js';
import type { Database } from './db.js';
import { runResources, runResourceUses } from './schema.js';

export class SqliteRunResources implements RunResourceJournal {
  constructor(private readonly db: Database) {}
  async find(key: string): Promise<OwnedRunResource | undefined> {
    return (await this.db.select().from(runResources).where(eq(runResources.key, key)).limit(1))[0];
  }
  async claim(resource: OwnedRunResource): Promise<void> {
    resource = {
      ...resource,
      physicalPath: resource.kind === 'workspace' ? await physicalDirectory(resource.path) : null,
    };
    await this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(runResources)
        .where(eq(runResources.key, resource.key));
      if (previous?.pending && previous.identity !== resource.identity) {
        // Recover the rename-before-commit crash window before a new publication takes its key.
        await tx
          .update(runResources)
          .set({ key: quarantinedKey(previous) })
          .where(eq(runResources.key, previous.key));
        await tx.insert(runResources).values({
          ...resource,
          ...(previous.ownerRunId === resource.ownerRunId
            ? { pending: true, approval: previous.approval }
            : {}),
        });
      } else
        await tx
          .insert(runResources)
          .values(resource)
          .onConflictDoUpdate({ target: runResources.key, set: { ...resource } });
    });
  }

  async use(runId: string, key: string, path: string): Promise<void> {
    if (!key.startsWith('workspace:')) {
      await this.db.insert(runResourceUses).values({ runId, key, path }).onConflictDoNothing();
      return;
    }
    const physical = await physicalDirectory(path);
    await this.db.transaction(async (tx) => {
      await tx.insert(runResourceUses).values({ runId, key, path }).onConflictDoNothing();
      await recordWorkspacePhysical(tx, 'use:' + runId + ':' + key, path, physical);
      await tx.delete(workspaceReferences).where(eq(workspaceReferences.id, 'pending:' + runId));
    });
  }
}
