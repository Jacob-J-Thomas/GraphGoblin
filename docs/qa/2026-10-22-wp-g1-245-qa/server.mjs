// Disposable native process; built public API composition with supported fake-harness injection.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { createContainer, buildApp, loadConfig } = await import('../../../apps/api/dist/index.js');
const { FakeHarness } = await import('../../../packages/engine/dist/testing/index.js');
const harness = new FakeHarness();
const owner = await createContainer(
  loadConfig({
    GG_DATA_DIR: process.env.QA_DATA,
    GG_PORT: '5723',
    GG_REQUIRE_API_KEY: 'true',
    GG_WEB_DIST: join(root, 'apps/web/dist'),
    GG_LOG_LEVEL: 'silent',
    GG_SWAGGER_UI: 'false',
  }),
  { harnesses: { codex: harness }, startTimers: false },
);
await owner.start();
const app = await buildApp(owner, { logger: false });
await app.listen({ port: 5723, host: '127.0.0.1' });
process.on('message', async ({ id, op, args }) => {
  try {
    let value;
    if (op === 'stop') owner.manager.stop();
    else if (op === 'start') await owner.manager.start();
    else if (op === 'idle') await owner.manager.waitForIdle();
    else if (op === 'script') harness.script(args);
    else if (op === 'raw') {
      const run = await owner.handle.client.execute({
        sql: 'SELECT * FROM runs WHERE id=?',
        args: [args],
      });
      const events = await owner.handle.client.execute({
        sql: 'SELECT * FROM run_events WHERE run_id=? ORDER BY seq',
        args: [args],
      });
      value = { run: run.rows, events: events.rows };
    } else if (op === 'close') {
      await app.close();
      await owner.stop();
      process.send({ id, value: true }, () => process.exit(0));
      return;
    } else throw new Error('Unknown control operation');
    process.send({ id, value: value ?? true });
  } catch (error) {
    process.send({ id, error: String(error) });
  }
});
process.send({ ready: true, pid: process.pid });
