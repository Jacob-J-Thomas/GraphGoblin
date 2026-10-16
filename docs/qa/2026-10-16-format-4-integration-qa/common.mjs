import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export { assert };
export const root = path.resolve('.tmp/qa');
fs.mkdirSync(path.join(root, 'wire'), { recursive: true });
export const tag = 'f4qa-' + Date.now();
let seq = fs.existsSync(path.join(root, 'http.jsonl'))
  ? fs.readFileSync(path.join(root, 'http.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length
  : 0;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clone = (x) => structuredClone(x);
const trim = (s) => (s.length > 1800 ? s.slice(0, 1800) + '…' : s);
export async function req(method, url, body, opts = {}) {
  assert(url.startsWith('/') && !url.startsWith('//'), 'Only the QA instance is allowed');
  const id = 'H' + String(++seq).padStart(4, '0');
  const raw =
    body === undefined
      ? undefined
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = opts.headers ?? {};
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers).flat();
  const effective = [
    'Host',
    '127.0.0.1:4796',
    ...(raw ? ['Content-Type', opts.contentType ?? 'application/json'] : []),
    ...pairs,
    ...(raw ? ['Content-Length', String(raw.length)] : []),
  ];
  let wire;
  if (raw && !opts.secret) {
    wire = 'wire/' + id + '.bin';
    fs.writeFileSync(path.join(root, wire), raw);
  }
  const result = await new Promise((resolve, reject) => {
    const q = http.request(
      { hostname: '127.0.0.1', port: 4796, path: url, method, headers: effective, timeout: 12000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          resolve({ id, status: res.statusCode, data, text, headers: res.headers });
        });
      },
    );
    q.on('error', reject);
    q.on('timeout', () => q.destroy(new Error('request timeout')));
    if (raw) q.write(raw);
    q.end();
  });
  const safeHeaders = effective.map((v, i) =>
    i % 2 === 1 && /signature/i.test(effective[i - 1])
      ? '[REDACTED HMAC; recompute using runtime secret]'
      : v,
  );
  const entry = {
    id,
    at: new Date().toISOString(),
    request: {
      method,
      url: 'http://127.0.0.1:4796' + url,
      headers: safeHeaders,
      bodyBytes: raw?.length ?? 0,
      ...(wire ? { wireFile: wire } : {}),
      body: opts.secret
        ? '[REDACTED throwaway secret]'
        : raw && raw.length < 16000
          ? raw.toString('utf8')
          : raw
            ? '[binary/large: see wireFile]'
            : null,
      ...(opts.note ? { note: opts.note } : {}),
    },
    response: { status: result.status, headers: result.headers, body: result.data },
  };
  fs.appendFileSync(path.join(root, 'http.jsonl'), JSON.stringify(entry) + '\n');
  return result;
}
export const get = (p) => req('GET', p);
export const post = (p, b = {}, o) => req('POST', p, b, o);
export function status(r, n, code) {
  assert.equal(r.status, n, JSON.stringify(r.data));
  if (code) assert.equal(r.data.code, code);
  return r.data;
}
export async function test(system, id, name, expected, fn) {
  const start = seq + 1;
  let pass = true,
    actual;
  try {
    actual = await fn();
  } catch (e) {
    pass = false;
    actual = e.message;
  }
  const row = {
    system,
    id,
    name,
    expected,
    actual: typeof actual === 'string' ? actual : JSON.stringify(actual),
    result: pass ? 'PASS' : 'FAIL',
    evidence:
      start <= seq
        ? `H${String(start).padStart(4, '0')}–H${String(seq).padStart(4, '0')}`
        : 'script assertion',
    at: new Date().toISOString(),
  };
  fs.appendFileSync(path.join(root, 'cases.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${row.result} ${id} ${name}: ${trim(row.actual ?? 'assertions passed')}`);
}
export function node(id, kind, config) {
  return { id, kind, label: id, config };
}
export function edge(id, a, b, port = 'out') {
  return { id, from: { node: a, port }, to: { node: b, port: 'in' } };
}
export function minimal(
  name,
  trigger = { type: 'manual' },
  exit = {
    outcome: 'success',
    returns: 'invocation.trigger.payload',
    destinations: [{ kind: 'caller' }],
  },
) {
  return {
    schemaVersion: 4,
    name: tag + ' ' + name,
    nodes: [node('start', 'trigger', trigger), node('done', 'exit', exit)],
    edges: [edge('e1', 'start', 'done')],
  };
}
export async function create(def) {
  const r = await post('/loops', { definition: def });
  status(r, 201);
  return r.data;
}
export async function publish(id) {
  const r = await post(`/loops/${id}/publish`);
  status(r, 200);
  return r.data;
}
export async function save(id, def) {
  const d = await get(`/loops/${id}`);
  status(d, 200);
  const r = await req(
    'PUT',
    `/loops/${id}/draft`,
    { definition: def },
    { headers: { 'If-Match': d.data.draftToken } },
  );
  status(r, 200);
  return r.data;
}
export async function ready(def) {
  const c = await create(def);
  await publish(c.loop.id);
  return c.loop.id;
}
export async function start(id, input = {}) {
  const r = await post(`/loops/${id}/runs`, { triggerNodeId: 'start', input });
  status(r, 202);
  return r.data.run.id;
}
export async function waitRun(id, wanted, ms = 15000) {
  const end = Date.now() + ms;
  let r;
  do {
    r = await get(`/runs/${id}`);
    status(r, 200);
    if (
      wanted
        ? r.data.status === wanted
        : ['succeeded', 'failed', 'exhausted', 'cancelled'].includes(r.data.status)
    )
      return r.data;
    await sleep(100);
  } while (Date.now() < end);
  throw new Error(`run ${id} deadline: ${JSON.stringify(r.data)}`);
}
export async function run(def, input = {}) {
  const loopId = await ready(def);
  const runId = await start(loopId, input);
  return { loopId, runId, snapshot: await waitRun(runId) };
}
export async function runs(id) {
  const r = await get(`/runs?loopId=${id}&limit=500`);
  status(r, 200);
  return r.data.items;
}
export async function waitCount(id, n, ms = 12000) {
  let items;
  const until = Date.now() + ms;
  do {
    items = await runs(id);
    if (items.length >= n) return items;
    await sleep(100);
  } while (Date.now() < until);
  throw new Error(`expected ${n} runs; got ${items.length}`);
}
export async function endpoint(id) {
  const r = await get(`/loops/${id}/triggers`);
  status(r, 200);
  const hooks = r.data.webhooks ?? r.data.webhookEndpoints;
  assert(hooks, JSON.stringify(r.data));
  const ep = hooks.find((x) => x.enabled);
  assert(ep, JSON.stringify(r.data));
  return ep;
}
export async function events() {
  const r = await get('/events?limit=200');
  status(r, 200);
  return r.data.items;
}
