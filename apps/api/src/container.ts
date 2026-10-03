import { mkdir } from 'node:fs/promises';
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
  openDatabase,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import type { HarnessId } from '@graphgoblin/contracts';
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
  type StructuredPort,
} from '@graphgoblin/engine';
import type { ApiConfig } from './config.js';
import { InboundEventBus } from './event-bus.js';
import { UlidIds } from './ids.js';
import { loadMasterKey } from './master-key.js';
import { PollTriggers } from './triggers/poll.js';
import { TriggerService } from './triggers/trigger-service.js';

/** The single owner of a 1.0 installation. Every table carries it so multi-tenancy is a data change, not a schema change. */
export const LOCAL_OWNER = 'local';

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
  /** Migrate, seed, recover runs, re-arm triggers, and start timers and cron. */
  start(): Promise<void>;
  stop(): Promise<void>;
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
  const logger = overrides.logger ?? silentLogger;
  const clock = overrides.clock ?? { now: () => new Date() };
  const ids = overrides.ids ?? new UlidIds(clock);
  if (!config.dbUrl.startsWith(':memory:') && !config.dbUrl.includes('mode=memory')) {
    await mkdir(config.dataDir, { recursive: true });
  }
  const masterKey =
    overrides.masterKey ??
    (await loadMasterKey({
      dataDir: config.dataDir,
      ...(config.masterKey ? { masterKey: config.masterKey } : {}),
    }));
  const handle = openDatabase({ url: config.dbUrl });
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
  const cron = new CronScheduler(schedules, clock, { pollIntervalMs: config.timerPollMs, logger });

  const ports: EnginePorts = {
    clock,
    ids,
    logger,
    events,
    runs,
    loops,
    sessions,
    harnesses: overrides.harnesses ?? {},
    deciders: overrides.deciders ?? [],
    ...(overrides.structured ? { structured: overrides.structured } : {}),
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
    secrets: secretsFor(LOCAL_OWNER),
  };
  const settings: EngineSettings = {
    defaultModel: config.defaultModel,
    defaultEffort: config.defaultEffort,
    maxConcurrentRuns: config.maxConcurrentRuns,
    structuredTimeoutMs: 120_000,
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
    async start() {
      await handle.migrate();
      await catalog.seed();
      await manager.start();
      triggers.start();
      await triggers.armAll();
      if (overrides.startTimers !== false) {
        timers.start();
        await cron.start();
        polls.start();
      }
    },
    async stop() {
      cron.stop();
      polls.stop();
      triggers.stop();
      timers.stop();
      manager.stop();
      await manager.waitForIdle();
      handle.close();
    },
  };
}
