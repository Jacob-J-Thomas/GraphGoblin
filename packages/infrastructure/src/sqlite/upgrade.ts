import { createHash } from 'node:crypto';
import { createClient, type Client, type Transaction } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  CURRENT_DEFINITION_FORMAT,
  HarnessDefaultsSchema,
  HeaderNameSchema,
  LoopDefinitionSchema,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import {
  stableStringify,
  upgradeLoopCurrent,
  upgradeDefaultsV1,
  validateLoop,
  type CurrentUpgradeIssue,
  type CurrentUpgradeResult,
  type UpgradeCurrentResolutions,
} from '@graphgoblin/domain';
import {
  currentStoreReadiness,
  SHIPPED_MIGRATIONS,
  storeStructure,
  normalizeStoreSql,
} from './readiness.js';
import {
  rows,
  tableNames as tables,
  tableBatches,
  hashUpgradeStore,
  quote,
} from './upgrade-scan.js';
type Executor = Pick<Client, 'execute'>;
type RawRow = Record<string, unknown>;
const MIGRATIONS = SHIPPED_MIGRATIONS;
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
const object = (value: unknown): value is RawRow =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function json(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('stored JSON column is not text');
  return JSON.parse(value);
}
export class DatabaseUpgradeRequiredError extends Error {
  readonly code = 'DATA_UPGRADE_REQUIRED';
  constructor(
    message = 'Stored data requires the offline graphgoblin-upgrade tool before startup',
  ) {
    super(message);
    this.name = 'DatabaseUpgradeRequiredError';
  }
}
/** Must run before Drizzle migrations, run recovery, catalog seeding or trigger admission. */
export async function guardDatabaseUpgrade(
  client: Executor,
  migrationsFolder = MIGRATIONS,
  options: { skipDefinitions?: boolean; phase?: 'baseline' | 'head' } = {},
): Promise<'fresh' | 'current'> {
  const names = await tables(client);
  const application = names.filter((name) => name !== '__drizzle_migrations');
  if (application.length === 0) {
    if (
      names.includes('__drizzle_migrations') &&
      (await rows(client, 'SELECT * FROM __drizzle_migrations')).length
    )
      throw new DatabaseUpgradeRequiredError(
        'Recorded migration history without application tables requires explicit repair',
      );
    return 'fresh';
  }
  const readiness = await currentStoreReadiness(migrationsFolder);
  if (!names.includes('gg_upgrade_state')) throw new DatabaseUpgradeRequiredError();
  const states = await rows(client, 'SELECT * FROM gg_upgrade_state');
  if (
    states.length !== 1 ||
    states[0]?.id !== 1 ||
    states[0]?.format_version !== readiness.marker.format_version ||
    states[0]?.status !== readiness.marker.status
  )
    throw new DatabaseUpgradeRequiredError(
      'The offline upgrade is incomplete; restore the backup or repeat the offline inspection',
    );
  const structure = await storeStructure(client);
  if (
    migrationsFolder === MIGRATIONS &&
    (names.includes('template_instances') ||
      structure
        .find((table) => table.name === 'runs')
        ?.columns.some((column) => column.name === 'template_subject'))
  )
    throw new DatabaseUpgradeRequiredError('Retired template storage requires the offline cutover');
  for (const table of readiness[options.phase ?? 'baseline']) {
    const actual = structure.find((stored) => stored.name === table.name);
    if (!actual)
      throw new DatabaseUpgradeRequiredError('Missing current-store table: ' + table.name);
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
      throw new DatabaseUpgradeRequiredError('Incomplete current-store columns: ' + table.name);
    if (
      table.checks.some((check) => !actual.checks.includes(check)) ||
      table.constraints.some((constraint) => !actual.constraints.includes(constraint))
    )
      throw new DatabaseUpgradeRequiredError('Stored constraints are incomplete: ' + table.name);
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
      throw new DatabaseUpgradeRequiredError('Stored indexes are incomplete: ' + table.name);
    if (
      options.phase === 'head' &&
      (actual.columns.length !== table.columns.length ||
        actual.checks.length !== table.checks.length ||
        actual.constraints.length !== table.constraints.length ||
        actual.indexes.length !== table.indexes.length)
    )
      throw new DatabaseUpgradeRequiredError(
        'Stored structure differs from the migration head: ' + table.name,
      );
  }
  const ledger = names.includes('__drizzle_migrations')
    ? await rows(client, 'SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
    : [];
  if (
    ledger.length <
      (options.phase === 'head' ? readiness.ledger.length : readiness.requiredLedgerLength) ||
    ledger.length > readiness.ledger.length ||
    ledger.some((entry, index) => Number(entry.created_at) !== readiness.ledger[index]?.created_at)
  )
    throw new DatabaseUpgradeRequiredError(
      'The shipped migration ledger is incomplete or inconsistent',
    );
  // An explicitly selected historical SQL catalogue can stop before 0013. The current baseline above
  // always requires auth_type before this data-level validation can be reached.
  if (
    structure
      .find((table) => table.name === 'webhook_endpoints')
      ?.columns.some((column) => column.name === 'auth_type')
  ) {
    const malformed = await rows(
      client,
      `SELECT id FROM webhook_endpoints WHERE auth_type IS NULL OR NOT (("auth_type" = 'none' AND "signature_message" IS NULL AND "signature_header" IS NULL AND "secret_ref" IS NULL AND "window_seconds" IS NULL) OR ("auth_type" = 'hmac-sha256' AND "signature_header" IS NOT NULL AND "secret_ref" IS NOT NULL AND (("signature_message" IS NOT NULL AND "signature_message" = 'body' AND "window_seconds" IS NULL) OR ("signature_message" IS NOT NULL AND "signature_message" = 'timestamp-body' AND "window_seconds" IS NOT NULL AND typeof("window_seconds") = 'integer' AND "window_seconds" BETWEEN 1 AND 86400))))`,
    );
    if (malformed.length)
      throw new DatabaseUpgradeRequiredError('Stored webhook signing fields are inconsistent');
    const signingHeaders = await rows(
      client,
      "SELECT signature_header FROM webhook_endpoints WHERE auth_type = 'hmac-sha256'",
    );
    if (signingHeaders.some((row) => !HeaderNameSchema.safeParse(row.signature_header).success))
      throw new DatabaseUpgradeRequiredError(
        'Stored webhook signing headers are not lowercase RFC tokens',
      );
  }
  if (!options.skipDefinitions)
    for await (const batch of tableBatches(client, 'loop_versions'))
      for (const row of batch) {
        try {
          LoopDefinitionSchema.parse(json(row.definition));
        } catch {
          throw new DatabaseUpgradeRequiredError(
            'A stored loop version is not strict current format',
          );
        }
      }
  if (names.includes('settings')) {
    for (const row of await rows(client, 'SELECT key, value FROM settings')) {
      if (row.key === 'defaultModel' || row.key === 'defaultEffort')
        throw new DatabaseUpgradeRequiredError('Owner defaults require offline conversion');
      if (row.key === 'defaults') {
        try {
          HarnessDefaultsSchema.parse(json(row.value));
        } catch {
          throw new DatabaseUpgradeRequiredError('Owner harness defaults are invalid');
        }
      }
    }
  }
  return 'current';
}
/** After ordinary migrations, require the entire shipped catalogue and ledger. No second parse. */
export async function verifyDatabaseHead(
  client: Executor,
  migrationsFolder = MIGRATIONS,
): Promise<void> {
  if (
    (await guardDatabaseUpgrade(client, migrationsFolder, {
      phase: 'head',
      skipDefinitions: true,
    })) !== 'current'
  )
    throw new DatabaseUpgradeRequiredError('Migrations did not produce a current store');
}
const STATE_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_state (id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL, status TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL)';
/** Schema, migration ledger and complete marker must commit together on first startup. */
export async function initializeFreshDatabase(
  client: Client,
  migrationsFolder = MIGRATIONS,
): Promise<'fresh' | 'current'> {
  const tx = await client.transaction('write');
  try {
    // Recheck under the write lock: only an empty store may be initialised, even if another
    // caller changed it after startup's first guard. Never authenticate an unmarked schema.
    const upgradeState = await guardDatabaseUpgrade(tx);
    if (upgradeState === 'fresh') {
      // Drizzle's libsql migrator commits its own batch; use the offline apply's SQL runner
      // so neither the schema nor its ledger can survive without the complete marker.
      await structuralMigrations(tx, migrationsFolder);
      await tx.execute(STATE_SQL);
      await tx.execute({
        sql: "INSERT INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,?,'complete','fresh','fresh')",
        args: [CURRENT_DEFINITION_FORMAT],
      });
    }
    await tx.commit();
    return upgradeState;
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

async function structuralMigrations(tx: Transaction, folder: string): Promise<void> {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const last = (
    await rows(tx, 'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
  )[0];
  const lastTime = Number(last?.created_at ?? 0);
  for (const migration of readMigrationFiles({ migrationsFolder: folder })) {
    if (migration.folderMillis <= lastTime) continue;
    for (const statement of migration.sql) await tx.execute(statement);
    await tx.execute({
      sql: 'INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)',
      args: [migration.hash, migration.folderMillis],
    });
  }
}

/** All history is removed, including snapshots, child notifications, admission intents and pins
 * embedded in runs, events and receipts. No historical payload is parsed or archived. */
export const RUN_HISTORY_TABLES = [
  'webhook_receipts',
  'inbound_events',
  'timers',
  'harness_sessions',
  'run_events',
  'runs',
] as const;
export interface DatabaseUpgradeRequest {
  planHash: string;
  /** Each published version and draft owns an independent set of namespaced stage maps. */
  resolutions?: Record<string, UpgradeCurrentResolutions>;
}
export interface DefinitionUpgrade {
  id: string;
  loopId: string;
  loopName: string;
  status: string;
  definitionHash: string;
  targetDefinitionHash?: string;
  conversion: 'automatic' | 'pending' | 'invalid';
  issues: CurrentUpgradeIssue[];
  notices: CurrentUpgradeResult<LoopDefinition>['notices'];
  reviewItems: CurrentUpgradeResult<LoopDefinition>['reviewItems'];
}
export interface DisarmedTrigger {
  versionId: string;
  loopId: string;
  nodeId: string;
  type: 'poll' | 'cron';
  scheduleId?: string;
}
export interface DatabaseUpgradeInventory {
  status: 'current' | 'upgrade-required';
  sourceHash: string;
  planHash: string;
  tableCounts: Record<string, number>;
  counts: {
    loops: number;
    versions: number;
    drafts: number;
    templateInstances: number;
    templateLoops: number;
    runs: number;
    events: number;
    receipts: number;
  };
  definitions: DefinitionUpgrade[];
  templateLoopIds: string[];
  blockedRuns: { id: string; loopId: string; status: string }[];
  blockedReceipts: { id: string; loopId: string; reason: string }[];
  disarm: DisarmedTrigger[];
  issues: CurrentUpgradeIssue[];
}
const invalid = (path: string, message: string): CurrentUpgradeIssue => ({
  kind: 'invalid',
  code: 'UPGRADE_STORE_INVALID',
  path,
  message,
});

/** A recorded shipped prefix must describe the actual store; never skip damaged SQL by
 * trusting only its last timestamp. Old unmarked stores are accepted here, never at startup. */
async function sourceStructureIssues(
  client: Executor,
  names: string[],
): Promise<CurrentUpgradeIssue[]> {
  const issues: CurrentUpgradeIssue[] = [];
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  const ledger = names.includes('__drizzle_migrations')
    ? await rows(client, 'SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
    : [];
  if (
    !ledger.length ||
    ledger.length > migrations.length ||
    ledger.some(
      (entry, index) =>
        entry.hash !== migrations[index]?.hash ||
        Number(entry.created_at) !== migrations[index]?.folderMillis,
    )
  )
    return [
      invalid('/__drizzle_migrations', 'Expected an exact nonempty prefix of shipped migrations'),
    ];
  const expected = createClient({ url: ':memory:' });
  try {
    for (const migration of migrations.slice(0, ledger.length))
      for (const statement of migration.sql) await expected.execute(statement);
    const application = (structure: Awaited<ReturnType<typeof storeStructure>>) =>
      structure.filter(
        (table) =>
          !['__drizzle_migrations', 'gg_upgrade_state', 'gg_upgrade_archive'].includes(table.name),
      );
    if (
      hash(application(await storeStructure(client))) !==
      hash(application(await storeStructure(expected)))
    )
      issues.push(
        invalid(
          '/',
          'Stored structure differs from its shipped migration prefix; repair before cutover',
        ),
      );
  } finally {
    expected.close();
  }
  if (names.includes('gg_upgrade_state')) {
    const state = await rows(client, 'SELECT * FROM gg_upgrade_state');
    if (
      state.length !== 1 ||
      state[0]?.id !== 1 ||
      state[0]?.status !== 'complete' ||
      ![1, 2, 3, 4].includes(Number(state[0]?.format_version))
    )
      issues.push(
        invalid(
          '/gg_upgrade_state',
          'Incomplete or invalid completion marker; restore or repair first',
        ),
      );
    if (state[0]?.format_version === CURRENT_DEFINITION_FORMAT) {
      try {
        await guardDatabaseUpgrade(client, MIGRATIONS, { phase: 'head' });
      } catch {
        issues.push(
          invalid('/gg_upgrade_state', 'Claimed format-4 store is incomplete; repair first'),
        );
      }
    }
  }
  return issues;
}

function disarmDefinition(definition: LoopDefinition): LoopDefinition {
  return {
    ...definition,
    nodes: definition.nodes.map((node) =>
      node.kind === 'trigger' && (node.config.type === 'poll' || node.config.type === 'cron')
        ? { ...node, config: { ...node.config, enabled: false } }
        : node,
    ),
  };
}
async function convert(row: RawRow, resolutions: UpgradeCurrentResolutions = {}, disarm = true) {
  const result = await upgradeLoopCurrent(
    json(row.definition),
    resolutions,
    'store-version:' + String(row.id),
  );
  if (!result.ok) return result;
  const value = LoopDefinitionSchema.parse(disarm ? disarmDefinition(result.value) : result.value);
  const errors = validateLoop(value).filter((entry) => entry.severity === 'error');
  if (errors.length)
    return {
      ...result,
      ok: false as const,
      issues: errors.map((entry) => invalid('/loop_versions/' + String(row.id), entry.message)),
    };
  return { ...result, value };
}

async function convertedOwnerDefaults(client: Executor) {
  const stored = await rows(client, 'SELECT * FROM settings ORDER BY owner_id,key');
  const changes: { ownerId: string; value: unknown; updatedAt: string }[] = [];
  const issues: CurrentUpgradeIssue[] = [];
  for (const row of stored)
    if (row.key === 'defaults') {
      try {
        HarnessDefaultsSchema.parse(json(row.value));
      } catch {
        issues.push(invalid('/settings/' + String(row.owner_id), 'Invalid owner harness defaults'));
      }
    }
  for (const ownerId of new Set(
    stored
      .filter((row) => row.key === 'defaultModel' || row.key === 'defaultEffort')
      .map((row) => String(row.owner_id)),
  )) {
    const selected = stored.filter((row) => row.owner_id === ownerId);
    try {
      const old = Object.fromEntries(
        selected
          .filter((row) => row.key === 'defaultModel' || row.key === 'defaultEffort')
          .map((row) => [row.key === 'defaultModel' ? 'model' : 'effort', json(row.value)]),
      );
      const result = upgradeDefaultsV1(old);
      if (!result.ok || selected.some((row) => row.key === 'defaults'))
        throw new Error('Conflicting defaults');
      changes.push({ ownerId, value: result.value, updatedAt: String(selected[0]!.updated_at) });
    } catch {
      issues.push(invalid('/settings/' + ownerId, 'Owner default conversion refused'));
    }
  }
  return { changes, issues };
}

/** Read-only inspection under the caller's stopped-data lock. Large history tables are only
 * counted and incrementally hashed; conversion retains only the definition working set. */
export async function inspectDatabaseUpgrade(
  client: Executor,
  resolutions: Record<string, UpgradeCurrentResolutions> = {},
): Promise<DatabaseUpgradeInventory> {
  const names = await tables(client);
  const issues = await sourceStructureIssues(client, names);
  let current = false;
  try {
    current = (await guardDatabaseUpgrade(client, MIGRATIONS, { phase: 'head' })) === 'current';
  } catch {
    /* old stores require explicit cutover */
  }

  if (names.includes('settings')) issues.push(...(await convertedOwnerDefaults(client)).issues);
  const tableCounts: Record<string, number> = {};
  for (const name of names)
    tableCounts[name] = Number(
      (await rows(client, 'SELECT COUNT(*) AS count FROM ' + quote(name)))[0]!.count,
    );
  const templateLoops = new Set<string>();
  if (names.includes('template_instances'))
    for (const row of await rows(client, 'SELECT * FROM template_instances ORDER BY id')) {
      try {
        const instance = json(row.instance);
        if (
          !object(instance) ||
          !Array.isArray(instance.loops) ||
          instance.loops.some((loop: unknown) => !object(loop) || typeof loop.loopId !== 'string')
        )
          throw new Error('Invalid template loop identities');
        for (const loop of instance.loops as { loopId: string }[]) templateLoops.add(loop.loopId);
      } catch {
        issues.push(
          invalid('/template_instances/' + String(row.id), 'Cannot identify template loops safely'),
        );
      }
    }
  const loopNames = new Map(
    names.includes('loops')
      ? (await rows(client, 'SELECT id,name FROM loops')).map((row) => [
          String(row.id),
          String(row.name),
        ])
      : [],
  );
  const definitions: DefinitionUpgrade[] = [];
  const disarm: DisarmedTrigger[] = [];
  if (names.includes('loop_versions'))
    for await (const batch of tableBatches(client, 'loop_versions'))
      for (const row of batch) {
        if (templateLoops.has(String(row.loop_id))) continue;
        try {
          const input = json(row.definition);
          const result = await convert(row, resolutions?.[String(row.id)], !current);
          const errors = result.ok
            ? result.value.nodes
                .filter(
                  (node) =>
                    node.kind === 'subloop' && templateLoops.has(node.config.loopRef.loopId),
                )
                .map((node) =>
                  invalid(
                    '/loop_versions/' + String(row.id) + '/nodes/' + node.id,
                    'Ordinary subloop references a retired template loop; replace the reference in the old build',
                  ),
                )
            : result.issues;
          definitions.push({
            id: String(row.id),
            loopId: String(row.loop_id),
            loopName: loopNames.get(String(row.loop_id)) ?? String(row.loop_id),
            status: String(row.status),
            definitionHash: hash(input),
            ...(result.ok ? { targetDefinitionHash: hash(result.value) } : {}),
            conversion: errors.some((entry) => entry.kind === 'invalid')
              ? 'invalid'
              : result.ok
                ? 'automatic'
                : 'pending',
            issues: errors,
            notices: result.notices,
            reviewItems: result.reviewItems,
          });
          const source = result.ok ? result.value : input;
          if (object(source) && Array.isArray(source.nodes))
            for (const node of source.nodes as unknown[]) {
              if (!object(node) || node.kind !== 'trigger' || !object(node.config)) continue;
              const type = node.config.type ?? node.config.subtype;
              if (type === 'poll' || type === 'cron')
                disarm.push({
                  versionId: String(row.id),
                  loopId: String(row.loop_id),
                  nodeId: String(node.id),
                  type,
                });
            }
        } catch {
          definitions.push({
            id: String(row.id),
            loopId: String(row.loop_id),
            loopName: loopNames.get(String(row.loop_id)) ?? String(row.loop_id),
            status: String(row.status),
            definitionHash: hash(row.definition),
            conversion: 'invalid',
            issues: [invalid('/loop_versions/' + String(row.id), 'Invalid stored definition JSON')],
            notices: [],
            reviewItems: [],
          });
        }
      }
  definitions.sort((a, b) => a.id.localeCompare(b.id));
  if (!object(resolutions))
    issues.push(invalid('/resolutions', 'Expected a map keyed by version or draft id'));
  else
    for (const id of Object.keys(resolutions))
      if (!definitions.some((entry) => entry.id === id))
        issues.push(
          invalid('/resolutions/' + id, 'Unused resolution: unknown or retired version/draft'),
        );
  const blockedRuns: DatabaseUpgradeInventory['blockedRuns'] = [];
  if (names.includes('runs'))
    for (const run of await rows(
      client,
      "SELECT id,loop_id,status FROM runs WHERE status IN ('queued','running','waiting','paused') ORDER BY id",
    ))
      if (!templateLoops.has(String(run.loop_id)))
        blockedRuns.push({
          id: String(run.id),
          loopId: String(run.loop_id),
          status: String(run.status),
        });
  const blockedReceipts: DatabaseUpgradeInventory['blockedReceipts'] = [];
  if (names.includes('webhook_receipts'))
    for (const receipt of await rows(
      client,
      "SELECT id,loop_id FROM webhook_receipts WHERE status='pending' ORDER BY id",
    ))
      if (!templateLoops.has(String(receipt.loop_id)))
        blockedReceipts.push({
          id: String(receipt.id),
          loopId: String(receipt.loop_id),
          reason: 'Pending receipt or frozen admission intent; settle in the old build',
        });
  if (names.includes('schedules'))
    for (const schedule of await rows(
      client,
      'SELECT id,loop_id,version_id,trigger_node_id FROM schedules ORDER BY id',
    ))
      if (!templateLoops.has(String(schedule.loop_id)))
        disarm.push({
          scheduleId: String(schedule.id),
          versionId: String(schedule.version_id),
          loopId: String(schedule.loop_id),
          nodeId: String(schedule.trigger_node_id),
          type: 'cron',
        });
  disarm.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const sourceHash = hash({
    rows: await hashUpgradeStore(client, names),
    structure: await storeStructure(client),
  });
  const plan = {
    status: current ? ('current' as const) : ('upgrade-required' as const),
    sourceHash,
    tableCounts,
    counts: {
      loops: tableCounts.loops ?? 0,
      versions: definitions.filter((entry) => entry.status === 'published').length,
      drafts: definitions.filter((entry) => entry.status === 'draft').length,
      templateInstances: tableCounts.template_instances ?? 0,
      templateLoops: templateLoops.size,
      runs: tableCounts.runs ?? 0,
      events: tableCounts.run_events ?? 0,
      receipts: tableCounts.webhook_receipts ?? 0,
    },
    definitions,
    templateLoopIds: [...templateLoops].sort(),
    blockedRuns,
    blockedReceipts,
    disarm: current ? [] : disarm,
    issues,
  };
  return {
    ...plan,
    planHash: hash({
      rule: 'format-4-definitions-only-v1',
      migrations: readMigrationFiles({ migrationsFolder: MIGRATIONS }),
      resolutions,
      plan,
    }),
  };
}

/** Offline only. verifySafety must recheck the caller's lock and verified complete backup.
 * Artifact deletion follows commit in the CLI, never inside this database transaction. */
export async function applyDatabaseUpgrade(
  client: Client,
  request: DatabaseUpgradeRequest,
  options: { verifySafety?: () => Promise<void> } = {},
): Promise<{
  status: 'current' | 'upgraded';
  sourceHash: string;
  planHash: string;
  definitions: number;
  deletedRuns: number;
}> {
  if (!options.verifySafety)
    throw new DatabaseUpgradeRequiredError(
      'A held directory lock and verified complete backup are required',
    );
  await options.verifySafety();
  const tx = await client.transaction('write');
  try {
    const plan = await inspectDatabaseUpgrade(tx, request.resolutions);
    if (plan.planHash !== request.planHash)
      throw new DatabaseUpgradeRequiredError('Plan hash changed; inspect and review again');
    if (plan.issues.length || plan.definitions.some((entry) => entry.conversion !== 'automatic'))
      throw new DatabaseUpgradeRequiredError(
        'Unresolved pending or invalid conversion items; inspect with resolutions',
      );
    if (plan.status === 'current') {
      await tx.rollback();
      return {
        status: 'current',
        sourceHash: plan.sourceHash,
        planHash: plan.planHash,
        definitions: 0,
        deletedRuns: 0,
      };
    }
    if (plan.blockedRuns.length || plan.blockedReceipts.length)
      throw new DatabaseUpgradeRequiredError(
        'Settle ordinary nonterminal runs and pending receipts/admission intents in the old build',
      );
    const names = await tables(tx);
    for (const name of RUN_HISTORY_TABLES)
      if (names.includes(name)) await tx.execute('DELETE FROM ' + quote(name));
    for (const id of plan.templateLoopIds) {
      for (const table of ['schedules', 'webhook_endpoints', 'loop_versions'])
        await tx.execute({ sql: 'DELETE FROM ' + quote(table) + ' WHERE loop_id=?', args: [id] });
      await tx.execute({ sql: 'DELETE FROM loops WHERE id=?', args: [id] });
    }
    if (names.includes('template_instances')) await tx.execute('DELETE FROM template_instances');
    if (names.includes('gg_upgrade_archive')) await tx.execute('DROP TABLE gg_upgrade_archive');
    await structuralMigrations(tx, MIGRATIONS);
    for await (const batch of tableBatches(tx, 'loop_versions'))
      for (const row of batch) {
        const converted = await convert(row, request.resolutions?.[String(row.id)]);
        if (
          !converted.ok ||
          hash(converted.value) !==
            plan.definitions.find((entry) => entry.id === String(row.id))?.targetDefinitionHash
        )
          throw new DatabaseUpgradeRequiredError('Definition conversion changed during apply');
        // Tokens/config hashes are derived from definitions at read time, not stored columns.
        await tx.execute({
          sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
          args: [JSON.stringify(converted.value), String(row.id)],
        });
      }
    for (const change of (await convertedOwnerDefaults(tx)).changes) {
      await tx.execute({
        sql: 'INSERT INTO settings (owner_id,key,value,updated_at) VALUES (?,?,?,?)',
        args: [change.ownerId, 'defaults', JSON.stringify(change.value), change.updatedAt],
      });
      await tx.execute({
        sql: "DELETE FROM settings WHERE owner_id=? AND key IN ('defaultModel','defaultEffort')",
        args: [change.ownerId],
      });
    }
    await tx.execute('UPDATE schedules SET enabled=0');
    await tx.execute(STATE_SQL);
    await tx.execute({
      sql: "INSERT OR REPLACE INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,?,'complete',?,?)",
      args: [CURRENT_DEFINITION_FORMAT, plan.sourceHash, plan.planHash],
    });
    await guardDatabaseUpgrade(tx);
    await verifyDatabaseHead(tx);
    if (
      (await rows(tx, 'PRAGMA integrity_check'))[0]?.integrity_check !== 'ok' ||
      (await rows(tx, 'PRAGMA foreign_key_check')).length
    )
      throw new DatabaseUpgradeRequiredError('Final database integrity check failed');
    await options.verifySafety();
    await tx.commit();
    return {
      status: 'upgraded',
      sourceHash: plan.sourceHash,
      planHash: plan.planHash,
      definitions: plan.definitions.length,
      deletedRuns: plan.counts.runs,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      /* Preserve the original transaction failure. */
    }
    throw error;
  } finally {
    tx.close();
  }
}
