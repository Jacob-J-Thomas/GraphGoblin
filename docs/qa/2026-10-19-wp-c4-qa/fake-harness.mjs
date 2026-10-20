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
  GG_PORT: '5720',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'true',
  GG_LOG_LEVEL: 'warn',
};
const baseUrl = 'http://127.0.0.1:5720',
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
  await writeFile(join(out, 'fake-harness-' + name), clean(value) + '\n');
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
let control, instance, e2e;
async function ctl(path, body = {}) {
  const r = await fetch(control + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error('control ' + r.status);
  return r.json();
}
try {
  e2e = spawn(process.execPath, ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'], {
    cwd: join(root, 'apps/web'),
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(e2e);
  e2e.once('exit', () => children.delete(e2e));
  let text = '';
  e2e.stdout.on('data', (b) => (text += b));
  e2e.stderr.on('data', (b) => logs.push(String(b)));
  await until(() => {
    const match = /GG_E2E_CONTROL (\S+)/.exec(text);
    if (match) control = match[1];
    return control;
  }, 120000);
  instance = await ctl('/apps', { requireApiKey: true, env: { GG_DATA_DIR: store } });
  key = instance.token;
  const c = createGraphGoblinClient({ baseUrl: instance.url, apiKey: key }),
    m = await connect({ apiUrl: instance.url, apiKey: key, pollMs: 30 });
  const childId = await pub(c, def('QA fake child', [script('child-work', [], 500)]));
  for (const rejected of [false, true])
    await test(
      'controlled fake turn plus ' + (rejected ? 'rejected' : 'accepted') + ' authored patches',
      async () => {
        await ctl('/harness/script', {
          instanceId: instance.instanceId,
          turns: [{ finalText: 'controlled QA output', delayMs: 100 }],
        });
        const patch = rejected
          ? [
              { op: 'add', path: '/vars/first', value: 1 },
              { op: 'add', path: '/vars/second', value: 2 },
              { op: 'move', from: '/run/id', path: '/vars/stolen' },
            ]
          : [
              { op: 'test', path: '/schemaVersion', value: 1 },
              { op: 'copy', from: '/run/id', path: '/vars/copied' },
            ];
        const lid = await pub(
          c,
          def('QA controlled fake ' + rejected, [
            n('turn', 'inference', {
              harness: 'codex',
              prompt: { template: 'QA no provider turn' },
              model: 'gpt-6-luna',
              effort: 'low',
            }),
            script('script-work', [{ op: 'add', path: '/vars/nativeScript', value: true }]),
            n('target', 'subloop', {
              loopRef: { loopId: childId, version: 'latest' },
              output: {
                mode: 'custom',
                usage: 'separate',
                custom: { patch: JSON.stringify(patch) },
              },
            }),
            n('hold', 'wait', { mode: 'input', prompt: 'Inspect' }),
          ]),
        );
        const r = await runs.start(c, lid);
        await until(async () => {
          const x = await runs.get(c, r.id);
          return x.waiting?.kind === 'child';
        });
        const before = await runs.thread(c, r.id),
          mBefore = await tool(m, 'get_run_thread', { runId: r.id });
        const final = await until(async () => {
          const x = await runs.get(c, r.id);
          return x.status === 'failed' || x.waiting?.kind === 'input' ? x : false;
        });
        const after = await runs.thread(c, r.id),
          mAfter = await tool(m, 'get_run_thread', { runId: r.id });
        const pass = rejected
          ? JSON.stringify(before) === JSON.stringify(after) &&
            final.failure?.code === 'EXPRESSION_ERROR' &&
            final.failure.message.includes('from "/run/id"')
          : after.vars.copied === r.id && after.vars.nativeScript === true;
        check(
          'controlled fake turn plus ' + (rejected ? 'rejected' : 'accepted') + ' authored patches',
          pass,
          { fakeOnly: true, patch, before, after, mBefore, mAfter, final },
        );
        if (final.status === 'waiting') await runs.cancel(c, r.id);
      },
    );
  const calls = await ctl('/harness/requests', { instanceId: instance.instanceId });
  check('exactly two controlled harness turns', calls.started.length === 2, {
    fakeOnly: true,
    requests: calls.started,
  });
} catch (e) {
  check('fake harness driver fatal', false, { error: String(e), stack: e.stack });
} finally {
  for (const s of sessions) {
    await s.client.close().catch(() => {});
    await s.server.close().catch(() => {});
  }
  if (e2e && e2e.exitCode === null) {
    const ended = once(e2e, 'exit');
    e2e.stdin.end('stop\n');
    await Promise.race([ended, sleep(10000)]);
  }
  for (const p of [...children]) await stop(p).catch(() => {});
  await save('api.log', logs.join(''));
  await emptyFiles(store);
  await save('cleanup.json', {
    processesRemaining: children.size,
    storeFilesRemoved: true,
    emptyDirectoryRetained: '<TEMP>/gg-wp-c4-qa-<random>',
  });
  await save('runtime-results.json', results);
  console.log(`FAKE ${results.filter((x) => x.pass).length}/${results.length}`);
}
