// WP-205 QA helpers, patterned on docs/qa/2026-10-27-pr426-qa-final/scripts/lib.mjs. Drives the
// built API of this worktree (apps/api/dist/main.js) on disposable stores under %TEMP%\gg-205-*,
// on ports 6300-6309 only. Every process it ends is one it started (by PID).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(OUT, '..', '..', '..');
export const NODE = process.execPath;
const requireInfra = createRequire(path.join(ROOT, 'packages', 'infrastructure', 'package.json'));
export const libsql = requireInfra('@libsql/client');

const home = os.homedir();
const host = os.hostname();
const user = path.basename(home);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function redact(text) {
  let t = String(text);
  const variants = [
    home,
    home.replaceAll('\\', '/'),
    home.replaceAll('\\', '\\\\'),
    home.replaceAll('\\', '\\\\\\\\'),
    '/c' + home.slice(2).replaceAll('\\', '/'),
  ];
  for (const v of variants) t = t.replace(new RegExp(escapeRe(v), 'gi'), '%USERPROFILE%');
  t = t.replace(new RegExp(escapeRe(host), 'gi'), '%COMPUTERNAME%');
  t = t.replace(/S-1-(?:\d+-)+\d+/g, '<SID>');
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED-TOKEN>');
  t = t.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '<REDACTED-KEY>');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<REDACTED-EMAIL>');
  t = t.replace(
    /\b(account[_-]?id|org[_-]?id|user[_-]?id|chatgpt[_-]?account[_-]?id)(\\?"?\s*[:=]\s*\\?"?)[A-Za-z0-9_-]{6,}/gi,
    '$1$2<REDACTED-ID>',
  );
  t = t.replace(new RegExp(escapeRe(user), 'gi'), '%USERNAME%');
  return t;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Recorder {
  constructor(name) {
    this.name = name;
    this.file = path.join(OUT, `${name}.log.txt`);
    fs.writeFileSync(this.file, '');
    this.checks = [];
    this.t0 = Date.now();
    this.turns = [];
  }
  log(message, data) {
    const line = `${new Date().toISOString()} +${((Date.now() - this.t0) / 1000).toFixed(1)}s ${message}${
      data === undefined ? '' : ' ' + JSON.stringify(data)
    }\n`;
    fs.appendFileSync(this.file, redact(line));
    process.stdout.write(redact(line));
  }
  check(id, ok, detail) {
    this.checks.push({ id, ok: Boolean(ok), detail });
    this.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id}`, detail);
    return ok;
  }
  observe(id, detail) {
    this.checks.push({ id, ok: null, detail });
    this.log(`OBSERVE ${id}`, detail);
  }
  /** One real provider invocation. */
  turn(entry) {
    this.turns.push(entry);
    this.log('REAL TURN', entry);
  }
  finish(extra = {}) {
    const summary = {
      scenario: this.name,
      passed: this.checks.filter((c) => c.ok === true).length,
      failed: this.checks.filter((c) => c.ok === false).length,
      observations: this.checks.filter((c) => c.ok === null).length,
      realTurns: this.turns,
      checks: this.checks,
      ...extra,
    };
    fs.writeFileSync(
      path.join(OUT, `${this.name}-result.json`),
      redact(JSON.stringify(summary, null, 2)) + '\n',
    );
    this.log(
      `DONE passed=${summary.passed} failed=${summary.failed} observations=${summary.observations} realTurns=${this.turns.length}`,
    );
    return summary;
  }
}

export function makeStore(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gg-205-${name}-`));
}

function assertPort(port) {
  if (port < 6300 || port > 6309) throw new Error(`port ${port} is outside 6300-6309`);
}

/**
 * The gateway environment: the shell's variables without JEV_API_KEY, every GG_* variable,
 * NODE_OPTIONS and coverage hooks; then this QA's own disposable settings.
 */
export function baseEnv(dir, port, extra = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.toUpperCase().startsWith('GG_') &&
        !/^(NODE_V8_COVERAGE|JEV_API_KEY|NODE_OPTIONS)$/i.test(k),
    ),
  );
  return {
    ...inherited,
    GG_DATA_DIR: dir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_WEB_DIST: path.join(ROOT, 'apps', 'web', 'dist'),
    GG_REQUIRE_API_KEY: 'false',
    ...extra,
  };
}

export const started = new Set();

