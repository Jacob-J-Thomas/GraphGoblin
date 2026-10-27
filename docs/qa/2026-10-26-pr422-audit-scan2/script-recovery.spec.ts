import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { CURRENT_DEFINITION_FORMAT, type RunRecord } from '../../../packages/contracts/dist/index.js';

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
  for (let port = 6653; port <= 6659; port++) {
    const listener = createServer();
    const free = await new Promise<boolean>((resolve, reject) => {
      listener.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? resolve(false) : reject(error),
      );
      listener.listen(port, '127.0.0.1', () => listener.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No free #321 port in 6653..6659');
}

test('an uncertain script needs consent; deliberate Replay runs the script as a new run (#321)', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-audit-422-script-browser-'));
  const marker = join(dataDir, 'marker');
  const release = join(dataDir, 'release');
  const apiRoot = fileURLToPath(new URL('../../../apps/api/', import.meta.url));
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
    GG_REQUIRE_API_KEY: 'false',
    GG_JEV_API_KEY: '',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_WEB_DIST: fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url)),
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
    await page.screenshot({ path: testInfo.outputPath('inspector-uncertain.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await count()).toBe(1);
    expect((await call<RunRecord>('GET', `/runs/${run.id}`)).status).toBe('failed');
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    const earlierReplay = page.getByRole('dialog', { name: 'Replay as a new run' });
    await earlierReplay.getByLabel('Replay from node').selectOption('start');
    await expect(earlierReplay.getByRole('button', { name: 'Create replay run' })).toBeDisabled();
    await expect(earlierReplay).toContainText('current uncertain script');
    await earlierReplay.getByRole('checkbox', { name: /I explicitly allow/ }).check();
    await expect(earlierReplay.getByRole('button', { name: 'Create replay run' })).toBeEnabled();
    await earlierReplay.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await count()).toBe(1);
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
    await eventually(async () =>
      Boolean((await call<RunRecord>('GET', `/runs/${run.id}`)).finalizedAt),
    );
    // Deliberate Replay runs the chosen script for a new run, preserving the source history.
    await page.getByRole('button', { name: 'Replay...', exact: true }).click();
    const replayDialog = page.getByRole('dialog', { name: 'Replay as a new run' });
    await replayDialog.getByLabel('Replay from node').selectOption('script');
    await expect(replayDialog.getByRole('button', { name: 'Create replay run' })).toBeEnabled();
    await expect(replayDialog.getByRole('list', { name: 'Work that can run again' })).toContainText(
      'Effect (script): script',
    );
    expect(await count()).toBe(2);
    const sourceHistory = await call('GET', `/runs/${run.id}/events`);
    const replayResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/runs/${run.id}/replay`),
    );
    await replayDialog.getByRole('button', { name: 'Create replay run' }).click();
    const response = await replayResponse;
    expect(response.status()).toBe(202);
    const fork = ((await response.json()) as { run: RunRecord }).run;
    expect(fork.id).not.toBe(run.id);
    await expect(page).toHaveURL(new RegExp(`/app/runs/${fork.id}$`));
    await expect(page.getByRole('link', { name: run.id, exact: true })).toBeVisible();
    await eventually(
      async () => (await call<RunRecord>('GET', `/runs/${fork.id}`)).status === 'succeeded',
    );
    expect(await count()).toBe(3);
    expect(await call('GET', `/runs/${run.id}/events`)).toEqual(sourceHistory);
    expect((await call<RunRecord>('GET', `/runs/${run.id}`)).status).toBe('succeeded');
    await page.screenshot({ path: testInfo.outputPath('replay-script-as-new-run.png') });
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

