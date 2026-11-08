import type {
  ModelCatalogAvailability,
  OllamaConnectionUpdate,
  OllamaConnectionView,
  OllamaDiscoveryStatus,
} from '@graphgoblin/contracts';
import { and, eq } from 'drizzle-orm';
import type {
  OllamaDiscoveredModel,
  OllamaDiscoveryError,
  OllamaRepository,
} from '../ollama/types.js';
import type { Database } from './db.js';
import { modelCatalog, modelDiscovery, ollamaConnection } from './schema.js';
import { ollamaAvailability } from './ollama-availability.js';

const ID = 'gateway';
export class SqliteOllamaRepository implements OllamaRepository {
  constructor(private readonly db: Database) {}
  async read(defaults: OllamaConnectionUpdate): Promise<OllamaConnectionView> {
    await this.db
      .insert(ollamaConnection)
      .values({ id: ID, ...defaults, revision: 1, discovery: { state: 'idle' } })
      .onConflictDoNothing();
    const row = await this.db.query.ollamaConnection.findFirst({
      where: eq(ollamaConnection.id, ID),
    });
    if (!row) throw new Error('Ollama connection initialization failed');
    return {
      connection: { enabled: row.enabled, baseUrl: row.baseUrl, revision: row.revision },
      discovery: row.discovery,
    };
  }
  async configure(input: OllamaConnectionUpdate, _at: string): Promise<OllamaConnectionView> {
    return this.db.transaction(async (tx) => {
      const old = await tx.query.ollamaConnection.findFirst({ where: eq(ollamaConnection.id, ID) });
      const revision = (old?.revision ?? 0) + 1;
      const discovery: OllamaDiscoveryStatus = {
        state: 'idle',
        ...(old?.discovery.lastSuccessAt ? { lastSuccessAt: old.discovery.lastSuccessAt } : {}),
      };
      await tx
        .insert(ollamaConnection)
        .values({ id: ID, ...input, revision, discovery })
        .onConflictDoUpdate({
          target: ollamaConnection.id,
          set: { ...input, revision, discovery },
        });
      return { connection: { ...input, revision }, discovery };
    });
  }
  async cached(revision: number): Promise<OllamaDiscoveredModel[]> {
    const rows = await this.db
      .select()
      .from(modelDiscovery)
      .innerJoin(
        modelCatalog,
        and(
          eq(modelCatalog.harness, modelDiscovery.harness),
          eq(modelCatalog.model, modelDiscovery.model),
        ),
      )
      .leftJoin(ollamaConnection, eq(ollamaConnection.id, ID))
      .where(
        and(eq(modelDiscovery.harness, 'ollama'), eq(modelDiscovery.connectionRevision, revision)),
      );
    return rows.map(
      ({ model_discovery: metadata, model_catalog: catalog, ollama_connection: connection }) => ({
        model: metadata.model,
        digest: metadata.digest,
        connectionRevision: metadata.connectionRevision,
        availability: ollamaAvailability(connection, metadata),
        thinkingByEffort: metadata.thinkingByEffort,
        displayName: catalog.displayName,
        efforts: catalog.efforts,
        defaultEffort: catalog.defaultEffort,
        enabled: catalog.enabled,
      }),
    );
  }
  async markRefreshing(revision: number, at: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const row = await tx.query.ollamaConnection.findFirst({ where: eq(ollamaConnection.id, ID) });
      if (!row || row.revision !== revision || !row.enabled) return false;
      await tx
        .update(ollamaConnection)
        .set({
          discovery: {
            state: 'refreshing',
            lastAttemptAt: at,
            ...(row.discovery.lastSuccessAt ? { lastSuccessAt: row.discovery.lastSuccessAt } : {}),
          },
        })
        .where(eq(ollamaConnection.id, ID));
      return true;
    });
  }
  async reconcile(revision: number, at: string, models: OllamaDiscoveredModel[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const connection = await tx.query.ollamaConnection.findFirst({
        where: eq(ollamaConnection.id, ID),
      });
      if (!connection || connection.revision !== revision || !connection.enabled) return false;
      const known = await tx
        .select()
        .from(modelDiscovery)
        .where(eq(modelDiscovery.harness, 'ollama'));
      const present = new Set(models.map((entry) => entry.model));
      for (const entry of known)
        if (!present.has(entry.model)) {
          const availability: ModelCatalogAvailability = {
            state: 'missing',
            checkedAt: at,
            reason: 'Model is not installed on the configured Ollama service',
          };
          await tx
            .update(modelDiscovery)
            .set({ availability })
            .where(
              and(eq(modelDiscovery.harness, 'ollama'), eq(modelDiscovery.model, entry.model)),
            );
        }
      for (const entry of models) {
        const catalog = {
          harness: 'ollama',
          source: 'harness' as const,
          model: entry.model,
          displayName: entry.displayName,
          efforts: entry.efforts,
          defaultEffort: entry.defaultEffort,
          enabled: true,
        };
        await tx
          .insert(modelCatalog)
          .values(catalog)
          .onConflictDoUpdate({
            target: [modelCatalog.harness, modelCatalog.model],
            set: {
              source: 'harness',
              displayName: catalog.displayName,
              efforts: catalog.efforts,
              defaultEffort: catalog.defaultEffort,
            },
          });
        const metadata = {
          harness: 'ollama',
          model: entry.model,
          digest: entry.digest,
          connectionRevision: revision,
          availability: { ...entry.availability, checkedAt: at },
          thinkingByEffort: entry.thinkingByEffort,
        };
        await tx
          .insert(modelDiscovery)
          .values(metadata)
          .onConflictDoUpdate({
            target: [modelDiscovery.harness, modelDiscovery.model],
            set: metadata,
          });
      }
      await tx
        .update(ollamaConnection)
        .set({
          discovery: {
            state: 'ready',
            lastAttemptAt: connection.discovery.lastAttemptAt ?? at,
            lastSuccessAt: at,
          },
        })
        .where(eq(ollamaConnection.id, ID));
      return true;
    });
  }
  async fail(revision: number, at: string, error: OllamaDiscoveryError): Promise<void> {
    await this.db.transaction(async (tx) => {
      const connection = await tx.query.ollamaConnection.findFirst({
        where: eq(ollamaConnection.id, ID),
      });
      if (!connection || connection.revision !== revision || !connection.enabled) return;
      await tx
        .update(ollamaConnection)
        .set({
          discovery: {
            state: 'error',
            lastAttemptAt: at,
            ...(connection.discovery.lastSuccessAt
              ? { lastSuccessAt: connection.discovery.lastSuccessAt }
              : {}),
            error,
          },
        })
        .where(eq(ollamaConnection.id, ID));
    });
  }
}
