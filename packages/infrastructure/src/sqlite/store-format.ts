import type { Client } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
  CURRENT_DEFINITION_FORMAT,
  HarnessDefaultsSchema,
  HeaderNameSchema,
  LoopDefinitionSchema,
} from '@graphgoblin/contracts';
import { retiredEventDestinations, withoutRetiredEventDestinations } from '@graphgoblin/domain';
import {
  currentStoreReadiness,
  normalizeStoreSql,
  quote,
  rows,
  SHIPPED_MIGRATIONS,
  storeStructure,
  type StoreReader,
  type StoreRow,
} from './readiness.js';

/**
 * The current-format store contract (ADR-0042): an empty store is initialised in one transaction;
 * a store marked with the current format and complete structure is reopened; anything else is
 * refused before any write. There is no conversion: an operator resets an unsupported store
 * explicitly (`--reset` on the API binary) or repairs it by hand.
 */

async function tableNames(client: StoreReader): Promise<string[]> {
  return (await rows(client, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('sqlite_'));
}

/** Rows per keyset batch when the guard parses every stored definition. */
const STORE_BATCH_SIZE = 500;

/** Keyset batches by rowid, yielding to the event loop between batches. */
async function* tableBatches(client: StoreReader, table: string): AsyncGenerator<StoreRow[]> {
  let after: number | undefined;
  for (;;) {
    const batch = await rows(
      client,
      'SELECT rowid AS __gg_rowid,* FROM ' +
        quote(table) +
        ' WHERE ' +
        (after === undefined ? '1' : 'rowid>?') +
        ' ORDER BY rowid LIMIT ?',
      after === undefined ? [STORE_BATCH_SIZE] : [after, STORE_BATCH_SIZE],
    );
    if (!batch.length) return;
    after = Number(batch.at(-1)!.__gg_rowid);
    for (const row of batch) delete row.__gg_rowid;
    yield batch;
    // Local libsql promises can settle without returning to the event loop. Give native
    // statement finalizers and other work a turn between batches.
    await yieldToEventLoop();
  }
}

/**
 * The store is not a current-format store this build can open. `foundFormat` is the stored
 * format marker's version when the store has a valid marker row; it is absent for a store with no
 * marker (written before markers existed) or a malformed one. `reason` says which check failed.
 */
export class UnsupportedStoreError extends Error {
  readonly code = 'STORE_UNSUPPORTED';
  readonly requiredFormat = CURRENT_DEFINITION_FORMAT;
  constructor(
    readonly reason: string,
    readonly foundFormat?: number,
  ) {
    super(reason);
    this.name = 'UnsupportedStoreError';
  }
}

// The marker table keeps its historical name: renaming it would refuse every current store.
const MARKER_TABLE = 'gg_upgrade_state';
const MARKER_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_state (id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL, status TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL)';

function json(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('stored JSON column is not text');
  return JSON.parse(value);
}

/** Read the stored format marker, refusing a store whose marker is absent, malformed or old. */
async function requireCurrentMarker(client: StoreReader, names: string[]): Promise<void> {
  if (!names.includes(MARKER_TABLE))
    throw new UnsupportedStoreError(
      'The store has no format marker; an older GraphGoblin build wrote it',
    );
  const markers = await rows(client, 'SELECT * FROM ' + MARKER_TABLE);
  const marker = markers[0];
  if (markers.length !== 1 || marker?.id !== 1 || typeof marker.format_version !== 'number')
    throw new UnsupportedStoreError('The store format marker is missing or malformed');
  const found = marker.format_version;
  if (found !== CURRENT_DEFINITION_FORMAT)
    throw new UnsupportedStoreError(
      'The store is format ' +
        String(found) +
        '; this build reads only format ' +
        String(CURRENT_DEFINITION_FORMAT),
      found,
    );
  if (marker.status !== 'complete')
    throw new UnsupportedStoreError(
      'The store format marker records an unfinished change (status ' +
        JSON.stringify(marker.status) +
        ')',
      found,
    );
}

type StoreTables = Awaited<ReturnType<typeof storeStructure>>;

/**
 * What the stored structure lacks against `tables`, as the damage detail, or undefined when every
 * table, column, constraint and index is present. With `exact`, the structure must also hold
 * nothing beyond the tables described (the migration head).
 */
function structureGap(
  structure: StoreTables,
  tables: StoreTables,
  exact: boolean,
): string | undefined {
  for (const table of tables) {
    const actual = structure.find((stored) => stored.name === table.name);
    if (!actual) return 'missing table ' + table.name;
    if (
      table.columns.some(
        (column) =>
          !actual.columns.some(
            (stored) =>
              stored.name === column.name &&
              stored.notNull === column.notNull &&
              stored.pk === column.pk,
          ),
      )
    )
      return 'incomplete columns in ' + table.name;
    if (
      table.checks.some((check) => !actual.checks.includes(check)) ||
      table.constraints.some((constraint) => !actual.constraints.includes(constraint))
    )
      return 'incomplete constraints in ' + table.name;
    if (
      table.indexes.some(
        (index) =>
          !actual.indexes.some(
            (stored) =>
              stored.name === index.name &&
              normalizeStoreSql(stored.sql) === normalizeStoreSql(index.sql),
          ),
      )
    )
      return 'incomplete indexes in ' + table.name;
    if (
      exact &&
      (actual.columns.length !== table.columns.length ||
        actual.checks.length !== table.checks.length ||
        actual.constraints.length !== table.constraints.length ||
        actual.indexes.length !== table.indexes.length)
    )
      return 'structure of ' + table.name + ' differs from the migration head';
  }
  return undefined;
}

/**
 * Must run before Drizzle migrations, run recovery, catalog seeding or trigger admission. Returns
 * `fresh` for an empty store and `current` for a complete current-format store; refuses anything
 * else with `UnsupportedStoreError`, reading only. `phase: 'head'` also requires the full shipped
 * migration head (after ordinary migrations ran).
 */
export async function guardCurrentStore(
  client: StoreReader,
  migrationsFolder = SHIPPED_MIGRATIONS,
  options: { skipDefinitions?: boolean; phase?: 'baseline' | 'head' } = {},
): Promise<'fresh' | 'current'> {
  const names = await tableNames(client);
  const application = names.filter((name) => name !== '__drizzle_migrations');
  if (application.length === 0) {
    if (
      names.includes('__drizzle_migrations') &&
      (await rows(client, 'SELECT * FROM __drizzle_migrations')).length
    )
      throw new UnsupportedStoreError(
        'The store records applied migrations but has no application tables',
      );
    return 'fresh';
  }
  await requireCurrentMarker(client, names);
  const damaged = (detail: string) =>
    new UnsupportedStoreError(
      'The format-' + String(CURRENT_DEFINITION_FORMAT) + ' store is damaged: ' + detail,
      CURRENT_DEFINITION_FORMAT,
    );
  const readiness = await currentStoreReadiness(migrationsFolder);
  const structure = await storeStructure(client);
  if (
    migrationsFolder === SHIPPED_MIGRATIONS &&
    (names.includes('template_instances') ||
      structure
        .find((table) => table.name === 'runs')
        ?.columns.some((column) => column.name === 'template_subject'))
  )
    throw damaged('retired template storage is still present');
  const phase = options.phase ?? 'baseline';
  const gap = structureGap(structure, readiness[phase], phase === 'head');
  if (gap) throw damaged(gap);
  const ledger = names.includes('__drizzle_migrations')
    ? await rows(client, 'SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
    : [];
  if (
    ledger.length < (phase === 'head' ? readiness.ledger.length : readiness.requiredLedgerLength) ||
    ledger.length > readiness.ledger.length ||
    ledger.some((entry, index) => Number(entry.created_at) !== readiness.ledger[index]?.created_at)
  )
    throw damaged('the migration ledger is incomplete or inconsistent');
  // A ledger that stops before the shipped catalogue while the structure already holds every
  // later migration's objects (a deleted ledger row, or a crash between a migration's statements
  // and its row) would have startup run those migrations again into existing objects and fail
  // inside the migrator. It is damage, refused here before any write.
  if (
    phase !== 'head' &&
    ledger.length < readiness.ledger.length &&
    structureGap(structure, readiness.head, false) === undefined
  )
    throw damaged('the migration ledger is behind the store structure');
  // A test-selected migration catalogue can stop before the authentication columns exist. The
  // shipped baseline always requires them before this data-level validation is reached.
  if (
    structure
      .find((table) => table.name === 'webhook_endpoints')
      ?.columns.some((column) => column.name === 'auth_type')
  ) {
    const malformed = await rows(
      client,
      `SELECT id FROM webhook_endpoints WHERE auth_type IS NULL OR NOT (("auth_type" = 'none' AND "signature_message" IS NULL AND "signature_header" IS NULL AND "secret_ref" IS NULL AND "window_seconds" IS NULL) OR ("auth_type" = 'hmac-sha256' AND "signature_header" IS NOT NULL AND "secret_ref" IS NOT NULL AND (("signature_message" IS NOT NULL AND "signature_message" = 'body' AND "window_seconds" IS NULL) OR ("signature_message" IS NOT NULL AND "signature_message" = 'timestamp-body' AND "window_seconds" IS NOT NULL AND typeof("window_seconds") = 'integer' AND "window_seconds" BETWEEN 1 AND 86400))))`,
    );
    if (malformed.length) throw damaged('stored webhook signing fields are inconsistent');
    const signingHeaders = await rows(
      client,
      "SELECT signature_header FROM webhook_endpoints WHERE auth_type = 'hmac-sha256'",
    );
    if (signingHeaders.some((row) => !HeaderNameSchema.safeParse(row.signature_header).success))
      throw damaged('stored webhook signing headers are not lowercase RFC tokens');
  }
  if (!options.skipDefinitions)
    for await (const batch of tableBatches(client, 'loop_versions'))
      for (const row of batch) {
        let definition: unknown;
        try {
          definition = json(row.definition);
        } catch {
          definition = undefined;
        }
        // ADR-0044: an exit that still publishes an Event is a per-loop condition, refused with
        // LOOP_UPGRADE_REQUIRED wherever that definition is served or run. It does not make the
        // store unsupported: a definition current apart from such destinations passes unchanged.
        const current =
          LoopDefinitionSchema.safeParse(definition).success ||
          (retiredEventDestinations(definition).length > 0 &&
            LoopDefinitionSchema.safeParse(withoutRetiredEventDestinations(definition)).success);
        if (!current)
          throw damaged('stored loop version ' + String(row.id) + ' is not a valid definition');
      }
  if (names.includes('settings')) {
    for (const row of await rows(client, 'SELECT key, value FROM settings')) {
      if (row.key === 'defaultModel' || row.key === 'defaultEffort')
        throw damaged('owner settings use the retired defaultModel/defaultEffort keys');
      if (row.key === 'defaults') {
        try {
          HarnessDefaultsSchema.parse(json(row.value));
        } catch {
          throw damaged('owner harness defaults are invalid');
        }
      }
    }
  }
  return 'current';
}

/** After ordinary migrations, require the entire shipped catalogue and ledger. No second parse. */
export async function verifyStoreHead(
  client: StoreReader,
  migrationsFolder = SHIPPED_MIGRATIONS,
): Promise<void> {
  if (
    (await guardCurrentStore(client, migrationsFolder, {
      phase: 'head',
      skipDefinitions: true,
    })) !== 'current'
  )
    throw new UnsupportedStoreError('Migrations did not produce a current store');
}

/** Schema, migration ledger and complete format marker commit together on first startup. */
export async function initializeFreshStore(
  client: Client,
  migrationsFolder = SHIPPED_MIGRATIONS,
): Promise<'fresh' | 'current'> {
  const tx = await client.transaction('write');
  try {
    // Recheck under the write lock: only an empty store may be initialised, even if another
    // caller changed it after startup's first guard. Never authenticate an unmarked schema.
    const state = await guardCurrentStore(tx);
    if (state === 'fresh') {
      // Drizzle's libsql migrator commits its own batch; run the SQL here so neither the schema
      // nor its ledger can survive without the complete marker.
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      for (const migration of readMigrationFiles({ migrationsFolder })) {
        for (const statement of migration.sql) await tx.execute(statement);
        await tx.execute({
          sql: 'INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)',
          args: [migration.hash, migration.folderMillis],
        });
      }
      await tx.execute(MARKER_SQL);
      await tx.execute({
        sql: "INSERT INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,?,'complete','fresh','fresh')",
        args: [CURRENT_DEFINITION_FORMAT],
      });
    }
    await tx.commit();
    return state;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // A lost connection must not replace the failure that interrupted initialisation.
    }
    throw error;
  } finally {
    tx.close();
  }
}
