import { mkdir } from 'node:fs/promises';
import { FsArtifactStore, FsWorkspace } from '@graphgoblin/infrastructure/fs';
import {
  HttpProbes,
  HttpWebhookDelivery,
  createReturnDelivery,
} from '@graphgoblin/infrastructure/http';
import { ProcessScripts } from '@graphgoblin/infrastructure/process';
import { TimerService } from '@graphgoblin/infrastructure/scheduler';
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
  type IdPort,
  type Logger,
  type StructuredPort,
} from '@graphgoblin/engine';
import type { ApiConfig } from './config.js';
import { InboundEventBus } from './event-bus.js';
import { UlidIds } from './ids.js';
import { loadMasterKey } from './master-key.js';

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
  /** Skip starting the timer poller (tests drive `timers.poll()` directly). */
  startTimers?: boolean;
}

export interface Container {
  config: ApiConfig;
  handle: DatabaseHandle;
  ports: EnginePorts;
  settings: EngineSettings;
  manager: RunManager;
  timers: TimerService;
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
    secretsFor(ownerId: string): SqliteSecrets;
  };
  /** Migrate, seed, recover runs, and start timers. */
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
    scripts: new ProcessScripts(),
    workspace: new FsWorkspace(config.dataDir),
    timers,
    probes: new HttpProbes(),
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

  return {
    config,
    handle,
    ports,
    settings,
    manager,
    timers,
    bus,
    masterKey,
    repos: { runs, loops, sessions, events, settings: settingsRepo, apiKeys, catalog, secretsFor },
    async start() {
      await handle.migrate();
      await catalog.seed();
      await manager.start();
      if (overrides.startTimers !== false) timers.start();
    },
    async stop() {
      timers.stop();
      manager.stop();
      await manager.waitForIdle();
      handle.close();
    },
  };
}
