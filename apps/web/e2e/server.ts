/**
 * E2E backend: the real API in this process over an in-memory database with the fake harness
 * (`createTestApp`), serving the built web app from apps/web/dist through the static plugin
 * (GG_WEB_DIST). Listens on an ephemeral port and prints `GG_E2E_READY <url>`; writing anything to
 * stdin, or closing it, shuts it down cleanly.
 *
 * A second, loopback-only control server (`GG_E2E_CONTROL <url>`) lets specs script the fakes:
 * harness turns, decider availability, structured completions, timer polls, and extra API
 * instances with other configuration (for example `GG_REQUIRE_API_KEY=true`).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, createContainer, loadConfig } from '@graphgoblin/api';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import type { ScriptedTurn } from '@graphgoblin/engine/testing';
import { ModelCatalogEntrySchema } from '@graphgoblin/contracts';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error(
    `No web build at ${dist}. Run \`pnpm build\` (or \`pnpm --filter @graphgoblin/web build\`) first.`,
  );
  process.exit(1);
}

const apps: TestApp[] = [];
const closers: (() => Promise<void>)[] = [];
async function startApp(env: Record<string, string> = {}, requireApiKey = false) {
  const app = await createTestApp({ env: { GG_WEB_DIST: dist, ...env }, requireApiKey });
  apps.push(app);
  const url = await app.app.listen({ host: '127.0.0.1', port: 0 });
  return { app, url };
}

const main = await startApp();

/** A scripted turn as JSON: `items` may be a count of generated progress items. */
interface TurnSpec {
  matchPrompt?: string;
  items?: number | ScriptedTurn['items'];
  finalText?: string;
  structured?: unknown;
  error?: ScriptedTurn['error'];
  delayMs?: number;
}

function toTurn(spec: TurnSpec): ScriptedTurn {
  const { matchPrompt, items, error, ...rest } = spec;
  return {
    ...rest,
    ...(error ? { error } : {}),
    ...(matchPrompt ? { match: (request) => request.prompt.includes(matchPrompt) } : {}),
    ...(typeof items === 'number'
      ? {
          items: Array.from({ length: items }, (_, i) => ({
            id: `item-${i + 1}`,
            type: 'message' as const,
            summary: `streamed item ${i + 1}`,
          })),
        }
      : items
        ? { items }
        : {}),
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function control(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  const body = await readJson(request);
  const target = main.app;
  switch (request.url) {
    case '/harness/script':
      target.harness.script(((body['turns'] as TurnSpec[] | undefined) ?? []).map(toTurn));
      return { ok: true };
    case '/harness/requests':
      return { started: target.harness.started.map((r) => ({ model: r.model, effort: r.effort })) };
    case '/deciders':
      target.jev.isAvailable = body['jev'] !== false;
      target.codex.isAvailable = body['codex'] !== false;
      return { ok: true };
    case '/structured': {
      const queue = [...((body['responses'] as unknown[] | undefined) ?? [])];
      target.structured.respondWith(() => (queue.length > 1 ? queue.shift() : queue[0]));
      return { ok: true };
    }
    case '/catalog/seed':
      await target.container.repos.catalog.upsert(ModelCatalogEntrySchema.parse(body));
      return { ok: true };
    case '/timers/poll':
      await target.container.timers.poll();
      return { ok: true };
    case '/apps/live': {
      // The real adapters (Codex CLI), for the LIVE=1 spec only. Costs subscription quota.
      const dataDir = await mkdtemp(join(tmpdir(), 'gg-e2e-live-'));
      const container = await createContainer(
        loadConfig({
          GG_DATA_DIR: dataDir,
          GG_DB_URL: ':memory:',
          GG_SWAGGER_UI: 'false',
          GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
          GG_DEFAULT_MODEL: 'gpt-6-luna',
          GG_DEFAULT_EFFORT: 'low',
          GG_WEB_DIST: dist,
        }),
        { startTimers: false },
      );
      await container.start();
      const live = await buildApp(container, { logger: false });
      closers.push(async () => {
        await live.close();
        await container.stop();
        await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
      });
      return { url: await live.listen({ host: '127.0.0.1', port: 0 }) };
    }
    case '/apps': {
      const extra = await startApp(
        (body['env'] as Record<string, string> | undefined) ?? {},
        body['requireApiKey'] === true,
      );
      // A key minted directly in the store: with GG_REQUIRE_API_KEY even POST /api-keys needs one.
      const { token } = await extra.app.container.repos.apiKeys.create('local', 'e2e', ['*']);
      return { url: extra.url, token };
    }
    default:
      response.statusCode = 404;
      return { error: `unknown control path ${request.url ?? ''}` };
  }
}

const controlServer = createServer((request, response) => {
  control(request, response).then(
    (result) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
    },
    (error: unknown) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: String(error) }));
    },
  );
});
await new Promise<void>((done) => controlServer.listen(0, '127.0.0.1', done));
const controlAddress = controlServer.address();
const controlPort = typeof controlAddress === 'object' && controlAddress ? controlAddress.port : 0;

console.log(`GG_E2E_CONTROL http://127.0.0.1:${controlPort}`);
console.log(`GG_E2E_READY ${main.url}`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  controlServer.close();
  for (const app of apps) await app.close();
  for (const close of closers) await close();
  process.exit(0);
}
if (process.env['GG_E2E_KEEP_STDIN'] !== '1') {
  process.stdin.on('data', () => void stop());
  process.stdin.on('end', () => void stop());
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
