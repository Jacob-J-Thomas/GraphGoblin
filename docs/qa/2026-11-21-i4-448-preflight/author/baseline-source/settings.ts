import { createHash, randomBytes } from 'node:crypto';
import { claudeCatalogModels } from '../claude/models.js';
import { JsonValueSchema, VoiceProbeSchema } from '@graphgoblin/contracts';
import type { Effort, JsonValue, ModelCatalogEntry, VoiceProbe } from '@graphgoblin/contracts';
import type { ClockPort, IdPort } from '@graphgoblin/engine';
import { and, eq, isNull, like, lt, asc, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { ollamaAvailability } from './ollama-availability.js';
import { apiKeys, modelCatalog, modelDiscovery, ollamaConnection, settings } from './schema.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface VoiceProbeState {
  generation: number;
  probe?: VoiceProbe;
}
function voiceProbeState(raw: JsonValue | undefined): VoiceProbeState {
  if (raw === undefined) return { generation: 0 };
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !('generation' in raw) ||
    typeof raw.generation !== 'number' ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0
  )
    throw new Error('Invalid voice qualification state');
  return {
    generation: raw.generation,
    ...('probe' in raw ? { probe: VoiceProbeSchema.parse(raw.probe) } : {}),
  };
}
export class SqliteSettings {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
  ) {}

  async get(ownerId: string, key: string): Promise<JsonValue | undefined> {
    const row = await this.db.query.settings.findFirst({
      where: and(eq(settings.ownerId, ownerId), eq(settings.key, key)),
    });
    return row === undefined ? undefined : JsonValueSchema.parse(JSON.parse(row.value));
  }

  async getAll(ownerId: string): Promise<Record<string, JsonValue>> {
    const rows = await this.db.select().from(settings).where(eq(settings.ownerId, ownerId));
    return Object.fromEntries(
      rows
        .filter((row) => !row.key.startsWith('chat.voice.'))
        .map((r) => [r.key, JsonValueSchema.parse(JSON.parse(r.value))]),
    );
  }

  async set(ownerId: string, key: string, value: JsonValue): Promise<void> {
    const updatedAt = this.clock.now().toISOString();
    const encoded = JSON.stringify(JsonValueSchema.parse(value));
    await this.db
      .insert(settings)
      .values({ ownerId, key, value: encoded, updatedAt })
      .onConflictDoUpdate({
        target: [settings.ownerId, settings.key],
        set: { value: encoded, updatedAt },
      });
  }

  async beginVoiceOperation(
    ownerId: string,
    operationId: string,
    value: JsonValue,
  ): Promise<boolean | 'capacity'> {
    return this.db.transaction(async (tx) => {
      const key = `chat.voice.operation.${operationId}`;
      const [existing] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, key)));
      if (existing) return false;
      const cutoff = new Date(this.clock.now().getTime() - 30 * 86400_000).toISOString();
      const old = await tx
        .select()
        .from(settings)
        .where(
          and(
            eq(settings.ownerId, ownerId),
            like(settings.key, 'chat.voice.operation.%'),
            lt(settings.updatedAt, cutoff),
            sql`json_extract(${settings.value}, '$.result.state') <> 'running'`,
            sql`coalesce(json_extract(${settings.value}, '$.result.code'),'') <> 'VOICE_OPERATION_RETIRED'`,
          ),
        )
        .orderBy(asc(settings.updatedAt))
        .limit(100);
      for (const row of old) {
        const stored: unknown = JSON.parse(row.value);
        if (
          stored &&
          typeof stored === 'object' &&
          'hash' in stored &&
          'result' in stored &&
          stored.result &&
          typeof stored.result === 'object' &&
          'operationId' in stored.result &&
          'kind' in stored.result
        ) {
          await tx
            .update(settings)
            .set({
              value: JSON.stringify({
                hash: stored.hash,
                result: {
                  operationId: stored.result.operationId,
                  kind: stored.result.kind,
                  state: 'failed',
                  code: 'VOICE_OPERATION_RETIRED',
                },
              }),
              updatedAt: this.clock.now().toISOString(),
            })
            .where(and(eq(settings.ownerId, ownerId), eq(settings.key, row.key)));
        }
      }
      const [count] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), like(settings.key, 'chat.voice.operation.%')));
      if (Number(count?.count ?? 0) >= 8192) return 'capacity';
      await tx.insert(settings).values({
        ownerId,
        key,
        value: JSON.stringify(JsonValueSchema.parse(value)),
        updatedAt: this.clock.now().toISOString(),
      });
      return true;
    });
  }
  async getVoiceProbeState(ownerId: string, route: 'local' | 'cloud'): Promise<VoiceProbeState> {
    return voiceProbeState(await this.get(ownerId, `chat.voice.probe.${route}`));
  }
  async saveVoiceProbe(
    ownerId: string,
    probe: VoiceProbe,
    expectedGeneration: number,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const key = `chat.voice.probe.${probe.route}`;
      const [row] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, key)));
      const state = voiceProbeState(row ? JsonValueSchema.parse(JSON.parse(row.value)) : undefined);
      const [config] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, 'chat.voice.v1')));
      const current: unknown = config ? JSON.parse(config.value) : { revision: 0 };
      if (
        state.generation !== expectedGeneration ||
        !current ||
        typeof current !== 'object' ||
        !('revision' in current) ||
        current.revision !== probe.configRevision
      )
        return false;
      const value = JSON.stringify({ generation: state.generation, probe });
      const updatedAt = this.clock.now().toISOString();
      await tx
        .insert(settings)
        .values({ ownerId, key, value, updatedAt })
        .onConflictDoUpdate({
          target: [settings.ownerId, settings.key],
          set: { value, updatedAt },
        });
      return true;
    });
  }
  async quarantineVoiceProbe(
    ownerId: string,
    revision: number,
    fingerprint: string,
    message: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const key = 'chat.voice.probe.local';
      const [row] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, key)));
      const state = voiceProbeState(row ? JsonValueSchema.parse(JSON.parse(row.value)) : undefined);
      if (state.probe?.configRevision !== revision || state.probe.fingerprint !== fingerprint)
        return;
      await tx
        .update(settings)
        .set({
          value: JSON.stringify({
            generation: state.generation + 1,
            probe: { ...state.probe, suitable: false, message },
          }),
          updatedAt: this.clock.now().toISOString(),
        })
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, key)));
    });
  }
  async compareVoiceConfig(
    ownerId: string,
    expectedRevision: number,
    value: JsonValue,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.ownerId, ownerId), eq(settings.key, 'chat.voice.v1')));
      const parsed: unknown = existing ? JSON.parse(existing.value) : { revision: 0 };
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('revision' in parsed) ||
        parsed.revision !== expectedRevision
      )
        return false;
      await tx
        .insert(settings)
        .values({
          ownerId,
          key: 'chat.voice.v1',
          value: JSON.stringify(value),
          updatedAt: this.clock.now().toISOString(),
        })
        .onConflictDoUpdate({
          target: [settings.ownerId, settings.key],
          set: { value: JSON.stringify(value), updatedAt: this.clock.now().toISOString() },
        });
      return true;
    });
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

