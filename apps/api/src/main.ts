import { pino } from 'pino';
import { buildApp } from './app.js';
import { bundledWebDist, loadConfig } from './config.js';
import { runCreateApiKeyCli } from './create-api-key.js';
import { createContainer } from './container.js';
import { runPreflightCli } from './preflight.js';

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
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // A signal during startup must not release ownership while recovery is still running.
    await startup.catch(() => undefined);
    removeSignals();
    await stop();
    process.exit(0);
  };
  const onSigint = (): void => void shutdown('SIGINT');
  const onSigterm = (): void => void shutdown('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const startup = (async () => {
    const owner = await createContainer(config, { logger });
    container = owner;
    await owner.start();
    const server = await buildApp(owner, { logger });
    app = server;
    server.addHook('onClose', async () => {
      removeSignals();
      await owner.stop();
    });
    await server.listen({ host: config.host, port: config.port });
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
  // `--preflight` prints the first-run checks and `--create-api-key` mints a key; both exit
  // without starting the server (docs/11).
  const run = process.argv.includes('--preflight')
    ? runPreflightCli().then((code) => process.exit(code))
    : process.argv.includes('--create-api-key')
      ? runCreateApiKeyCli().then((code) => process.exit(code))
      : main();
  run.catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
