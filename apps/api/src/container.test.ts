import { LoopDefinitionSchema, type RunRecord } from '@graphgoblin/contracts';
import { minimalLoop, samplePin, FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { JevDecider } from '@graphgoblin/adapter-jev';
import { openDatabase, openReadOnlyDatabaseClient } from '@graphgoblin/infrastructure/sqlite';
import { createInitialThread } from '@graphgoblin/engine';
import { CapturingLogger, singleNodeLoop } from '@graphgoblin/engine/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { JEV_SECRET, LOCAL_OWNER, createContainer, type Container } from './container.js';
import { StoreRefusedError } from './store-refusal.js';
import type { ApiInstance } from './types.js';
import { startFakeClassifierEndpoint } from './testing/fake-classifier.js';

// Interpose only on the external libsql client. Resolve from its declaring package:
// the API intentionally depends on the infrastructure port, not directly on libsql.
const libsqlPath = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.resolve('@graphgoblin/infrastructure/sqlite'));
  const entry = require.resolve('@libsql/client');
  const esm = entry.replace('lib-cjs', 'lib-esm');
  if (esm === entry) throw new Error(`Unexpected libsql module layout: ${entry}`);
  // Resolve the actual mock target now, so a layout change fails before any migration gate.
  return require.resolve(esm);
});
type SqliteClient = ReturnType<typeof openDatabase>['client'];
let migrationGate: { entered(): void; held: Promise<void> } | undefined;
vi.mock(libsqlPath, async (importOriginal) => {
  const actual = await importOriginal<{ createClient(options: { url: string }): SqliteClient }>();
  return {
    ...actual,
    createClient: (options: { url: string }) => {
      const client = actual.createClient(options);
      return new Proxy(client, {
        get(target, key) {
          if (key === 'transaction')
            return async (...args: Parameters<SqliteClient['transaction']>) => {
              const gate = migrationGate;
              if (gate) {
                migrationGate = undefined;
                gate.entered();
                await gate.held;
              }
              return client.transaction(...args);
            };
          const value: unknown = Reflect.get(target, key, target);
          const forwarded: unknown = typeof value === 'function' ? value.bind(target) : value;
          return forwarded;
        },
      });
    },
  };
});

function holdMigrationTransaction() {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  migrationGate = { entered, held };
  return { reached, release };
}

async function queueRecoveryWork(container: Container) {
  const { loop } = await container.repos.loops.create(
    LOCAL_OWNER,
    LoopDefinitionSchema.parse(
      singleNodeLoop('seed before recovery', {
        id: 'work',
        kind: 'script',
        label: 'Work',
        config: { command: 'fixture' },
      }),
    ),
  );
  const version = await container.repos.loops.publish(loop.id);
  if (!version) throw new Error('expected published fixture');
  // Pinned as a start would pin it (ADR-0041): the published version, no defaults or classifiers.
  const pinned = samplePin({
    version: version.version,
    name: version.definition.name,
    label: `${version.definition.name} v${version.version}`,
  });
  const run: RunRecord = {
    id: FIXTURE_IDS.run,
    ownerId: LOCAL_OWNER,
    loopId: loop.id,
    versionId: version.id,
    pinned,
    invocationId: FIXTURE_IDS.invocation,
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: loop.id,
    versionId: version.id,
    invocation: {
      id: run.invocationId,
      source: 'manual.api',
      trigger: {
        kind: 'manual',
        nodeId: 'start',
        payload: null,
        receivedAt: FIXTURE_TS,
      },
    },
  });
  // Real durable admission without dispatch: only the next container's recovery can run it.
  return container.ports.admission.create({
    run,
    initialThread,
    pinnedLoopIds: [loop.id],
    queued: {
      type: 'run.queued',
      versionId: version.id,
      pinned,
      initialThread,
      subloopVersions: {},
    },
  });
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-container-'));
});