export type { ModelCatalogEntry } from '@graphgoblin/contracts';

/**
 * Each seeded Codex model offers the canonical efforts its family accepts. GPT-6 and GPT-5.6 models
 * offer `none` (no reasoning) to `max`: the provider accepted `none` for GPT-6 Luna in a real turn
 * (#205), and the Codex adapter sends `none` under the family's own name (`effort-names.ts` in
 * adapter-codex). GPT-5.5 offers `low` to `xhigh`, as the model catalog compiled into the pinned
 * Codex CLI (0.160.0) lists for it (docs/qa/2026-10-27-f2-fixes). Levels outside the canonical
 * scale (`ultra`) are not offered.
 */
const CODEX_EFFORTS: Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORTS_TO_XHIGH: Effort[] = ['low', 'medium', 'high', 'xhigh'];

/** Harness-owned metadata; Settings may only change enabled. */
export const DEFAULT_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'low',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-6.1-sol',
    displayName: 'GPT-6.1 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-6.1-terra',
    displayName: 'GPT-6.1 Terra',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'low',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    efforts: CODEX_EFFORTS,
    defaultEffort: 'medium',
    enabled: true,
  },
  {
    harness: 'codex',
    source: 'harness',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    efforts: CODEX_EFFORTS_TO_XHIGH,
    defaultEffort: 'medium',
    enabled: true,
  },
  ...claudeCatalogModels().map((entry) => ({
    harness: 'claude',
    source: 'harness' as const,
    model: entry.model,
    displayName: entry.displayName,
    efforts: entry.efforts,
    defaultEffort: 'high' as const,
    enabled: true,
  })),
];

