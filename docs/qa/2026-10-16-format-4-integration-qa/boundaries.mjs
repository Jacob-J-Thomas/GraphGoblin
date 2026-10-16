import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  root,
  req,
  get,
  post,
  status,
  test,
  minimal,
  node,
  edge,
  ready,
  start,
  run,
  waitRun,
  waitCount,
  runs,
  save,
  publish,
  endpoint,
  events,
  sleep,
  tag,
} from './common.mjs';
const S = 'Webhooks',
  G = 'Gates and exits';
async function hook(name, config) {
  const def = minimal(name, { type: 'webhook', ...config });
  const id = await ready(def);
  return { id, def, ep: await endpoint(id) };
}
for (const [name, config, body, want] of [
  [
    'escaped-array-pointer',
    { eventType: { source: 'json-pointer', pointer: '/a~1b/~0key/0', fallback: 'fallback' } },
    { 'a/b': { '~key': ['escaped-event'] } },
    'escaped-event',
  ],
  [
    'root-scalar-pointer',
    { eventType: { source: 'json-pointer', pointer: '', fallback: 'fallback' } },
    true,
    'true',
  ],
  [
    'own-property-pointer',
    { eventType: { source: 'json-pointer', pointer: '/toString', fallback: 'fallback' } },
    {},
    'fallback',
  ],
])
  await test(S, 'W-boundary-' + name, name, '202; eventType=' + want, async () => {
    const h = await hook(name, config);
    const r = await post(h.ep.path, JSON.stringify(body));
    status(r, 202);
    const rr = await waitCount(h.id, 1);
    const t = await get(`/runs/${rr[0].id}/thread`);
    assert.equal(t.data.invocation.trigger.eventType, want);
    return { ack: r.data, trigger: t.data.invocation.trigger };
  });
await test(
  S,
  'W-key-undefined',
  'undefined expression key',
  '422 KEY_INVALID with no stored receipt or run',
  async () => {
    const h = await hook('undefined key', { dedupeKey: 'missing' });
    const r = await post(h.ep.path, {});
    status(r, 422, 'KEY_INVALID');
    assert.equal((await runs(h.id)).length, 0);
    assert(!(await events()).some((e) => e.webhook?.loopId === h.id));
    return r.data;
  },
);
await test(
  S,
  'W-key-whitespace',
  'whitespace keys remain literal',
  'space and two-space create distinct runs; repeated space deduplicates',
  async () => {
    const h = await hook('literal whitespace', { dedupeKey: 'key' });
    for (const key of [' ', '  ', ' ']) status(await post(h.ep.path, { key }), 202);
    const rr = await waitCount(h.id, 2);
    await sleep(150);
    assert.equal((await runs(h.id)).length, 2);
    const keys = [];
    for (const r of rr) {
      const t = await get(`/runs/${r.id}/thread`);
      keys.push(t.data.invocation.trigger.dedupeKey);
    }
    assert.deepEqual(keys.sort(), [' ', '  ']);
    return { runCount: 2, keys };
  },
);
await test(
  S,
  'W-key-non-string',
  'object key uses JSON representation',
  '202, then deduplicated repeat; stored exact JSON key',
  async () => {
    const h = await hook('object key', { dedupeKey: 'key' });
    const body = { key: { business: 7 } };
    status(await post(h.ep.path, body), 202);
    status(await post(h.ep.path, body), 202);
    const rr = await waitCount(h.id, 1);
    await sleep(150);
    assert.equal((await runs(h.id)).length, 1);
    const t = await get(`/runs/${rr[0].id}/thread`);
    assert.equal(t.data.invocation.trigger.dedupeKey, '{"business":7}');
    return { count: 1, key: t.data.invocation.trigger.dedupeKey };
  },
);
await test(
  S,
  'W-key-expression-error',
  'key expression evaluation failure',
  '422 EXPRESSION_FAILED with no receipt/run',
  async () => {
    const h = await hook('expression failed', { dedupeKey: '$error("qa deliberate key failure")' });
    const r = await post(h.ep.path, {});
    status(r, 422, 'EXPRESSION_FAILED');
    assert.equal((await runs(h.id)).length, 0);
    return r.data;
  },
);
await test(
  S,
  'W-auth-before-json',
  'missing signing secret refuses intake before decoding',
  '503 HOOK_NOT_READY for malformed body when configured secret is absent',
  async () => {
    const h = await hook('auth first', {
      authentication: { type: 'hmac-sha256', message: 'body', secretRef: 'qa-missing-secret' },
    });
    const r = await post(h.ep.path, '{');
    status(r, 503, 'HOOK_NOT_READY');
    return r.data;
  },
);
for (const [name, config] of [
  [
    'bad-header',
    {
      authentication: {
        type: 'hmac-sha256',
        message: 'body',
        header: 'Bad Header',
        secretRef: 'qa-unused',
      },
    },
  ],
  [
    'zero-window',
    {
      authentication: {
        type: 'hmac-sha256',
        message: 'timestamp-body',
        secretRef: 'qa-unused',
        windowSeconds: 0,
      },
    },
  ],
  [
    'bad-pointer',
    { eventType: { source: 'json-pointer', pointer: '/bad~2escape', fallback: 'fallback' } },
  ],
  ['control-constant', { eventType: { source: 'constant', value: 'bad\nname' } }],
])
  await test(S, 'W-config-' + name, 'reject ' + name, '400 VALIDATION_FAILED', async () => {
    const r = await post('/loops', { definition: minimal(name, { type: 'webhook', ...config }) });
    status(r, 400, 'VALIDATION_FAILED');
    return r.data;
  });
