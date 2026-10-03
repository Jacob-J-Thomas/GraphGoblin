import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCodexAdapters } from '@graphgoblin/adapter-codex';
import { createJevDecider } from '@graphgoblin/adapter-jev';
import { FsArtifactStore, FsWorkspace } from '@graphgoblin/infrastructure/fs';
import {
  HttpProbes,
  HttpWebhookDelivery,
  createReturnDelivery,
} from '@graphgoblin/infrastructure/http';
import { ProcessScripts } from '@graphgoblin/infrastructure/process';
import { CronScheduler, TimerService } from '@graphgoblin/infrastructure/scheduler';
import {
  SqliteApiKeys,
  SqliteEventStore,
  SqliteLoopRepository,
  SqliteModelCatalog,
  SqliteRunRepository,
  SqliteSecrets,
  SqliteSessionRepository,
  SqliteSettings,
  SqliteTimerStore,
  SqliteInboundEvents,
  SqliteScheduleStore,
  SqliteWebhookEndpoints,
  databaseFilePath,
  openDatabase,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import { EffortSchema, type Effort, type HarnessId } from '@graphgoblin/contracts';
import {
  RunManager,
  type ClockPort,
  type DeciderPort,
  type EnginePorts,
  type EngineSettings,
  type HarnessPort,
  type HttpProbePort,
  type IdPort,
  type Logger,
  type ScriptPort,
  type SecretsPort,
  type StructuredPort,
} from '@graphgoblin/engine';
import type { ApiConfig } from './config.js';
import { acquireDataDirLock } from './data-dir-lock.js';
import { InboundEventBus } from './event-bus.js';
import { UlidIds } from './ids.js';
import { loadMasterKey } from './master-key.js';
import { PollTriggers } from './triggers/poll.js';
import { TriggerService } from './triggers/trigger-service.js';

/** The single owner of a 1.0 installation. Every table carries it so multi-tenancy is a data change, not a schema change. */
export const LOCAL_OWNER = 'local';

/** The secret the Jev decider reads its API key from. */
export const JEV_SECRET = 'jev-api-key';

/** Notified after a secret is set or deleted, so adapters that cache a secret can re-read it. */
export type SecretChangeHook = (ownerId: string, name: string) => Promise<void>;

export interface ContainerOverrides {
  clock?: ClockPort;
  ids?: IdPort;
  logger?: Logger;
  harnesses?: Partial<Record<HarnessId, HarnessPort>>;
  deciders?: DeciderPort[];
  structured?: StructuredPort;
  masterKey?: Buffer;
  probes?: HttpProbePort;
  scripts?: ScriptPort;
  /** Extra secret-change hooks, run after the container's own. */
  secretHooks?: SecretChangeHook[];
  /** Skip starting the timer, cron, and poll-trigger pollers (tests drive `timers.poll()`, `cron.recover()`, `cron.poll()`, and `polls.poll()` directly). */
  startTimers?: boolean;
}

export interface Container {
  config: ApiConfig;
  handle: DatabaseHandle;
  ports: EnginePorts;
  settings: EngineSettings;
  manager: RunManager;
  timers: TimerService;
  cron: CronScheduler;
  triggers: TriggerService;
  polls: PollTriggers;
  bus: InboundEventBus;
  masterKey: Buffer;
  repos: {
    runs: SqliteRunRepository;
    loops: SqliteLoopRepository;
    sessions: SqliteSessionRepository;
    events: SqliteEventStore;
    settings: SqliteSettings;
    apiKeys: SqliteApiKeys;
    catalog: SqliteModelCatalog;
    schedules: SqliteScheduleStore;
    endpoints: SqliteWebhookEndpoints;
    inbound: SqliteInboundEvents;
    secretsFor(ownerId: string): SqliteSecrets;
  };
  /** Tell adapters a secret changed. The settings routes call this after a set or delete. */
  onSecretChanged(ownerId: string, name: string): Promise<void>;
  /** Migrate, seed, recover runs, re-arm triggers, and start timers and cron under the data-directory lock. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** The owner settings `defaultModel` and `defaultEffort`; empty or invalid values are ignored. */
export async function readOwnerDefaults(
  settings: Pick<SqliteSettings, 'get'>,
  ownerId: string,
): Promise<{ model?: string; effort?: Effort }> {
  const model = await settings.get(ownerId, 'defaultModel');
  const effort = EffortSchema.safeParse(await settings.get(ownerId, 'defaultEffort'));
  return {
    ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
    ...(effort.success ? { effort: effort.data } : {}),
  };
}

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export async function createContainer(
  config: ApiConfig,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  // Own the directory before even opening SQLite or generating the master key. Direct container
  // callers get the same protection as main(); ownership lasts until stop() finishes.
  const lock = await acquireDataDirLock(config.dataDir);
  let opened: DatabaseHandle | undefined;
  try {
    const logger = overrides.logger ?? silentLogger;
    const clock = overrides.clock ?? { now: () => new Date() };
    const ids = overrides.ids ?? new UlidIds(clock);
    if (!config.dbUrl.startsWith(':memory:') && !config.dbUrl.includes('mode=memory')) {
      await mkdir(config.dataDir, { recursive: true });
    }
    // GG_DB_URL may point outside the data directory; create the database file's directory too.
    const dbFile = databaseFilePath(config.dbUrl);
    if (dbFile) await mkdir(dirname(dbFile), { recursive: true });
    const masterKey =
      overrides.masterKey ??
      (await loadMasterKey({
        dataDir: config.dataDir,
        ...(config.masterKey ? { masterKey: config.masterKey } : {}),
      }));
    const handle = openDatabase({ url: config.dbUrl });
    opened = handle;
    const { db } = handle;

    const runs = new SqliteRunRepository(db);
    const loops = new SqliteLoopRepository(db, clock, ids);
    const sessions = new SqliteSessionRepository(db);
    const events = new SqliteEventStore(db, clock);
    const settingsRepo = new SqliteSettings(db, clock);
    const apiKeys = new SqliteApiKeys(db, clock, ids);
    const catalog = new SqliteModelCatalog(db);
    const secretsFor = (ownerId: string): SqliteSecrets =>
      new SqliteSecrets(db, clock, masterKey, ownerId);
    const timers = new TimerService(new SqliteTimerStore(db), clock, {
      pollIntervalMs: config.timerPollMs,
      logger,
    });
    const bus = new InboundEventBus();
    const schedules = new SqliteScheduleStore(db, clock, ids);
    const endpoints = new SqliteWebhookEndpoints(db, clock, ids);
    const inbound = new SqliteInboundEvents(db);
    const cron = new CronScheduler(schedules, clock, {
      pollIntervalMs: config.timerPollMs,
      logger,
    });

    // Real adapters back whatever the caller did not override. Building them is cheap and has no
    // side effects: the Codex CLI is only spawned when a session starts, and Jev only calls out when
    // a decision runs.
    const codex = createCodexAdapters({
      logger,
      model: config.defaultModel,
      effort: config.defaultEffort,
      ...(config.codexBinary ? { codexBinary: config.codexBinary } : {}),
    });
    // Jev resolves its key as soon as it is built, before `start()` has migrated the database; until
    // then it sees no secret, and `start()` refreshes it once the tables exist.
    let migrated = false;
    const ownerSecrets = secretsFor(LOCAL_OWNER);
    const jevSecrets: SecretsPort = {
      resolve: (name) => (migrated ? ownerSecrets.resolve(name) : Promise.resolve(undefined)),
    };
    const jev = createJevDecider({ secrets: jevSecrets, logger, secretName: JEV_SECRET });
    const secretHooks: SecretChangeHook[] = [
      async (ownerId, name) => {
        if (ownerId === LOCAL_OWNER && name === JEV_SECRET) await jev.refresh();
      },
      ...(overrides.secretHooks ?? []),
    ];
    const structured = overrides.structured ?? codex.structured;

    const ports: EnginePorts = {
      clock,
      ids,
      logger,
      events,
      runs,
      loops,
      sessions,
      harnesses: overrides.harnesses ?? { codex: codex.harness },
      // Decision nodes pick a strategy by id; Jev first, the Codex decider as the fallback.
      deciders: overrides.deciders ?? [jev, codex.decider],
      structured,
      scripts: overrides.scripts ?? new ProcessScripts(),
      workspace: new FsWorkspace(config.dataDir),
      timers,
      probes: overrides.probes ?? new HttpProbes(),
      delivery: createReturnDelivery({
        webhooks: new HttpWebhookDelivery(clock),
        publishEvent: (eventType, payload) =>
          bus.publish({
            id: ids.next(),
            ownerId: LOCAL_OWNER,
            type: eventType,
            payload,
            receivedAt: clock.now().toISOString(),
          }),
        logger,
      }),
      artifacts: new FsArtifactStore(config.dataDir),
      secrets: ownerSecrets,
    };
    const settings: EngineSettings = {
      defaultModel: config.defaultModel,
      defaultEffort: config.defaultEffort,
      maxConcurrentRuns: config.maxConcurrentRuns,
      structuredTimeoutMs: 120_000,
      // Settings → Defaults, read at run start; GG_DEFAULT_MODEL and GG_DEFAULT_EFFORT are the fallback.
      ownerDefaults: (ownerId) => readOwnerDefaults(settingsRepo, ownerId),
    };
    const manager = new RunManager(ports, settings);
    const polls = new PollTriggers({
      probes: ports.probes,
      scripts: ports.scripts,
      manager,
      hasDedupe: (loopId, nodeId, key) => runs.hasTriggerDedupe(loopId, nodeId, key),
      clock,
      logger,
      scriptCwd: config.dataDir,
      tickMs: config.timerPollMs,
    });
    const triggers = new TriggerService({
      loops,
      runs,
      schedules,
      endpoints,
      inbound,
      manager,
      cron,
      bus,
      secretsFor,
      clock,
      ids,
      logger,
      webhookRateLimit: config.hookRateLimitPerMinute,
      polls,
    });

    let starting: Promise<void> | undefined;
    let stopping: Promise<void> | undefined;
    let disposing: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
      disposing ??= (async () => {
        cron.stop();
        polls.stop();
        triggers.stop();
        timers.stop();
        manager.stop();
        await manager.waitForIdle();
        try {
          handle.close();
        } finally {
          await lock.release();
        }
      })();
      return disposing;
    };
    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        // Direct callers may stop during migration or recovery. Keep ownership until startup
        // finishes, then shut down; otherwise a new owner could recover while this one starts.
        await starting?.catch(() => undefined);
        await dispose();
      })();
      return stopping;
    };

    return {
      config,
      handle,
      ports,
      settings,
      manager,
      timers,
      cron,
      triggers,
      polls,
      bus,
      masterKey,
      repos: {
        runs,
        loops,
        sessions,
        events,
        settings: settingsRepo,
        apiKeys,
        catalog,
        schedules,
        endpoints,
        inbound,
        secretsFor,
      },
      async onSecretChanged(ownerId, name) {
        for (const hook of secretHooks) await hook(ownerId, name);
      },
      start() {
        if (stopping) return Promise.reject(new Error('container has been stopped'));
        starting ??= (async () => {
          try {
            await handle.migrate();
            migrated = true;
            if (config.jevApiKey && (await ownerSecrets.resolve(JEV_SECRET)) === undefined) {
              await ownerSecrets.set(JEV_SECRET, config.jevApiKey);
              logger.info({}, 'seeded jev-api-key from GG_JEV_API_KEY');
            }
            await jev.init();
            await jev.refresh();
            await catalog.seed();
            await manager.start();
            triggers.start();
            await triggers.armAll();
            if (overrides.startTimers !== false) {
              timers.start();
              await cron.start();
              polls.start();
            }
          } catch (error) {
            await dispose();
            throw error;
          }
        })();
        return starting;
      },
      stop,
    };
  } catch (error) {
    try {
      opened?.close();
    } finally {
      await lock.release();
    }
    throw error;
  }
}
