import { eq } from 'drizzle-orm';
import type { RunResourceJournal, OwnedRunResource } from '../fs/owned-resources.js';
import type { Database } from './db.js';
import { runResources, runResourceUses } from './schema.js';

export class SqliteRunResources implements RunResourceJournal {
  constructor(private readonly db: Database) {}
  async find(key: string): Promise<OwnedRunResource | undefined> {
    return (await this.db.select().from(runResources).where(eq(runResources.key, key)).limit(1))[0];
  }
  async claim(resource: OwnedRunResource): Promise<void> {
    await this.db
      .insert(runResources)
      .values(resource)
      .onConflictDoUpdate({ target: runResources.key, set: { identity: resource.identity } });
  }
  async use(runId: string, key: string, path: string): Promise<void> {
    await this.db.insert(runResourceUses).values({ runId, key, path }).onConflictDoNothing();
  }
}
