import { spawn } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { test, expect as baseExpect } from '@playwright/test';

const root = resolve('../..');
// The cases hold the same way under `shutdown.config.ts` and inside the functional browser gate:
// each drives its own gateway through a grace period and a restart; the service worker is
// blocked so a stopped gateway reads as disconnected rather than answered from the cache; and an
// assertion allows one ten-second poll of a running gateway plus slack.
test.describe.configure({ timeout: 120_000 });
test.use({ serviceWorkers: 'block' });
const expect = baseExpect.configure({ timeout: 15_000 });

async function gateway(
  options: {
    directory?: string;
    env?: NodeJS.ProcessEnv;
    prepare?: (directory: string) => Promise<NodeJS.ProcessEnv>;
  } = {},
) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), 'gg-wp-c7-319-')));
  const extra = options.prepare ? await options.prepare(directory) : options.env;
  let port = 5980;
  for (; port <= 5989; port++) {
    const probe = createServer();
    const free = await new Promise<boolean>((done, reject) => {
      probe.once('error', (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' ? done(false) : reject(error),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (free) break;
  }
  if (port > 5989) throw new Error('No disposable port free in 5980?5989');
  const origin = `http://127.0.0.1:${port}`;
  let logs = '';
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GG_')),
  );
  const child = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    windowsHide: true,
    env: {
      ...inherited,
      GG_DATA_DIR: directory,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_WEB_DIST: join(root, 'apps/web/dist'),
      GG_REQUIRE_API_KEY: 'false',
      GG_SHUTDOWN_GRACE_MS: '3000',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: Buffer) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    logs += chunk.toString();
  });
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  await expect
    .poll(
      () => {
        if (child.exitCode !== null) throw new Error(logs);
        return logs.includes('GraphGoblin API listening');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(origin + path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    return response.json() as Promise<Record<string, unknown>>;
  };
  return { directory, origin, call, child, exited, env: extra };
}

test('drain is visible everywhere, expiry offers choices, waiting has no timer, and completion exits cleanly', async ({
  page,
  context,
}, testInfo) => {
  const g = await gateway();
  let restarted: Awaited<ReturnType<typeof gateway>> | undefined;
  let shutdownReads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/system/shutdown' && request.method() === 'GET')
      shutdownReads++;
  });
  const release = join(g.directory, 'release');
  const started = join(g.directory, 'started');
  try {
    const created = await g.call('/loops', 'POST', {
      definition: {
        schemaVersion: 4,
        name: 'Shutdown browser work',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'hold',
            kind: 'script',
            label: 'Held script',
            config: {
              command: process.execPath,
              args: [
                '-e',
                `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'active');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},25);setTimeout(()=>process.exit(0),180000)`,
              ],
            },
          },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'hold' } },
          { id: 'b', from: { node: 'hold', port: 'out' }, to: { node: 'done' } },
        ],
      },
    });
    const loopId = (created['loop'] as { id: string }).id;
    await g.call(`/loops/${loopId}/publish`, 'POST');
    const startedRun = await g.call(`/loops/${loopId}/runs`, 'POST', {});
    const runId = (startedRun['run'] as { id: string }).id;
    await expect
      .poll(() =>
        access(started).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await page.goto(g.origin + '/app/loops');
    await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible();
    const draining = await g.call('/system/shutdown', 'POST', { action: 'drain' });
    await testInfo.attach('draining-state', {
      body: JSON.stringify(draining),
      contentType: 'application/json',
    });
    await expect
      .poll(async () => (await g.call('/system/shutdown'))['phase'])
      .toBe('awaiting-choice');
    const state = await g.call('/system/shutdown');
    await testInfo.attach('awaiting-choice-state', {
      body: JSON.stringify(state),
      contentType: 'application/json',
    });
    await testInfo.attach('browser-at-expiry', {
      body: await page.locator('body').innerText(),
      contentType: 'text/plain',
    });
    await testInfo.attach('expiry', { body: await page.screenshot(), contentType: 'image/png' });
    expect(state['activeRunIds']).toContain(runId);
    await expect(page.getByRole('heading', { name: 'Gateway is draining' })).toBeVisible();
    await expect(page.getByText(/The gateway grace period elapsed/)).toBeVisible();
    await testInfo.attach('browser-confirmed-choice', {
      body: await page.locator('body').innerText(),
      contentType: 'text/plain',
    });
    await testInfo.attach('confirmed-choice', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect(page.getByRole('link', { name: new RegExp(runId) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Force stop', exact: true })).toBeVisible();
    const other = await context.newPage();
    await other.goto(g.origin + '/app/events');
    await expect(other.getByRole('heading', { name: 'Gateway is draining' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Keep waiting' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Keep waiting' })).toBeVisible();
    await Promise.all([
      page.getByRole('button', { name: 'Keep waiting' }).click(),
      other.getByRole('button', { name: 'Keep waiting' }).click(),
    ]);
    await expect.poll(async () => (await g.call('/system/shutdown'))['phase']).toBe('draining');
    // Observe beyond the original grace. This checks the absence of a second countdown.
    await page.waitForTimeout(3500);
    expect((await g.call('/system/shutdown'))['phase']).toBe('draining');
    await other.close();
    expect((await g.call('/system/shutdown'))['phase']).toBe('draining');
    await writeFile(release, 'finish');
    await expect.poll(() => g.child.exitCode, { timeout: 30_000 }).toBe(0);
    expect(await g.exited).toBe(0);
    await expect(page.getByText('Gateway stopped or disconnected', { exact: true })).toBeVisible();
    await expect(access(join(g.directory, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const readsAtClosure = shutdownReads;
    await page.waitForTimeout(2500);
    expect(shutdownReads).toBe(readsAtClosure);
    restarted = await gateway({ directory: g.directory });
    const recovered = await restarted.call(`/runs/${runId}`);
    expect(recovered['status']).toBe('succeeded');
    await testInfo.attach('restarted-completion', {
      body: JSON.stringify(recovered),
      contentType: 'application/json',
    });
    await restarted.call('/system/shutdown', 'POST', { action: 'drain' });
    await expect.poll(() => restarted?.child.exitCode).toBe(0);
  } finally {
    await writeFile(release, 'finish');
    for (const instance of [g, restarted]) {
      if (instance && instance.child.exitCode === null) {
        await instance.call('/system/shutdown', 'POST', { action: 'drain' }).catch(() => undefined);
        await expect.poll(() => instance.child.exitCode, { timeout: 30_000 }).toBe(0);
      }
    }
  }
});

test('confirmed force interrupts a controlled native harness, releases ownership and preserves interruption on restart', async ({
  page,
}, testInfo) => {
  const g = await gateway({
    prepare: async (directory) => {
      let binary: string;
      if (process.platform === 'win32') {
        binary = join(directory, 'shutdown-codex.exe');
        const compile = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(root, 'apps/web/e2e/shutdown-fake-codex.ps1'),
            '-Directory',
            directory,
          ],
          { windowsHide: true, stdio: 'pipe' },
        );
        let errors = '';
        compile.stderr.on('data', (chunk: Buffer) => {
          errors += chunk.toString();
        });
        const code = await new Promise<number | null>((done) => compile.once('exit', done));
        expect(code, errors).toBe(0);
      } else {
        binary = join(directory, 'shutdown-codex');
        await writeFile(
          binary,
          `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex-cli 0.160.0');process.exit(0)}
if(process.argv.includes('--help')){console.log('--json --model --sandbox --cd --skip-git-repo-check --output-schema --config');process.exit(0)}
if(process.argv.includes('login')){console.log('Logged in using ChatGPT');process.exit(0)}
require('node:fs').writeFileSync(process.env.SHUTDOWN_FAKE_PID,String(process.pid));
console.log(JSON.stringify({type:'thread.started',thread_id:'shutdown-controlled-session'}));
console.log(JSON.stringify({type:'turn.started'}));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),180000);
`,
        );
        await chmod(binary, 0o755);
      }
      return { GG_CODEX_BINARY: binary, SHUTDOWN_FAKE_PID: join(directory, 'harness.pid') };
    },
  });
  let restarted: Awaited<ReturnType<typeof gateway>> | undefined;
  try {
    const created = await g.call('/loops', 'POST', {
      definition: {
        schemaVersion: 4,
        name: 'Controlled native shutdown harness',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          {
            id: 'infer',
            kind: 'inference',
            label: 'Held harness',
            config: {
              harness: 'codex',
              prompt: { template: 'Synthetic shutdown fixture; no provider call' },
            },
          },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
          { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
        ],
      },
    });
    const loopId = (created['loop'] as { id: string }).id;
    await g.call(`/loops/${loopId}/publish`, 'POST');
    const run = await g.call(`/loops/${loopId}/runs`, 'POST', {});
    const runId = (run['run'] as { id: string }).id;
    await expect
      .poll(() =>
        access(join(g.directory, 'harness.pid')).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    const pid = Number(await readFile(join(g.directory, 'harness.pid'), 'utf8'));
    await page.goto(g.origin + `/app/runs/${runId}`);
    await g.call('/system/shutdown', 'POST', { action: 'drain' });
    await expect(page.getByRole('heading', { name: 'Gateway is draining' })).toBeVisible();
    await expect
      .poll(async () => (await g.call('/system/shutdown'))['phase'])
      .toBe('awaiting-choice');
    await expect(page.getByText(/The gateway grace period elapsed/)).toBeVisible();
    await page.getByRole('button', { name: 'Force stop', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: new RegExp(runId) })).toBeVisible();
    await expect(dialog.getByText(/External effects may be uncertain/)).toBeVisible();
    await testInfo.attach('force-confirmation', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect((await g.call('/system/shutdown'))['phase']).toBe('awaiting-choice');
    await dialog.getByRole('button', { name: 'Confirm force stop' }).click();
    await expect.poll(() => g.child.exitCode, { timeout: 30_000 }).toBe(0);
    expect(await g.exited).toBe(0);
    try {
      process.kill(pid, 0);
      throw new Error('Controlled harness process is still running');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ESRCH' });
    }
    await expect(page.getByText('Gateway stopped or disconnected', { exact: true })).toBeVisible();
    await expect(access(join(g.directory, 'graphgoblin.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    restarted = await gateway({ directory: g.directory, ...(g.env ? { env: g.env } : {}) });
    const recovered = await restarted.call(`/runs/${runId}`);
    expect(recovered).toMatchObject({
      status: 'failed',
      failure: {
        code: 'RUN_INTERRUPTED_BY_STOP',
        nodeId: 'infer',
        resumable: false,
        details: { attempt: 1, effectMayHaveHappened: true },
      },
    });
    await testInfo.attach('restarted-interruption', {
      body: JSON.stringify(recovered),
      contentType: 'application/json',
    });
    const events = await restarted.call(`/runs/${runId}/events`);
    expect(JSON.stringify(events)).toContain('RUN_INTERRUPTED_BY_STOP');
    await restarted.call('/system/shutdown', 'POST', { action: 'drain' });
    await expect.poll(() => restarted?.child.exitCode).toBe(0);
  } finally {
    for (const instance of [g, restarted]) {
      if (instance && instance.child.exitCode === null) {
        await instance.call('/system/shutdown', 'POST', { action: 'force' }).catch(() => undefined);
        await expect.poll(() => instance.child.exitCode, { timeout: 30_000 }).not.toBeNull();
      }
    }
  }
});
