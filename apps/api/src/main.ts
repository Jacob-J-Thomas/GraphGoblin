import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { runPreflightCli } from './preflight.js';

/** Process entry point: configure, migrate, recover runs, listen, and shut down cleanly. */
export async function main(): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  container: Awaited<ReturnType<typeof createContainer>>;
}> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const container = await createContainer(config, { logger });
  await container.start();
  const app = await buildApp(container, { logger });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await app.close();
    await container.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
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
  return { app, container };
}

const invokedDirectly = process.argv[1] !== undefined && /main\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  // `--preflight` prints the first-run checks and exits without starting the server (docs/11).
  const run = process.argv.includes('--preflight')
    ? runPreflightCli().then((code) => process.exit(code))
    : main();
  run.catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
