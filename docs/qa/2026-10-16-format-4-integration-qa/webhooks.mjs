import { randomBytes, createHmac } from 'node:crypto';
import {
  assert,
  clone,
  req,
  get,
  post,
  status,
  test,
  minimal,
  ready,
  save,
  publish,
  endpoint,
  events,
  runs,
  waitCount,
  waitRun,
  sleep,
  tag,
} from './common.mjs';
const S = 'Webhooks',
  secret = randomBytes(32).toString('hex'),
  secretRef = tag + '-hmac';
const secretResult = await req('PUT', '/secrets/' + secretRef, { value: secret }, { secret: true });
status(secretResult, 200);
const raw = Buffer.from('{ "message": "café 🌳", "n": 7 }\n', 'utf8');
const auth = {
  none: { type: 'none' },
  body: { type: 'hmac-sha256', message: 'body', header: 'x-hub-signature-256', secretRef },
  timestamp: {
    type: 'hmac-sha256',
    message: 'timestamp-body',
    header: 'x-graphgoblin-signature',
    secretRef,
    windowSeconds: 30,
  },
};
function signed(kind, body, ts = String(Math.floor(Date.now() / 1000))) {
  if (kind === 'none') return {};
  const bytes = kind === 'body' ? body : Buffer.concat([Buffer.from(ts + '.'), body]);
  const sig = 'sha256=' + createHmac('sha256', secret).update(bytes).digest('hex');
  return kind === 'body'
    ? { 'x-hub-signature-256': sig }
    : { 'x-graphgoblin-timestamp': ts, 'x-graphgoblin-signature': sig };
}
async function hook(name, config = {}) {
  const def = minimal(name, { type: 'webhook', authentication: auth.none, ...config });
  const id = await ready(def);
  return { id, def, ep: await endpoint(id) };
}
const hs = {};
for (const kind of Object.keys(auth))
  hs[kind] = await hook(kind, {
    authentication: auth[kind],
    eventType: { source: 'constant', value: 'qa-' + kind },
  });
async function delivery(h, bytes, headers = {}, code = 202, errorCode) {
  const r = await post(h.ep.path, bytes, {
    headers,
    contentType: 'application/octet-stream',
    note: 'HMACs computed with Node crypto over the exact wireFile bytes; secret exists only in process memory/API secret store.',
  });
  status(r, code, errorCode);
  if (code === 202) assert.deepEqual(r.data, { accepted: true });
  return r;
}
async function inspectNew(h, before, payload, eventType) {
  const items = await waitCount(h.id, before + 1);
  assert.equal(items.length, before + 1);
  const r = items[0];
  await waitRun(r.id);
  const t = await get(`/runs/${r.id}/thread`);
  status(t, 200);
  assert.deepEqual(t.data.invocation.trigger.payload, payload);
  if (eventType) assert.equal(t.data.invocation.trigger.eventType, eventType);
  const e = await get(`/runs/${r.id}/events`);
  status(e, 200);
  return { runId: r.id, trigger: t.data.invocation.trigger, first: e.data.items[0] };
}
for (const kind of Object.keys(auth))
  await test(
    S,
    'W-auth-' + kind,
    kind + ' authentication uses exact UTF-8 bytes',
    '202 exactly {accepted:true}; async run payload preserved and invocation eventType set',
    async () => {
      const h = hs[kind],
        before = (await runs(h.id)).length,
        r = await delivery(h, raw, signed(kind, raw));
      const result = await inspectNew(h, before, JSON.parse(raw), 'qa-' + kind);
      assert.equal(result.first.type, 'run.queued');
      assert.equal(result.first.initialThread.invocation.trigger.eventType, 'qa-' + kind);
      return { ack: r.data, ...result };
    },
  );
for (const kind of ['body', 'timestamp'])
  for (const mode of ['wrong', 'missing', 'duplicate', 'tampered-bytes'])
    await test(
      S,
      `W-signature-${kind}-${mode}`,
      `${kind}: ${mode} signature`,
      '401 SIGNATURE_INVALID; no new run',
      async () => {
        const h = hs[kind],
          before = (await runs(h.id)).length;
        let headers = signed(kind, raw),
          bytes = raw;
        const header = auth[kind].header;
        if (mode === 'wrong') headers[header] = 'sha256=' + '0'.repeat(64);
        if (mode === 'missing') delete headers[header];
        if (mode === 'duplicate')
          headers = [...Object.entries(headers).flat(), header.toUpperCase(), headers[header]];
        if (mode === 'tampered-bytes') bytes = Buffer.from(raw.toString().replace('7', '8'));
        const r = await delivery(h, bytes, headers, 401, 'SIGNATURE_INVALID');
        assert.equal((await runs(h.id)).length, before);
        return r.data;
      },
    );
