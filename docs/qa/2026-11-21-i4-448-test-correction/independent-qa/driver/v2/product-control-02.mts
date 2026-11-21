// QA448 run 02: controlled product-path check of finding F1. Runs the real createContainer().start()
// (production TypeScript, loaded by tsx with the `development` condition) on a disposable fixture with
// GG_OLLAMA_URL pointed at an in-process loopback honeypot, so the default port 11434 is never targeted.
// Variant `enabled-default`: the parent commit's environment shape (no GG_OLLAMA_ENABLED).
// Variant `disabled-candidate`: the candidate's GG_OLLAMA_ENABLED='false'.
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'G:/ggq/gg-i4-448-qa/GraphGoblin';
const src = (p: string) => pathToFileURL(join(REPO, p)).href;
const variant = process.argv[2];
if (variant !== 'enabled-default' && variant !== 'disabled-candidate') throw new Error(`variant ${variant}`);

const guard = (globalThis as { __qa448Guard?: { counts: { blocked: number; attemptObserved: number; byKind: Record<string, number> } } }).__qa448Guard;
if (!guard) throw new Error('guard not installed');
const snapshot = () => JSON.parse(JSON.stringify(guard.counts));

let honeypotConnections = 0;
const honeypot = net.createServer((s) => {
  honeypotConnections++;
  s.destroy();
});
await new Promise<void>((r) => honeypot.listen(0, '127.0.0.1', () => r()));
const honeypotOpened = Date.now();
const port = (honeypot.address() as net.AddressInfo).port;

const { loadConfig } = await import(src('apps/api/src/config.ts'));
const { createContainer } = await import(src('apps/api/src/container.ts'));
const { DEFAULT_MODEL_CATALOG, SqliteModelCatalog, openDatabase } = await import(src('packages/infrastructure/src/sqlite/index.ts'));
const { FakeHarness } = await import(src('packages/engine/src/testing/index.ts'));

const dir = mkdtempSync(join(tmpdir(), 'qa448-control02-'));
const dbFile = join(dir, 'store', 'gateway.db');
const { mkdirSync } = await import('node:fs');
mkdirSync(join(dir, 'store'));
const handle = openDatabase({ url: pathToFileURL(dbFile).href });
try {
  await handle.migrate();
  await new SqliteModelCatalog(handle.db).seed(DEFAULT_MODEL_CATALOG);
} finally {
  handle.close();
}

const environment: Record<string, string> = {
  GG_DATA_DIR: join(dir, 'data'),
  GG_DB_URL: pathToFileURL(dbFile).href,
  GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
  GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } }),
  GG_OLLAMA_URL: `http://127.0.0.1:${port}`,
};
if (variant === 'disabled-candidate') environment.GG_OLLAMA_ENABLED = 'false';
const config = loadConfig(environment);

const before = snapshot();
const container = await createContainer(config, {
  harnesses: { codex: new FakeHarness(), claude: new FakeHarness([], 'claude') },
  deciders: [],
  startTimers: false,
});
const startedAt = Date.now();
let firstAttemptMs: number | undefined;
try {
  await container.start();
  // Wait for discovery to act (or 6 s) before stopping, so a missing attempt is not a timing artefact.
  while (Date.now() - startedAt < 6000) {
    if (guard.counts.blocked + guard.counts.attemptObserved > before.blocked + before.attemptObserved) {
      firstAttemptMs = Date.now() - startedAt;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  // Give any follow-up requests a moment to be recorded.
  await new Promise((r) => setTimeout(r, 500));
} finally {
  await container.stop();
}
const after = snapshot();
// Keep the honeypot listening >= 5 s in total so the native TCP poller can observe its LISTEN row.
const remaining = 5000 - (Date.now() - honeypotOpened);
if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
await new Promise<void>((r) => honeypot.close(() => r()));

const deltaByKind: Record<string, number> = {};
for (const [k, v] of Object.entries(after.byKind as Record<string, number>)) {
  const d = v - ((before.byKind as Record<string, number>)[k] ?? 0);
  if (d && !/listen|ip-literal|child-spawn|pipe|ipc|local-scheme/.test(k)) deltaByKind[k] = d;
}
const result = {
  variant,
  environmentKeys: Object.keys(environment).sort(),
  config: { ollamaEnabled: config.ollamaEnabled, ollamaUrl: config.ollamaUrl },
  honeypotPort: port,
  honeypotConnections,
  firstAttemptMs,
  outboundDelta: {
    blocked: after.blocked - before.blocked,
    attemptObserved: after.attemptObserved - before.attemptObserved,
    byKind: deltaByKind,
  },
};
(globalThis as { gc?: () => void }).gc?.();
await new Promise((r) => setTimeout(r, 200));
rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log(JSON.stringify(result, null, 2));
const expected =
  variant === 'enabled-default'
    ? result.outboundDelta.blocked >= 1 && (deltaByKind['L1-fetch'] ?? 0) >= 1 && honeypotConnections === 0
    : result.outboundDelta.blocked === 0 && result.outboundDelta.attemptObserved === 0 && honeypotConnections === 0;
process.exitCode = expected ? 0 : 1;
