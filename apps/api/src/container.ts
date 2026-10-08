import { existsSync } from 'node:fs';
import { validateHarnessDefaults } from '@graphgoblin/domain';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createCodexAdapters } from '@graphgoblin/adapter-codex';
import { FsArtifactStore, FsWorkspace } from '@graphgoblin/infrastructure/fs';
import {
  HttpProbes,
  HttpWebhookDelivery,
  createReturnDelivery,
} from '@graphgoblin/infrastructure/http';
import { ProcessScripts } from '@graphgoblin/infrastructure/process';
import { CronScheduler, TimerService } from '@graphgoblin/infrastructure/scheduler';
import {
  DEFAULT_MODEL_CATALOG,
  openReadOnlyDatabaseClient,
  databaseView,
  SqliteApiKeys,
  SqliteTemplateInstances,
  SqliteEventStore,
  SqliteTriggerAdmission,
  SqliteLoopRepository,
  SqliteModelCatalog,
  SqliteClassifierModels,
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
  guardDatabaseUpgrade,
  type DatabaseHandle,
} from '@graphgoblin/infrastructure/sqlite';
import {
  HarnessDefaultsSchema,
  type HarnessDefaults,
  type HarnessId,
} from '@graphgoblin/contracts';
import {
  RunManager,
  type ClockPort,
  type ClassifierRegistryPort,
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
import { BUILTIN_CLASSIFIER, ClassifierRegistry } from './classifier-registry.js';
import { acquireDataDirLock } from './data-dir-lock.js';
import {
  ClaudeHarness,
  claudeModelBlocked,
  CLAUDE_BILLING_UNVERIFIED_MESSAGE,
} from '@graphgoblin/infrastructure/claude';
import { InboundEventBus } from './event-bus.js';
import { UlidIds } from './ids.js';
import { loadMasterKey } from './master-key.js';
import { PollTriggers } from './triggers/poll.js';
import { TriggerService } from './triggers/trigger-service.js';
import { TemplateCatalog } from './templates/catalog.js';
import { TemplatePrerequisites } from './templates/prerequisites.js';
import { TemplateInstances } from './templates/instances.js';
import {
  TemplateRuntime,
  templateAdmission,
  type TemplateAuthoritySource,
  type TemplateFailureReporter,
} from './templates/runtime.js';
import { PrivateTemplateScripts } from './templates/scripts.js';
import { ReviewAuthority } from './templates/github/review-authority.js';
import { ReviewReporter } from './templates/github/review-reporter.js';
import type { ReviewDependenciesFactory } from './templates/github/review.js';
import {
  ImplementationAuthority,
  type SupportDependencies,
} from './templates/github/authority-source.js';
import {
  ImplementationReporter,
  installImplementationFinalization,
} from './templates/github/reporter.js';

/** The single owner of a 1.0 installation. Every table carries it so multi-tenancy is a data change, not a schema change. */
export const LOCAL_OWNER = 'local';

/** The secret the Jev decider reads its API key from. */
export const JEV_SECRET = 'jev-api-key';

/** Notified after a secret is set or deleted, so adapters that cache a secret can re-read it. */
export type SecretChangeHook = (ownerId: string, name: string) => Promise<void>;

export interface ContainerOverrides {
  templateCatalogRoot?: string;
  templateAuthority?: TemplateAuthoritySource;
  templateFailureReporter?: TemplateFailureReporter;
  /** Inject deterministic boundaries for repository-template tests; never an authored setting. */
  implementationDependencies?: SupportDependencies;
  reviewDependencies?: ReviewDependenciesFactory;
  clock?: ClockPort;
  ids?: IdPort;
  logger?: Logger;
  harnesses?: Partial<Record<HarnessId, HarnessPort>>;
  deciders?: DeciderPort[];
  classifiers?: ClassifierRegistryPort;
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
  templates: TemplateInstances;
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
  classifierRegistry: ClassifierRegistry;
  repos: {
    runs: SqliteRunRepository;
    loops: SqliteLoopRepository;
    sessions: SqliteSessionRepository;
    events: SqliteEventStore;
    settings: SqliteSettings;
    apiKeys: SqliteApiKeys;
    catalog: SqliteModelCatalog;
    classifiers: SqliteClassifierModels;
    schedules: SqliteScheduleStore;
    endpoints: SqliteWebhookEndpoints;
    inbound: SqliteInboundEvents;
    secretsFor(ownerId: string): SqliteSecrets;
  };
  /** Tell adapters a secret changed. The settings routes call this after a set or delete. */
  onSecretChanged(ownerId: string, name: string): Promise<void>;
  onClassifierChanged(ownerId: string, id: string): Promise<void>;
  /** Migrate, seed, recover runs, re-arm triggers, and start timers and cron under the data-directory lock. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Strict harness-scoped owner defaults; invalid persisted configuration is never silently ignored. */
export async function readOwnerDefaults(
  settings: Pick<SqliteSettings, 'get'>,
  ownerId: string,
): Promise<HarnessDefaults> {
  const value = await settings.get(ownerId, 'defaults');
  return HarnessDefaultsSchema.parse(value ?? { byHarness: {} });
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
    // Validate catalog semantics without a mutable SQLite connection or any startup writes.
    let startupCatalog = DEFAULT_MODEL_CATALOG;
    if (dbFile && existsSync(dbFile)) {
      const readonlyClient = openReadOnlyDatabaseClient(dbFile);
      try {
        const state = await guardDatabaseUpgrade(readonlyClient);
        if (state === 'current') {
          const stored = await new SqliteModelCatalog(databaseView(readonlyClient)).list();
          startupCatalog = [
            ...stored,
            ...DEFAULT_MODEL_CATALOG.filter(
              (seed) =>
                !stored.some(
                  (entry) => entry.harness === seed.harness && entry.model === seed.model,
                ),
            ),
          ];
        }
      } finally {
        readonlyClient.close();
      }
    }
    const configurationIssues = validateHarnessDefaults({
      loopDefaults: { byHarness: {} },
      ownerDefaults: { byHarness: {} },
      processDefaults: config.defaults,
      catalog: startupCatalog,
    });
    if (claudeModelBlocked(config.defaults.byHarness.claude?.model))
      throw new Error('Invalid GG_DEFAULTS: ' + CLAUDE_BILLING_UNVERIFIED_MESSAGE);
    if (configurationIssues.length)
      throw new Error(
        'Invalid GG_DEFAULTS: ' +
          configurationIssues.map((issue) => issue.resolution.message).join('; '),
      );
    if (dbFile) await mkdir(dirname(dbFile), { recursive: true });
    const handle = openDatabase({ url: config.dbUrl });
    opened = handle;
    const { db } = handle;
    await guardDatabaseUpgrade(handle.client);
    const masterKey =
      overrides.masterKey ??
      (await loadMasterKey({
        dataDir: config.dataDir,
        ...(config.masterKey ? { masterKey: config.masterKey } : {}),
      }));

    const runs = new SqliteRunRepository(db, (store, run, changes) =>
      templateRuntime.beforeTransition(store, run, changes),
    );
    const loops = new SqliteLoopRepository(db, clock, ids);
    const sessions = new SqliteSessionRepository(db);
    const events = new SqliteEventStore(db, clock);
    const settingsRepo = new SqliteSettings(db, clock);
    const apiKeys = new SqliteApiKeys(db, clock, ids);
    const catalog = new SqliteModelCatalog(db);
    const classifiers = new SqliteClassifierModels(db);
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
      ...(config.defaults.byHarness.codex?.model !== undefined
        ? { model: config.defaults.byHarness.codex.model }
        : {}),
      ...(config.defaults.byHarness.codex?.effort !== undefined
        ? { effort: config.defaults.byHarness.codex.effort }
        : {}),
      ...(config.codexBinary ? { codexBinary: config.codexBinary } : {}),
    });
    const ownerSecrets = secretsFor(LOCAL_OWNER);
    const classifierRegistry = new ClassifierRegistry(classifiers, secretsFor, logger);
    const secretHooks: SecretChangeHook[] = [
      (ownerId, name) => {
        classifierRegistry.secretChanged(ownerId, name);
        return Promise.resolve();
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
      admission: new SqliteTriggerAdmission(handle.db, events, (store, input, pollItem) =>
        templateRuntime.afterRunStaged(store, input, pollItem),
      ),
      loops,
      sessions,
      harnesses: overrides.harnesses ?? {
        codex: codex.harness,
        claude: new ClaudeHarness({
          ...(config.claudeBinary ? { binary: config.claudeBinary } : {}),
        }),
      },
      modelCatalog: catalog,
      // LLM evaluation uses Codex; all classifier primitives use the owner registry.
      deciders: overrides.deciders ?? [codex.decider],
      classifiers: overrides.classifiers ?? classifierRegistry,
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
    const templateCatalog = new TemplateCatalog(
      overrides.templateCatalogRoot ??
        fileURLToPath(
          new URL(import.meta.url.endsWith('.ts') ? '../templates' : './catalog', import.meta.url),
        ),
      fileURLToPath(new URL('..', import.meta.url)),
    );
    const templateStore = new SqliteTemplateInstances(db);
    const templatePrerequisites = new TemplatePrerequisites({
      catalog,
      harnesses: ports.harnesses,
      scripts: ports.scripts,
      apiKeys,
      secretsFor,
      defaults: config.defaults,
      ownerDefaults: (ownerId) => readOwnerDefaults(settingsRepo, ownerId),
      supportAvailable: async (manifest) => {
        const installed = await templateCatalog.get(manifest.id);
        return (
          installed.bundle.manifest.version === manifest.version && installed.support !== undefined
        );
      },
    });
    const templates = new TemplateInstances(
      templateCatalog,
      templatePrerequisites,
      templateStore,
      ids,
      clock,
    );
    const implementationReporter = new ImplementationReporter(
      templates,
      overrides.implementationDependencies,
    );
    const implementationAuthority = new ImplementationAuthority(
      templates,
      overrides.implementationDependencies,
    );
    const reviewReporter = new ReviewReporter(templates, overrides.reviewDependencies);
    const reviewAuthority = new ReviewAuthority(
      templates,
      overrides.reviewDependencies,
      async (binding) => {
        if (!('supportReadKey' in binding.settings))
          throw new Error('Private review credential unavailable.');
        const credential = await secretsFor(binding.ownerId).resolve(
          binding.settings.supportReadKey,
        );
        const key = credential ? await apiKeys.authenticate(credential) : undefined;
        if (
          !credential ||
          !key ||
          key.ownerId !== binding.ownerId ||
          key.scopes.length !== 1 ||
          key.scopes[0] !== 'runs:read'
        )
          throw new Error('Private review credential unavailable.');
        return credential;
      },
    );
    const templateRuntime = new TemplateRuntime(
      templates,
      overrides.templateAuthority ?? {
        resolve: (binding, payload) =>
          binding.manifest.kind === 'review'
            ? reviewAuthority.resolve(binding, payload)
            : implementationAuthority.resolve(binding, payload),
        recheck: (binding, subject) =>
          binding.manifest.kind === 'review'
            ? reviewAuthority.recheck(binding, subject)
            : implementationAuthority.recheck(binding, subject),
      },
      overrides.templateFailureReporter ?? {
        report: (binding, run, subject, code) =>
          binding.manifest.kind === 'review'
            ? reviewReporter.report(binding, run, subject, code)
            : implementationReporter.report(binding, run, subject, code),
      },
    );
    // Reporting is reconciled before finalization. Failure leaves the durable terminal run
    // unfinalized, so startup retries the fixed report instead of losing it.
    installImplementationFinalization(runs, {
      terminal: async (run) => {
        await implementationReporter.terminal(run);
        await reviewReporter.terminal(run);
      },
    });
    ports.admission = templateAdmission(ports.admission, templateRuntime);
    ports.scripts = new PrivateTemplateScripts({
      instances: templates,
      raw: ports.scripts,
      apiKeys,
      secretsFor,
    });
    const settings: EngineSettings = {
      ...templateRuntime.hooks,
      defaults: config.defaults,
      maxConcurrentRuns: config.maxConcurrentRuns,
      structuredTimeoutMs: 120_000,
      // Harness-scoped Settings defaults are read at run start; GG_DEFAULTS are the fallback.
      ownerDefaults: (ownerId) => readOwnerDefaults(settingsRepo, ownerId),
    };
    const manager = new RunManager(ports, settings);
    const polls = new PollTriggers({
      probes: ports.probes,
      scripts: ports.scripts,
      manager,
      hasDedupe: (loopId, nodeId, key) => runs.hasTriggerDedupe(loopId, nodeId, key),
      findSeen: (loopId, nodeId, keys) => runs.findTriggerDedupeKeys(loopId, nodeId, keys),
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
        await manager.waitForWebhookRecovery();
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
      templates,
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
      classifierRegistry,
      repos: {
        runs,
        loops,
        sessions,
        events,
        settings: settingsRepo,
        apiKeys,
        catalog,
        classifiers,
        schedules,
        endpoints,
        inbound,
        secretsFor,
      },
      async onSecretChanged(ownerId, name) {
        for (const hook of secretHooks) await hook(ownerId, name);
      },
      onClassifierChanged(ownerId, id) {
        classifierRegistry.invalidate(ownerId, id);
        return Promise.resolve();
      },
      start() {
        if (stopping) return Promise.reject(new Error('container has been stopped'));
        starting ??= (async () => {
          try {
            await handle.migrate();
            await classifiers.seedBuiltin(LOCAL_OWNER, BUILTIN_CLASSIFIER);
            if (config.jevApiKey && (await ownerSecrets.resolve(JEV_SECRET)) === undefined) {
              await ownerSecrets.set(JEV_SECRET, config.jevApiKey);
              logger.info({}, 'seeded jev-api-key from GG_JEV_API_KEY');
            }
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
