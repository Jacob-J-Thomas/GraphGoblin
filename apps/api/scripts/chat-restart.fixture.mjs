import process from 'node:process';
import { createContainer } from '../dist/container.js';
import { buildApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { ProcessScripts } from '@graphgoblin/infrastructure/process';

// Real built composition, SQLite admission, binary storage, and native Script subprocesses.
// Only inference is scripted. The first process withholds an already-finished Script result,
// placing the native engine at a known external-effect uncertainty boundary before SIGKILL.
const nativeScripts = new ProcessScripts();
const harness = new FakeHarness([
  { structured: { protocol: 'graphgoblin.chat.v1', reply: 'Exact native fixture reply' } },
]);
const offset = Number(process.env.CHAT_RESTART_CLOCK_OFFSET_MS ?? 0);
const container = await createContainer(loadConfig(process.env), {
  harnesses: { codex: harness },
  clock: { now: () => new Date(Date.now() + offset) },
  startTimers: false,
  scripts: {
    async run(request) {
      const result = await nativeScripts.run(request);
      if (process.env.CHAT_RESTART_HOLD === '1' && request.env.CHAT_RESTART_PHASE === 'effect') {
        if (result.state !== 'completed' || result.exitCode !== 0)
          throw new Error('The disposable effect Script must finish before the crash boundary');
        process.send?.({ type: 'effect-held' });
        await new Promise((resolve) =>
          request.signal.addEventListener('abort', resolve, { once: true }),
        );
      }
      return result;
    },
  },
});
await container.start();
const token =
  process.env.CHAT_RESTART_BOOTSTRAP === '1'
    ? (await container.repos.apiKeys.create('local', 'Disposable Chat restart owner', ['*'])).token
    : undefined;
const app = await buildApp(container, { logger: false });
app.addHook('onSend', async (request, _reply, payload) => {
  if (
    request.headers['x-chat-restart-drop-ack'] === '1' &&
    request.method === 'POST' &&
    request.routeOptions.url === '/chat/conversations/:id/turns'
  ) {
    process.send?.({ type: 'admitted-without-ack', turn: JSON.parse(payload) });
    // This fixture deliberately loses the HTTP acknowledgement after the real admission commits.
    await new Promise(() => undefined);
  }
  return payload;
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.GG_PORT) });
process.send?.({ type: 'ready', ...(token ? { ownerToken: token } : {}) });
process.on('message', async (message) => {
  if (message.type === 'stop') {
    await app.close();
    await container.stop();
    process.exit(0);
  }
});
