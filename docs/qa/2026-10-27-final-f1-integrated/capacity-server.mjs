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
// F1 uses the ordinary provider adapters with explicitly configured external fake CLIs.
// No in-process harness override is supplied.
//
// Usage: node qa-server.mjs <dataDir> <port> <capacityFile>
// Stdout carries pino JSON logs plus "QA_READY <url>". POST /qa/stop on the API port is NOT
// added; stop gracefully by writing "stop" to stdin, or kill the process to simulate a crash.
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const [dataDir, port, capacityFile] = process.argv.slice(2);
if (!realpathSync.native(dataDir).toLowerCase().includes('gg-final-f1-') || Number(port) < 6630 || Number(port) > 6639) throw Error('QA isolation guard');
const ledger = join(here, 'process-ledger.log.txt');
appendFileSync(ledger, `START ${process.pid} port=${port}\n`, 'utf8');
process.on('exit', code => appendFileSync(ledger, `EXIT ${process.pid} code=${code}\n`, 'utf8'));
if (!dataDir || !port || !capacityFile) {
  console.error('usage: node qa-server.mjs <dataDir> <port> <capacityFile>');
  process.exit(2);
}

const api = await import(pathToFileURL(join(root, 'apps/api/dist/index.js')).href);
const fsAdapters = await import(
  pathToFileURL(join(root, 'packages/infrastructure/dist/fs/index.js')).href
);
const requireFromApi = createRequire(join(root, 'apps/api/package.json'));
const { pino } = requireFromApi('pino');

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
  GG_CODEX_BINARY: process.env.GG_CODEX_BINARY,
  GG_CLAUDE_BINARY: process.env.GG_CLAUDE_BINARY,
  GG_WEB_DIST: join(root, 'apps/web/dist'),
});
const logger = pino({ level: process.env.QA_LOG_LEVEL ?? 'info', base: { pid: process.pid } });
const container = await api.createContainer(config, {
  logger,
  storageCapacity,
});
await container.start();
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
