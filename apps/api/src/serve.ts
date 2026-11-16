import { ShutdownSignals } from './shutdown-signals.js';
import type { DestinationStream } from 'pino';
import { buildApp } from './app.js';
import { bundledGoblinDist, bundledWebDist, loadConfig } from './config.js';
import { createContainer } from './container.js';
import { ProcessDefaultsRefusedError } from './defaults-refusal.js';
import { createGatewayLogger } from './gateway-logger.js';
import { StoreRefusedError } from './store-refusal.js';
import type { StartupCause, StartupStage } from './windows-log/guard.js';

export interface ServeResult {
  app: Awaited<ReturnType<typeof buildApp>>;
  container: Awaited<ReturnType<typeof createContainer>>;
}

export interface ServeOptions {
  /** Only for the Windows launcher's detached gateway, supplied by the guarded entry. */
  managed?: {
    /** The bounded private log destination. */
    destination: DestinationStream;
    /** Called before each startup stage begins. */
    onStage(stage: StartupStage): void;
    /** Bounded diagnostic flush after graceful cleanup, before the process exits. */
    beforeExit(): Promise<unknown>;
  };
}

/** Configure, migrate, recover runs, listen, and shut down cleanly. */
export async function serve(options: ServeOptions = {}): Promise<ServeResult> {
  const managed = options.managed;
  managed?.onStage('configuration');
  const config = loadConfig(process.env, {
    webDistFallback: bundledWebDist(),
    goblinDistFallback: bundledGoblinDist(),
  });
  const logger = createGatewayLogger(config, managed?.destination);
  let container: Awaited<ReturnType<typeof createContainer>> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const stop = async (): Promise<void> => {
    try {
      await app?.close();
    } finally {
      await container?.stop();
    }
  };
  const removeSignals = (): void => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  };

  let shuttingDown = false;
  let forceRequested = false;
  const signals = new ShutdownSignals(
    (action) => {
      shuttingDown = true;
      forceRequested ||= action === 'force';
      logger.info({ action }, 'shutting down');
      container?.prepareShutdown();
      // Startup retains ownership until recovery settles, including deliberate later signals.
      void startup
        .catch(() => undefined)
        .then(async () => {
          await container?.requestShutdown(forceRequested ? 'force' : 'drain');
        })
        .catch((error) => logger.error({ error }, 'shutdown control rejected'));
    },
    () =>
      shuttingDown || (container !== undefined && container.shutdown.state().phase !== 'running'),
  );
  const onSigint = (): void => signals.receive();
  const onSigterm = (): void => signals.receive();
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const startup = (async () => {
    managed?.onStage('store');
    const owner = await createContainer(config, { logger });
    container = owner;
    if (shuttingDown) owner.prepareShutdown();
    managed?.onStage('recovery');
    await owner.start();
    managed?.onStage('http');
    const server = await buildApp(owner, { logger });
    app = server;
    let closing = false;
    server.addHook('preClose', () => {
      closing = true;
      return Promise.resolve();
    });
    server.addHook('onClose', async () => {
      removeSignals();
      if (owner.shutdown.state().phase === 'ready') await owner.dispose();
      else await owner.stop();
    });
    managed?.onStage('bind');
    await server.listen({ host: config.host, port: config.port });
    // HTTP (including SSE and controls) stays open until logical runs and cleanup settle.
    void owner
      .waitForShutdown()
      .then(async () => {
        if (closing) return;
        await server.close();
        await owner.dispose();
        removeSignals();
        // The managed destination gets a bounded diagnostic flush; expiry permits loss.
        await managed?.beforeExit();
        process.exit(0);
      })
      .catch((error) => logger.error({ error }, 'shutdown failed'));
    void owner.shutdown.abandoned.then(() => {
      // Allow the control response to flush. This is a nonzero emergency exit, not cleanup:
      // leave the durable failure and lock for inspection and next-start stale-lock recovery.
      setTimeout(() => process.exit(1), 100);
    });
    logger.info(
      {
        host: config.host,
        port: config.port,
        dataDir: config.dataDir,
        requireApiKey: config.requireApiKey,
      },
      'GraphGoblin API listening',
    );
    if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.requireApiKey) {
      logger.warn(
        { host: config.host },
        'API is reachable beyond localhost without API keys; set GG_REQUIRE_API_KEY=true',
      );
    }
    return { app: server, container: owner };
  })();
  try {
    return await startup;
  } catch (error) {
    removeSignals();
    await stop();
    throw error;
  }
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && 'code' in error && codes.some((code) => error.code === code);
}

/**
 * Closed cause for a managed startup failure at a reached stage. Recognizes only error classes,
 * Node codes and fixed message prefixes; the error text itself never leaves this function.
 */
export function startupFailureCause(stage: StartupStage, error: unknown): StartupCause {
  if (error instanceof StoreRefusedError) return 'store-refused';
  if (error instanceof ProcessDefaultsRefusedError) return 'defaults-refused';
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('another GraphGoblin process')) return 'store-held';
  if (message.startsWith('Store ownership could not be verified'))
    return 'store-ownership-unverified';
  if (message.startsWith('Cannot establish Windows process identity'))
    return 'process-identity-unavailable';
  switch (stage) {
    case 'configuration':
      return 'invalid-configuration';
    case 'store':
      return 'store-unavailable';
    case 'recovery':
      return 'recovery-failed';
    case 'http':
      return 'http-setup-failed';
    case 'bind':
      if (hasCode(error, 'EADDRINUSE')) return 'port-in-use';
      if (hasCode(error, 'EACCES', 'EADDRNOTAVAIL')) return 'port-denied';
      return 'bind-failed';
  }
}

/** A store or GG_DEFAULTS refusal is a complete operator explanation; a stack would bury it. */
export function shellFailureOutput(error: unknown): unknown {
  return error instanceof StoreRefusedError || error instanceof ProcessDefaultsRefusedError
    ? error.message
    : error;
}