for (const [name, delta] of [
  ['stale', -120],
  ['future', 120],
])
  await test(
    S,
    'W-timestamp-' + name,
    name + ' timestamp with valid HMAC',
    '401 TIMESTAMP_OUT_OF_WINDOW',
    async () => {
      const ts = String(Math.floor(Date.now() / 1000) + delta);
      return (
        await delivery(
          hs.timestamp,
          raw,
          signed('timestamp', raw, ts),
          401,
          'TIMESTAMP_OUT_OF_WINDOW',
        )
      ).data;
    },
  );
for (const mode of ['missing', 'duplicate', 'invalid'])
  await test(
    S,
    'W-timestamp-' + mode,
    mode + ' timestamp header',
    '401 TIMESTAMP_MISSING',
    async () => {
      let headers = signed('timestamp', raw);
      if (mode === 'missing') delete headers['x-graphgoblin-timestamp'];
      if (mode === 'invalid') headers['x-graphgoblin-timestamp'] = 'not-a-date';
      if (mode === 'duplicate')
        headers = [
          ...Object.entries(headers).flat(),
          'X-Graphgoblin-Timestamp',
          headers['x-graphgoblin-timestamp'],
        ];
      return (await delivery(hs.timestamp, raw, headers, 401, 'TIMESTAMP_MISSING')).data;
    },
  );
await test(S, 'W-timestamp-iso', 'ISO timestamp authentication', '202 and one run', async () => {
  const h = hs.timestamp,
    before = (await runs(h.id)).length;
  const r = await delivery(h, raw, signed('timestamp', raw, new Date().toISOString()));
  await waitCount(h.id, before + 1);
  return { status: r.status, body: r.data };
});
for (const [name, body] of [
  ['empty', Buffer.alloc(0)],
  ['whitespace', Buffer.from(' \r\n\t')],
  ['invalid-json', Buffer.from('{')],
  ['invalid-utf8', Buffer.from([0xc3, 0x28])],
])
  await test(
    S,
    'W-json-' + name,
    'JSON ' + name,
    '400 BODY_INVALID',
    async () => (await delivery(hs.none, body, {}, 400, 'BODY_INVALID')).data,
  );
await test(S, 'W-json-null', 'literal JSON null', '202; null payload retained', async () => {
  const h = hs.none,
    before = (await runs(h.id)).length;
  await delivery(h, Buffer.from('null'));
  return inspectNew(h, before, null, 'qa-none');
});
for (const [kind, bodyType, payload, bytes] of [
  ['text', 'text', 'line 1\n café', Buffer.from('line 1\n café')],
  ['text-empty', 'text', '', Buffer.alloc(0)],
  [
    'bytes',
    'bytes',
    { encoding: 'base64', data: Buffer.from([0, 255, 0xc3, 0x28, 10]).toString('base64') },
    Buffer.from([0, 255, 0xc3, 0x28, 10]),
  ],
])
  await test(
    S,
    'W-mode-' + kind,
    kind + ' body mode',
    '202; decoded payload equals expected representation',
    async () => {
      const h = await hook(kind, { body: { type: bodyType } });
      await delivery(h, bytes);
      return inspectNew(h, 0, payload, 'webhook');
    },
  );
await test(
  S,
  'W-text-invalid-utf8',
  'text mode refuses invalid UTF-8',
  '400 BODY_INVALID',
  async () => {
    const h = await hook('text invalid', { body: { type: 'text' } });
    return (await delivery(h, Buffer.from([0xc3, 0x28]), {}, 400, 'BODY_INVALID')).data;
  },
);
await test(S, 'W-over-limit', '1 MiB + 1 raw bytes', '413 BODY_TOO_LARGE; no run', async () => {
  const h = await hook('over limit', { body: { type: 'bytes' } });
  const r = await delivery(h, Buffer.alloc(1024 * 1024 + 1, 65), {}, 413, 'BODY_TOO_LARGE');
  assert.equal((await runs(h.id)).length, 0);
  return r.data;
});
const headerHook = await hook('event header', {
  eventType: { source: 'header', name: 'x-qa-event', fallback: 'qa-fallback' },
});
for (const [name, headers, expected] of [
  ['selected', { 'x-qa-event': 'issue-opened' }, 'issue-opened'],
  ['absent', {}, 'qa-fallback'],
  ['blank', { 'x-qa-event': '   ' }, 'qa-fallback'],
  ['comma', { 'x-qa-event': 'one,two' }, 'one,two'],
])
  await test(
    S,
    'W-event-header-' + name,
    'header event ' + name,
    '202; invocation.trigger.eventType=' + expected,
    async () => {
      const before = (await runs(headerHook.id)).length;
      await delivery(headerHook, raw, headers);
      return inspectNew(headerHook, before, JSON.parse(raw), expected);
    },
  );
