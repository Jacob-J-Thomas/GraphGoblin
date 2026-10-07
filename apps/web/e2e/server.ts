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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, createContainer, loadConfig } from '@graphgoblin/api';
import { createTestApp, startFakeClassifierEndpoint, type TestApp } from '@graphgoblin/api/testing';
import type { HarnessEvent, HarnessStartRequest, HarnessSession } from '@graphgoblin/engine';
import { FakeHarness, type ScriptedTurn } from '@graphgoblin/engine/testing';
import {
  HarnessPreflightSchema,
  ModelCatalogEntrySchema,
  type HarnessPreflight,
} from '@graphgoblin/contracts';
import { originalWorker as cleanWorker } from '../src/e2e-support/worker.js';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error(
    `No web build at ${dist}. Run \`pnpm build\` (or \`pnpm --filter @graphgoblin/web build\`) first.`,
  );
  process.exit(1);
}

interface E2eInstance {
  id: string;
  app: TestApp;
  url: string;
  harnesses: Partial<Record<'codex' | 'claude', FakeHarness>>;
}

class E2eControlError extends Error {
  readonly statusCode = 400;
}

const apps: TestApp[] = [];
const instances = new Map<string, E2eInstance>();
const closers: (() => Promise<void>)[] = [];
let nextInstanceId = 1;
/** Loopback Choice endpoints started for classifier specs, by their API root. */
const classifiers = new Map<string, Awaited<ReturnType<typeof startFakeClassifierEndpoint>>>();
const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const readyClaudePreflight = HarnessPreflightSchema.parse({
  ok: true,
  version: '2.1.285 (E2E fake)',
  authenticated: true,
  problems: [],
  authMethod: 'claude.ai',
  billingMode: 'claude.ai-account',
  billingStatus: 'account-dependent',
  supportedPolicies: [
    {
      sandbox: 'read-only',
      approval: 'never',
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      authMethod: 'claude.ai',
      billingMode: 'claude.ai-account',
      billingStatus: 'account-dependent',
      boundary: 'builtin-tools',
      network: 'unconfined',
    },
    {
      sandbox: 'danger-full-access',
      approval: 'never',
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
      authMethod: 'claude.ai',
      billingMode: 'claude.ai-account',
      billingStatus: 'account-dependent',
      boundary: 'unconfined',
      network: 'unconfined',
    },
  ],
  models: [
    {
      model: 'claude-opus-5-5',
      efforts: claudeEfforts,
      admission: 'supported',
      reasonCode: null,
      billingStatus: 'account-dependent',
    },
    {
      model: 'claude-fable-5-1',
      efforts: claudeEfforts,
      admission: 'blocked',
      reasonCode: 'BILLING_UNVERIFIED',
      billingStatus: 'unverified',
    },
  ],
});
const notReadyClaudePreflight: HarnessPreflight = {
  ...readyClaudePreflight,
  ok: false,
  authenticated: false,
  problems: ['Claude CLI is not signed in.'],
  supportedPolicies: [],
};

class E2eClaudeHarness extends FakeHarness {
  termination: 'confirmed' | 'unconfirmed' = 'confirmed';
  private terminationSession = 0;

  constructor() {
    super([], 'claude');
    this.preflightResult = readyClaudePreflight;
  }

  override start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    if (this.termination === 'confirmed') return super.start(request, signal);
    this.started.push(request);
    this.terminationSession += 1;
    const sessionId = 'fake-claude-unconfirmed-' + this.terminationSession;
    const error = Object.assign(
      new Error('Termination not confirmed; stop the E2E fake before retrying.'),
      { code: 'HARNESS_TERMINATION_UNCONFIRMED', retriable: false },
    );
    const result: HarnessSession['result'] = new Promise((_, reject) => {
      if (signal.aborted) reject(error);
      else signal.addEventListener('abort', () => reject(error), { once: true });
    });
    result.catch(() => undefined);
    const events = async function* (): AsyncGenerator<HarnessEvent> {
      yield { type: 'session', sessionId, mode: 'fresh' };
      await result.catch(() => undefined);
      yield {
        type: 'error',
        code: error.code,
        message: error.message,
        retriable: false,
      };
    };
    return {
      sessionId: Promise.resolve(sessionId),
      events: events(),
      result,
      cancel: () => Promise.reject(error),
    };
  }
}

async function startApp(
  env: Record<string, string> = {},
  requireApiKey = false,
  realClassifiers = false,
  options: { claude?: boolean; id?: string } = {},
) {
  const id = options.id ?? 'e2e-instance-' + nextInstanceId++;
  const codex = new FakeHarness([], 'codex');
  const claude = options.claude ? new E2eClaudeHarness() : undefined;
  const harnesses = { codex, ...(claude ? { claude } : {}) };
  const app = await createTestApp({
    env: { GG_WEB_DIST: dist, ...env },
    requireApiKey,
    realClassifiers,
    harnesses,
  });
  apps.push(app);
  const url = await app.app.listen({ host: '127.0.0.1', port: 0 });
  const instance: E2eInstance = { id, app, url, harnesses };
  instances.set(id, instance);
  return instance;
}

const main = await startApp({}, false, false, { id: 'main' });
const mainPort = Number(new URL(main.url).port);
const workerPath = join(dist, 'sw.js');
const originalWorker = cleanWorker(await readFile(workerPath, 'utf8'));
let workerBuild = 0;

/** Drop real HTTP connections, then reuse the same listener and in-memory API state. */
async function setApiListening(listening: boolean): Promise<void> {
  const server = main.app.app.server;
  if (listening === server.listening) return;
  if (listening) {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(mainPort, '127.0.0.1', () => {
        server.removeListener('error', reject);
        done();
      });
    });
  } else {
    await new Promise<void>((done, reject) => {
      server.close((error) => (error ? reject(error) : done()));
      server.closeAllConnections();
    });
  }
}

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

