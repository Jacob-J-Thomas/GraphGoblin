// Seed a fresh isolated instance through its public API. Minimal trigger/exit loops use no provider.

const [apiUrl, key] = process.argv.slice(2);
if (!apiUrl) throw new Error('Usage: node seed-visual.mjs <API URL> [API key]');
const base = new URL(apiUrl);
if (base.pathname !== '/' || base.search || base.hash) throw new Error('Use an API origin URL.');
const headers = { ...(key ? { authorization: `Bearer ${key}` } : {}) };
async function call(method, path, body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
const schema = await call('GET', '/openapi.json');
const currentFormat = schema.components.schemas.LoopDefinitionInput.properties.schemaVersion.const;
if (!Number.isInteger(currentFormat))
  throw new Error('The API did not advertise a current definition format.');
const existing = await call('GET', '/loops');
if (existing.items.length) throw new Error('Seed a fresh disposable store with no loops.');
async function loop(name) {
  const created = await call('POST', '/loops', {
    definition: {
      schemaVersion: currentFormat,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
  });
  await call('POST', `/loops/${created.loop.id}/publish`, {});
  return created.loop.id;
}
const old = await loop('older history');
const oldRun = (await call('POST', `/loops/${old}/runs`, {})).run.id;
const empty = await loop('no history');
const paging = await loop('paging runs');
for (let i = 0; i < 105; i++) await call('POST', `/loops/${paging}/runs`, {});
const busy = await loop('busy history');
for (let i = 0; i < 501; i++) await call('POST', `/loops/${busy}/runs`, {});
for (let i = 0; i < 105; i++)
  await call('POST', '/events', {
    type: 'paging-events',
    payload: {
      index: i,
      ...(i === 5
        ? { text: 'Long payload remains visible while older events append.\n'.repeat(40) }
        : {}),
    },
  });
// Admission is asynchronous. Poll the public summary until the last simple exits have completed.
for (let attempt = 0; ; attempt++) {
  const { items } = await call('GET', '/loops');
  if (
    [old, paging, busy].every(
      (id) => items.find((item) => item.id === id)?.latestRun?.status === 'succeeded',
    )
  )
    break;
  if (attempt >= 100) throw new Error('Seeded runs did not finish; inspect the isolated app.');
  await new Promise((resolve) => setTimeout(resolve, 100));
}
console.log(
  JSON.stringify(
    {
      old,
      oldRun,
      empty,
      paging,
      busy,
      loopsUrl: new URL('/app/loops', base).href,
      runsUrl: new URL(`/app/runs?loop=${paging}`, base).href,
      eventsUrl: new URL('/app/events', base).href,
      runCounts: [1, 0, 105, 501],
      inboundEvents: 105,
    },
    null,
    2,
  ),
);
