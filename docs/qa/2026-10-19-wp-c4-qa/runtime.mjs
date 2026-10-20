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
  await writeFile(join(out, name), clean(value) + '\n');
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
  const mint = start(['apps/api/dist/main.js', '--create-api-key', 'qa']);
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
  api = await boot();
  const c = createGraphGoblinClient({ baseUrl, apiKey: key }),
    m = await connect({ apiUrl: baseUrl, apiKey: key, pollMs: 50 });
  check('API authentication', (await fetch(baseUrl + '/runs')).status === 401);
  const seed = [
    { op: 'add', path: '/vars/a', value: 1 },
    { op: 'add', path: '/vars/deleteMe', value: 2 },
  ];
  const cases = [
    ['add', [{ op: 'add', path: '/vars/new', value: 3 }], true],
    ['replace', [{ op: 'replace', path: '/vars/a', value: 7 }], true],
    ['remove', [{ op: 'remove', path: '/vars/deleteMe' }], true],
    ['writable-move', [{ op: 'move', from: '/vars/a', path: '/vars/moved' }], true],
    ['protected-remove', [{ op: 'remove', path: '/run/id' }], false, 'path', '/run/id'],
    [
      'protected-move-source',
      [{ op: 'move', from: '/run/id', path: '/vars/stolen' }],
      false,
      'from',
      '/run/id',
    ],
    [
      'protected-move-target',
      [{ op: 'move', from: '/vars/a', path: '/run/id' }],
      false,
      'path',
      '/run/id',
    ],
    ['protected-copy', [{ op: 'copy', from: '/run/id', path: '/vars/copied' }], true],
    [
      'missing-path',
      [{ op: 'replace', path: '/vars/missing', value: 3 }],
      false,
      '',
      '/vars/missing',
    ],
    [
      'third-protected',
      [
        { op: 'add', path: '/vars/first', value: 1 },
        { op: 'replace', path: '/vars/a', value: 2 },
        { op: 'remove', path: '/invocation/id' },
      ],
      false,
      'path',
      '/invocation/id',
    ],
    [
      'third-missing',
      [
        { op: 'add', path: '/vars/first', value: 1 },
        { op: 'replace', path: '/vars/a', value: 2 },
        { op: 'remove', path: '/vars/missing' },
      ],
      false,
      '',
      '/vars/missing',
    ],
    ['protected-test', [{ op: 'test', path: '/schemaVersion', value: 1 }], true],
  ];
  const childId = await pub(c, def('QA child', [script('delay', [], 700)]));
  for (const mode of ['script', 'subloop'])
    for (const [name, patch, accepted, field, bad] of cases)
      await test(mode + '/' + name, async () => {
        const target =
          mode === 'script'
            ? script('target', patch, 800)
            : n('target', 'subloop', {
                loopRef: { loopId: childId, version: 'latest' },
                output: {
                  mode: 'custom',
                  custom: { patch: JSON.stringify(patch) },
                  usage: 'separate',
                },
              });
        const lid = await pub(
            c,
            def('QA ' + mode + ' ' + name, [
              script('seed', seed),
              target,
              n('hold', 'wait', { mode: 'input', prompt: 'Inspect patch' }),
            ]),
          ),
          r = await runs.start(c, lid);
        await until(async () => {
          const x = await runs.get(c, r.id);
          return (
            x.currentNodeId === 'target' &&
            (mode === 'script' ? x.status === 'running' : x.waiting?.kind === 'child')
          );
        });
        const before = await raw(r.id),
          mBefore = await tool(m, 'get_run_thread', { runId: r.id });
        const final = await until(async () => {
          const x = await runs.get(c, r.id);
          return x.status === 'failed' || x.waiting?.kind === 'input' ? x : false;
        });
        const after = await raw(r.id),
          mAfter = await tool(m, 'get_run_thread', { runId: r.id }),
          v = JSON.parse(after).vars;
        let pass;
        if (accepted) {
          const applied =
            name === 'add'
              ? v.new === 3
              : name === 'replace'
                ? v.a === 7
                : name === 'remove'
                  ? !('deleteMe' in v)
                  : name === 'writable-move'
                    ? v.moved === 1 && !('a' in v)
                    : name === 'protected-copy'
                      ? v.copied === r.id
                      : v.a === 1;
          pass = final.waiting?.kind === 'input' && applied && !mAfter.isError;
        } else {
          const expected = field
            ? mode === 'script'
              ? 'SCRIPT_EXIT_CODE'
              : 'EXPRESSION_ERROR'
            : 'INTERNAL_ERROR';
          pass =
            final.status === 'failed' &&
            before === after &&
            final.failure?.code === expected &&
            final.failure?.resumable === Boolean(field) &&
            final.failure.message.includes(bad) &&
            (!field || final.failure.message.includes(field)) &&
            JSON.stringify(mBefore) === JSON.stringify(mAfter);
        }
        check(mode + '/' + name, pass, {
          failure: final.failure,
          byteIdentical: before === after,
          status: final.status,
        });
        await save('patch-' + mode + '-' + name + '.json', {
          patch,
          beforeSha256: hash(before),
          afterSha256: hash(after),
          before: JSON.parse(before),
          after: JSON.parse(after),
          mBefore,
          mAfter,
          final,
        });
        if (final.status === 'waiting') await runs.cancel(c, r.id);
      });
  await test('client zero and preabort', async () => {
    let count = 0;
    const cc = createGraphGoblinClient({
        baseUrl,
        apiKey: key,
        fetch: (r) => {
          count++;
          return fetch(r);
        },
      }),
      zero = await waitForRun(cc, 'unused', { timeoutMs: 0 }),
      a = new AbortController(),
      why = Error('before start');
    a.abort(why);
    let exact = false;
    try {
      await waitForRun(cc, 'unused', { timeoutMs: 1000, signal: a.signal });
    } catch (e) {
      exact = e === why;
    }
    check('client zero and preabort', count === 0 && !('run' in zero) && !zero.finished && exact, {
      count,
      zero,
      exact,
    });
  });
  await test('client sleep deadline concurrency', async () => {
    const r = await busy(c, 2500),
      a = new AbortController(),
      why = Error('cancel sleep');
    let ready;
    const got = new Promise((r) => (ready = r)),
      cc = createGraphGoblinClient({
        baseUrl,
        apiKey: key,
        fetch: async (q) => {
          const x = await fetch(q);
          ready();
          return x;
        },
      }),
      t = Date.now(),
      p = waitForRun(cc, r.id, { timeoutMs: 6000, pollMs: 4000, signal: a.signal }).catch((e) => ({
        exact: e === why,
        ms: Date.now() - t,
      })),
      others = [1, 2, 3].map(() => waitForRun(c, r.id, { timeoutMs: 7000, pollMs: 40 }));
    await got;
    await sleep(80);
    a.abort(why);
    const cancelled = await p,
      short = await waitForRun(c, r.id, { timeoutMs: 150, pollMs: 30 }),
      still = await runs.get(c, r.id),
      finals = await Promise.all(others);
    check(
      'client sleep deadline concurrency',
      cancelled.exact &&
        cancelled.ms < 1200 &&
        !short.finished &&
        short.run?.status === 'running' &&
        still.status === 'running' &&
        finals.every((x) => x.finished && x.run.status === 'succeeded'),
      {
        cancelled,
        short,
        still: still.status,
        finals: finals.map((x) => ({ finished: x.finished, status: x.run?.status })),
      },
    );
  });
  let mode = 'delay',
    requests = [];
  const slow = createServer((q, s) => {
    const item = { method: q.method, url: q.url, closedEarly: false };
    requests.push(item);
    s.on('close', () => (item.closedEarly = !s.writableFinished));
    if (mode === 'stall') return;
    setTimeout(() => {
      if (!s.destroyed) {
        s.setHeader('content-type', 'application/json');
        s.end(
          JSON.stringify({
            id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            status: 'succeeded',
            lastEventSeq: 5,
          }),
        );
      }
    }, 650);
  });
  await new Promise((r) => slow.listen(5721, '127.0.0.1', r));
  servers.push(slow);
  const sc = createGraphGoblinClient({ baseUrl: 'http://127.0.0.1:5721' });
  await test('client pending abort deadline late', async () => {
    const a = new AbortController(),
      why = Error('cancel HTTP'),
      t = Date.now(),
      p = waitForRun(sc, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { timeoutMs: 4000, signal: a.signal }).catch(
        (e) => e === why,
      );
    await until(() => requests.length);
    a.abort(why);
    const exact = await p,
      abortMs = Date.now() - t,
      td = Date.now(),
      deadline = await waitForRun(sc, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { timeoutMs: 120 }),
      deadlineMs = Date.now() - td;
    let count = 0;
    const ignores = createGraphGoblinClient({
        baseUrl: 'http://127.0.0.1:5721',
        fetch: (r) => {
          count++;
          return fetch(r.url);
        },
      }),
      late = await waitForRun(ignores, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { timeoutMs: 100 }),
      settled = JSON.stringify(late);
    await sleep(750);
    check(
      'client pending abort deadline late',
      exact &&
        abortMs < 800 &&
        deadlineMs < 800 &&
        !deadline.finished &&
        !('run' in deadline) &&
        !late.finished &&
        JSON.stringify(late) === settled &&
        count === 1 &&
        requests.filter((x) => x.closedEarly).length >= 2,
      { exact, abortMs, deadlineMs, deadline, late, count, requests },
    );
  });
  await test('MCP boundaries', async () => {
    const r = await busy(c, 1600),
      invalid = [];
    for (const v of [0, -1, 1.5, 601, '1'])
      invalid.push({
        value: v,
        result: await tool(m, 'wait_for_run', { runId: r.id, timeoutSeconds: v }),
      });
    await waitForRun(c, r.id, { timeoutMs: 5000, pollMs: 40 });
    const max = await tool(m, 'wait_for_run', { runId: r.id, timeoutSeconds: 600 });
    check('MCP boundaries', invalid.every((x) => x.result.isError) && max.finished, {
      invalid,
      accepted600: max,
    });
  });
  await test('MCP busy deadline and input', async () => {
    const r = await busy(c, 2300),
      t = Date.now(),
      answer = await tool(m, 'wait_for_run', { runId: r.id, timeoutSeconds: 1 }),
      ms = Date.now() - t,
      final = await waitForRun(c, r.id, { timeoutMs: 5000, pollMs: 50 }),
      lid = await pub(
        c,
        def('QA input', [n('input', 'wait', { mode: 'input', prompt: 'QA answer' })]),
      ),
      wr = await runs.start(c, lid),
      ti = Date.now(),
      input = await tool(m, 'wait_for_run', { runId: wr.id, timeoutSeconds: 600 });
    check(
      'MCP busy deadline and input',
      !answer.finished &&
        answer.status === 'running' &&
        typeof answer.cursor === 'number' &&
        answer.next &&
        ms >= 900 &&
        ms < 2500 &&
        final.finished &&
        input.waiting?.waitId &&
        input.waiting.kind === 'input' &&
        Date.now() - ti < 1200,
      { answer, ms, input, final: final.run?.status },
    );
    await runs.provideInput(c, wr.id, input.waiting.waitId, { answer: true });
  });
  await test('MCP no snapshot default60', async () => {
    mode = 'stall';
    const sm = await connect({ apiUrl: 'http://127.0.0.1:5721', pollMs: 20 }),
      t = Date.now(),
      one = await tool(sm, 'wait_for_run', {
        runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        timeoutSeconds: 1,
      });
    check(
      'MCP no snapshot',
      !one.finished && !('status' in one) && !('waiting' in one) && !('cursor' in one) && one.next,
      { ms: Date.now() - t, result: one },
    );
    console.log('OBSERVING default 60 second MCP deadline');
    const td = Date.now(),
      omitted = await tool(
        sm,
        'wait_for_run',
        { runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        { timeout: 65000 },
      ),
      ms = Date.now() - td;
    check(
      'MCP default60',
      ms >= 59000 && ms < 64000 && !omitted.finished && !('cursor' in omitted),
      { ms, result: omitted },
    );
    mode = 'delay';
  });
  await test('MCP request cancel run survives', async () => {
    const r = await busy(c, 1700),
      a = new AbortController(),
      t = Date.now(),
      p = tool(
        m,
        'wait_for_run',
        { runId: r.id, timeoutSeconds: 600 },
        { signal: a.signal, timeout: 5000 },
      ).catch((e) => ({ error: String(e) }));
    await sleep(90);
    a.abort(Error('QA MCP cancellation'));
    const cancelled = await p,
      ms = Date.now() - t,
      still = await runs.get(c, r.id),
      final = await waitForRun(c, r.id, { timeoutMs: 5000, pollMs: 40 });
    check(
      'MCP request cancel run survives',
      cancelled.error &&
        ms < 1200 &&
        still.status === 'running' &&
        final.finished &&
        final.run.status === 'succeeded',
      { cancelled, ms, still: still.status, final: final.run?.status },
    );
  });
  await test('client restart', async () => {
    const lid = await pub(
        c,
        def('QA restart', [n('input', 'wait', { mode: 'input', prompt: 'Continue' })]),
      ),
      r = await runs.start(c, lid),
      old = await until(async () => {
        const x = await runs.get(c, r.id);
        return x.waiting?.kind === 'input' ? x : false;
      });
    let first = true,
      reached,
      allow;
    const second = new Promise((r) => (reached = r)),
      allowed = new Promise((r) => (allow = r)),
      cc = createGraphGoblinClient({
        baseUrl,
        apiKey: key,
        fetch: async (q) => {
          if (!first) {
            reached();
            await allowed;
          }
          first = false;
          return fetch(q);
        },
      });
    let settlements = 0;
    const p = waitForRun(cc, r.id, { timeoutMs: 10000, pollMs: 20 }).then((x) => {
      settlements++;
      return x;
    });
    await second;
    await stop(api);
    api = await boot();
    const recovered = await runs.get(c, r.id);
    await runs.provideInput(c, r.id, recovered.waiting.waitId, { afterRestart: true });
    allow();
    const answer = await p,
      events = await runs.events(c, r.id),
      term = events.items.filter((x) => x.type === 'run.finished').length;
    check(
      'client restart',
      (!answer.finished || answer.run.status === 'succeeded') &&
        old.waiting.waitId === recovered.waiting.waitId &&
        settlements === 1 &&
        term === 1,
      {
        answer,
        settlements,
        term,
        waitIdentityPreserved: old.waiting.waitId === recovered.waiting.waitId,
      },
    );
  });
} catch (e) {
  check('driver fatal', false, { error: String(e), stack: e.stack });
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
    reason: 'User prohibits directory deletion; no directory removal attempted.',
  });
  await save('runtime-results.json', results);
  console.log(`RESULT ${results.filter((x) => x.pass).length}/${results.length}`);
}
