// Acceptance group A helpers: start the built API (apps/api/dist/main.js) as a real process with
// the session-recording fake CLIs, call its public HTTP API, and read the CLI request log.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const { fetch } = globalThis;
export const RECORD = dirname(fileURLToPath(import.meta.url));
export const WORKTREE = resolve(RECORD, '../../..');
/** Disposable root created by the operator (temp prefix gg-acc-a-), holding cli/ with the fixture. */
export const ROOT = process.env.GG_ACC_ROOT;
if (!ROOT || !/gg-acc-a-/.test(ROOT)) throw new Error('Set GG_ACC_ROOT to the disposable gg-acc-a- root');
export const CLI = join(ROOT, 'cli');

export function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
}

/** Start the built API as its own process. Returns helpers bound to its base URL. */
export async function startApi({ name, port, dataDir, env = {} }) {
  if (port < 6440 || port > 6449) throw new Error('Port outside the 6440-6449 allocation');
  await mkdir(dataDir, { recursive: true });
  const base = `http://127.0.0.1:${port}`;
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GG_')),
  );
  const childEnv = {
    ...inherited,
    GG_DATA_DIR: dataDir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_REQUIRE_API_KEY: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_CODEX_BINARY: join(CLI, 'codex.exe'),
    GG_CLAUDE_BINARY: join(CLI, 'claude.exe'),
    GG_LOG_LEVEL: 'info',
    GG_TIMER_POLL_MS: '200',
    ...env,
  };
  const logPath = join(ROOT, 'logs', `${name}.api.log.txt`);
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn(process.execPath, [join(WORKTREE, 'apps/api/dist/main.js')], {
    cwd: WORKTREE,
    env: childEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`API ${name} exited during startup; see ${logPath}`);
    try {
      const response = await fetch(base + '/healthz');
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`API ${name} did not become healthy`);
    await delay(100);
  }
  return {
    base,
    child,
    pid: child.pid,
    /** Hard kill (TerminateProcess on Windows): no drain, no graceful shutdown. */
    async kill() {
      if (child.exitCode === null) child.kill('SIGKILL');
      await exited;
    },
    /** Normal stop: SIGTERM drains (docs/05); the force path is a second signal. */
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const settled = await Promise.race([exited.then(() => true), delay(20_000).then(() => false)]);
      if (!settled) {
        child.kill('SIGKILL');
        await exited;
      }
    },
  };
}

export async function call(base, method, path, body, expected) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (expected !== undefined && response.status !== expected)
    throw new Error(`${method} ${path} -> ${response.status}, expected ${expected}: ${text}`);
  return { status: response.status, body: json };
}
export const get = async (base, path, expected = 200) => (await call(base, 'GET', path, undefined, expected)).body;
export const post = async (base, path, body = {}, expected = 200) =>
  (await call(base, 'POST', path, body, expected)).body;
export const put = async (base, path, body, expected = 200) => (await call(base, 'PUT', path, body, expected)).body;

export async function createPublished(base, definition) {
  const created = await post(base, '/loops', { definition }, 201);
  await post(base, `/loops/${created.loop.id}/publish`, {});
  return created.loop.id;
}

export async function startRun(base, loopId, body = {}) {
  return (await post(base, `/loops/${loopId}/runs`, body, 202)).run;
}

export async function waitRun(base, runId, statuses, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await get(base, `/runs/${runId}`);
    if (statuses.includes(run.status)) return run;
    if (Date.now() > deadline)
      throw new Error(`run ${runId} stayed ${run.status}, wanted ${statuses.join('/')}`);
    await delay(150);
  }
}

export async function events(base, runId) {
  const all = [];
  let after = 0;
  for (;;) {
    const page = await get(base, `/runs/${runId}/events?after=${after}&limit=1000`);
    all.push(...page.items);
    if (!page.hasMore || page.items.length === 0) break;
    after = page.items.at(-1).seq;
  }
  return all;
}

export async function requests() {
  const path = join(CLI, 'requests.jsonl');
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function resetCli() {
  await rm(join(CLI, 'requests.jsonl'), { force: true });
  await rm(join(CLI, 'sessions'), { recursive: true, force: true });
  for (const name of ['delay-ms.txt', 'resume-mode.txt', 'hold.txt', 'linger-ms.txt'])
    await rm(join(CLI, name), { force: true });
}

export async function control(name, value) {
  if (value === undefined) await rm(join(CLI, name), { force: true });
  else await writeFile(join(CLI, name), String(value));
}

/** Requests whose prompt contains a marker, in invocation order. */
export function byMarker(all, marker) {
  return all.filter((request) => request.prompt.includes(marker));
}

export function summarize(request) {
  return {
    harness: request.harness,
    mode: request.mode,
    outcome: request.outcome,
    resumeId: request.resumeId,
    sessionId: request.sessionId,
    conversationTurn: request.conversationTurn,
    model: request.model,
    effort: request.effort,
    prompt: request.prompt.trim(),
  };
}

export async function saveJson(name, value) {
  await writeFile(join(RECORD, name), JSON.stringify(value, null, 2) + '\n');
}

export const MODELS = { codex: 'gpt-6-luna', claude: 'claude-opus-5-5' };

export function inference(id, harness, session, template, extra = {}) {
  return {
    id,
    kind: 'inference',
    label: id,
    config: {
      harness,
      model: MODELS[harness],
      effort: 'low',
      session,
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template },
      ...extra,
    },
  };
}

export function gate(id, maxPasses) {
  return {
    id,
    kind: 'decision',
    label: id,
    config: {
      kind: 'expression',
      jsonata: '"repeat"',
      maxPasses,
      routes: [
        { id: 'repeat', label: 'Repeat', repeat: true },
        { id: 'finish', label: 'Finish' },
      ],
    },
  };
}

export function edge(id, from, to, port = 'out') {
  return { id, from: { node: from, port }, to: { node: to } };
}

export function loop(name, nodes, edges, settings = {}) {
  return {
    schemaVersion: 4,
    name,
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      ...nodes,
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges,
  };
}
