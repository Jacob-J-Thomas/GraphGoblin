import process from 'node:process';
import { createContainer } from '../dist/container.js';
import { buildApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { FakeHarness } from '@graphgoblin/engine/testing';

// Built production composition and stores; only the external harness port is controlled.
const harness = new FakeHarness(
  process.env.WP_F4_HOLD === '1'
    ? [{ finalText: 'held', delayMs: 600000 }]
    : process.env.WP_F4_HOLD === 'unaccepted'
      ? [
          { finalText: 'A completed' },
          { items: [], accepted: false, announceSession: false, delayMs: 600000 },
        ]
      : [{ finalText: 'recovered' }],
);
const container = await createContainer(loadConfig(process.env), {
  harnesses: { codex: harness },
  startTimers: false,
});
await container.start();
const app = await buildApp(container);
await app.listen({ host: '127.0.0.1', port: Number(process.env.GG_PORT) });
process.send?.({ type: 'ready' });
process.on('message', async (message) => {
  if (message.type === 'inspect')
    process.send?.({ type: 'calls', started: harness.started, resumed: harness.resumed });
  if (message.type === 'stop') {
    await app.close();
    await container.stop();
    process.exit(0);
  }
});
