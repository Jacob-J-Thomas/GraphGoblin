// Seed the isolated review instance through its public HTTP API only.
const base = process.argv[2] ?? 'http://127.0.0.1:5631';
const def = (name) => ({
  schemaVersion: Number(process.argv[3] ?? 0) || undefined,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ],
  edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
});
async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (r.status >= 400) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}
const format = (await call('GET', '/version')) ?? {};
console.log('version', JSON.stringify(format));
async function loop(name) {
  const created = await call('POST', '/loops', { definition: { ...def(name), schemaVersion: Number(process.env.FORMAT) } });
  const id = created.loop.id;
  await call('POST', `/loops/${id}/publish`, {});
  return id;
}
const old = await loop('older history');
const oldRun = (await call('POST', `/loops/${old}/runs`, {})).run.id;
await loop('no history');
await new Promise((r) => setTimeout(r, 20));
const paging = await loop('paging runs');
for (let i = 0; i < 105; i++) await call('POST', `/loops/${paging}/runs`, {});
const busy = await loop('busy history');
for (let i = 0; i < 501; i++) await call('POST', `/loops/${busy}/runs`, {});
for (let i = 0; i < 105; i++) await call('POST', '/events', { type: 'paging-events', payload: { index: i } });
await call('POST', '/events', { type: 'unrelated-event' });
console.log(JSON.stringify({ old, oldRun, paging, busy }));
