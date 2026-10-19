/** Disposable built-entry process fixture. No owner environment, listener, or store is reused. */
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const entry = join(apiRoot, 'dist', 'main.js');
const safe = (value: string) => value.replace(/\bgg_[A-Za-z0-9_-]+/g, '[disposable-key]');

export async function eventually(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for disposable API state');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function freePort(): Promise<number> {
  const offset = Math.floor(Math.random() * 100);
  for (let index = 0; index < 100; index++) {
    const port = 5600 + ((offset + index) % 100);
    const server = createServer();
    const available = await new Promise<boolean>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(false) : reject(error),
      );
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No disposable API port is free in 5600-5699');
}

function launch(env: NodeJS.ProcessEnv, args: string[]) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '',
    exited = false;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        exited = true;
        resolve({ code, signal });
      });
    },
  );
  void completion.catch(() => undefined);
  async function waitForExit(timeoutMs = 20_000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`API child did not exit: ${safe(stdout)} ${safe(stderr)}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get exited() {
      return exited;
    },
    waitForExit,
    async waitForLog(message: string, timeoutMs = 20_000) {
      await eventually(() => {
        if (stdout.includes(message)) return true;
        if (exited) throw new Error(`API child exited before ${message}: ${safe(stderr)}`);
        return false;
      }, timeoutMs);
    },
    async dispose() {
      // Force is test cleanup only. It is never evidence that a JS signal handler ran.
      if (!exited) child.kill('SIGKILL');
      await waitForExit();
    },
  };
}

export async function createApiProcessFixture() {
  await access(entry); // Run pnpm build before these tests; never silently build a different entry.
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-api-process-'));
  const databaseFile = join(dataDir, 'graphgoblin.db');
  const lockPath = join(dataDir, 'graphgoblin.lock');
  const port = await freePort();
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith('GG_') && name.toUpperCase() !== 'JEV_API_KEY',
    ),
  );
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    NODE_V8_COVERAGE: join(dataDir, 'v8'),
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${databaseFile.replaceAll('\\', '/')}`,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_LOG_LEVEL: 'info',
    GG_REQUIRE_API_KEY: 'true',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
    GG_JEV_API_KEY: '',
    GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
  };
  const children: ReturnType<typeof launch>[] = [];
  const run = (args: string[] = [], overrides: NodeJS.ProcessEnv = {}) => {
    const child = launch({ ...env, ...overrides }, args);
    children.push(child);
    return child;
  };
  return {
    dataDir,
    databaseFile,
    lockPath,
    port,
    env,
    run,
    async createKey() {
      const command = run(['--create-api-key', 'disposable lifecycle']);
      const result = await command.waitForExit();
      if (result.code !== 0) throw new Error(`Key CLI failed: ${safe(command.stderr)}`);
      const token = /^\s+(gg_[A-Za-z0-9_-]+)\s*$/m.exec(command.stdout)?.[1];
      if (!token) throw new Error('Key CLI did not print a token');
      return token;
    },
    async ready(child: ReturnType<typeof launch>, token: string) {
      await child.waitForLog('GraphGoblin API listening');
      const response = await fetch(`http://127.0.0.1:${port}/loops`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status !== 200)
        throw new Error(`Authenticated API readiness returned ${response.status}`);
    },
    async entryCoverage() {
      const reports = await readdir(join(dataDir, 'v8'));
      const entries: unknown[] = [];
      for (const report of reports) {
        const raw = JSON.parse(await readFile(join(dataDir, 'v8', report), 'utf8')) as {
          result: {
            url: string;
            functions: { functionName: string; ranges: { count: number }[] }[];
          }[];
        };
        entries.push(...raw.result.filter((script) => script.url.endsWith('/api/dist/main.js')));
      }
      return entries;
    },
    async dispose() {
      await Promise.all(children.map((child) => child.dispose()));
      // Retain uniquely named temp directories and V8 reports for review; do not delete directories.
    },
  };
}
