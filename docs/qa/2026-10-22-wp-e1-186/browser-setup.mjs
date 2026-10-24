import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dependency = (name) => import(import.meta.resolve(
  name, new URL('../../../apps/api/package.json', import.meta.url).href,
));
export default async function setup() {
  const { createContainer, loadConfig, buildApp } = await dependency('@graphgoblin/api');
  const { FakeHarness } = await dependency('@graphgoblin/engine/testing');
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e1-186-'));
  const container = await createContainer(loadConfig({
    GG_DATA_DIR: dataDir, GG_DB_URL: ':memory:', GG_SWAGGER_UI: 'false', GG_REQUIRE_API_KEY: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'), GG_WEB_DIST: join(root, 'apps/web/dist'),
  }), { harnesses: { codex: new FakeHarness() }, startTimers: false });
  await container.start();
  const app = await buildApp(container, { logger: false });
  process.env.GG_E2E_BASE_URL = await app.listen({ host: '127.0.0.1', port: 5743 });
  return async () => { await app.close(); await container.stop(); };
}
