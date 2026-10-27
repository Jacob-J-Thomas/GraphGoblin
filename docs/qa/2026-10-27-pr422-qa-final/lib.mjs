import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export const RECORD = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(RECORD, '../../..');
export const ROOT = process.env.GG_QA_ROOT;
const SYSTEM_TEMP = process.env.GG_QA_SYSTEM_TEMP ?? os.tmpdir();
process.env.GG_QA_SYSTEM_TEMP = SYSTEM_TEMP;
if (
  !ROOT ||
  !path.basename(ROOT).startsWith('gg-qa-422f-') ||
  path.dirname(ROOT).toLowerCase() !== SYSTEM_TEMP.toLowerCase()
)
  throw Error('Disposable system-temp GG_QA_ROOT required');
export const CLI = path.join(ROOT, 'cli');
// Keep browser/library scratch files inside the same disposable allocation on future runs.
process.env.TEMP = ROOT;
process.env.TMP = ROOT;
export const checks = [];
export const processes = [];
export const sleep = delay;
export const redact = (value) =>
  String(value)
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '\\\\'), '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%')
    .replace(new RegExp(os.hostname(), 'gi'), '%COMPUTERNAME%')
    .replace(/S-1-\d+(?:-\d+)+/g, '<SID>');
export function save(name, data) {
  fs.writeFileSync(
    path.join(RECORD, name),
    redact(typeof data === 'string' ? data : JSON.stringify(data, null, 2)) + '\n',
    'utf8',
  );
}
export function check(name, passed, detail) {
  checks.push({ name, passed: !!passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : ': ' + JSON.stringify(detail)}`);
}
export async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  do {
    last = await fn();
    if (last) return last;
    await delay(100);
  } while (Date.now() < end);
  throw Error('Timed out: ' + String(fn) + ' last=' + JSON.stringify(last));
}
export async function startApi(
  name,
  port = 6660,
  env = {},
  entry = path.join(REPO, 'apps/api/dist/main.js'),
) {
  if (port < 6660 || port > 6669) throw Error('Port allocation');
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('GG_') && !/JEV_API_KEY|NODE_V8_COVERAGE/.test(k),
    ),
  );
  const child = spawn(process.execPath, [entry], {
    cwd: REPO,
    windowsHide: true,
    env: {
      ...clean,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_DATA_DIR: dir,
      GG_REQUIRE_API_KEY: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      GG_CODEX_BINARY: path.join(CLI, 'codex.exe'),
      GG_CLAUDE_BINARY: path.join(CLI, 'claude.exe'),
      GG_WEB_DIST: path.join(REPO, 'apps/web/dist'),
      GG_TIMER_POLL_MS: '100',
      GG_LOG_LEVEL: 'warn',
      GG_TEST_PORT_START: '6970',
      GG_TEST_PORT_COUNT: '30',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  const exit = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })),
  );
  const base = `http://127.0.0.1:${port}`;
  const api = {
    child,
    dir,
    base,
    exit,
    name,
    async call(method, url, body) {
      const r = await fetch(base + url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const raw = await r.text();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        json = raw;
      }
      return { status: r.status, body: json };
    },
    async get(url) {
      const r = await api.call('GET', url);
      if (r.status !== 200) throw Error(JSON.stringify(r));
      return r.body;
    },
    async post(url, body = {}) {
      const r = await api.call('POST', url, body);
      if (r.status >= 300) throw Error(url + JSON.stringify(r));
      return r.body;
    },
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exit;
      save(`${name}-${child.pid}.log.txt`, log);
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        await api.post('/system/shutdown', { action: 'drain' }).catch(() => {});
        await Promise.race([exit, delay(3000)]);
        if (child.exitCode === null && child.signalCode === null)
          await api.post('/system/shutdown', { action: 'force' }).catch(() => {});
        await Promise.race([exit, delay(10000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      await exit;
      save(`${name}-${child.pid}.log.txt`, log);
    },
  };
  processes.push(api);
  await until(async () => {
    if (child.exitCode !== null) throw Error('API exited ' + log);
    try {
      return (await fetch(base + '/healthz')).ok;
    } catch {
      return false;
    }
  }, 30000);
  return api;
}
export const edge = (id, from, to, port = 'out') => ({
  id,
  from: { node: from, port },
  to: { node: to },
});
export function loop(name, nodes = [], settings = {}, edges) {
  return {
    schemaVersion: 4,
    name,
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      ...nodes,
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges:
      edges ??
      ['start', ...nodes.map((n) => n.id), 'done']
        .slice(1)
        .map((id, i, a) => edge('e' + i, i === 0 ? 'start' : a[i - 1], id)),
  };
}
export const waitNode = (id = 'park') => ({
  id,
  kind: 'wait',
  label: 'Input park',
  config: { mode: 'input', prompt: 'Continue QA', exposeTo: ['api', 'ui'] },
});
export const inference = (id = 'think', session = { policy: 'fresh' }) => ({
  id,
  kind: 'inference',
  label: 'Inference',
  config: {
    harness: 'claude',
    model: 'claude-opus-5-5',
    effort: 'low',
    session,
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
    prompt: { template: 'QA worker {{ run.id }} visit={{ counters.nodeVisits.' + id + ' }}' },
  },
});
export const scriptNode = (file, args = [], id = 'script') => ({
  id,
  kind: 'script',
  label: 'QA effect',
  config: { command: process.execPath, args: [file, ...args], cwd: ROOT },
});
export async function publish(api, def) {
  const r = await api.post('/loops', { definition: def });
  await api.post(`/loops/${r.loop.id}/publish`);
  return r.loop.id;
}
export async function run(api, id) {
  return (await api.post(`/loops/${id}/runs`)).run;
}
export async function state(api, id, status) {
  return until(async () => {
    const r = await api.get(`/runs/${id}`);
    return status.includes(r.status) ? r : false;
  }, 30000);
}
export async function events(api, id) {
  let all = [],
    after = 0;
  for (;;) {
    let p = await api.get(`/runs/${id}/events?after=${after}&limit=1000`);
    all.push(...p.items);
    if (!p.hasMore || !p.items.length) return all;
    after = p.items.at(-1).seq;
  }
}
export const control = (name, value) => {
  const p = path.join(CLI, name);
  if (value === undefined) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } else fs.writeFileSync(p, String(value));
};
export async function cleanup() {
  for (const api of processes) await api.stop();
  save(
    'processes.json',
    processes.map((p) => ({
      name: p.name,
      pid: p.child.pid,
      exitCode: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
}
