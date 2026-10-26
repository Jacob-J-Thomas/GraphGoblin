// Shared harness for the #186 acceptance-fix measurements, adapted from the acceptance group B
// harness (docs/qa/2026-10-26-acceptance-b/lib.mjs in the acceptance worktree). It drives the
// BUILT product through public interfaces only: the API process (apps/api/dist/main.js) with a
// disposable data directory under the system temp directory, its HTTP surface and Edge.
// No provider is ever invoked: the measured loops contain no inference node, and both harness
// binaries point at files that do not exist.
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export { delay, assert };

const PREFIX = 'gg-186f-';

export async function makeTemp(tag) {
  return mkdtemp(join(tmpdir(), `${PREFIX}${tag}-`));
}

/** Remove only a disposable directory this harness created under the system temp directory. */
export async function removeTemp(dir) {
  const rel = relative(tmpdir(), dir);
  assert(rel.startsWith(PREFIX) && !rel.includes('..') && !isAbsolute(rel), `refuse to remove ${dir}`);
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export function logger(file) {
  const path = join(HERE, file);
  let chain = writeFile(path, '');
  const log = (...parts) => {
    const line =
      `[${new Date().toISOString()}] ` +
      parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    console.log(line);
    chain = chain.then(() => appendFile(path, line + '\n'));
    return chain;
  };
  log.flush = () => chain;
  return log;
}

export async function until(check, { timeout = 30_000, interval = 50, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const last = await check();
    if (last) return last;
    await delay(interval);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Start the built API with a disposable data directory. Only this PID is ever terminated. */
export async function startApi({ port, dataDir, log = () => {}, env = {} }) {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GG_DATA_DIR: dataDir,
      GG_PORT: String(port),
      GG_HOST: '127.0.0.1',
      GG_REQUIRE_API_KEY: 'false',
      GG_WEB_DIST: join(ROOT, 'apps/web/dist'),
      GG_SWAGGER_UI: 'false',
      GG_LOG_LEVEL: 'warn',
      // No provider is reachable from these measurements.
      GG_CLAUDE_BINARY: join(dataDir, 'no-claude', 'claude.exe'),
      GG_CODEX_BINARY: join(dataDir, 'no-codex', 'codex.exe'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  const url = `http://127.0.0.1:${port}`;
  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`API exited during startup: ${stderr}`);
      try {
        const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
        return r.ok;
      } catch {
        return false;
      }
    },
    { timeout: 60_000, what: `API health on ${port}` },
  );
  log(`API started pid=${child.pid} port=${port}`);
  return {
    url,
    pid: child.pid,
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      log(`API pid=${child.pid} terminated`);
    },
  };
}

/** JSON REST helper. Throws on non-2xx. */
export function restClient(url) {
  const api = async (method, path, body) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 2000)}`);
    return text ? JSON.parse(text) : undefined;
  };
  api.createLoop = async (definition) => {
    const created = await api('POST', '/loops', { definition });
    await api('POST', `/loops/${created.loop.id}/publish`);
    return created;
  };
  api.start = async (loopId) => (await api('POST', `/loops/${loopId}/runs`, {})).run;
  return api;
}

/** Playwright from apps/web, driving the installed Microsoft Edge. */
export async function edge() {
  const require = createRequire(join(ROOT, 'apps/web/package.json'));
  const { chromium } = require('@playwright/test');
  return chromium.launch({ channel: process.env.GG_E2E_BROWSER_CHANNEL ?? 'msedge', headless: true });
}

/** Private bytes and working set of a process (Windows), in MiB. */
export async function processMemory(pid) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${pid}; "$($p.PrivateMemorySize64) $($p.WorkingSet64)"`],
    { windowsHide: true },
  );
  const [privateBytes, workingSet] = stdout.trim().split(/\s+/).map(Number);
  return { privateMiB: +(privateBytes / 1048576).toFixed(1), workingSetMiB: +(workingSet / 1048576).toFixed(1) };
}

export const edge_ = (from, port, to) => ({ id: `${from}-${port}-${to}`, from: { node: from, port }, to: { node: to } });

/** The acceptance probes' cyclic loop: `grow` increments vars.n; a gate repeats without a cap. */
export function cycle({ name, passes }) {
  return {
    schemaVersion: 4,
    name,
    settings: { maxNodeVisits: null },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'grow',
        kind: 'mutate',
        label: 'Grow',
        config: {
          operations: [
            { op: 'set', path: '/vars/n', value: { kind: 'expression', jsonata: '($exists(vars.n) ? vars.n : 0) + 1' } },
          ],
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: `vars.n < ${passes} ? "again" : "done"`,
          maxPasses: null,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.n' } },
    ],
    edges: [
      edge_('start', 'out', 'grow'),
      edge_('grow', 'out', 'gate'),
      edge_('gate', 'again', 'grow'),
      edge_('gate', 'done', 'finish'),
      edge_('gate', 'limit-reached', 'finish'),
    ],
  };
}
