// Forked Windows gateway. Imports built modules only after the parent verifies its admission.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unexpectedRepairFault } from './fixtures.mjs';

const [checkout, tier] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(checkout, file)).href);
assert.equal(process.version, 'v22.23.4');
assert.equal(typeof process.send, 'function', 'Run this worker through the admitted driver');
assert.equal(process.env.GG_HOST, '127.0.0.1');
assert.equal(process.env.GG_PORT, '0');
assert.equal(process.env.GG_DATA_DIR, process.cwd());
assert.equal(process.env.GG_OLLAMA_ENABLED, 'false');
assert.match(process.env.GG_CODEX_BINARY, /no-codex\.exe$/u);
assert.match(process.env.GG_CLAUDE_BINARY, /no-claude\.exe$/u);

let app;
let host;
let closing;
function closeComposed() {
  return closing ??= (async () => {
    try {
      await app?.close();
    } finally {
      await host?.stop();
    }
  })();
}

try {
  if (tier === 'native') {
    const { main } = await load('apps/api/dist/main.js');
    ({ app } = await main());
    process.on('disconnect', () => void app.close().catch(console.error));
  } else {
    assert.equal(tier, 'composed');
    const { createContainer, buildApp, loadConfig } = await load('apps/api/dist/index.js');
    const { TemplateError } = await load('packages/domain/dist/index.js');
    const { pino } = await load('apps/api/node_modules/pino/pino.js');
    const config = loadConfig();
    // Keep the gateway's logger options. A synchronous private sink makes log delivery
    // observable as soon as the REST run reaches finalization.
    const logger = pino({ level: config.logLevel }, pino.destination({ dest: 1, sync: true }));
    const modes = ['no-call', 'valid', 'invalid', 'provider-error', 'provider-template', 'missing-port'];
    let mode = 'no-call';
    let calls = [];
    const structured = {
      async complete(request, signal) {
        calls.push({ mode, request, aborted: signal.aborted });
        signal.throwIfAborted();
        switch (mode) {
          case 'valid': return { value: { ok: true } };
          case 'invalid': return { value: { ok: 'still wrong' } };
          case 'provider-error': {
            const fault = new Error('qa-381-external-provider ' + unexpectedRepairFault.messagePath);
            fault.stack = 'Error: qa-381-external-provider\n    at repairFixture (' +
              unexpectedRepairFault.stackPath + ':381:17)';
            throw fault;
          }
          case 'provider-template': throw new TemplateError('qa-381-external-template');
          default: throw new Error('Unauthorised structured call for mode ' + mode);
        }
      },
    };
    host = await createContainer(config, { logger, structured, startTimers: false, deciders: [], harnesses: {} });
    assert.equal(host.ports.structured, structured);
    await host.start();
    app = await buildApp(host);
    await app.listen({ host: '127.0.0.1', port: 0 });
    process.on('message', ({ id, command, value }) => {
      if (command === 'configure' && modes.includes(value)) {
        mode = value;
        calls = [];
        if (mode === 'missing-port') delete host.ports.structured;
        else host.ports.structured = structured;
        process.send({ id, mode, overridden: host.ports.structured === structured,
          absent: host.ports.structured === undefined });
      } else if (command === 'calls') {
        process.send({ id, mode, calls });
      } else {
        process.send({ id, error: 'Invalid structured fixture command' });
      }
    });
    void host.waitForShutdown().then(closeComposed).then(
      () => process.exit(0),
      (error) => { console.error(error); process.exit(1); },
    );
    process.once('disconnect', () => void closeComposed().catch(console.error));
  }
  const address = app.server.address();
  assert(address && address.address === '127.0.0.1');
  assert(address.port > 0 && ![4747, 4748].includes(address.port));
  process.send({ type: 'ready', tier, pid: process.pid, startedAt: new Date(performance.timeOrigin).toISOString(),
    host: address.address, port: address.port, cwd: process.cwd() });
} catch (error) {
  try {
    if (tier === 'composed') await closeComposed();
    else await app?.close();
  } finally {
    console.error(error);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
