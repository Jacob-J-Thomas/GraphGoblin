// Independent QA composition for PR #412 (#187, #322). Not product code.
//
// Composes the BUILT API exactly as apps/api/src/main.ts does (createContainer + buildApp over a
// file-backed SQLite store in a disposable data directory, real clock, real ids, real timers,
// real process scripts, real filesystem resources), with two public ContainerOverrides:
//
//   storageCapacity  the public StorageCapacityPort (ADR-0060). Reads a JSON control file on every
//                    call, so pressure can be changed from outside the process:
//                      {"mode":"real"}                      -> production FsStorageCapacity (fs.statfs)
//                      {"mode":"fixed","totalBytes":N,"availableBytes":M}
//                      {"mode":"fail"}                      -> the port throws (unavailable)
//   harnesses        a provider fake (FakeHarness from @graphgoblin/engine/testing) for codex and
//                    claude, so inference nodes complete without live provider turns. Prompt
//                    directives script the fake: [[delay=MS]] [[fail]] [[items=N]]; otherwise the
//                    transcript echoes the prompt, so distinct prompts give distinct artifacts.
//
// Usage: node qa-server.mjs <dataDir> <port> <capacityFile>
// Stdout carries pino JSON logs plus "QA_READY <url>". POST /qa/stop on the API port is NOT
// added; stop gracefully by writing "stop" to stdin, or kill the process to simulate a crash.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const [dataDir, port, capacityFile] = process.argv.slice(2);
if (!dataDir || !port || !capacityFile) {
  console.error('usage: node qa-server.mjs <dataDir> <port> <capacityFile>');
  process.exit(2);
}

const api = await import(pathToFileURL(join(root, 'apps/api/dist/index.js')).href);
const fsAdapters = await import(
  pathToFileURL(join(root, 'packages/infrastructure/dist/fs/index.js')).href
);
const testing = await import(pathToFileURL(join(root, 'packages/engine/dist/testing/index.js')).href);
const requireFromApi = createRequire(join(root, 'apps/api/package.json'));
const { pino } = requireFromApi('pino');

class QaHarness extends testing.FakeHarness {
  turnFor(prompt) {
    const delay = /\[\[delay=(\d+)\]\]/.exec(prompt);
    const items = /\[\[items=(\d+)\]\]/.exec(prompt);
    const fail = prompt.includes('[[fail]]');
    return {
      ...(delay ? { delayMs: Number(delay[1]) } : {}),
      ...(fail
        ? { error: { code: 'HARNESS_FAILED', message: 'QA scripted provider failure', retriable: false } }
        : {}),
      items: items
        ? Array.from({ length: Number(items[1]) }, (_, i) => ({
            id: `item-${i + 1}`,
            type: 'message',
            summary: `${prompt} item ${i + 1}`,
          }))
        : [{ id: 'i1', type: 'message', summary: prompt }],
      finalText: `echo: ${prompt}`,
    };
  }
  start(request, signal) {
    this.script([this.turnFor(request.turn.prompt)]);
    return super.start(request, signal);
  }
  resume(sessionId, request, signal) {
    this.script([this.turnFor(request.turn.prompt.replace('[[fail]]', ''))]);
    return super.resume(sessionId, request, signal);
  }
}

const real = new fsAdapters.FsStorageCapacity();
const storageCapacity = {
  async read(path) {
    // Marks the start of a cleanup pass for the interruption driver (this port is read first).
    process.stdout.write(`QA_CAPACITY_READ ${Date.now()}\n`);
    const control = JSON.parse(readFileSync(capacityFile, 'utf8'));
    if (control.mode === 'real') return real.read(path);
    if (control.mode === 'fail') throw new Error('QA capacity reading unavailable');
    return { totalBytes: control.totalBytes, availableBytes: control.availableBytes };
  },
};

// Only this QA configuration: never inherit the operator's GG_*/JEV_* settings or secrets.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(GG_|JEV_)/i.test(key)),
);
const config = api.loadConfig({
  ...env,
  GG_DATA_DIR: dataDir,
  GG_HOST: '127.0.0.1',
  GG_PORT: port,
  GG_SWAGGER_UI: 'false',
  GG_MASTER_KEY: Buffer.alloc(32, 41).toString('base64'),
  GG_WEB_DIST: join(root, 'apps/web/dist'),
});
const logger = pino({ level: process.env.QA_LOG_LEVEL ?? 'info', base: { pid: process.pid } });
const container = await api.createContainer(config, {
  logger,
  storageCapacity,
  harnesses: { codex: new QaHarness([], 'codex'), claude: new QaHarness([], 'claude') },
});
await container.start();
if (process.env.QA_SEED_RETAINED === '1000') {
  const { seedRetained } = await import('./r3-store-fixture.mjs');
  const seeded = await seedRetained(container, dataDir);
  console.log('QA_RETAINED_READY', JSON.stringify({ runs: seeded.runs, workspaces: seeded.paths.length, aliases: seeded.aliases }));
}
const app = await api.buildApp(container, { logger });
const url = await app.listen({ host: config.host, port: config.port });
process.stdout.write(`QA_READY ${url}\n`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } finally {
    await container.stop();
  }
  process.stdout.write('QA_STOPPED\n', () => process.exit(0));
}
process.stdin.on('data', (chunk) => {
  if (String(chunk).includes('stop')) void stop();
});
