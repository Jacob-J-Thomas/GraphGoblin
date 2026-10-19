import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpProbes } from '../../../packages/infrastructure/dist/http/index.js';
const out = 'docs/qa/2026-10-19-wp-d3-qa/';
const data = await mkdtemp(join(tmpdir(), 'gg-wp-d3-supplement-'));
const checks = [];
let api,
  server,
  key = '',
  log = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = {
  ...process.env,
  GG_DATA_DIR: data,
  GG_DB_URL: `file:${join(data, 'graphgoblin.db').replaceAll('\\', '/')}`,
  GG_PORT: '5660',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'true',
  GG_WEB_DIST: '',
  GG_JEV_API_KEY: '',
  JEV_API_KEY: '',
  GG_LOG_LEVEL: 'warn',
  GG_MAX_CONCURRENT_RUNS: '8',
};
delete env.GG_MASTER_KEY;
async function until(fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const x = await fn();
    if (x) return x;
    await sleep(100);
  }
  throw Error('wait expired');
}
function expect(x, m) {
  if (!x) throw Error(m);
}
async function request(path, method = 'GET', body) {
  const r = await fetch('http://127.0.0.1:5660' + path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(3000),
  });
  const text = await r.text();
  if (!r.ok) throw Error(`${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}
async function check(id, fn) {
  try {
    checks.push({ id, pass: true, detail: await fn() });
    console.log('PASS ' + id);
  } catch (e) {
    checks.push({ id, pass: false, error: e.message });
    console.log('FAIL ' + id + ': ' + e.message);
  }
}
const node = (id, kind, config) => ({ id, label: id, kind, config });
const http = (url) => ({ kind: 'http', url, method: 'GET', timeoutSeconds: 5 });
async function loop(name, trigger, work) {
  const nodes = [
    node('start', 'trigger', trigger),
    ...(work ? [work] : []),
    node('done', 'exit', { outcome: 'success', returns: 'none' }),
  ];
  const definition = {
    schemaVersion: 4,
    name,
    nodes,
    edges: nodes.slice(1).map((n, i) => ({
      id: 'e' + i,
      from: { node: nodes[i].id, port: 'out' },
      to: { node: n.id, port: 'in' },
    })),
  };
  const x = await request('/loops', 'POST', { definition });
  await request(`/loops/${x.loop.id}/publish`, 'POST', {});
  return x.loop.id;
}
async function start(id) {
  return (await request(`/loops/${id}/runs`, 'POST', {})).run.id;
}
async function finish(id) {
  return until(async () => {
    const r = await request('/runs/' + id);
    return ['succeeded', 'failed', 'cancelled'].includes(r.status) ? r : false;
  });
}
const poll = (probe) => ({
  type: 'poll',
  intervalSeconds: 5,
  fireWhen: 'true',
  dedupeKey: '"once"',
  probe,
});
const hb = (probe) =>
  node('work', 'heartbeat', { intervalSeconds: 1, maxBeats: 1, record: 'full', probe });
try {
  const mint = spawn(
    process.execPath,
    ['apps/api/dist/main.js', '--create-api-key', 'wp-d3-supplement'],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let text = '';
  mint.stdout.on('data', (b) => (text += b));
  const [code] = await once(mint, 'exit');
  expect(code === 0, 'key CLI');
  key = text
    .split('\n')
    .find((l) => /^  \S+\s*$/.test(l))
    ?.trim();
  expect(key, 'missing key');
  api = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (b) => (log += b));
  api.stderr.on('data', (b) => (log += b));
  await until(async () => {
    try {
      return await request('/loops');
    } catch {
      return false;
    }
  });
  const script = {
    kind: 'script',
    command: 'node',
    args: ['-e', `process.stdout.write(JSON.stringify({value:'a'.repeat(70000)}))`],
    timeoutSeconds: 5,
  };
  await check('single-result-script-above-http-cap', async () => {
    const id = await loop('large-script-poll', poll(script));
    const r = await until(async () => (await request('/runs?loopId=' + id)).items[0]);
    await finish(r.id);
    const t = await request('/runs/' + r.id + '/thread');
    const p = t.invocation.trigger.payload;
    expect(p.json.value === 'a'.repeat(70000), 'full JSON not retained');
    expect(p.stdout.length === 65536, 'display preview changed');
    return {
      run: r.id,
      jsonStringLength: p.json.value.length,
      stdoutPreviewLength: p.stdout.length,
    };
  });
  await check('heartbeat-script-above-http-cap', async () => {
    const id = await start(await loop('large-script-heartbeat', { type: 'manual' }, hb(script)));
    const r = await finish(id);
    const t = await request('/runs/' + id + '/thread');
    expect(
      r.status === 'succeeded' && t.outputs.work.value.probe.json.value === 'a'.repeat(70000),
      'script heartbeat full JSON mismatch',
    );
    return {
      run: id,
      status: r.status,
      jsonStringLength: t.outputs.work.value.probe.json.value.length,
    };
  });
  const metrics = [];
  let mode = 'header';
  server = createServer((req, res) => {
    const m = { route: req.url, mode, sent: 0, closed: false, started: Date.now() };
    metrics.push(m);
    res.on('close', () => {
      m.closed = true;
      m.closedAt = Date.now();
    });
    if (req.url === '/header') {
      res.writeHead(200, { 'content-length': '100000', 'content-type': 'application/json' });
      res.flushHeaders();
      const timer = setTimeout(() => {
        m.sent = 100000;
        res.end('a'.repeat(100000));
      }, 2000);
      res.on('close', () => clearTimeout(timer));
      return;
    }
    const over = req.url.includes('over');
    const body = Buffer.from(JSON.stringify({ id: req.url, text: 'a'.repeat(over ? 66000 : 100) }));
    res.writeHead(200, { 'content-type': 'application/json' });
    let sent = 0;
    const timer = setInterval(
      () => {
        if (res.destroyed) {
          clearInterval(timer);
          return;
        }
        const part = body.subarray(sent, sent + 4096);
        sent += part.length;
        m.sent += part.length;
        res.write(part);
        if (sent >= body.length) {
          clearInterval(timer);
          res.end();
        }
      },
      req.url.startsWith('/poll-over') ? 150 : 25,
    );
    res.on('close', () => clearInterval(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  await check('content-length-refused-before-body', async () => {
    let error;
    try {
      await new HttpProbes().fetch(
        { method: 'GET', url: base + '/header', timeoutMs: 4000 },
        new AbortController().signal,
      );
    } catch (e) {
      error = e.code;
    }
    const m = await until(() => metrics.find((x) => x.route === '/header' && x.closed));
    expect(error === 'HTTP_PROBE_BODY_OVERFLOW' && m.sent === 0, 'body was read or wrong code');
    return { code: error, ...m };
  });
  await check('poll-heartbeat-actual-overlap', async () => {
    mode = 'concurrent';
    const targets = await Promise.all(
      ['poll-good', 'poll-over', 'poll-good-2'].map((n) => loop(n, poll(http(base + '/' + n)))),
    );
    await until(() => metrics.some((m) => m.route === '/poll-over' && !m.closed));
    const hbs = await Promise.all(
      ['hb-good', 'hb-over', 'hb-good-2', 'hb-over-2'].map(async (n) => {
        const id = await start(await loop(n, { type: 'manual' }, hb(http(base + '/' + n))));
        const r = await finish(id);
        const e = await request('/runs/' + id + '/events?limit=1000');
        expect(
          n.includes('over')
            ? r.failure?.code === 'HTTP_PROBE_BODY_OVERFLOW' &&
                e.items.filter((e) => e.type === 'heartbeat.beat').length === 0
            : r.status === 'succeeded' &&
                e.items.filter((e) => e.type === 'heartbeat.beat').length === 1,
          'concurrent heartbeat wrong',
        );
        return { route: '/' + n, run: id, status: r.status, code: r.failure?.code };
      }),
    );
    await until(
      async () =>
        (await request('/runs?loopId=' + targets[0])).items[0] &&
        (await request('/runs?loopId=' + targets[2])).items[0] &&
        metrics.some((m) => m.route === '/poll-over' && m.closed),
    );
    const bad = await request('/runs?loopId=' + targets[1]);
    expect(bad.items.length === 0, 'overflow poll admitted run');
    const overlapped = metrics.some(
      (p) =>
        p.route.startsWith('/poll') &&
        metrics.some(
          (h) => h.route.startsWith('/hb') && p.started < h.closedAt && h.started < p.closedAt,
        ),
    );
    expect(overlapped, 'no actual HTTP request overlap measured');
    return {
      measuredRequestOverlap: true,
      heartbeats: hbs,
      overflowPollAdmitted: 0,
      pollDispatch: 'serial within poller, concurrent with heartbeat probes',
    };
  });
  await writeFile(out + 'supplement-fixture.json', JSON.stringify(metrics, null, 2) + '\n');
} finally {
  if (api && api.exitCode === null) {
    const end = once(api, 'exit');
    api.kill();
    await end;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await writeFile(out + 'supplement-checks.json', JSON.stringify(checks, null, 2) + '\n');
  await writeFile(
    out + 'supplement-cleanup.json',
    JSON.stringify(
      {
        apiStopped: !api || api.exitCode !== null || api.signalCode !== null,
        fixtureStopped: !server?.listening,
        directoriesDeleted: false,
        dataDirectory: '%TEMP%/gg-wp-d3-supplement-<unique>',
      },
      null,
      2,
    ) + '\n',
  );
}
