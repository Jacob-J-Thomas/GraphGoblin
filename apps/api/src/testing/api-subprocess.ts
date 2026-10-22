/** Disposable built-entry process fixture. No owner environment, listener, or store is reused. */
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const entry = join(apiRoot, 'dist', 'main.js');
const safe = (value: string) => value.replace(/\bgg_[A-Za-z0-9_-]+/g, '[disposable-key]');

export async function eventually(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 60_000,
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

async function freePort(first: number, last: number): Promise<number> {
  const count = last - first + 1;
  const offset = Math.floor(Math.random() * count);
  for (let index = 0; index < count; index++) {
    const port = first + ((offset + index) % count);
    const server = createServer();
    const available = await new Promise<boolean>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(false) : reject(error),
      );
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`No disposable API port is free in ${first}-${last}`);
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
  async function waitForExit(timeoutMs = 60_000) {
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
    async waitForLog(message: string, timeoutMs = 60_000) {
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

export async function createApiProcessFixture(
  options: { directoryPrefix?: string; portRange?: readonly [number, number] } = {},
) {
  try {
    await access(entry);
  } catch (cause) {
    throw new Error('Built API entry is missing; run pnpm build before API subprocess tests.', {
      cause,
    });
  }
  const port = await freePort(...(options.portRange ?? [5600, 5699]));
  const dataDir = await mkdtemp(join(tmpdir(), options.directoryPrefix ?? 'gg-api-process-'));
  const databaseFile = join(dataDir, 'graphgoblin.db');
  const lockPath = join(dataDir, 'graphgoblin.lock');
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.toUpperCase().startsWith('GG_') &&
        name.toUpperCase() !== 'JEV_API_KEY' &&
        name.toUpperCase() !== 'NODE_V8_COVERAGE',
    ),
  );
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...(process.env.GG_API_SUBPROCESS_V8_COVERAGE === '1'
      ? { NODE_V8_COVERAGE: join(dataDir, 'v8') }
      : {}),
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
    async dispose() {
      try {
        await Promise.all(children.map((child) => child.dispose()));
      } finally {
        // Native handles can take a moment to release on Windows; cleanup is best effort.
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10 }).catch(() => undefined);
      }
    },
  };
}