afterEach(async () => {
  migrationGate = undefined;
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

function config(env: Record<string, string> = {}) {
  return loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'gg.db').replace(/\\/g, '/')}`,
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...env,
  });
}

/** Resolve Jev as a run started now would: bind the current entry, then resolve that binding. */
async function resolveJev(container: Container, primitive: 'choice' | 'noul') {
  const binding = await container.classifierRegistry.bind(LOCAL_OWNER, 'jev');
  if (!binding) throw new Error('the built-in classifier is always catalogued');
  return container.classifierRegistry.resolve(LOCAL_OWNER, 'jev', primitive, binding);
}

async function jevAvailable(container: Container): Promise<boolean> {
  return (await resolveJev(container, 'noul')).status === 'ready';
}

describe('default adapters', () => {
  let container: Container;
  let app: ApiInstance;
  const hook = vi.fn(() => Promise.resolve());

  beforeEach(async () => {
    hook.mockClear();
    // No harness, structured, or decider overrides: the real Codex and Jev adapters are wired.
    // Nothing here starts a session, so the Codex CLI is never spawned.
    container = await createContainer(config(), { startTimers: false, secretHooks: [hook] });
    await container.start();
    app = await buildApp(container, { logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await container.stop();
  });

  it('registers the Codex harness, structured completions, and the Codex evaluator and classifier registry', () => {
    expect(container.ports.harnesses.codex).toBeInstanceOf(CodexHarness);
    expect(container.ports.structured).toBeDefined();
    expect(container.ports.deciders.map((d) => d.id)).toEqual(['codex']);
    expect(container.ports.deciders[0]?.available()).toBe(true);
  });

  it('starts without a Jev key and leaves Jev unavailable', async () => {
    expect(await jevAvailable(container)).toBe(false);
  });

  it('refreshes Jev when its key secret is set or deleted through the API', async () => {
    const set = await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'test-key' },
    });
    expect(set.statusCode).toBe(200);
    expect(await jevAvailable(container)).toBe(true);
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, JEV_SECRET);

    const deleted = await app.inject({ method: 'DELETE', url: `/secrets/${JEV_SECRET}` });
    expect(deleted.statusCode).toBe(204);
    expect(await jevAvailable(container)).toBe(false);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('ignores other secrets and other owners', async () => {
    await app.inject({
      method: 'PUT',
      url: `/secrets/${JEV_SECRET}`,
      payload: { value: 'configured-key' },
    });
    const before = await resolveJev(container, 'noul');
    if (before.status !== 'ready') throw new Error('expected configured Jev');
    await app.inject({ method: 'PUT', url: '/secrets/other', payload: { value: 'x' } });
    await container.onSecretChanged('someone-else', JEV_SECRET);
    const after = await resolveJev(container, 'noul');
    if (after.status !== 'ready') throw new Error('expected unchanged Jev availability');
    expect(after.classifier).toBe(before.classifier);
    expect(await jevAvailable(container)).toBe(true);
    expect(hook).toHaveBeenCalledWith(LOCAL_OWNER, 'other');
  });

  it('does not notify when deleting a secret that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/secrets/missing' });
    expect(res.statusCode).toBe(404);
    expect(hook).not.toHaveBeenCalled();
  });

  it('shares configured Noul and Choice classifier snapshots and invalidates them after key and enable changes', async () => {
    const fake = await startFakeClassifierEndpoint();
    try {
      const entry = await container.repos.classifiers.findOne(LOCAL_OWNER, 'jev');
      if (!entry) throw new Error('missing built-in Jev');
      await container.repos.classifiers.seedBuiltin(LOCAL_OWNER, {
        ...entry,
        endpoint: fake.endpoint,
      });
      await container.onClassifierChanged(LOCAL_OWNER, 'jev');
      await app.inject({
        method: 'PUT',
        url: `/secrets/${JEV_SECRET}`,
        payload: { value: 'first-key' },
      });
      const first = await resolveJev(container, 'choice');
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') throw new Error('expected configured Jev');
      expect(first.classifier).toBeInstanceOf(JevDecider);
      expect(await resolveJev(container, 'choice')).toEqual(first);
      await app.inject({
        method: 'PUT',
        url: `/secrets/${JEV_SECRET}`,
        payload: { value: 'second-key' },
      });
      const next = await resolveJev(container, 'choice');
      expect(next.status).toBe('ready');
      if (next.status !== 'ready') throw new Error('expected configured Jev');
      expect(next.classifier).not.toBe(first.classifier);
      const noul = await resolveJev(container, 'noul');
      if (noul.status !== 'ready') throw new Error('expected configured Noul');
      expect(noul.classifier).toBe(next.classifier);
      expect(
        await next.classifier.classifyNoul(
          {
            question: 'Done?',
            context: { change: 1 },
            criteria: { true: 'Ready', false: 'Continue' },
          },
          new AbortController().signal,
        ),
      ).toEqual({ type: 'noul', trueProbability: 1 });
      expect(
        await next.classifier.choose(
          {
            question: 'Route?',
            context: { change: 2 },
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Approve' },
              { id: 'no', label: 'No', criteria: 'Revise' },
            ],
          },
          new AbortController().signal,
        ),
      ).toEqual({
        type: 'choice',
        optionId: 'yes',
        confidence: 1,
        probabilities: { yes: 1, no: 0 },
      });
      expect(fake.requests).toEqual([
        {
          method: 'POST',
          url: '/v1/systemone',
          authorization: 'Bearer second-key',
          body: {
            model: entry.providerModel,
            state: { change: 1 },
            questions: {
              answer: {
                type: 'noul',
                instructions: 'Done?',
                criteria: { true: 'Ready', false: 'Continue' },
              },
            },
          },
        },
        {
          method: 'POST',
          url: '/v1/systemone',
          authorization: 'Bearer second-key',
          body: {
            model: entry.providerModel,
            state: { change: 2 },
            questions: {
              answer: {
                type: 'choice',
                instructions: 'Route?',
                criteria: { yes: 'Approve', no: 'Revise' },
              },
            },
          },
        },
      ]);
      await app.inject({
        method: 'PATCH',
        url: '/classifier-models/jev',
        payload: { enabled: false },
      });
      expect(await jevAvailable(container)).toBe(false);
      expect(await resolveJev(container, 'choice')).toMatchObject({
        reason: 'CLASSIFIER_MODEL_DISABLED',
      });
      await app.inject({
        method: 'PATCH',
        url: '/classifier-models/jev',
        payload: { enabled: true },
      });
      expect(await jevAvailable(container)).toBe(true);
      await app.inject({ method: 'DELETE', url: `/secrets/${JEV_SECRET}` });
      expect(await jevAvailable(container)).toBe(false);
      expect(await resolveJev(container, 'choice')).toMatchObject({
        reason: 'CLASSIFIER_SECRET_MISSING',
      });
    } finally {
      await fake.close();
    }
  });
});

describe('Jev key at boot', () => {
  it('seeds before recovery, refreshes metadata, and preserves a disabled built-in across real restarts', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    await first.repos.classifiers.setEnabled(LOCAL_OWNER, 'jev', false);
    await first.handle.client.execute(
      "UPDATE classifier_models SET display_name = 'stale' WHERE id = 'jev'",
    );
    const queued = await queueRecoveryWork(first);
    await first.stop();
    let observed = false;
    const second = await createContainer(config(), {
      startTimers: false,
      scripts: {
        run: async () => {
          expect(await second.repos.classifiers.findOne(LOCAL_OWNER, 'jev')).toMatchObject({
            displayName: 'Jev',
            enabled: false,
          });
          observed = true;
          return {
            exitCode: 0,
            stdout: 'recovered',
            stderr: '',
            state: 'completed' as const,
            timedOut: false,
            stdoutBytes: 9,
            stderrBytes: 0,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    });
    try {
      await second.start();
      await second.manager.waitForIdle();
      expect(observed).toBe(true);
      expect((await second.repos.runs.get(queued.id))?.status).toBe('succeeded');
      expect(await jevAvailable(second)).toBe(false);
    } finally {
      await second.stop();
    }
  });
  it('seeds an encrypted local-owner secret once, keeps it across restarts, and never logs the value', async () => {
    const key = 'test-environment-seed-key';
    const logger = new CapturingLogger();
    const first = await createContainer(config({ GG_JEV_API_KEY: key }), {
      startTimers: false,
      logger,
    });
    try {
      await first.start();
      await first.start();
      expect(await first.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await first.repos.secretsFor('other-owner').resolve(JEV_SECRET)).toBeUndefined();
      expect(await jevAvailable(first)).toBe(true);
      const rows = await first.handle.db.query.secrets.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ciphertext).not.toContain(key);
      expect(logger.lines.filter((line) => line.level === 'info')).toEqual([
        { level: 'info', obj: {}, msg: 'seeded jev-api-key from GG_JEV_API_KEY' },
      ]);
      expect(JSON.stringify(logger.lines)).not.toContain(key);
    } finally {
      await first.stop();
    }

    logger.lines.length = 0;
    const second = await createContainer(config(), { startTimers: false, logger });
    try {
      await second.start();
      expect(await second.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await jevAvailable(second)).toBe(true);
      expect(logger.lines).toEqual([]);
    } finally {
      await second.stop();
    }
  });

  it.each(['stored-key', ''])(
    'preserves an existing secret, including an empty value (%j)',
    async (stored) => {
      const first = await createContainer(config(), { startTimers: false });
      let before;
      try {
        await first.start();
        await first.repos.secretsFor(LOCAL_OWNER).set(JEV_SECRET, stored);
        before = await first.handle.db.query.secrets.findMany();
      } finally {
        await first.stop();
      }

      const envKey = 'test-ignored-environment-key';
      const logger = new CapturingLogger();
      const second = await createContainer(config({ GG_JEV_API_KEY: envKey }), {
        startTimers: false,
        logger,
      });
      try {
        await second.start();
        expect(await second.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(stored);
        expect(await second.handle.db.query.secrets.findMany()).toEqual(before);
        expect(logger.lines).toEqual([]);
        expect(JSON.stringify(logger.lines)).not.toContain(envKey);
      } finally {
        await second.stop();
      }
    },
  );

  it.each([
    {},
    { GG_JEV_API_KEY: '' },
    { JEV_API_KEY: '' },
    { GG_JEV_API_KEY: '', JEV_API_KEY: 'test-unused-fallback-key' },
  ])('does nothing without a non-empty environment seed (%j)', async (env) => {
    const logger = new CapturingLogger();
    const container = await createContainer(config(env), { startTimers: false, logger });
    try {
      await container.start();
      expect(await container.repos.secretsFor(LOCAL_OWNER).list()).toEqual([]);
      expect(await jevAvailable(container)).toBe(false);
      expect(logger.lines).toEqual([]);
    } finally {
      await container.stop();
    }
  });

  it('seeds from JEV_API_KEY when GG_JEV_API_KEY is unset, even if another owner has a key', async () => {
    const key = 'test-fallback-environment-key';
    const logger = new CapturingLogger();
    const container = await createContainer(config({ JEV_API_KEY: key }), {
      startTimers: false,
      logger,
    });
    try {
      await container.handle.migrate();
      await container.repos.secretsFor('other-owner').set(JEV_SECRET, 'other-owner-key');
      await container.start();
      expect(await container.repos.secretsFor(LOCAL_OWNER).resolve(JEV_SECRET)).toBe(key);
      expect(await container.repos.secretsFor('other-owner').resolve(JEV_SECRET)).toBe(
        'other-owner-key',
      );
      expect(await jevAvailable(container)).toBe(true);
      expect(logger.lines.filter((line) => line.level === 'info')).toEqual([
        { level: 'info', obj: {}, msg: 'seeded jev-api-key from GG_JEV_API_KEY' },
      ]);
      expect(JSON.stringify(logger.lines)).not.toContain(key);
    } finally {
      await container.stop();
    }
  });

  it('picks up a key stored before the process started', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    await first.repos.secretsFor(LOCAL_OWNER).set(JEV_SECRET, 'stored-key');
    await first.stop();

    const second = await createContainer(config({ GG_CODEX_BINARY: 'C:/tools/codex.exe' }), {
      startTimers: false,
    });
    expect(second.config.codexBinary).toBe('C:/tools/codex.exe');
    await second.start();
    try {
      expect(await jevAvailable(second)).toBe(true);
    } finally {
      await second.stop();
    }
  });
});

describe('container directory ownership', () => {
  it('refuses a second container before opening or recovering the store, and releases on stop', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    const lockPath = join(dataDir, 'graphgoblin.lock');
    const lock = await readFile(lockPath, 'utf8');
    try {
      await expect(createContainer(config({ GG_PORT: '4749' }))).rejects.toThrow(
        `another GraphGoblin process holds ${lockPath}`,
      );
      expect(await readFile(lockPath, 'utf8')).toBe(lock);
    } finally {
      await first.stop();
      await first.stop();
    }
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const next = await createContainer(config(), { startTimers: false });
    await next.start();
    const lockOfNext = await readFile(lockPath, 'utf8');
    await expect(first.start()).rejects.toThrow('container has been stopped');
    expect(await readFile(lockPath, 'utf8')).toBe(lockOfNext);
    await next.stop();
  });

  it('releases ownership if container construction fails', async () => {
    await expect(createContainer(config({ GG_MASTER_KEY: 'invalid' }))).rejects.toThrow(
      'GG_MASTER_KEY must decode to exactly 32 bytes',
    );
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('releases ownership without recovery or writes when readiness fails during migration', async () => {
    const first = await createContainer(config(), { startTimers: false });
    await first.start();
    const queued = await queueRecoveryWork(first);
    await first.stop();
    const container = await createContainer(config(), { startTimers: false });
    await container.handle.client.execute('UPDATE gg_upgrade_state SET format_version=99');
    const tables = [
      'runs',
      'run_events',
      'classifier_models',
      'model_catalog',
      'settings',
      '__drizzle_migrations',
    ];
    const before = await Promise.all(
      tables.map((table) => container.handle.client.execute(`SELECT * FROM "${table}"`)),
    );
    const refusal = await container.start().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(StoreRefusedError);
    expect(refusal).toMatchObject({
      code: 'STORE_UNSUPPORTED',
      refusal: {
        foundFormat: 99,
        requiredFormat: 4,
        reason: 'The store is format 99; this build reads only format 4',
      },
    });
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const inspection = openReadOnlyDatabaseClient(join(dataDir, 'gg.db'));
    try {
      for (const [index, table] of tables.entries())
        expect((await inspection.execute(`SELECT * FROM "${table}"`)).rows).toEqual(
          before[index]!.rows,
        );
      expect(
        (await inspection.execute({ sql: 'SELECT status FROM runs WHERE id=?', args: [queued.id] }))
          .rows,
      ).toEqual([expect.objectContaining({ status: 'queued' })]);
    } finally {
      inspection.close();
      await container.stop();
    }
  });

  it('serializes repeated starts and holds ownership until a stop during migration finishes', async () => {
    const container = await createContainer(config(), { startTimers: false });
    const gate = holdMigrationTransaction();
    const starting = container.start();
    const repeated = container.start();
    const stopping = container.stop();
    try {
      await gate.reached;
      expect(repeated).toBe(starting);
      await expect(access(join(dataDir, 'graphgoblin.lock'))).resolves.toBeUndefined();
      await expect(createContainer(config())).rejects.toThrow('another GraphGoblin process holds');
    } finally {
      gate.release();
      await Promise.all([starting, repeated, stopping]);
    }
    await expect(access(join(dataDir, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('configuration admission before startup writes', () => {
  it('does not create SQLite/master-key files for an unknown process default', async () => {
    const invalid = config({
      GG_DEFAULTS: JSON.stringify({
        byHarness: { codex: { model: 'not-in-catalog', effort: 'low' } },
      }),
    });
    await expect(createContainer(invalid, { startTimers: false })).rejects.toThrow(
      /Invalid GG_DEFAULTS/,
    );
    for (const name of ['gg.db', 'master.key', 'graphgoblin.lock'])
      await expect(access(join(dataDir, name))).rejects.toThrow();
  });
  it('reads existing manual catalog entries without changing database bytes or rows on invalid effort', async () => {
    const valid = config();
    const first = await createContainer(valid, { startTimers: false });
    await first.start();
    await first.repos.catalog.upsert({
      harness: 'codex',
      model: 'manual-model',
      source: 'litellm',
      displayName: 'Manual',
      enabled: true,
      efforts: ['low'],
      defaultEffort: 'low',
    });
    await first.handle.client.execute('PRAGMA journal_mode=DELETE');
    await first.stop();
    const file = join(dataDir, 'gg.db');
    const before = await readFile(file);
    await expect(
      createContainer(
        config({
          GG_DEFAULTS: JSON.stringify({
            byHarness: { codex: { model: 'manual-model', effort: 'high' } },
          }),
        }),
        { startTimers: false },
      ),
    ).rejects.toThrow(/Invalid GG_DEFAULTS/);
    expect(await readFile(file)).toEqual(before);
    const second = await createContainer(
      config({
        GG_DEFAULTS: JSON.stringify({
          byHarness: { codex: { model: 'manual-model', effort: 'low' } },
        }),
      }),
      { startTimers: false },
    );
    await second.stop();
    expect(await readFile(file)).toEqual(before);
  });
  it('refuses an old store before creating a master key or applying migrations', async () => {
    const handle = openDatabase({ url: config().dbUrl });
    await handle.client.execute('CREATE TABLE old_data(id TEXT)');
    handle.close();
    const refusal = await createContainer(config(), { startTimers: false }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(StoreRefusedError);
    expect(refusal).toMatchObject({
      code: 'STORE_UNSUPPORTED',
      message: [
        `GraphGoblin did not start: this build cannot open the store in data directory ${dataDir}.`,
        `  Database: ${join(dataDir, 'gg.db')}`,
        '  Found:    no valid format marker',
        '  Requires: format 4',
        '  Reason:   The store has no format marker; an older GraphGoblin build wrote it',
        'No stored data was changed. This build does not convert stores from other formats.',
        'To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):',
        `  node apps/api/dist/main.js --reset --data-dir "${dataDir}"`,
      ].join('\n'),
    });
    await expect(access(join(dataDir, 'master.key'))).rejects.toThrow();
    const inspection = openDatabase({ url: config().dbUrl });
    try {
      expect(
        (
          await inspection.client.execute(
            "SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      inspection.close();
    }
  });
});

it('admits a valid stored definition before recovery', async () => {
  const settings = config();
  const prepared = openDatabase({ url: settings.dbUrl });
  await prepared.migrate();
  await prepared.client.execute({
    sql: 'INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
    args: [
      FIXTURE_IDS.version,
      FIXTURE_IDS.loop,
      'published',
      JSON.stringify({ ...minimalLoop(), name: 'Readiness once sentinel' }),
      FIXTURE_TS,
    ],
  });
  prepared.close();
  const container = await createContainer(settings, { startTimers: false });
  try {
    await container.start();
    expect(await container.repos.loops.getVersion(FIXTURE_IDS.version)).toMatchObject({
      definition: expect.objectContaining({ name: 'Readiness once sentinel' }),
    });
  } finally {
    await container.stop();
  }
});
it('repeats cheap readiness checks inside migrate even after a protected preflight', async () => {
  const prepared = openDatabase({ url: config().dbUrl });
  await prepared.migrate();
  prepared.close();
  const container = await createContainer(config(), { startTimers: false });
  await container.handle.client.execute('UPDATE gg_upgrade_state SET format_version=3');
  await expect(container.start()).rejects.toMatchObject({
    code: 'STORE_UNSUPPORTED',
    message: expect.stringContaining(
      '  Found:    format 3\n  Requires: format 4\n  Reason:   The store is format 3; this build reads only format 4\n',
    ),
  });
  await container.stop();
});
it('names a damaged current-format store and offers repair or a fresh start', async () => {
  const prepared = openDatabase({ url: config().dbUrl });
  await prepared.migrate();
  await prepared.client.execute('DROP INDEX runs_parent_idx');
  prepared.close();
  await expect(createContainer(config(), { startTimers: false })).rejects.toMatchObject({
    code: 'STORE_UNSUPPORTED',
    message: expect.stringMatching(
      /Found: {4}format 4, but the store is damaged or unfinished\n.*\n {2}Reason: {3}The format-4 store is damaged: incomplete indexes in runs\nNo stored data was changed\..*\nRepair the store by hand, or start fresh: /,
    ),
  });
});
it('reparses external database definitions changed after construction before startup writes', async () => {
  const outside = dataDir;
  const settings = config({
    GG_DATA_DIR: join(dataDir, 'locked'),
    GG_DB_URL: `file:${join(outside, 'external.db').replaceAll('\\', '/')}`,
  });
  const prepared = openDatabase({ url: settings.dbUrl });
  await prepared.migrate();
  prepared.close();
  const container = await createContainer(settings, { startTimers: false });
  try {
    await container.handle.client.execute({
      sql: 'INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
      args: [
        FIXTURE_IDS.version,
        FIXTURE_IDS.loop,
        'published',
        JSON.stringify({ ...minimalLoop(), removedField: true }),
        FIXTURE_TS,
      ],
    });
    const tables = [
      'loop_versions',
      'model_catalog',
      'classifier_models',
      'settings',
      '__drizzle_migrations',
    ];
    const before = await Promise.all(
      tables.map((table) => container.handle.client.execute('SELECT * FROM "' + table + '"')),
    );
    await expect(container.start()).rejects.toMatchObject({ code: 'STORE_UNSUPPORTED' });
    // Closing a writer may checkpoint the WAL. Compare stored rows through a fresh read-only
    // connection, including all startup seed targets, rather than SQLite file layout.
    const inspection = openReadOnlyDatabaseClient(join(outside, 'external.db'));
    try {
      for (const [index, table] of tables.entries())
        expect((await inspection.execute('SELECT * FROM "' + table + '"')).rows).toEqual(
          before[index]!.rows,
        );
    } finally {
      inspection.close();
    }
  } finally {
    await container.stop();
  }
});

it('refuses malformed current definitions before master-key creation or database writes', async () => {
  const prepared = openDatabase({ url: config().dbUrl });
  await prepared.migrate();
  await prepared.client.execute({
    sql: 'INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
    args: [
      FIXTURE_IDS.version,
      FIXTURE_IDS.loop,
      'published',
      JSON.stringify({ ...minimalLoop(), removedField: true }),
      FIXTURE_TS,
    ],
  });
  await prepared.client.execute('PRAGMA journal_mode=DELETE');
  prepared.close();
  const before = await readFile(join(dataDir, 'gg.db'));
  const { masterKey: _masterKey, ...withoutMasterKey } = config();
  await expect(createContainer(withoutMasterKey, { startTimers: false })).rejects.toMatchObject({
    code: 'STORE_UNSUPPORTED',
  });
  expect(await readFile(join(dataDir, 'gg.db'))).toEqual(before);
  await expect(access(join(dataDir, 'master.key'))).rejects.toThrow();
});
