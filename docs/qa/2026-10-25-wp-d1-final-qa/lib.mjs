// Shared helpers for the WP-D1 final QA scripts. Disposable data only: every store lives under
// the system temp directory with the prefix gg-qa-d1-int-, every listener on 6390..6399.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const qaDir = dirname(fileURLToPath(import.meta.url));
export const worktree = join(qaDir, '..', '..', '..');
export const apiRoot = join(worktree, 'apps', 'api');
export const apiEntry = join(apiRoot, 'dist', 'main.js');
export const mcpEntry = join(worktree, 'apps', 'mcp', 'dist', 'main.js');
export const webDist = join(worktree, 'apps', 'web', 'dist');
export const markerScript = join(apiRoot, 'scripts', 'uncertain-script-marker.mjs');
export const CURRENT_FORMAT = 4;

const profile = homedir();
const variants = [
  profile,
  profile.replaceAll('\\', '/'),
  profile.replaceAll('\\', '\\\\'),
  encodeURIComponent(profile),
  profile.replace(/^C:/i, '/c').replaceAll('\\', '/'),
];
export function sanitize(text) {
  let out = String(text);
  for (const v of variants) out = out.split(v).join('%USERPROFILE%');
  // Lower-case drive letter variants produced by some loggers.
  for (const v of variants) out = out.split(v.toLowerCase()).join('%USERPROFILE%');
  return out;
}

export function logger(name) {
  const file = join(qaDir, `${name}.log.txt`);
  writeFileSync(file, '');
  const log = (...parts) => {
    const line = `[${new Date().toISOString()}] ${parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ')}`;
    appendFileSync(file, sanitize(line) + '\n');
    process.stdout.write(sanitize(line) + '\n');
  };
  return log;
}

export function writeJson(name, value) {
  writeFileSync(join(qaDir, name), sanitize(JSON.stringify(value, null, 2)) + '\n');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function eventually(check, timeoutMs = 60_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
    await sleep(40);
  }
}

export async function makeDataDir(tag) {
  return mkdtemp(join(tmpdir(), `gg-qa-d1-int-${tag}-`));
}