/** Startup-only inspection before pending schema migrations; no discovery tables or writes. */
export async function readPreMigrationModelCatalog(db: Database): Promise<ModelCatalogEntry[]> {
  return db
    .select({
      harness: modelCatalog.harness,
      model: modelCatalog.model,
      source: modelCatalog.source,
      displayName: modelCatalog.displayName,
      efforts: modelCatalog.efforts,
      defaultEffort: modelCatalog.defaultEffort,
      enabled: modelCatalog.enabled,
    })
    .from(modelCatalog)
    .orderBy(modelCatalog.harness, modelCatalog.model);
}

export class SqliteModelCatalog {
  constructor(private readonly db: Database) {}

  /** Refresh harness metadata, preserving enabled and rows outside the seed. Returns inserts. */
  async seed(entries: ModelCatalogEntry[] = DEFAULT_MODEL_CATALOG): Promise<number> {
    let inserted = 0;
    for (const entry of entries) {
      const result = await this.db
        .insert(modelCatalog)
        .values({ ...entry, source: 'harness' })
        .onConflictDoNothing()
        .returning({ model: modelCatalog.model });
      inserted += result.length;
      await this.db
        .update(modelCatalog)
        .set({
          displayName: entry.displayName,
          efforts: entry.efforts,
          defaultEffort: entry.defaultEffort,
        })
        .where(
          and(
            eq(modelCatalog.harness, entry.harness),
            eq(modelCatalog.model, entry.model),
            eq(modelCatalog.source, 'harness'),
          ),
        );
    }
    return inserted;
  }

  async list(): Promise<ModelCatalogEntry[]> {
    const rows = await this.db
      .select()
      .from(modelCatalog)
      .leftJoin(
        modelDiscovery,
        and(
          eq(modelCatalog.harness, modelDiscovery.harness),
          eq(modelCatalog.model, modelDiscovery.model),
        ),
      )
      .leftJoin(ollamaConnection, eq(ollamaConnection.id, 'gateway'))
      .orderBy(modelCatalog.harness, modelCatalog.model);
    return rows.map(
      ({ model_catalog: r, model_discovery: metadata, ollama_connection: connection }) => ({
        harness: r.harness,
        model: r.model,
        source: r.source,
        displayName: r.displayName,
        efforts: r.efforts,
        defaultEffort: r.defaultEffort,
        enabled: r.enabled,
        ...(r.harness === 'ollama'
          ? { availability: ollamaAvailability(connection, metadata) }
          : {}),
      }),
    );
  }

  async upsert(entry: ModelCatalogEntry): Promise<void> {
    await this.db
      .insert(modelCatalog)
      .values(entry)
      .onConflictDoUpdate({ target: [modelCatalog.harness, modelCatalog.model], set: entry });
  }

  async findOne(harness: string, model: string): Promise<ModelCatalogEntry | undefined> {
    const rows = await this.db
      .select()
      .from(modelCatalog)
      .leftJoin(
        modelDiscovery,
        and(
          eq(modelCatalog.harness, modelDiscovery.harness),
          eq(modelCatalog.model, modelDiscovery.model),
        ),
      )
      .leftJoin(ollamaConnection, eq(ollamaConnection.id, 'gateway'))
      .where(and(eq(modelCatalog.harness, harness), eq(modelCatalog.model, model)))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          ...row.model_catalog,
          ...(row.model_catalog.harness === 'ollama'
            ? { availability: ollamaAvailability(row.ollama_connection, row.model_discovery) }
            : {}),
        }
      : undefined;
  }

  async setEnabled(
    harness: string,
    model: string,
    enabled: boolean,
  ): Promise<ModelCatalogEntry | undefined> {
    const rows = await this.db
      .update(modelCatalog)
      .set({ enabled })
      .where(and(eq(modelCatalog.harness, harness), eq(modelCatalog.model, model)))
      .returning();
    return rows[0] ? this.findOne(harness, model) : undefined;
  }

  async delete(harness: string, model: string): Promise<boolean> {
    const deleted = await this.db
      .delete(modelCatalog)
      .where(and(eq(modelCatalog.harness, harness), eq(modelCatalog.model, model)))
      .returning({ model: modelCatalog.model });
    return deleted.length > 0;
  }

  async isAllowed(harness: string, model: string, effort?: Effort): Promise<boolean> {
    const row = await this.findOne(harness, model);
    if (!row || !row.enabled || (row.availability && row.availability.state !== 'available'))
      return false;
    return effort === undefined || row.efforts.includes(effort);
  }
}
