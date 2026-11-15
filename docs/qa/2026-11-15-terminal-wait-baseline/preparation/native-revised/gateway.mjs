import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, checkoutArg, storeArg, ...extra] = process.argv.slice(2);
assert.ok(['ordinary', 'gated'].includes(mode));
assert.equal(extra.length, 0);
assert.equal(process.execArgv.length, 0);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'win32');
assert.equal(typeof process.send, 'function');
const checkout = await realpath(checkoutArg);
const store = await realpath(storeArg);
assert.equal(await realpath(process.cwd()), checkout);
assert.equal(process.env.GG_DATA_DIR, store);
assert.equal(process.env.GG_DB_URL, pathToFileURL(join(store, 'graphgoblin.db')).href);
assert.equal(process.env.GG_HOST, '127.0.0.1');
assert.equal(process.env.GG_PORT, '0');
assert.equal(process.env.GG_OLLAMA_ENABLED, 'false');
assert.equal(process.env.GG_REQUIRE_API_KEY, 'false');

function send(value) {
  return new Promise((resolve, reject) => {
    process.send(value, (error) => error ? reject(error) : resolve());
  });
}

try {
  let app;
  if (mode === 'ordinary') {
    // Import the real entry and call exactly its production startup path. The wrapper only sends
    // the ephemeral actual socket address to its owner after listen.
    const { main } = await import(pathToFileURL(join(checkout, 'apps/api/dist/main.js')).href);
    ({ app } = await main());
  } else {
    const { loadConfig, createContainer, buildApp } =
      await import(pathToFileURL(join(checkout, 'apps/api/dist/index.js')).href);
    const owner = await createContainer(loadConfig(process.env), { startTimers: false, harnesses: {} });
    const original = owner.ports.runs;
    const waitForCleanup = Promise.withResolvers();
    let armed;
    let entered = false;
    owner.ports.runs = new Proxy(original, {
      get(target, key) {
        if (key === 'transition') return async (runId, states, change, options) => {
          if (runId === armed?.parentId && change.status === 'failed') {
            assert.equal(entered, false);
            entered = true;
            // This notification occurs before calling the real SQLite transition. The real event
            // store already committed run.failed. The supervisor independently proves both.
            await send({
              type: 'gate', pid: process.pid, runId, childId: armed.childId, states,
              change, ownsWaitingMember: Object.hasOwn(change, 'waiting'), delegateEntered: false,
            });
            await waitForCleanup.promise;
            await send({ type: 'cleanup-release', runId });
          }
          return target.transition(runId, states, change, options);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await owner.start();
    app = await buildApp(owner, { logger: { level: 'info' } });
    void owner.waitForShutdown().then(async () => {
      await app.close();
      await owner.dispose();
      process.exit(0);
    }).catch(async (error) => {
      await send({ type: 'fatal', message: error.message, where: 'managed shutdown' }).catch(() => {});
      process.exit(1);
    });
    process.on('message', (message) => {
      void (async () => {
        if (message.type === 'arm') {
          assert.equal(armed, undefined);
          const run = await owner.repos.runs.get(message.parentId);
          assert.equal(run?.status, 'waiting');
          assert.equal(run.waiting?.kind, 'child');
          assert.equal(run.waiting.childRunId, message.childId);
          assert.equal(run.waiting.waitId, message.waitId);
          armed = { parentId: message.parentId, childId: message.childId };
          await send({ type: 'armed', ...armed });
        } else if (message.type === 'release-for-incomplete-cleanup') {
          // Failure cleanup only. Using it invalidates the abrupt-interruption witness.
          if (!entered) armed = undefined;
          waitForCleanup.resolve();
        }
      })().catch(async (error) => {
        await send({ type: 'fatal', message: error.message, where: 'IPC' }).catch(() => {});
      });
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
  }
  const address = app.server.address();
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0 && ![4747, 4748].includes(address.port));
  const lock = JSON.parse(await readFile(join(store, 'graphgoblin.lock'), 'utf8'));
  const databaseLock = JSON.parse(await readFile(join(store, 'graphgoblin.db.graphgoblin.lock'), 'utf8'));
  assert.equal(lock.pid, process.pid);
  assert.equal(databaseLock.pid, process.pid);
  assert.match(lock.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
  assert.equal(databaseLock.windowsCreationTime, lock.windowsCreationTime);
  await send({ type: 'ready', mode, pid: process.pid, store, origin: 'http://127.0.0.1:' + address.port,
    windowsCreationTime: lock.windowsCreationTime,
    lockStartedAt: lock.startedAt, databaseLockStartedAt: databaseLock.startedAt });
} catch (error) {
  await send({ type: 'fatal', message: error.message, stack: error.stack, where: 'startup' }).catch(() => {});
  process.stderr.write(String(error.stack ?? error) + '\n');
  process.exit(1);
}