function selectedInstance(body: Record<string, unknown>): E2eInstance {
  const id = typeof body['instanceId'] === 'string' ? body['instanceId'] : 'main';
  const instance = instances.get(id);
  if (!instance) throw new E2eControlError("unknown E2E instance '" + id + "'");
  return instance;
}

function selectedHarness(
  instance: E2eInstance,
  body: Record<string, unknown>,
): { harness: 'codex' | 'claude'; fake: FakeHarness } {
  const requested = body['harness'] === undefined ? 'codex' : body['harness'];
  if (requested !== 'codex' && requested !== 'claude') {
    const label = typeof requested === 'string' ? requested : typeof requested;
    throw new E2eControlError("unknown E2E harness '" + label + "'");
  }
  const fake = instance.harnesses[requested];
  if (!fake)
    throw new E2eControlError(
      "harness '" + requested + "' is not enabled for E2E instance '" + instance.id + "'",
    );
  return { harness: requested, fake };
}

async function control(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  const body = await readJson(request);
  const target = main.app;
  switch (request.url) {
    case '/api/listener':
      await setApiListening(body['listening'] !== false);
      return { ok: true };
    case '/worker/build':
      workerBuild += 1;
      await writeFile(workerPath, `${originalWorker}\n// E2E build ${workerBuild}\n`);
      return { build: workerBuild };
    case '/worker/reset':
      await writeFile(workerPath, originalWorker);
      return { ok: true };
    case '/harness/script':
      selectedHarness(selectedInstance(body), body).fake.script(
        ((body['turns'] as TurnSpec[] | undefined) ?? []).map(toTurn),
      );
      return { ok: true };
    case '/harness/requests': {
      const instance = selectedInstance(body);
      const { harness, fake } = selectedHarness(instance, body);
      const detailed = body['instanceId'] !== undefined || body['harness'] !== undefined;
      return {
        started: fake.started.map((r) => ({
          model: r.model,
          effort: r.effort,
          ...(detailed ? { harness, options: r.options } : {}),
        })),
      };
    }
    case '/harness/preflight': {
      const instance = selectedInstance(body);
      const { harness, fake } = selectedHarness(instance, body);
      if (harness !== 'claude' || !(fake instanceof E2eClaudeHarness))
        throw new E2eControlError('preflight controls are available only for the Claude E2E fake');
      if (body['state'] === 'ready') fake.preflightResult = readyClaudePreflight;
      else if (body['state'] === 'not-ready') fake.preflightResult = notReadyClaudePreflight;
      else throw new E2eControlError("preflight state must be 'ready' or 'not-ready'");
      return { ok: true };
    }
    case '/harness/termination': {
      const instance = selectedInstance(body);
      const { harness, fake } = selectedHarness(instance, body);
      if (harness !== 'claude' || !(fake instanceof E2eClaudeHarness))
        throw new E2eControlError(
          'termination controls are available only for the Claude E2E fake',
        );
      if (body['mode'] !== 'confirmed' && body['mode'] !== 'unconfirmed')
        throw new E2eControlError("termination mode must be 'confirmed' or 'unconfirmed'");
      fake.termination = body['mode'];
      return { ok: true };
    }
    case '/deciders':
      target.jev.isAvailable = body['jev'] !== false;
      target.codex.isAvailable = body['codex'] !== false;
      return { ok: true };
    case '/deciders/route':
      target.jev.choose = (request) => {
        target.jev.choices.push(request);
        const optionId =
          typeof body['optionId'] === 'string' ? body['optionId'] : request.options[0]!.id;
        return Promise.resolve({
          type: 'choice' as const,
          optionId,
          confidence: 1,
          probabilities: Object.fromEntries(
            request.options.map((option) => [option.id, option.id === optionId ? 1 : 0]),
          ),
        });
      };
      return { ok: true };
    case '/structured': {
      const queue = [...((body['responses'] as unknown[] | undefined) ?? [])];
      target.structured.respondWith(() => (queue.length > 1 ? queue.shift() : queue[0]));
      return { ok: true };
    }
    case '/catalog/upsert':
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
          GG_DEFAULTS: JSON.stringify({
            byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } },
          }),
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
    case '/classifier/start': {
      // A Choice endpoint answering the first route with probability 1, as `kev.serve` would.
      const fake = await startFakeClassifierEndpoint();
      classifiers.set(fake.endpoint, fake);
      closers.push(fake.close);
      return { endpoint: fake.endpoint };
    }
    case '/classifier/requests': {
      const fake = classifiers.get(String(body['endpoint']));
      if (!fake) throw new Error(`no fake classifier at ${String(body['endpoint'])}`);
      return {
        requests: fake.requests.map((r) => ({
          method: r.method,
          url: r.url,
          model: r.body.model,
          bearer: r.authorization !== undefined,
          labels: Object.keys(r.body.questions.answer.criteria),
        })),
      };
    }
    case '/apps': {
      const extra = await startApp(
        (body['env'] as Record<string, string> | undefined) ?? {},
        body['requireApiKey'] === true,
        // The real catalog, secret resolution, and HTTP transport for classifiers (#43).
        body['realClassifiers'] === true,
        { claude: body['claude'] === true },
      );
      // A key minted directly in the store: with GG_REQUIRE_API_KEY even POST /api-keys needs one.
      const { token } = await extra.app.container.repos.apiKeys.create('local', 'e2e', ['*']);
      return { instanceId: extra.id, url: extra.url, token };
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
      response.statusCode = error instanceof E2eControlError ? error.statusCode : 500;
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
  await setApiListening(true);
  await writeFile(workerPath, originalWorker);
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