for (const [name, headers, code, error] of [
  ['ambiguous', ['x-qa-event', 'one', 'X-QA-Event', 'two'], 400, 'EVENT_TYPE_AMBIGUOUS'],
  ['control', { 'x-qa-event': 'one\ttwo' }, 422, 'EVENT_TYPE_INVALID'],
  ['overlong', { 'x-qa-event': 'x'.repeat(129) }, 422, 'EVENT_TYPE_INVALID'],
])
  await test(
    S,
    'W-event-header-' + name,
    'header event ' + name,
    code + ' ' + error,
    async () => (await delivery(headerHook, raw, headers, code, error)).data,
  );
const pointerHook = await hook('event pointer', {
  eventType: { source: 'json-pointer', pointer: '/meta/type', fallback: 'qa-pointer-fallback' },
});
for (const [name, payload, expected] of [
  ['selected', { meta: { type: 'issue-ready' } }, 'issue-ready'],
  ['missing', {}, 'qa-pointer-fallback'],
  ['object', { meta: { type: { x: 1 } } }, 'qa-pointer-fallback'],
  ['null', { meta: { type: null } }, 'qa-pointer-fallback'],
  ['number', { meta: { type: 42 } }, '42'],
  ['blank', { meta: { type: '' } }, 'qa-pointer-fallback'],
])
  await test(
    S,
    'W-event-pointer-' + name,
    'pointer event ' + name,
    '202; eventType=' + expected,
    async () => {
      const before = (await runs(pointerHook.id)).length;
      await delivery(pointerHook, Buffer.from(JSON.stringify(payload)));
      return inspectNew(pointerHook, before, payload, expected);
    },
  );
for (const [name, value] of [
  ['control', 'a\u0001b'],
  ['blank-control', '\t'],
  ['overlong', 'x'.repeat(129)],
])
  await test(
    S,
    'W-event-pointer-' + name,
    'pointer event ' + name,
    '422 EVENT_TYPE_INVALID',
    async () =>
      (
        await delivery(
          pointerHook,
          Buffer.from(JSON.stringify({ meta: { type: value } })),
          {},
          422,
          'EVENT_TYPE_INVALID',
        )
      ).data,
  );
for (const kind of Object.keys(auth))
  await test(
    S,
    'W-Allow-' + kind,
    kind + ' identical unkeyed delivery Allow',
    'two 202 acknowledgements; two distinct runs',
    async () => {
      const h = hs[kind],
        before = (await runs(h.id)).length,
        headers = signed(kind, raw);
      const a = await delivery(h, raw, headers),
        b = await delivery(h, raw, headers);
      const items = await waitCount(h.id, before + 2);
      assert.equal(items.length, before + 2);
      assert.notEqual(items[0].id, items[1].id);
      return { acknowledgements: [a.data, b.data], runIds: items.slice(0, 2).map((r) => r.id) };
    },
  );
const keyed = {};
for (const kind of Object.keys(auth))
  keyed[kind] = await hook('key ' + kind, { authentication: auth[kind], dedupeKey: 'key' });
for (const kind of Object.keys(auth))
  for (const [name, key, expected] of [
    ['empty', '', 422],
    ['null', null, 422],
    ['513', 'k'.repeat(513), 422],
    ['512', 'k'.repeat(512), 202],
  ])
    await test(
      S,
      `W-key-${kind}-${name}`,
      `${kind} explicit ${name} key`,
      expected === 422
        ? '422 KEY_INVALID; no receipt or run'
        : '202; one run with exact 512-character key',
      async () => {
        const h = keyed[kind],
          body = Buffer.from(JSON.stringify({ key })),
          before = (await runs(h.id)).length,
          evBefore = (await events()).filter((e) => e.webhook?.loopId === h.id).length;
        const r = await delivery(
          h,
          body,
          signed(kind, body),
          expected,
          expected === 422 ? 'KEY_INVALID' : undefined,
        );
        if (expected === 202) {
          const items = await waitCount(h.id, before + 1);
          const t = await get(`/runs/${items[0].id}/thread`);
          assert.equal(t.data.invocation.trigger.dedupeKey, key);
        } else {
          assert.equal((await runs(h.id)).length, before);
          assert.equal((await events()).filter((e) => e.webhook?.loopId === h.id).length, evBefore);
        }
        return {
          status: r.status,
          body: r.data,
          keyLength: typeof key === 'string' ? key.length : null,
        };
      },
    );
