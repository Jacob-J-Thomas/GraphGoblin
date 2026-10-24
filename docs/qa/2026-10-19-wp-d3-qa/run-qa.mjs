// Independent QA driver. Uses built public APIs/components; no provider turns.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProcessScripts } from '../../../packages/infrastructure/dist/process/index.js';
import { HttpProbes } from '../../../packages/infrastructure/dist/http/index.js';
import { itemsScriptProbe } from '../../../apps/api/dist/triggers/poll-probe.js';
import { PollTriggers } from '../../../apps/api/dist/triggers/poll.js';

const root = process.cwd();
const out = resolve('docs/qa/2026-10-19-wp-d3-qa');
const data = await mkdtemp(join(tmpdir(), 'gg-wp-d3-qa-'));
const cap = 65536;
const checks = [];
const snapshots = {};
let token = '';
let api;
let apiPort;
let fixture;
let logs = '';
const children = new Set();
const pendingPids = new Set();
const metrics = [];
const overrides = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash('sha256').update(s).digest('hex');
function clean(s) {
  for (const p of [
    root,
    root.replaceAll('\\', '/'),
    data,
    data.replaceAll('\\', '/'),
    process.execPath,
    tmpdir(),
  ]) {
    s = s.replaceAll(p, '<local-path>').replaceAll(p.replaceAll('\\', '\\\\'), '<local-path>');
  }
  if (token) s = s.replaceAll(token, '<redacted-key>');
  return s;
}
async function save(name, value) {
  await writeFile(
    join(out, name),
    clean(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n',
  );
}
async function check(id, fn) {
  const begin = Date.now();
  try {
    const detail = await fn();
    checks.push({ id, pass: true, milliseconds: Date.now() - begin, detail });
    console.log(`PASS ${id}`);
  } catch (e) {
    checks.push({
      id,
      pass: false,
      milliseconds: Date.now() - begin,
      error: clean(e.stack ?? String(e)),
    });
    console.log(`FAIL ${id}: ${clean(e.message ?? String(e))}`);
  }
  await save('checks.json', checks);
}
function expect(value, message) {
  if (!value) throw new Error(message);
}
async function until(fn, ms = 18000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await sleep(80);
  }
  throw new Error('bounded wait expired');
}
function child(args, env = process.env) {
  const c = spawn(process.execPath, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(c);
  c.on('exit', () => children.delete(c));
  return c;
}
const env = {
  ...process.env,
  GG_DATA_DIR: data,
  GG_DB_URL: `file:${join(data, 'graphgoblin.db').replaceAll('\\', '/')}`,
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'true',
  GG_LOG_LEVEL: 'warn',
  GG_WEB_DIST: '',
  GG_JEV_API_KEY: '',
  JEV_API_KEY: '',
  GG_MAX_CONCURRENT_RUNS: '8',
  GG_TIMER_POLL_MS: '50',
};
delete env.GG_MASTER_KEY;
async function request(path, method = 'GET', body) {
  const r = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}
async function startApi() {
  api = child(['apps/api/dist/main.js'], { ...env, GG_PORT: String(apiPort) });
  api.stdout.on('data', (b) => {
    logs += b;
  });
  api.stderr.on('data', (b) => {
    logs += b;
  });
  await until(async () => {
    try {
      return await request('/loops');
    } catch {
      if (api.exitCode !== null) throw new Error(`API exited ${api.exitCode}: ${clean(logs)}`);
      return false;
    }
  }, 60000);
}
async function stopApi() {
  if (api && api.exitCode === null) {
    const ended = once(api, 'exit');
    api.kill();
    await ended;
  }
}
function node(id, kind, config) {
  return { id, label: id, kind, config };
}
function definition(name, trigger, work) {
  const nodes = [
    node('start', 'trigger', trigger),
    ...(work ? [work] : []),
    node('done', 'exit', { outcome: 'success', returns: 'none' }),
  ];
  return {
    schemaVersion: 4,
    name,
    nodes,
    edges: nodes.slice(1).map((n, i) => ({
      id: `e${i}`,
      from: { node: nodes[i].id, port: 'out' },
      to: { node: n.id, port: 'in' },
    })),
  };
}
async function makeLoop(name, trigger, work) {
  const created = await request('/loops', 'POST', { definition: definition(name, trigger, work) });
  await request(`/loops/${created.loop.id}/publish`, 'POST', {});
  return created.loop.id;
}
async function startRun(loop) {
  return (await request(`/loops/${loop}/runs`, 'POST', {})).run.id;
}
async function terminal(id) {
  return until(async () => {
    const r = await request(`/runs/${id}`);
    return ['succeeded', 'failed', 'cancelled', 'exhausted'].includes(r.status) ? r : false;
  });
}
async function capture(id) {
  return {
    run: await request(`/runs/${id}`),
    events: await request(`/runs/${id}/events?limit=1000`),
    thread: await request(`/runs/${id}/thread`),
  };
}
function jsonBody(size) {
  return Buffer.from(JSON.stringify({ text: 'a'.repeat(size - 11) }));
}
function fixtureHandler(req, res) {
  const route = new URL(req.url, 'http://localhost').pathname.slice(1);
  const mode = overrides.get(route) ?? route;
  const m = {
    route,
    mode,
    method: req.method,
    sent: 0,
    total: 0,
    ended: false,
    closed: false,
    started: Date.now(),
  };
  metrics.push(m);
  res.on('close', () => {
    m.closed = true;
    m.elapsed = Date.now() - m.started;
  });
  if (mode === 'fault') {
    req.socket.destroy();
    return;
  }
  if (['204', '304', 'head'].includes(mode)) {
    res.writeHead(mode === 'head' ? 200 : Number(mode), {
      'content-length': '100000',
      'content-type': 'application/json',
    });
    res.end();
    m.ended = true;
    return;
  }
  let body = jsonBody(mode === 'over' || mode === 'gzip-over' ? cap + 1 : cap);
  if (mode === 'small') body = Buffer.from('{"ok":"Aé雪🦎Z"}');
  if (mode === 'gzip-wide') {
    const raw = Buffer.from('{"ok":"Aé雪🦎Z"}');
    const gz = gzipSync(raw);
    gz[3] |= 4;
    const len = Buffer.alloc(2);
    len.writeUInt16LE(65535);
    body = Buffer.concat([gz.subarray(0, 10), len, Buffer.alloc(65535), gz.subarray(10)]);
    m.decompressedBytes = raw.length;
  } else if (mode === 'gzip-over') {
    m.decompressedBytes = body.length;
    body = gzipSync(body);
  }
  if (mode === 'unicode') body = Buffer.from('"' + 'a'.repeat(cap - 13) + 'Aé雪🦎Z' + '"');
  const stream = ['chunk-over', 'slow', 'unicode'].includes(mode);
  if (mode === 'chunk-over') body = Buffer.alloc(1024 * 1024, 97);
  if (mode === 'slow') body = Buffer.alloc(100000, 97);
  m.total = body.length;
  const headers = { 'content-type': 'application/json' };
  if (mode.startsWith('gzip')) headers['content-encoding'] = 'gzip';
  if (!stream) headers['content-length'] = String(body.length);
  res.writeHead(200, headers);
  if (!stream) {
    m.sent = body.length;
    res.end(body);
    m.ended = true;
    return;
  }
  const step = mode === 'slow' ? 100 : mode === 'unicode' ? cap - 7 : 1024;
  const tick = setInterval(
    () => {
      if (res.destroyed) {
        clearInterval(tick);
        return;
      }
      const next = body.subarray(m.sent, m.sent + step);
      m.sent += next.length;
      res.write(next);
      if (m.sent >= body.length) {
        clearInterval(tick);
        res.end();
        m.ended = true;
      }
    },
    mode === 'slow' ? 100 : mode === 'unicode' ? 80 : 2,
  );
  res.on('close', () => clearInterval(tick));
}
let fixtureBase;
const httpProbe = (route, method = 'GET', timeoutSeconds = 3) => ({
  kind: 'http',
  method,
  url: `${fixtureBase}/${route}`,
  timeoutSeconds,
});
const manual = { type: 'manual' };
const poll = (probe, items) => ({
  type: 'poll',
  intervalSeconds: 5,
  enabled: true,
  probe,
  fireWhen: 'true',
  ...(items
    ? { items: { select: 'probe.json.items', dedupeKey: 'item.id', maxRunsPerPoll: 1 } }
    : { dedupeKey: '"once"' }),
});
const heartbeat = (probe) =>
  node('work', 'heartbeat', { intervalSeconds: 1, maxBeats: 1, record: 'full', probe });
function warning(loop, code) {
  return logs.split('\n').some((s) => {
    try {
      const x = JSON.parse(s);
      return x.loopId === loop && x.msg === 'poll trigger failed' && x.code === code;
    } catch {
      return false;
    }
  }, 60000);
}
const runs = async (loop) => (await request(`/runs?loopId=${loop}&limit=500`)).items;
async function httpPollCase(mode, accepted, method = 'GET') {
  const loop = await makeLoop(`http-${mode}`, poll(httpProbe(mode, method)));
  await until(async () =>
    accepted ? (await runs(loop))[0] : warning(loop, 'HTTP_PROBE_BODY_OVERFLOW'),
  );
  const found = await runs(loop);
  expect(
    accepted ? found.length === 1 : found.length === 0,
    `unexpected run count ${found.length}`,
  );
  if (!accepted) return { loop, admitted: 0, warning: 'HTTP_PROBE_BODY_OVERFLOW' };
  await terminal(found[0].id);
  const evidence = await capture(found[0].id);
  const payload = evidence.thread.invocation.trigger.payload;
  if (['204', '304', 'head'].includes(mode))
    expect(
      payload.body === '' && payload.headers['content-length'] === '100000',
      'empty/metadata mismatch',
    );
  else if (mode === 'gzip-wide')
    expect(
      JSON.stringify(payload.json) === JSON.stringify({ ok: 'Aé雪🦎Z' }),
      'gzip exact JSON mismatch',
    );
  else {
    const expected =
      mode === 'unicode' ? '"' + 'a'.repeat(cap - 13) + 'Aé雪🦎Z' + '"' : jsonBody(cap).toString();
    expect(
      payload.body === expected &&
        JSON.stringify(payload.json) === JSON.stringify(JSON.parse(expected)),
      'exact accepted payload mismatch',
    );
  }
  await save(`poll-${mode}.json`, {
    run: evidence.run,
    payload: {
      status: payload.status,
      headers: payload.headers,
      bodyBytes: Buffer.byteLength(payload.body),
      bodySha256: hash(payload.body),
      exactBodyAndJson: true,
    },
    events: evidence.events.items.map((e) => ({ type: e.type, seq: e.seq })),
  });
  return {
    loop,
    run: found[0].id,
    exactBodyAndJson: true,
    bodyBytes: Buffer.byteLength(payload.body),
  };
}
try {
  await mkdir(out, { recursive: true });
  // Select an unused permitted API port without contacting the owner's instance.
  for (let p = 5660; p <= 5669; p++) {
    const s = createServer();
    try {
      await new Promise((yes, no) => {
        s.once('error', no);
        s.listen(p, '127.0.0.1', yes);
      });
      apiPort = p;
      await new Promise((r) => s.close(r));
      break;
    } catch {
      /* try next permitted port */
    }
  }
  expect(apiPort, 'no free permitted API port');
  const mint = child(['apps/api/dist/main.js', '--create-api-key', 'independent-wp-d3-qa'], env);
  let minted = '';
  mint.stdout.on('data', (b) => {
    minted += b;
  });
  let mintError = '';
  mint.stderr.on('data', (b) => {
    mintError += b;
  });
  const [mintCode] = await once(mint, 'exit');
  expect(mintCode === 0, `key CLI failed: ${mintError}`);
  token = minted
    .split('\n')
    .find((l) => /^  \S+\s*$/.test(l))
    ?.trim();
  expect(token, 'key CLI returned no token');
  fixture = createServer(fixtureHandler);
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  fixtureBase = `http://127.0.0.1:${fixture.address().port}`;
  await startApi();
  await save('environment.json', {
    revision: '7639cbf530561f116db986bbe8a2e69c6a20311e',
    node: process.version,
    platform: process.platform,
    apiPort,
    fixturePort: fixture.address().port,
    dataDirectory: '%TEMP%/gg-wp-d3-qa-<unique>',
    apiAuthentication: 'binary-created bearer key, not recorded',
    browser: 'not applicable; backend-only change',
    buildEntry: 'node apps/api/dist/main.js',
  });

  await Promise.all(
    [
      ['exact', true],
      ['over', false],
      ['chunk-over', false],
      ['gzip-wide', true],
      ['gzip-over', false],
      ['204', true],
      ['304', true],
      ['head', true],
      ['unicode', true],
    ].map(([mode, accepted]) =>
      check(`poll-${mode}`, () => httpPollCase(mode, accepted, mode === 'head' ? 'HEAD' : 'GET')),
    ),
  );
  await check('poll-next-after-overflow', async () => {
    const old = checks.find((c) => c.id === 'poll-over').detail;
    expect(old, 'overflow prerequisite failed');
    overrides.set('over', 'small');
    const found = await until(async () => (await runs(old.loop))[0]);
    await terminal(found.id);
    const evidence = await capture(found.id);
    expect(
      evidence.thread.invocation.trigger.payload.json.ok === 'Aé雪🦎Z',
      'next-poll JSON mismatch',
    );
    return { loop: old.loop, run: found.id, nextPollExact: true };
  });
  await check('chunk-socket-closed-early', async () => {
    const m = metrics.find((x) => x.route === 'chunk-over' && x.closed);
    expect(m && !m.ended && m.sent < m.total, 'overflow fixture was not stopped early');
    return m;
  });

  await Promise.all(
    [65535, 65536, 65537].map((size) =>
      check(`items-script-${size}`, async () => {
        const json = JSON.stringify({ items: [{ id: 'only', value: 'x' }] });
        const code = `process.stdout.write(${JSON.stringify(json)}+' '.repeat(${size - Buffer.byteLength(json)}))`;
        const loop = await makeLoop(
          `items-${size}`,
          poll({ kind: 'script', command: 'node', args: ['-e', code], timeoutSeconds: 5 }, true),
        );
        await until(async () =>
          size > cap ? warning(loop, 'POLL_STDOUT_OVERFLOW') : (await runs(loop))[0],
        );
        const found = await runs(loop);
        expect(found.length === (size > cap ? 0 : 1), 'items admission count mismatch');
        if (found[0]) {
          await terminal(found[0].id);
          expect(
            (await capture(found[0].id)).thread.invocation.trigger.payload.id === 'only',
            'item mismatch',
          );
        }
        return {
          loop,
          emittedBytes: size,
          admitted: found.length,
          ...(size > cap ? { warning: 'POLL_STDOUT_OVERFLOW' } : {}),
        };
      }),
    ),
  );
  await check('items-explicit-overflow-public-port', async () => {
    const text = '{"items":[{"id":"blocked"}]}';
    const warnings = [];
    const admitted = [];
    const requests = [];
    const result = {
      stdout: text,
      stderr: '',
      stdoutBytes: Buffer.byteLength(text),
      stderrBytes: 0,
      stdoutOverflow: true,
      stderrOverflow: false,
      exitCode: 0,
      timedOut: false,
    };
    const clock = { now: () => new Date('2026-10-19T00:00:00Z') };
    const ports = {
      scripts: {
        run: async (r) => {
          requests.push(r.maxStdoutBytes);
          return result;
        },
      },
      probes: {
        fetch: async () => {
          throw new Error('unused');
        },
      },
      manager: {
        startRun: async () => {
          admitted.push('single');
        },
        startPollItem: async () => {
          admitted.push('item');
        },
      },
      hasDedupe: async () => false,
      findSeen: async () => new Set(),
      clock,
      logger: {
        info() {},
        error() {},
        debug() {},
        warn: (context, message) => warnings.push({ context, message }),
      },
      scriptCwd: data,
    };
    const target = new PollTriggers(ports);
    target.arm(
      { id: 'controlled-loop', ownerId: 'qa' },
      {
        id: 'controlled-version',
        definition: definition(
          'flag',
          poll({ kind: 'script', command: 'unused', args: [], timeoutSeconds: 5 }, true),
        ),
      },
    );
    clock.now = () => new Date('2026-10-19T00:00:06Z');
    await target.poll();
    expect(
      admitted.length === 0 &&
        warnings[0]?.context.code === 'POLL_STDOUT_OVERFLOW' &&
        requests[0] === cap,
      'explicit flag ignored',
    );
    let typed;
    try {
      itemsScriptProbe(result);
    } catch (e) {
      typed = e.code;
    }
    expect(typed === 'POLL_STDOUT_OVERFLOW', 'consumer code mismatch');
    return {
      controlledPortOnly: true,
      admitted,
      warnings,
      requestedCap: requests[0],
      reportedBytes: result.stdoutBytes,
      decodedBytes: Buffer.byteLength(text),
    };
  });

  await Promise.all(
    ['over', 'small', 'fault'].map((mode) =>
      check(`heartbeat-${mode}`, async () => {
        const route = `hb-${mode}`;
        overrides.set(route, mode);
        const loop = await makeLoop(`heartbeat-${mode}`, manual, heartbeat(httpProbe(route)));
        const id = await startRun(loop);
        const state = await terminal(id);
        const evidence = await capture(id);
        const beats = evidence.events.items.filter((e) => e.type === 'heartbeat.beat');
        if (mode === 'small')
          expect(
            state.status === 'succeeded' &&
              beats.length === 1 &&
              evidence.thread.outputs.work.value.probe.json.ok === 'Aé雪🦎Z',
            'ordinary beat failed',
          );
        else {
          expect(
            state.status === 'failed' &&
              state.failure.code ===
                (mode === 'over' ? 'HTTP_PROBE_BODY_OVERFLOW' : 'INTERNAL_ERROR'),
            'failure code mismatch',
          );
          expect(
            beats.length === 0 && !evidence.thread.outputs.work,
            'failure recorded successful beat/output',
          );
        }
        await save(`heartbeat-${mode}.json`, evidence);
        if (mode === 'over') snapshots.overflow = evidence;
        return {
          loop,
          run: id,
          status: state.status,
          failure: state.failure,
          beats: beats.length,
          outputPresent: !!evidence.thread.outputs.work,
        };
      }),
    ),
  );
  await check('heartbeat-resume-after-overflow', async () => {
    const first = checks.find((c) => c.id === 'heartbeat-over').detail;
    expect(first, 'overflow prerequisite failed');
    overrides.set('hb-over', 'small');
    await request(`/runs/${first.run}/resume`, 'POST', {});
    const state = await terminal(first.run);
    const evidence = await capture(first.run);
    expect(
      state.status === 'succeeded' &&
        evidence.events.items.filter((e) => e.type === 'heartbeat.beat').length === 1,
      'resume did not beat exactly once',
    );
    await save('heartbeat-resumed.json', evidence);
    snapshots.resumed = evidence;
    // Keep a second, still-failed overflow run for restart comparison.
    overrides.set('hb-over', 'over');
    const id = await startRun(first.loop);
    await terminal(id);
    snapshots.overflow = await capture(id);
    return { run: first.run, status: state.status, restartFailedRun: id };
  });

  const sample = 'Aé雪🦎Z';
  const sampleHex = Buffer.from(sample).toString('hex');
  await Promise.all(
    Array.from({ length: Buffer.byteLength(sample) + 1 }, (_, split) =>
      check(`script-utf8-split-${split}`, async () => {
        const code = `const b=Buffer.from('${sampleHex}','hex');process.stdout.write(b.subarray(0,${split}));process.stderr.write(b.subarray(0,${split}));setTimeout(()=>{process.stdout.write(b.subarray(${split}));process.stderr.write(b.subarray(${split}))},100)`;
        const loop = await makeLoop(
          `split-${split}`,
          manual,
          node('work', 'script', { command: 'node', args: ['-e', code], stdin: 'none' }),
        );
        const id = await startRun(loop);
        const state = await terminal(id);
        const evidence = await capture(id);
        const progress = evidence.events.items.find(
          (e) => e.type === 'node.progress' && e.nodeId === 'work',
        )?.progress;
        expect(
          state.status === 'succeeded' &&
            evidence.thread.outputs.work.value === sample &&
            progress?.stderr === sample &&
            progress.stdoutBytes === 11,
          'UTF-8 stream/progress mismatch',
        );
        if (split === 5) {
          snapshots.utf8 = evidence;
          await save('script-utf8.json', evidence);
        }
        return {
          run: id,
          split,
          stdoutHex: Buffer.from(evidence.thread.outputs.work.value).toString('hex'),
          stderrHex: Buffer.from(progress.stderr).toString('hex'),
          stdoutBytes: progress.stdoutBytes,
        };
      }),
    ),
  );
  const scripts = new ProcessScripts();
  await check('script-cap-split-public-component', async () => {
    const r = await scripts.run({
      command: 'node',
      args: [
        '-e',
        `process.stdout.write(Buffer.from('${sampleHex}','hex'));process.stderr.write(Buffer.from('${sampleHex}','hex'))`,
      ],
      cwd: data,
      env: {},
      signal: new AbortController().signal,
      maxStdoutBytes: 7,
      maxStderrBytes: 7,
    });
    expect(
      r.stdout === 'Aé雪' &&
        r.stderr === 'Aé雪' &&
        r.stdoutBytes === 7 &&
        r.stderrBytes === 7 &&
        r.stdoutOverflow &&
        r.stderrOverflow,
      'cap-split behavior mismatch',
    );
    return r;
  });
  await check('script-default-cap-built-api', async () => {
    const max = 10 * 1024 * 1024;
    const code = `process.stdout.write('a'.repeat(${max - 1}));process.stdout.write(Buffer.from('f09fa68e','hex'));`;
    const loop = await makeLoop(
      'default-cap',
      manual,
      node('work', 'script', { command: 'node', args: ['-e', code], stdin: 'none' }),
    );
    const id = await startRun(loop);
    await terminal(id);
    const evidence = await capture(id);
    const value = evidence.thread.outputs.work.value;
    const progress = evidence.events.items.find((e) => e.type === 'node.progress')?.progress;
    expect(
      value === 'a'.repeat(max - 1) && progress.stdoutBytes === max,
      'default byte cap mismatch',
    );
    return {
      run: id,
      emittedBytes: max + 3,
      capturedBytes: progress.stdoutBytes,
      decodedBytes: Buffer.byteLength(value),
      outputSha256: hash(value),
      capSplitSuffixOmitted: true,
    };
  });
  for (const action of ['cancel', 'timeout', 'clean-eof'])
    await check(`script-incomplete-${action}-component`, async () => {
      const pidFile = join(data, `component-${action}.pid`);
      const controller = new AbortController();
      const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdout.write(Buffer.from([65,240,159]));process.stderr.write(Buffer.from([65,240,159]));${action === 'clean-eof' ? '' : 'setInterval(()=>{},1000);'}`;
      const promise = scripts.run({
        command: 'node',
        args: ['-e', code],
        cwd: data,
        env: {},
        signal: controller.signal,
        ...(action === 'timeout' ? { timeoutMs: 700 } : {}),
      });
      const pid = await until(async () => {
        try {
          return Number(await readFile(pidFile, 'utf8'));
        } catch {
          return false;
        }
      }, 60000);
      pendingPids.add(pid);
      if (action === 'cancel') {
        await sleep(150);
        controller.abort();
      }
      let assistedCleanup = false;
      const watchdog = setTimeout(() => {
        assistedCleanup = true;
        try {
          process.kill(pid);
        } catch {}
      }, 3000);
      const result = await promise;
      clearTimeout(watchdog);
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      pendingPids.delete(pid);
      await save(`component-${action}.json`, {
        result,
        pid,
        processGone: true,
        assistedCleanup,
        terminationDeadlineMs: 3000,
      });
      expect(
        !assistedCleanup,
        'child survived cancellation/timeout for 3000 ms; explicit QA cleanup required; see component evidence',
      );
      expect(
        result.stdout === 'A�' &&
          result.stderr === 'A�' &&
          result.stdoutBytes === 3 &&
          result.stderrBytes === 3,
        'incomplete final output mismatch',
      );
      expect(result.timedOut === (action === 'timeout'), 'timeout flag mismatch');
      return { ...result, pid, processGone: true };
    });
  await Promise.all(
    ['cancel', 'timeout'].map((action) =>
      check(`script-incomplete-${action}-api`, async () => {
        const pidFile = join(data, `api-${action}.pid`);
        const code = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdout.write(Buffer.from([65,240,159]));process.stderr.write(Buffer.from([65,240,159]));setInterval(()=>{},1000);`;
        const loop = await makeLoop(
          `api-${action}`,
          manual,
          node('work', 'script', {
            command: 'node',
            args: ['-e', code],
            stdin: 'none',
            timeoutSeconds: action === 'timeout' ? 1 : 20,
          }),
        );
        const id = await startRun(loop);
        const pid = await until(async () => {
          try {
            return Number(await readFile(pidFile, 'utf8'));
          } catch {
            return false;
          }
        }, 60000);
        pendingPids.add(pid);
        let assistedCleanup = false;
        const watchdog = setTimeout(() => {
          try {
            process.kill(pid, 0);
            assistedCleanup = true;
            process.kill(pid);
          } catch {}
        }, 4000);
        await sleep(150);
        if (action === 'cancel') await request(`/runs/${id}/cancel`, 'POST', {});
        const state = await terminal(id);
        await until(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
        clearTimeout(watchdog);
        pendingPids.delete(pid);
        expect(
          action === 'cancel'
            ? state.status === 'cancelled'
            : state.status === 'failed' && state.failure.code === 'SCRIPT_TIMEOUT',
          'terminal state mismatch',
        );
        const evidence = await capture(id);
        await save(`script-${action}.json`, { ...evidence, assistedCleanup, pid });
        expect(
          !assistedCleanup,
          'script child survived cancellation/timeout for 4000 ms; explicit QA cleanup required; see API script evidence',
        );
        return {
          run: id,
          pid,
          processGone: true,
          status: state.status,
          failure: state.failure,
          note: 'API cancels/fails before recording progress/output; final decoded capture verified through public ProcessScripts above.',
        };
      }),
    ),
  );

  await Promise.all(
    ['abort', 'timeout'].map((action) =>
      check(`http-read-${action}`, async () => {
        const route = `slow-${action}`;
        overrides.set(route, 'slow');
        const controller = new AbortController();
        const promise = new HttpProbes().fetch(
          {
            method: 'GET',
            url: `${fixtureBase}/${route}`,
            timeoutMs: action === 'timeout' ? 350 : 5000,
          },
          controller.signal,
        );
        await until(() => metrics.find((m) => m.route === route && m.sent > 0));
        if (action === 'abort') controller.abort();
        let error;
        try {
          await promise;
        } catch (e) {
          error = { name: e.name, code: e.code, message: e.message };
        }
        const m = await until(() => metrics.find((x) => x.route === route && x.closed));
        expect(
          error?.name === (action === 'abort' ? 'AbortError' : 'TimeoutError') &&
            !m.ended &&
            m.sent < m.total,
          'reader abort/closure mismatch',
        );
        return { error, fixture: m };
      }),
    ),
  );
  await check('heartbeat-cancel-slow-read-api', async () => {
    overrides.set('hb-slow', 'slow');
    const loop = await makeLoop(
      'heartbeat-cancel',
      manual,
      heartbeat(httpProbe('hb-slow', 'GET', 10)),
    );
    const id = await startRun(loop);
    await until(() => metrics.find((x) => x.route === 'hb-slow' && x.sent > 0));
    await request(`/runs/${id}/cancel`, 'POST', {});
    const state = await terminal(id);
    const m = await until(() => metrics.find((x) => x.route === 'hb-slow' && x.closed));
    const evidence = await capture(id);
    expect(
      state.status === 'cancelled' &&
        !m.ended &&
        !evidence.events.items.some((e) => e.type === 'heartbeat.beat') &&
        !evidence.thread.outputs.work,
      'cancelled heartbeat mismatch',
    );
    return { run: id, status: state.status, fixture: m, beats: 0 };
  });
  await check('concurrent-heartbeats-and-polls', async () => {
    // Poll loops from the first matrix remain armed while these eight real runs execute.
    const ids = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const route = `parallel-${i}`;
        const mode = i % 2 ? 'over' : 'small';
        overrides.set(route, mode);
        const loop = await makeLoop(`parallel-${i}`, manual, heartbeat(httpProbe(route)));
        return { run: await startRun(loop), mode, route };
      }),
    );
    const result = await Promise.all(
      ids.map(async (r) => {
        const state = await terminal(r.run);
        const e = await capture(r.run);
        expect(
          r.mode === 'over'
            ? state.failure?.code === 'HTTP_PROBE_BODY_OVERFLOW' && !e.thread.outputs.work
            : state.status === 'succeeded' &&
                e.thread.outputs.work.value.probe.json.ok === 'Aé雪🦎Z',
          `cross-talk ${r.route}`,
        );
        return {
          ...r,
          status: state.status,
          failureCode: state.failure?.code,
          beats: e.events.items.filter((x) => x.type === 'heartbeat.beat').length,
        };
      }),
    );
    return {
      pollLoopsStillArmed: true,
      result,
      note: 'Public PollTriggers intentionally serializes poll checks; independent runs overlap, no claim of parallel probe dispatch inside one poller.',
    };
  });
  await check('restart-terminal-runs-and-event-pages', async () => {
    expect(
      snapshots.overflow && snapshots.utf8 && snapshots.resumed,
      'restart prerequisites incomplete',
    );
    const before = {};
    for (const [name, e] of Object.entries(snapshots)) before[name] = await capture(e.run.id);
    const pageBefore = {};
    for (const [name, e] of Object.entries(before))
      pageBefore[name] = await request(`/runs/${e.run.id}/events?after=0&limit=3`);
    await stopApi();
    await startApi();
    const after = {};
    const pageAfter = {};
    for (const [name, e] of Object.entries(before)) {
      after[name] = await capture(e.run.id);
      pageAfter[name] = await request(`/runs/${e.run.id}/events?after=0&limit=3`);
    }
    await sleep(1200);
    for (const [name, e] of Object.entries(before)) {
      expect(JSON.stringify(e) === JSON.stringify(after[name]), `restart changed ${name}`);
      expect(
        JSON.stringify(pageBefore[name]) === JSON.stringify(pageAfter[name]),
        `restart page changed ${name}`,
      );
      expect(
        JSON.stringify(after[name].events) ===
          JSON.stringify(await request(`/runs/${e.run.id}/events?limit=1000`)),
        `node re-executed ${name}`,
      );
    }
    await save('restart.json', {
      before,
      after,
      pageBefore,
      pageAfter,
      identical: true,
      noNewEventsAfter1200ms: true,
      stop: 'real API process termination, new process on same disposable SQLite store',
    });
    return {
      statesAndThreadsAndEventsIdentical: true,
      eventPagesIdentical: true,
      noNodeReexecution: true,
      ids: Object.fromEntries(Object.entries(before).map(([name, e]) => [name, e.run.id])),
    };
  });
} catch (e) {
  checks.push({ id: 'driver-fatal', pass: false, error: clean(e.stack ?? String(e)) });
  console.log(clean(e.stack ?? String(e)));
} finally {
  await stopApi();
  if (fixture) {
    fixture.closeAllConnections();
    await new Promise((r) => fixture.close(r));
  }
  for (const pid of pendingPids) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  for (const c of children) {
    if (c.exitCode === null) c.kill();
  }
  await save('checks.json', checks);
  await save('api.log', logs);
  await save('fixture.json', metrics);
  await save('cleanup.json', {
    apiStopped: !api || api.exitCode !== null || api.signalCode !== null,
    fixtureStopped: !fixture?.listening,
    trackedChildProcesses: children.size,
    pendingScriptPids: [...pendingPids],
    directoriesDeleted: false,
    retainedDataDirectory: '%TEMP%/gg-wp-d3-qa-<unique>',
  });
  console.log(`TOTAL ${checks.filter((x) => x.pass).length}/${checks.length} passed`);
}
