// Provider isolation of disposable API startup (#565), in both venues that use the process
// fixture: the built entry as a child process and main() inside this worker. Each case owns a
// stand-in Ollama listener on 127.0.0.1 port 0 that answers discovery with an empty model list,
// so no model is listed, loaded or run. Every case routes discovery to that listener, including
// the case that asserts the fixture default.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OllamaConnectionView } from '@graphgoblin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../main.js';
import { createApiProcessFixture, eventually } from './api-subprocess.js';

type Fixture = Awaited<ReturnType<typeof createApiProcessFixture>>;
type Start = (f: Fixture, token: string, overrides: Record<string, string>) => Promise<void>;

/** A synthetic owner-shell value; neither venue may seed it as the owner's Jev secret. */
const JEV_CANARY = 'jev-565-synthetic-canary';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  const failures: unknown[] = [];
  // Last in, first out: a running API closes before its store is removed and its listener closes.
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup().catch((error: unknown) => failures.push(error));
  if (failures.length > 0) throw failures[0];
}, 60_000);

/** The request oracle: every request the owned stand-in receives, as `METHOD path`. */
async function ownedOllama() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'GET' && request.url === '/api/tags')
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"models":[]}');
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject).listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, requests };
}

const venues: [string, Start][] = [
  [
    'built API subprocess',
    async (f, token, overrides) => {
      const child = f.run([], overrides);
      await f.ready(child, token);
      expect(child.stdout).not.toContain('seeded jev-api-key');
    },
  ],
  [
    'in-process main()',
    async (f, token, overrides) => {
      // As main.test.ts: clear inherited configuration and JEV_API_KEY, then adopt the fixture's
      // GG_* values, all through reversible stubs.
      for (const name of Object.keys(process.env)) {
        const upper = name.toUpperCase();
        if ((upper.startsWith('GG_') && !upper.startsWith('GG_TEST_')) || upper === 'JEV_API_KEY')
          vi.stubEnv(name, undefined);
      }
      for (const [name, value] of Object.entries({ ...f.env, ...overrides }))
        if (name.toUpperCase().startsWith('GG_')) vi.stubEnv(name, value);
      const running = await main();
      cleanups.push(async () => {
        try {
          await running.app.close();
        } finally {
          await running.container.stop();
        }
      });
      expect(running.container.config.jevApiKey).toBeUndefined();
      const response = await fetch(`http://127.0.0.1:${f.port}/loops`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    },
  ],
];

const cases = [
  ['makes no discovery request under the fixture default', {}, false],
  [
    'discovers from the owned endpoint with explicit GG_OLLAMA_ENABLED=true',
    { GG_OLLAMA_ENABLED: 'true' },
    true,
  ],
] as const;

describe.each(venues)('%s: Ollama discovery at startup (#565)', (_venue, start) => {
  it.each(cases)(
    '%s',
    async (_case, enable, discovers) => {
      vi.stubEnv('JEV_API_KEY', JEV_CANARY);
      const ollama = await ownedOllama();
      const f = await createApiProcessFixture();
      cleanups.push(() => f.dispose());
      const token = await f.createKey();
      await start(f, token, { ...enable, GG_OLLAMA_URL: ollama.origin });
      const view = async () => {
        const response = await fetch(`http://127.0.0.1:${f.port}/harness/ollama/connection`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as OllamaConnectionView;
      };
      if (!discovers) {
        // Deterministic: a disabled connection never starts discovery or its refresh timer.
        expect(await view()).toEqual({
          connection: { enabled: false, baseUrl: ollama.origin, revision: 1 },
          discovery: { state: 'idle' },
        });
        expect(ollama.requests).toEqual([]);
        return;
      }
      let settled: OllamaConnectionView | undefined;
      await eventually(async () => {
        settled = await view();
        return settled.discovery.state !== 'idle' && settled.discovery.state !== 'refreshing';
      }, 30_000);
      expect(settled).toMatchObject({
        connection: { enabled: true, baseUrl: ollama.origin, revision: 1 },
        discovery: { state: 'ready' },
      });
      expect(ollama.requests).toEqual(['GET /api/tags']);
    },
    60_000,
  );
});
