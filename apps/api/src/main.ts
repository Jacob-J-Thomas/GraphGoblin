import { ShutdownSignals } from './shutdown-signals.js';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { bundledWebDist, loadConfig } from './config.js';
import { runCreateApiKeyCli } from './create-api-key.js';
import { createContainer } from './container.js';
import { runPreflightCli } from './preflight.js';
import { runResetCli } from './reset/reset.js';
import { StoreRefusedError } from './store-refusal.js';

/** Process entry point: configure, migrate, recover runs, listen, and shut down cleanly. */
export async function main(): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  container: Awaited<ReturnType<typeof createContainer>>;
}> {
  const config = loadConfig(process.env, { webDistFallback: bundledWebDist() });
  const logger = pino({ level: config.logLevel });
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
    const owner = await createContainer(config, { logger });
    container = owner;
    if (shuttingDown) owner.prepareShutdown();
    await owner.start();
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
    await server.listen({ host: config.host, port: config.port });
    // HTTP (including SSE and controls) stays open until logical runs and cleanup settle.
    void owner
      .waitForShutdown()
      .then(async () => {
        if (closing) return;
        await server.close();
        await owner.dispose();
        removeSignals();
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

const invokedDirectly = process.argv[1] !== undefined && /main\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  // `--preflight` prints the first-run checks, `--create-api-key` mints a key and `--reset`
  // lists (or, confirmed, removes) the store; each exits without starting the server (docs/11).
  const run = process.argv.includes('--preflight')
    ? runPreflightCli().then((code) => process.exit(code))
    : process.argv.includes('--create-api-key')
      ? runCreateApiKeyCli().then((code) => process.exit(code))
      : process.argv.includes('--reset')
        ? runResetCli().then((code) => process.exit(code))
        : main();
  run.catch((error: unknown) => {
    // A store refusal is a complete operator explanation; a stack trace would only bury it.
    console.error(error instanceof StoreRefusedError ? error.message : error);
    process.exit(1);
  });
}
