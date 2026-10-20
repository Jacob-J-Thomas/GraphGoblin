import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  createGraphGoblinClient,
  loops,
  runs,
  waitForRun,
} from '../../../packages/api-client/dist/index.js';
import { createMcpServer } from '../../../apps/mcp/dist/server.js';
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  out = fileURLToPath(new URL('./', import.meta.url));
const req = createRequire(join(root, 'apps/mcp/package.json'));
const { Client } = await import(
  pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js'))
);
const { InMemoryTransport } = await import(
  pathToFileURL(req.resolve('@modelcontextprotocol/sdk/inMemory.js'))
);
const store = await mkdtemp(join(tmpdir(), 'gg-wp-c4-qa-'));
const env = {
  ...process.env,
  GG_DATA_DIR: store,
  GG_PORT: '5722',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'true',
  GG_LOG_LEVEL: 'warn',
};
const baseUrl = 'http://127.0.0.1:5722',
  results = [],
  children = new Set(),
  sessions = [],
  servers = [],
  logs = [];
let key = '',
  api;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function clean(v) {
  let s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  for (const [a, b] of [
    [key, '<redacted>'],
    [store, '<disposable-store>'],
    [root.replace(/[\\/]$/, ''), '<worktree>'],
    [process.env.USERPROFILE, '<user>'],
  ])
    if (a) {
      s = s
        .split(a)
        .join(b)
        .split(a.replaceAll('\\', '\\\\'))
        .join(b)
        .split(a.replaceAll('\\', '/'))
        .join(b);
    }
  return s;
}
async function save(name, value) {
  await writeFile(join(out, 'supplemental-' + name), clean(value) + '\n');
}
function check(name, pass, detail = {}) {
  results.push({ name, pass: !!pass, ...detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function test(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, { error: String(e) });
  }
  await save('runtime-results.json', results);
}
async function until(fn, ms = 10000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  throw Error('condition timeout');
}
function start(args) {
  const p = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(p);
  p.once('exit', () => children.delete(p));
  return p;
}
async function stop(p) {
  if (!p || p.exitCode !== null) return;
  const end = once(p, 'exit');
  p.kill('SIGKILL');
  await end;
}
async function boot() {
  const p = start(['apps/api/dist/main.js']);
  console.log('API child launched ' + p.pid);
  p.stdout.on('data', (b) => logs.push(String(b)));
  p.stderr.on('data', (b) => logs.push(String(b)));
  await until(async () => {
    try {
      return (await fetch(baseUrl + '/healthz')).ok;
    } catch {
      return false;
    }
  }, 120000);
  return p;
}
async function connect(options) {
  const server = createMcpServer(options),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'independent-qa', version: '1' });
  await client.connect(a);
  sessions.push({ server, client });
  return client;
}
async function tool(client, name, args, options) {
  const r = await client.callTool({ name, arguments: args }, undefined, options);
  return r.isError
    ? { isError: true, content: r.content }
    : JSON.parse(r.content.find((c) => c.type === 'text').text);
}
const n = (id, kind, config) => ({ id, kind, label: id, config });
function def(name, middle) {
  const nodes = [n('start', 'trigger', { type: 'manual' }), ...middle, n('end', 'exit', {})];
  return {
    schemaVersion: 4,
    name,
    settings: { workingDirectory: { kind: 'fixed', path: store } },
    nodes,
    edges: nodes.slice(1).map((node, i) => ({
      id: 'e' + i,
      from: { node: nodes[i].id, port: 'out' },
      to: { node: node.id },
    })),
  };
}
function script(id, patch, ms = 0) {
  return n(id, 'script', {
    command: process.execPath,
    args: [
      '-e',
      `setTimeout(()=>process.stdout.write(${JSON.stringify(JSON.stringify(patch))}),${ms})`,
    ],
    stdin: 'none',
    stdout: 'patch',
  });
}
async function pub(c, d) {
  const r = await loops.create(c, d),
    id = (r.loop ?? r).id;
  await loops.publish(c, id);
  return id;
}
async function busy(c, ms = 2000) {
  const id = await pub(c, def('QA delayed script', [script('work', [], ms)])),
    r = await runs.start(c, id);
  await until(async () => (await runs.get(c, r.id)).status === 'running');
  return r;
}
async function raw(id) {
  const r = await fetch(baseUrl + '/runs/' + id + '/thread', {
    headers: { authorization: 'Bearer ' + key },
  });
  if (!r.ok) throw Error('thread ' + r.status);
  return r.text();
}
const hash = (s) => createHash('sha256').update(s).digest('hex');
async function emptyFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await emptyFiles(p);
    else await unlink(p);
  }
}
try {
  const mint = start(['apps/api/dist/main.js', '--create-api-key', 'qa-supplemental']);
  let text = '',
    err = '';
  mint.stdout.on('data', (b) => (text += b));
  mint.stderr.on('data', (b) => (err += b));
  const [code] = await once(mint, 'exit');
  if (code) throw Error('mint failed ' + err);
  key = text
    .split(/\r?\n/)
    .find((l) => /^  \S+$/.test(l))
    ?.trim();
  text = '';
  if (!key) throw Error('no key');
  // Wait for the primary driver's 5720 listener to disappear before taking the assigned port.

  api = await boot();
  const c = createGraphGoblinClient({ baseUrl, apiKey: key });
  await test('natural waiter over real hard restart', async () => {
    const lid = await pub(
        c,
        def('QA natural restart', [n('input', 'wait', { mode: 'input', prompt: 'Continue' })]),
      ),
      r = await runs.start(c, lid);
    await until(async () => (await runs.get(c, r.id)).waiting?.kind === 'input');
    let observed;
    const ready = new Promise((r) => (observed = r));
    let requests = 0;
    const cc = createGraphGoblinClient({
      baseUrl,
      apiKey: key,
      fetch: async (q) => {
        const response = await fetch(q);
        requests++;
        observed();
        return response;
      },
    });
    let settlements = 0;
    const p = waitForRun(cc, r.id, { timeoutMs: 10000, pollMs: 25 }).then(
      (result) => {
        settlements++;
        return { result };
      },
      (e) => {
        settlements++;
        return {
          error: { name: e.name, message: e.message, status: e.status, code: e.problem?.code },
        };
      },
    );
    await ready;
    await sleep(60);
    await stop(api);
    await sleep(150);
    const observation = await p;
    api = await boot();
    const recovered = await runs.get(c, r.id);
    await runs.provideInput(c, r.id, recovered.waiting.waitId, { afterRestart: true });
    const final = await waitForRun(c, r.id, { timeoutMs: 5000, pollMs: 40 });
    const expectedShape =
      observation.result &&
      (observation.result.finished ? observation.result.run.status === 'succeeded' : true);
    check(
      'natural waiter over real hard restart',
      expectedShape && settlements === 1 && final.run?.status === 'succeeded',
      {
        observation,
        settlements,
        requests,
        recoveredStatus: recovered.status,
        finalStatus: final.run?.status,
        expected: 'a terminal success or finished:false as requested; no stale or duplicate result',
      },
    );
  });
  await test('MCP abort in pending HTTP request', async () => {
    let seen,
      closed = false,
      count = 0;
    const arrived = new Promise((r) => (seen = r));
    const slow = createServer((q, s) => {
      count++;
      seen();
      s.on('close', () => (closed = !s.writableFinished));
    });
    await new Promise((r) => slow.listen(5723, '127.0.0.1', r));
    servers.push(slow);
    let signal;
    const m = await connect({
      apiUrl: 'http://127.0.0.1:5723',
      fetch: (q) => {
        signal = q.signal;
        return fetch(q);
      },
      pollMs: 50,
    });
    const r = await busy(c, 3000),
      a = new AbortController(),
      t = Date.now(),
      p = tool(
        m,
        'wait_for_run',
        { runId: r.id, timeoutSeconds: 600 },
        { signal: a.signal, timeout: 5000 },
      ).catch((e) => ({ error: String(e) }));
    await arrived;
    a.abort(Error('QA cancel pending MCP'));
    const answer = await p;
    await until(() => signal.aborted && closed, 1000);
    const ms = Date.now() - t,
      still = await runs.get(c, r.id),
      final = await waitForRun(c, r.id, { timeoutMs: 6000, pollMs: 40 });
    check(
      'MCP abort in pending HTTP request',
      answer.error &&
        signal.aborted &&
        closed &&
        count === 1 &&
        ms < 1500 &&
        still.status === 'running' &&
        final.run?.status === 'succeeded',
      {
        answer,
        signalAborted: signal.aborted,
        socketClosed: closed,
        requests: count,
        ms,
        stillStatus: still.status,
        finalStatus: final.run?.status,
      },
    );
  });
} catch (e) {
  check('supplemental fatal', false, { error: String(e), stack: e.stack });
} finally {
  for (const s of sessions) {
    await s.client.close().catch(() => {});
    await s.server.close().catch(() => {});
  }
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  for (const p of [...children]) await stop(p).catch((e) => logs.push(String(e)));
  await save('api.log', logs.join(''));
  await emptyFiles(store);
  await save('cleanup.json', {
    processesRemaining: children.size,
    storeFilesRemoved: true,
    emptyDirectoryRetained: '<TEMP>/gg-wp-c4-qa-<random>',
    reason: 'No directory deletion permitted.',
  });
  await save('runtime-results.json', results);
  console.log(`SUPPLEMENTAL ${results.filter((x) => x.pass).length}/${results.length}`);
}
