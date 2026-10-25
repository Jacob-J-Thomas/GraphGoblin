import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContainer } from '../dist/container.js';
import { buildApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { FakeHarness } from '@graphgoblin/engine/testing';

// Real production composition/storage; only the provider port and its disposable disk store are fake.
const { DOMException } = globalThis;
const family = process.env.WP_265_HARNESS;
const root = join(process.env.GG_DATA_DIR, 'provider-sessions');
await mkdir(root, { recursive: true });
const calls = join(process.env.GG_DATA_DIR, 'provider-calls.jsonl');
const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 };
function turn(request, signal, resumeId) {
  const id = resumeId ?? randomUUID();
  const result = (async () => {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    await appendFile(
      calls,
      JSON.stringify({
        mode: resumeId ? 'resume' : 'fresh',
        id,
        model: request.model,
        effort: request.effort,
        prompt: request.turn.prompt,
      }) + '\n',
    );
    if (resumeId) {
      try {
        await access(join(root, id));
      } catch {
        throw Object.assign(new Error('The provider session was removed'), {
          code: 'HARNESS_SESSION_MISSING',
          submission: 'session-missing',
          retriable: false,
        });
      }
    } else await writeFile(join(root, id), request.turn.prompt);
    return { finalText: 'OK', usage, items: [] };
  })();
  result.catch(() => undefined);
  const sessionId = result.then(() => id);
  sessionId.catch(() => undefined);
  return {
    result,
    sessionId,
    cancel: async () => {},
    events: (async function* () {
      try {
        await result;
        yield { type: 'session', sessionId: id, mode: resumeId ? 'resumed' : 'fresh' };
        yield { type: 'submitted', marker: 'fake.accepted' };
      } catch (error) {
        yield {
          type: 'error',
          code: error.code,
          message: error.message,
          submission: error.submission,
          retriable: false,
        };
      }
    })(),
  };
}
const ready = new FakeHarness([], family);
const harness = {
  id: family,
  preflight: () => ready.preflight(),
  start: (request, signal) => turn(request, signal),
  resume: (id, request, signal) => turn(request, signal, id),
};
const container = await createContainer(loadConfig(process.env), {
  harnesses: { [family]: harness },
  startTimers: false,
});
await container.start();
const app = await buildApp(container, { logger: false });
await app.listen({ host: '127.0.0.1', port: Number(process.env.GG_PORT) });
process.send?.({ type: 'ready' });
process.on('message', async (message) => {
  if (message.type === 'arm-choice-crash') {
    container.repos.events.subscribe(message.runId, (event) => {
      // Supported event subscription runs after SQLite commit and before the append resolves.
      if (event.type === 'run.resumed' && event.freshSession) process.exit(0);
    });
    process.send?.({ type: 'armed' });
  }
  if (message.type === 'stop') {
    await app.close();
    await container.dispose();
    process.exit(0);
  }
});