/** Start this worktree's built API as a hidden, piped child. */
export async function startGateway({ dir, port, env = {}, label, rec }) {
  assertPort(port);
  const logFile = path.join(dir, `gateway-${label}.log`);
  const origin = `http://127.0.0.1:${port}`;
  let exitCode = null;
  const child = spawn(NODE, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
    cwd: ROOT,
    env: baseEnv(dir, port, env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // A fresh log per start: a reused store keeps the previous start's "listening" line.
  fs.writeFileSync(logFile, '');
  const sink = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(sink, { end: false });
  child.stderr.pipe(sink, { end: false });
  child.once('exit', (code, signal) => {
    exitCode = code ?? signal;
    fs.appendFileSync(
      path.join(OUT, 'exits.log.txt'),
      JSON.stringify({ pid: child.pid, label, exitCode }) + '\n',
    );
  });
  const pid = child.pid;
  started.add(pid);
  fs.appendFileSync(
    path.join(OUT, 'pids.log.txt'),
    redact(JSON.stringify({ pid, label, port, dir })) + '\n',
  );
  const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  const deadline = Date.now() + 90_000;
  let failedStart;
  while (!readLog().includes('GraphGoblin API listening')) {
    if (exitCode !== null) {
      failedStart = readLog();
      break;
    }
    if (Date.now() > deadline) throw new Error('gateway did not start:\n' + readLog());
    await sleep(100);
  }
  if (failedStart === undefined) rec?.log(`gateway ${label} listening`, { pid, port });
  else rec?.log(`gateway ${label} exited during startup`, { pid, exitCode });
  return {
    dir,
    port,
    origin,
    pid,
    label,
    logFile,
    readLog,
    failedStart,
    exitCode: () => exitCode,
    async waitExit(timeoutMs = 60_000) {
      const end = Date.now() + timeoutMs;
      while (exitCode === null) {
        if (Date.now() > end) return null;
        await sleep(100);
      }
      return exitCode;
    },
    call: makeCall(origin),
    copyLog(outName) {
      fs.writeFileSync(path.join(OUT, outName), redact(readLog()));
    },
    /** Drain, then force if the drain does not finish, then end the PID; returns the exit code. */
    async stop(timeoutMs = 30_000) {
      if (exitCode !== null) return exitCode;
      await this.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } }).catch(
        () => undefined,
      );
      let code = await this.waitExit(timeoutMs);
      if (code === null) {
        await this.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(
          () => undefined,
        );
        code = await this.waitExit(20_000);
      }
      if (code === null) {
        endPid(pid);
        code = await this.waitExit(10_000);
      }
      return code;
    },
  };
}

export function makeCall(origin) {
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, text };
  };
}

export async function createLoop(call, definition) {
  return call('/loops', { method: 'POST', body: { definition } });
}

export async function publishLoop(call, definition) {
  const created = await createLoop(call, definition);
  if (created.status !== 201 && created.status !== 200)
    throw new Error('create loop failed ' + JSON.stringify(created.json));
  const id = created.json.loop.id;
  const published = await call(`/loops/${id}/publish`, { method: 'POST' });
  if (published.status >= 300) throw new Error('publish failed ' + JSON.stringify(published.json));
  return id;
}

export async function events(call, runId) {
  const all = [];
  let after = 0;
  for (;;) {
    const page = (await call(`/runs/${runId}/events?after=${after}&limit=1000`)).json;
    all.push(...page.items);
    if (!page.hasMore || page.items.length === 0) break;
    after = page.items.at(-1).seq;
  }
  return all;
}

export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(intervalMs);
  }
}

export async function waitRun(
  call,
  runId,
  statuses = ['succeeded', 'failed', 'cancelled'],
  timeoutMs = 180_000,
) {
  return waitFor(
    async () => {
      const r = (await call(`/runs/${runId}`)).json;
      return statuses.includes(r.status) ? r : null;
    },
    { timeoutMs, intervalMs: 250 },
  ).then(async (r) => r ?? (await call(`/runs/${runId}`)).json);
}

/** End one process by PID. Only for PIDs this QA started. */
export function endPid(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = { id: 'done', kind: 'exit', label: 'Done', config: {} };
export const edge = (id, from, to, port = 'out') => ({
  id,
  from: { node: from, port },
  to: { node: to },
});

export function loop(name, nodes, edges, settings = {}) {
  return { schemaVersion: 4, name, settings, nodes: [trigger, ...nodes, exit], edges };
}

export function inferenceNode(
  id,
  {
    harness = 'codex',
    model,
    effort,
    template = 'Reply with exactly the word READY and nothing else.',
  } = {},
) {
  return {
    id,
    kind: 'inference',
    label: id,
    ui: { x: 260, y: 80 },
    config: {
      harness,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template },
    },
  };
}

export function llmDecisionNode(id, { harness = 'codex', model, effort } = {}) {
  return {
    id,
    kind: 'decision',
    label: id,
    ui: { x: 260, y: 80 },
    config: {
      kind: 'llm',
      harness,
      model: model ? { mode: 'explicit', value: model } : { mode: 'inherit' },
      effort: effort ? { mode: 'explicit', value: effort } : { mode: 'inherit' },
      instructions: 'Always choose the route with id "finish".',
      routes: [
        { id: 'finish', label: 'Finish' },
        { id: 'other', label: 'Other' },
      ],
    },
  };
}

/** start -> node -> done; an LLM decision routes both of its ports to done. */
export function single(name, node, settings = {}) {
  const edges = [edge('e1', 'start', node.id)];
  if (node.kind === 'decision')
    edges.push(edge('e2', node.id, 'done', 'finish'), edge('e3', node.id, 'done', 'other'));
  else edges.push(edge('e2', node.id, 'done'));
  return loop(name, [node], edges, settings);
}

export async function withDb(dir, fn) {
  const client = libsql.createClient({
    url: 'file:' + path.join(dir, 'graphgoblin.db').replaceAll('\\', '/'),
  });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** The fields of a problem response worth recording. */
export function problemOf(response) {
  const j = response.json ?? {};
  return {
    status: response.status,
    code: j.code ?? null,
    message: typeof j.message === 'string' ? j.message.slice(0, 300) : null,
    issues: Array.isArray(j.issues)
      ? j.issues.slice(0, 4).map((i) => ({ code: i.code, path: i.path, nodeId: i.nodeId }))
      : undefined,
    details: j.details === undefined ? undefined : JSON.stringify(j.details).slice(0, 600),
  };
}