await test(
  G,
  'G-output-shape',
  'expression output uses current evidence shape',
  'thread decision output has exactly portId/provenance/observation; route confidence/reasoning null',
  async () => {
    const d = minimal('decision output');
    d.nodes.splice(
      1,
      0,
      node('decide', 'decision', {
        kind: 'expression',
        jsonata: '"yes"',
        routes: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      }),
    );
    d.edges = [
      edge('e1', 'start', 'decide'),
      edge('e2', 'decide', 'done', 'yes'),
      edge('e3', 'decide', 'done', 'no'),
    ];
    const x = await run(d);
    assert.equal(x.snapshot.status, 'succeeded');
    const t = await get(`/runs/${x.runId}/thread`);
    const value = t.data.outputs.decide.value;
    assert.deepEqual(Object.keys(value).sort(), ['observation', 'portId', 'provenance']);
    assert.deepEqual(value.observation, {
      kind: 'route',
      routeId: 'yes',
      confidence: null,
      reasoning: null,
    });
    return { status: x.snapshot.status, output: value };
  },
);
await test(
  G,
  'G-wait-time',
  'gate time includes a parked duration wait',
  'after two-second wait, repeat blocked by one-second run-time limit at pass 1',
  async () => {
    const d = minimal('gate after wait');
    d.nodes = [
      d.nodes[0],
      node('wait', 'wait', { mode: 'duration', seconds: 2 }),
      node('gate', 'decision', {
        kind: 'expression',
        jsonata: '"again"',
        routes: [
          { id: 'again', label: 'Again', repeat: true },
          { id: 'done', label: 'Done' },
        ],
        maxPasses: 8,
        maxRunTimeSeconds: 1,
      }),
      node('finish', 'exit', { outcome: 'success', returns: 'none', destinations: [] }),
      node('exhausted', 'exit', {
        outcome: 'exhausted',
        returns: 'gates.gate.passes',
        destinations: [{ kind: 'caller' }],
      }),
    ];
    d.edges = [
      edge('e1', 'start', 'wait'),
      edge('e2', 'wait', 'gate'),
      edge('e3', 'gate', 'wait', 'again'),
      edge('e4', 'gate', 'finish', 'done'),
      edge('e5', 'gate', 'exhausted', 'limit-reached'),
    ];
    const x = await run(d);
    assert.equal(x.snapshot.status, 'exhausted');
    assert.equal(x.snapshot.result, 1);
    const ev = await get(`/runs/${x.runId}/events`);
    assert(ev.data.items.some((e) => e.type === 'run.waiting'));
    const decision = ev.data.items.find((e) => e.type === 'decision.made');
    assert.equal(decision.gate.limit, 'max-run-time');
    const resume = await post(`/runs/${x.runId}/resume`);
    status(resume, 409, 'INVALID_STATE');
    const list = await get(`/runs?loopId=${x.loopId}&status=exhausted`);
    status(list, 200);
    assert.equal(list.data.items.length, 1);
    return { status: x.snapshot.status, result: x.snapshot.result, decision, resume: resume.data };
  },
);
// Cancel only active runs whose loop IDs were created by recorded requests in this QA session.
const log = fs
  .readFileSync(path.join(root, 'http.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
const owned = new Set(
  log
    .filter(
      (x) =>
        x.request.method === 'POST' &&
        ['http://127.0.0.1:4796/loops', 'http://127.0.0.1:4796/loops/import'].includes(
          x.request.url,
        ) &&
        x.response.status === 201,
    )
    .map((x) => x.response.body.loop.id),
);
const active = await get('/runs?status=queued,running,waiting,paused&limit=500');
status(active, 200);
const cleanup = [];
for (const r of active.data.items)
  if (owned.has(r.loopId)) {
    const c = await post(`/runs/${r.id}/cancel`);
    status(c, 200);
    await waitRun(r.id, 'cancelled');
    cleanup.push(r.id);
  }
fs.writeFileSync(
  path.join(root, 'cleanup.json'),
  JSON.stringify(
    {
      cancelledRunIds: cleanup,
      scope: 'Only recorded QA-created loop IDs; no broad resource cleanup',
    },
    null,
    2,
  ),
);
