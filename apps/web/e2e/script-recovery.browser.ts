import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { CURRENT_DEFINITION_FORMAT, type RunRecord } from '@graphgoblin/contracts';

interface ApiProcess {
  child: ChildProcess;
  exited: Promise<void>;
  diagnostics(): string;
}

async function eventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Disposable script browser state timed out');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function freePort() {
  for (let port = 5910; port <= 5919; port++) {
    const listener = createServer();
    const free = await new Promise<boolean>((resolve, reject) => {
      listener.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(false) : reject(error),
      );
      listener.listen(port, '127.0.0.1', () => listener.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No free #321 port in 5910..5919');
}

test('a real interrupted script explains its effect and only Resume repeats it (#321)', async ({
  page,
}) => {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-d1-browser-'));
  const marker = join(dataDir, 'marker');
  const release = join(dataDir, 'release');
  const apiRoot = fileURLToPath(new URL('../../api/', import.meta.url));
  const entry = join(apiRoot, 'dist/main.js');
  const script = join(apiRoot, 'scripts/uncertain-script-marker.mjs');
  const origin = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GG_') && name !== 'JEV_API_KEY' && name !== 'NODE_V8_COVERAGE',
    ),
  );
  Object.assign(env, {
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db')}`,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_API_KEY_REQUIRED: 'false',
    GG_JEV_API_KEY: '',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_WEB_DIST: fileURLToPath(new URL('../dist/', import.meta.url)),
  });
  const servers: ApiProcess[] = [];
  function boot(): ApiProcess {
    const child = spawn(process.execPath, [entry], {
      cwd: apiRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stdout.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', () => resolve());
    });
    const server = { child, exited, diagnostics: () => diagnostics };
    servers.push(server);
    return server;
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    if (!response.ok) throw new Error(`Disposable ${method} ${path} returned ${response.status}`);
    return (await response.json()) as T;
  }
  async function ready(server: ReturnType<typeof boot>) {
    await eventually(async () => {
      if (server.child.exitCode !== null)
        throw new Error(`Disposable API exited: ${server.diagnostics()}`);
      try {
        return (await fetch(origin + '/loops')).ok;
      } catch {
        return false;
      }
    });
  }
  const count = async () => (await readFile(marker, 'utf8')).match(/effect\n/g)?.length ?? 0;
  const markerRunning = async () =>
    (await readdir(dataDir))
      .filter((name) => name.startsWith('marker.active-'))
      .some((name) => {
        try {
          process.kill(Number(name.slice('marker.active-'.length)), 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      });
  try {
    let server = boot();
    await ready(server);
    const definition = {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'Script recovery browser',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'script',
          kind: 'script',
          label: 'Effect',
          config: {
            command: process.execPath,
            args: [script, marker, release, '60000'],
            cwd: dataDir,
          },
        },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'script' } },
        { id: 'b', from: { node: 'script', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const { loop } = await call<{ loop: { id: string } }>('POST', '/loops', { definition });
    await call('POST', `/loops/${loop.id}/publish`);
    const { run } = await call<{ run: RunRecord }>('POST', `/loops/${loop.id}/runs`);
    await eventually(async () => {
      try {
        return (await count()) === 1;
      } catch {
        return false;
      }
    });
    server.child.kill('SIGKILL');
    await server.exited;
    await writeFile(release, 'done');
    server = boot();
    await ready(server);
    await eventually(
      async () =>
        (await call<RunRecord>('GET', `/runs/${run.id}`)).failure?.code ===
        'SCRIPT_OUTCOME_UNCERTAIN',
    );
    await page.goto(`${origin}/app/runs/${run.id}`);
    await expect(page.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('may already have produced its effect');
    await page.getByRole('button', { name: 'Recover script' }).click();
    const dialog = page.getByRole('dialog', { name: 'Recover script' });
    await expect(dialog).toContainText('Resume runs the script again');
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          '../../../docs/qa/2026-10-22-wp-d1-uncertain-scripts/inspector-uncertain.png',
          import.meta.url,
        ),
      ),
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await count()).toBe(1);
    expect((await call<RunRecord>('GET', `/runs/${run.id}`)).status).toBe('failed');
    await eventually(async () => !(await markerRunning()));
    await rm(release, { force: true });
    await page.getByRole('button', { name: 'Recover script' }).click();
    await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
    // Hold the new process until the inspector has observed running. Its final status must
    // arrive through resumed observation, rather than winning a race with the mutation refetch.
    await eventually(async () => (await count()) === 2);
    await expect(page.locator('[data-status="running"]')).toBeVisible();
    await writeFile(release, 'done');
    await eventually(async () =>
      ['succeeded', 'failed'].includes((await call<RunRecord>('GET', `/runs/${run.id}`)).status),
    );
    const completed = await call<RunRecord>('GET', `/runs/${run.id}`);
    console.warn(
      JSON.stringify({
        boundary: 'explicit-resume',
        status: completed.status,
        markerCount: await count(),
      }),
    );
    expect(completed.status).toBe('succeeded');
    await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
    expect(await count()).toBe(2);
  } catch (error) {
    console.warn(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        servers: servers.map((server) => ({
          pid: server.child.pid,
          code: server.child.exitCode,
          signal: server.child.signalCode,
          log: server.diagnostics().slice(-20_000),
        })),
      }),
    );
    throw error;
  } finally {
    await writeFile(release, 'done');
    for (const server of servers) {
      if (server.child.exitCode === null && server.child.signalCode === null)
        server.child.kill('SIGKILL');
      await server.exited;
    }
    await eventually(async () => !(await markerRunning()));
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
    await expect(access(dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});