export async function removeDir(dir) {
  globalThis.gc?.();
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** One API store; start() spawns the built API on it, kill() hard-kills it. */
export function apiStore({ dataDir, port, env = {}, log }) {
  const origin = `http://127.0.0.1:${port}`;
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([n]) => !n.toUpperCase().startsWith('GG_') && n.toUpperCase() !== 'JEV_API_KEY' && n.toUpperCase() !== 'NODE_V8_COVERAGE',
    ),
  );
  const base = {
    ...inherited,
    GG_DATA_DIR: dataDir,
    GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_LOG_LEVEL: 'info',
    GG_REQUIRE_API_KEY: 'false',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
    GG_JEV_API_KEY: '',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...env,
  };
  let incarnation = 0;
  const store = {
    origin,
    dataDir,
    server: undefined,
    async start(extra = {}) {
      incarnation += 1;
      const child = spawn(process.execPath, [apiEntry], {
        cwd: apiRoot,
        env: { ...base, ...extra },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (c) => (output += c));
      child.stderr.setEncoding('utf8').on('data', (c) => (output += c));
      const exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
      const server = { child, exited, incarnation, output: () => output, exitInfo: undefined };
      exited.then((info) => (server.exitInfo = info));
      store.server = server;
      await eventually(async () => {
        if (server.exitInfo) throw new Error(`API exited at boot: ${output.slice(-4000)}`);
        try {
          return (await fetch(origin + '/loops')).ok;
        } catch {
          return false;
        }
      }, 60_000, 'API ready');
      log?.(`API incarnation ${incarnation} ready on ${port}, pid ${child.pid}`);
      return server;
    },
    async kill() {
      const server = store.server;
      if (!server || server.exitInfo) return server?.exitInfo;
      server.child.kill('SIGKILL');
      const info = await server.exited;
      log?.(`API incarnation ${server.incarnation} hard-killed: ${JSON.stringify(info)}`);
      return info;
    },
    serverLog() {
      return store.server?.output() ?? '';
    },
    async call(method, path, body, { allowError = false, headers = {} } = {}) {
      const response = await fetch(origin + path, {
        method,
        headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...headers },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      });
      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }
      if (!response.ok && !allowError) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 2000)}`);
      return allowError ? { status: response.status, body: json } : json;
    },
    async publish(definition) {
      const created = await store.call('POST', '/loops', { definition });
      await store.call('POST', `/loops/${created.loop.id}/publish`);
      return created.loop.id;
    },
    async startRun(loopId, body = {}) {
      return (await store.call('POST', `/loops/${loopId}/runs`, body)).run;
    },
    run: (id) => store.call('GET', `/runs/${id}`),
    async events(id) {
      const all = [];
      let after = 0;
      for (;;) {
        const page = await store.call('GET', `/runs/${id}/events?after=${after}&limit=1000`);
        all.push(...page.items);
        if (!page.hasMore || page.items.length === 0) break;
        after = page.nextAfter;
      }
      return all;
    },
    async runs(query = '') {
      const all = [];
      let cursor;
      for (;;) {
        const q = [query, 'limit=500', cursor ? `cursor=${encodeURIComponent(cursor)}` : '']
          .filter(Boolean)
          .join('&');
        const page = await store.call('GET', `/runs?${q}`);
        all.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return all;
    },
    children: (id) => store.runs(`parent=${id}`),
  };
  return store;
}

export const TERMINAL = ['succeeded', 'failed', 'cancelled', 'exhausted'];

// ----- loop builders -----
export const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
export function chain(name, nodes, extra = {}) {
  const all = [trigger, ...nodes];
  return {
    schemaVersion: CURRENT_FORMAT,
    name,
    nodes: all,
    edges: all.slice(1).map((node, i) => ({ id: `e${i}`, from: { node: all[i].id, port: 'out' }, to: { node: node.id } })),
    ...extra,
  };
}
export const exitNode = (returns, extra = {}) => ({ id: 'done', kind: 'exit', label: 'Done', config: { ...(returns ? { returns } : {}), ...extra } });
export const subNode = (loopId, id = 'sub') => ({ id, kind: 'subloop', label: 'Sub', config: { loopRef: { loopId } } });
export const scriptNode = (id, args, extra = {}) => ({
  id,
  kind: 'script',
  label: id,
  config: { command: process.execPath, args, ...extra },
});

/** start -> sub(child) -> gate(repeat to sub, `passes` visits) -> done | exhausted. */
export function gateParent(name, childLoopId, passes, settings) {
  return {
    schemaVersion: CURRENT_FORMAT,
    name,
    ...(settings ? { settings } : {}),
    nodes: [
      trigger,
      subNode(childLoopId),
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: `gates.gate.passes = ${passes} ? "done" : "repeat"`,
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
          maxPasses: passes,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: '{"passes": gates.gate.passes}' } },
      { id: 'exhausted', kind: 'exit', label: 'Exhausted', config: { outcome: 'exhausted', returns: 'gates.gate.passes' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'gate' } },
      { id: 'r', from: { node: 'gate', port: 'repeat' }, to: { node: 'sub' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'l', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'exhausted' } },
    ],
  };
}

/** Per-visit child accounting for a subloop node in one run's event log. */
export function visitAccounting(events, nodeId = 'sub') {
  const visits = [];
  let open;
  for (const e of events) {
    if (e.type === 'node.started' && e.nodeId === nodeId && e.attempt === 1) {
      open = { startSeq: e.seq, attempts: 1, childStarts: [], childFinishes: [], nodeFinished: 0, wokenChild: 0, failed: 0 };
      visits.push(open);
    } else if (!open) continue;
    else if (e.type === 'node.started' && e.nodeId === nodeId) open.attempts += 1;
    else if (e.type === 'child_run.started' && e.nodeId === nodeId) open.childStarts.push(e.childRunId);
    else if (e.type === 'child_run.finished' && e.nodeId === nodeId)
      open.childFinishes.push({ childRunId: e.childRunId, status: e.status, seq: e.seq });
    else if (e.type === 'run.woken' && e.nodeId === nodeId && e.reason === 'child') open.wokenChild += 1;
    else if (e.type === 'run.failed') open.failed += 1;
    else if (e.type === 'node.finished' && e.nodeId === nodeId) {
      open.nodeFinished += 1;
      open = undefined;
    }
  }
  return visits;
}

export const countType = (events, type, pred = () => true) => events.filter((e) => e.type === type && pred(e)).length;
