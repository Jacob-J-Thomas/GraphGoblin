// Invokes the built gateway entry point with a disposable environment and reports its loopback bind.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout] = process.argv.slice(2);
assert.equal(process.version, 'v22.23.4');
assert.equal(process.env.GG_HOST, '127.0.0.1');
assert.equal(process.env.GG_PORT, '0');
assert.equal(process.env.GG_DATA_DIR, process.cwd());
assert.equal(process.env.GG_OLLAMA_ENABLED, 'false');

let app;
try {
  const { main } = await import(pathToFileURL(join(checkout, 'apps/api/dist/main.js')).href);
  ({ app } = await main());
  const address = app.server.address();
  assert(address && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
  assert(address.port > 0 && ![4747, 4748].includes(address.port), 'Gateway port refused.');
  process.send({
    host: address.address,
    port: address.port,
    pid: process.pid,
    createdAt: new Date(performance.timeOrigin).toISOString(),
    readyAt: new Date().toISOString(),
  });
  process.disconnect();
} catch (error) {
  try {
    await app?.close();
  } finally {
    console.error(error);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
