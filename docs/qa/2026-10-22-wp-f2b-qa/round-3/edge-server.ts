// <repo> model-picker-only control server: built API/web, existing engine fakes.
// No live-provider endpoint; every listener is constrained to the approved range.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FakeHarness } from '../../../../packages/engine/dist/testing/index.js';
import {
  HarnessPreflightSchema,
  ModelCatalogEntrySchema,
} from '../../../../packages/contracts/dist/index.js';
import { createTestApp, qaStores } from './edge-test-app.mjs';

const evidence = new URL('.', import.meta.url);
const dist = fileURLToPath(new URL('../../../../apps/web/dist', import.meta.url));
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const ready = HarnessPreflightSchema.parse({
  state: 'ready',
  ok: true,
  version: '2.1.285 (E2E fake)',
  authenticated: true,
  problems: [],
  authMethod: 'claude.ai',
  supportedPolicies: [
    {
      sandbox: 'read-only',
      approval: 'never',
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      authMethod: 'claude.ai',
      boundary: 'builtin-tools',
      network: 'unconfined',
    },
    {
      sandbox: 'danger-full-access',
      approval: 'never',
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
      authMethod: 'claude.ai',
      boundary: 'unconfined',
      network: 'unconfined',
    },
  ],
  models: [
    { model: 'claude-opus-5-5', efforts },
    { model: 'claude-fable-5-1', efforts },
  ],
});
class Claude extends FakeHarness {
  constructor() {
    super([], 'claude');
  }
  async preflight() {
    return ready;
  }
}
type Instance = {
  id: string;
  app: Awaited<ReturnType<typeof createTestApp>>;
  url: string;
  harnesses: Record<string, FakeHarness>;
};
const instances = new Map<string, Instance>();
let nextPort = 5883;
async function start(claude = false, main = false) {
  const id = main ? 'main' : 'e2e-instance-' + instances.size;
  const harnesses: Record<string, FakeHarness> = {
    codex: new FakeHarness([], 'codex'),
    ...(claude ? { claude: new Claude() } : {}),
  };
  const app = await createTestApp({ env: { GG_WEB_DIST: dist }, harnesses });
  const port = main ? 5881 : nextPort++;
  if (port > 5889) throw new Error('QA port range exhausted');
  const url = await app.app.listen({ host: '127.0.0.1', port });
  const instance = { id, app, url, harnesses };
  instances.set(id, instance);
  return instance;
}
const main = await start(false, true);
async function control(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  const body = raw ? JSON.parse(raw) : {};
  const instance = instances.get(body.instanceId ?? 'main');
  if (!instance) throw new Error('Unknown fixture instance');
  const harness = instance.harnesses[body.harness ?? 'codex'];
  switch (req.url) {
    case '/catalog/upsert':
      await main.app.container.repos.catalog.upsert(ModelCatalogEntrySchema.parse(body));
      return { ok: true };
    case '/harness/script':
      if (!harness) throw new Error('Unknown fixture harness');
      harness.script(body.turns ?? []);
      return { ok: true };
    case '/harness/requests':
      if (!harness) throw new Error('Unknown fixture harness');
      return {
        started: harness.started.map((r) => ({
          model: r.model,
          effort: r.effort,
          ...(body.instanceId !== undefined || body.harness !== undefined
            ? { harness: body.harness ?? 'codex', options: r.options }
            : {}),
        })),
      };
    case '/apps': {
      const extra = await start(body.claude === true);
      return { instanceId: extra.id, url: extra.url };
    }
    default:
      res.statusCode = 404;
      return { error: 'Unsupported model-picker fixture control' };
  }
}
const server = createServer((req, res) => {
  void control(req, res).then(
    (result) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result));
    },
    (error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    },
  );
});
await new Promise<void>((done) => server.listen(5882, '127.0.0.1', done));
console.log('GG_E2E_CONTROL http://127.0.0.1:5882');
console.log('GG_E2E_READY ' + main.url);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((done) => server.close(() => done()));
  for (const instance of instances.values()) await instance.app.close();
  await writeFile(
    new URL('edge-lifecycle.json', evidence),
    JSON.stringify({ pid: process.pid, stores: qaStores }, null, 2) + '\n',
  );
  process.exit(0);
}
process.stdin.on('data', () => void stop());
process.stdin.on('end', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
