import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

/** Build the app against an in-memory database and write its OpenAPI document. */
export async function emitOpenApi(outputPath?: string): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-openapi-'));
  const config = loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: ':memory:',
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
  });
  const container = await createContainer(config, { startTimers: false });
  await container.start();
  const app = await buildApp(container, { logger: false });
  await app.ready();
  const document = JSON.stringify(app.swagger(), null, 2);
  await app.close();
  await container.stop();
  if (outputPath) await writeFile(outputPath, `${document}\n`, 'utf8');
  return document;
}

const invokedDirectly =
  process.argv[1] !== undefined && /emit-openapi\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  emitOpenApi(process.argv[2])
    .then((document) => {
      if (!process.argv[2]) process.stdout.write(document);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