for (const kind of Object.keys(auth))
  await test(
    S,
    'W-key-repeat-' + kind,
    kind + ' explicit key repeat',
    'both 202; one new run; admitted and deduplicated private receipts',
    async () => {
      const h = keyed[kind],
        before = (await runs(h.id)).length,
        body = Buffer.from(JSON.stringify({ key: 'permanent-business-key' })),
        headers = signed(kind, body);
      await delivery(h, body, headers);
      await delivery(h, body, headers);
      await waitCount(h.id, before + 1);
      await sleep(200);
      assert.equal((await runs(h.id)).length, before + 1);
      const es = (await events()).filter(
        (e) => e.webhook?.loopId === h.id && e.dedupeKey === 'permanent-business-key',
      );
      assert(es.some((e) => e.delivery.state === 'admitted'));
      assert(es.some((e) => e.delivery.state === 'deduplicated'));
      return es.map((e) => ({ id: e.id, delivery: e.delivery, runIds: e.runIds }));
    },
  );
await test(
  S,
  'W-key-permanent',
  'explicit key survives version and authentication recipe change',
  'stable endpoint token; new version body HMAC repeat 202 deduplicated; no new run',
  async () => {
    const h = keyed.none,
      before = (await runs(h.id)).length,
      oldVersion = h.ep.versionId,
      oldPath = h.ep.path;
    h.def.nodes[0].config.authentication = auth.body;
    h.def.description = 'New version changes auth recipe';
    await save(h.id, h.def);
    await publish(h.id);
    h.ep = await endpoint(h.id);
    assert.equal(h.ep.path, oldPath);
    assert.notEqual(h.ep.versionId, oldVersion);
    const body = Buffer.from(JSON.stringify({ key: 'permanent-business-key' }));
    const r = await delivery(h, body, signed('body', body));
    await sleep(300);
    assert.equal((await runs(h.id)).length, before);
    const es = (await events()).filter((e) => e.webhook?.loopId === h.id);
    assert.equal(es[0].delivery.state, 'deduplicated');
    return {
      ack: r.data,
      oldVersion,
      newVersion: h.ep.versionId,
      runs: before,
      latestReceipt: es[0].delivery,
    };
  },
);
await test(
  S,
  'W-key-concurrent',
  'concurrent keyed repeats',
  'five 202 acknowledgements; one run, four deduplicated receipts',
  async () => {
    const h = keyed.body,
      before = (await runs(h.id)).length,
      body = Buffer.from(JSON.stringify({ key: 'concurrent-key' })),
      headers = signed('body', body);
    const a = await Promise.all(Array.from({ length: 5 }, () => delivery(h, body, headers)));
    await waitCount(h.id, before + 1);
    await sleep(300);
    assert.equal((await runs(h.id)).length, before + 1);
    const es = (await events()).filter(
      (e) => e.webhook?.loopId === h.id && e.dedupeKey === 'concurrent-key',
    );
    assert.equal(es.filter((e) => e.delivery.state === 'deduplicated').length, 4);
    return { acks: a.map((r) => r.status), receipts: es.map((e) => e.delivery.state) };
  },
);
await test(
  S,
  'W-safe-config',
  'private Events and endpoint summaries expose safe pinned config',
  'authentication recipe/name only, body/eventType/dedupeKey/configurationAvailable; admitted and deduplicated states with safe counters/run links',
  async () => {
    const h = keyed.body,
      ep = await endpoint(h.id),
      es = (await events()).filter((e) => e.webhook?.loopId === h.id);
    assert.equal(ep.authentication.secretRef, secretRef);
    assert.equal(ep.configurationAvailable, true);
    assert.equal(ep.body.type, 'json');
    assert.equal(ep.eventType.source, 'constant');
    assert.equal(ep.dedupeKey, 'key');
    assert(es.length);
    assert(es.every((e) => Number.isInteger(e.delivery.attempts)));
    assert(es.every((e) => e.webhook.authentication.secretRef === secretRef));
    assert(!JSON.stringify({ ep, es }).includes(secret));
    assert(!JSON.stringify({ ep, es }).includes('intent'));
    return { endpoint: ep, states: [...new Set(es.map((e) => e.delivery.state))], example: es[0] };
  },
);
await test(
  S,
  'W-disabled',
  'republishing without webhook disables old endpoint',
  'old endpoint listed disabled; POST returns 404 HOOK_NOT_FOUND',
  async () => {
    const h = await hook('disable');
    const old = h.ep.path;
    h.def.nodes[0].config = { type: 'manual' };
    await save(h.id, h.def);
    await publish(h.id);
    const listing = await get(`/loops/${h.id}/triggers`);
    assert(listing.data.webhooks.some((e) => e.path === old && e.enabled === false));
    const r = await post(old, raw);
    status(r, 404, 'HOOK_NOT_FOUND');
    return { listing: listing.data, response: r.data };
  },
);
await test(S, 'W-unknown', 'unknown hook token', '404 HOOK_NOT_FOUND', async () => {
  const r = await post('/hooks/' + tag + '-does-not-exist', raw);
  status(r, 404, 'HOOK_NOT_FOUND');
  return r.data;
});
