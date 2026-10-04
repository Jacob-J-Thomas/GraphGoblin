import { createHash, randomBytes } from 'node:crypto';
import type { Effort, JsonValue } from '@graphgoblin/contracts';
import type { ClockPort, IdPort } from '@graphgoblin/engine';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { apiKeys, modelCatalog, settings } from './schema.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export class SqliteSettings {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
  ) {}

  async get(ownerId: string, key: string): Promise<JsonValue | undefined> {
    const row = await this.db.query.settings.findFirst({
      where: and(eq(settings.ownerId, ownerId), eq(settings.key, key)),
    });
    return row?.value;
  }

  async getAll(ownerId: string): Promise<Record<string, JsonValue>> {
    const rows = await this.db.select().from(settings).where(eq(settings.ownerId, ownerId));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(ownerId: string, key: string, value: JsonValue): Promise<void> {
    const updatedAt = this.clock.now().toISOString();
    await this.db
      .insert(settings)
      .values({ ownerId, key, value, updatedAt })
      .onConflictDoUpdate({ target: [settings.ownerId, settings.key], set: { value, updatedAt } });
  }

  async delete(ownerId: string, key: string): Promise<boolean> {
    const deleted = await this.db
      .delete(settings)
      .where(and(eq(settings.ownerId, ownerId), eq(settings.key, key)))
      .returning({ key: settings.key });
    return deleted.length > 0;
  }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface ApiKeyRecord {
  id: string;
  ownerId: string;
  label: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export const API_KEY_PREFIX = 'gg_';

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class SqliteApiKeys {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  /** Create a key. The plaintext token is returned once and never stored. */
  async create(
    ownerId: string,
    label: string,
    scopes: string[],
  ): Promise<{ record: ApiKeyRecord; token: string }> {
    const token = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const record: ApiKeyRecord = {
      id: this.ids.next(),
      ownerId,
      label,
      scopes,
      createdAt: this.clock.now().toISOString(),
    };
    await this.db.insert(apiKeys).values({
      id: record.id,
      ownerId,
      label,
      hash: hashApiKey(token),
      scopes,
      createdAt: record.createdAt,
    });
    return { record, token };
  }

  /** Resolve a presented token to its record, touching lastUsedAt. Revoked keys resolve to undefined. */
  async authenticate(token: string): Promise<ApiKeyRecord | undefined> {
    const row = await this.db.query.apiKeys.findFirst({
      where: eq(apiKeys.hash, hashApiKey(token)),
    });
    if (!row || row.revokedAt) return undefined;
    const lastUsedAt = this.clock.now().toISOString();
    await this.db.update(apiKeys).set({ lastUsedAt }).where(eq(apiKeys.id, row.id));
    return {
      id: row.id,
      ownerId: row.ownerId,
      label: row.label,
      scopes: row.scopes,
      createdAt: row.createdAt,
      lastUsedAt,
    };
  }

  async list(ownerId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.ownerId, ownerId))
      .orderBy(apiKeys.createdAt);
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      label: row.label,
      scopes: row.scopes,
      createdAt: row.createdAt,
      ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
      ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    }));
  }

  async revoke(ownerId: string, id: string): Promise<boolean> {
    const updated = await this.db
      .update(apiKeys)
      .set({ revokedAt: this.clock.now().toISOString() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.ownerId, ownerId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return updated.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export interface ModelCatalogEntry {
  harness: string;
  model: string;
  displayName: string;
  efforts: Effort[];
  defaultEffort: Effort;
  enabled: boolean;
}

const CODEX_EFFORTS: Effort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Models seen on the development machine on 2026-10-02 (docs/research/codex-sdk.md). Editable in settings. */
export const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    harness: 'codex',
    model: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'low',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-6.1-sol',
    displayName: 'GPT-6.1 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'low',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
];

export class SqliteModelCatalog {
  constructor(private readonly db: Database) {}

  /** Insert the defaults for any model not yet present. Never overwrites edits. */
  async seed(entries: ModelCatalogEntry[] = DEFAULT_MODEL_CATALOG): Promise<number> {
    let inserted = 0;
    for (const entry of entries) {
      const result = await this.db
        .insert(modelCatalog)
        .values(entry)
        .onConflictDoNothing()
        .returning({ model: modelCatalog.model });
      inserted += result.length;
    }
    return inserted;
  }

  async list(): Promise<ModelCatalogEntry[]> {
    const rows = await this.db
      .select()
      .from(modelCatalog)
      .orderBy(modelCatalog.harness, modelCatalog.model);
    return rows.map((r) => ({
      harness: r.harness,
      model: r.model,
      displayName: r.displayName,
      efforts: r.efforts,
      defaultEffort: r.defaultEffort,
      enabled: r.enabled,
    }));
  }

  async upsert(entry: ModelCatalogEntry): Promise<void> {
    await this.db
      .insert(modelCatalog)
      .values(entry)
      .onConflictDoUpdate({ target: [modelCatalog.harness, modelCatalog.model], set: entry });
  }

  async delete(harness: string, model: string): Promise<boolean> {
    const deleted = await this.db
      .delete(modelCatalog)
      .where(and(eq(modelCatalog.harness, harness), eq(modelCatalog.model, model)))
      .returning({ model: modelCatalog.model });
    return deleted.length > 0;
  }

  async isAllowed(harness: string, model: string, effort?: Effort): Promise<boolean> {
    const row = await this.db.query.modelCatalog.findFirst({
      where: and(eq(modelCatalog.harness, harness), eq(modelCatalog.model, model)),
    });
    if (!row || !row.enabled) return false;
    return effort === undefined || row.efforts.includes(effort);
  }
}
