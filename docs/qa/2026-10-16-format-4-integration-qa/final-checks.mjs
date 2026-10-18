import { randomBytes, createHmac } from 'node:crypto';
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
  ready,
  start,
  run,
  waitRun,
  runs,
  save,
  publish,
  endpoint,
  waitCount,
  tag,
} from './common.mjs';
await test(
  'Instance and method',
  'ENV-instance',
  'QA instance responds on the designated port',
  'health 200; version 200; OpenAPI and docs 200',
  async () => {
    const health = await get('/healthz');
    status(health, 200);
    assert.equal(health.data.status, 'ok');
    const version = await get('/version');
    status(version, 200);
    const api = await get('/openapi.json');
    status(api, 200);
    assert(api.data.paths['/loops']);
    const docs = await get('/docs');
    assert([200, 301, 302].includes(docs.status));
    return {
      health: health.data,
      version: version.data,
      openapiStatus: api.status,
      docsStatus: docs.status,
    };
  },
);
const value = randomBytes(32).toString('hex'),
  secretRef = tag + '-final-secret';
status(await req('PUT', '/secrets/' + secretRef, { value }, { secret: true }), 200);
await test(
  'Webhooks',
  'W-auth-before-json',
  'authentication precedes JSON decoding with configured secret',
  '401 SIGNATURE_INVALID for unsigned malformed JSON; correctly signed malformed JSON gives 400 BODY_INVALID',
  async () => {
    const id = await ready(
        minimal('authenticate before decode', {
          type: 'webhook',
          authentication: { type: 'hmac-sha256', message: 'body', secretRef },
        }),
      ),
      ep = await endpoint(id),
      body = Buffer.from('{');
    const a = await post(ep.path, body);
    status(a, 401, 'SIGNATURE_INVALID');
    const sig = 'sha256=' + createHmac('sha256', value).update(body).digest('hex');
    const b = await post(ep.path, body, { headers: { 'x-hub-signature-256': sig } });
    status(b, 400, 'BODY_INVALID');
    assert.equal((await runs(id)).length, 0);
    return { unsigned: a.data, signed: b.data };
  },
);
for (const message of ['body', 'timestamp-body'])
  await test(
    'Webhooks',
    'W-binary-hmac-' + message,
    'arbitrary binary bytes with ' + message + ' HMAC',
    '202 and exact base64 payload for non-UTF-8 bytes',
    async () => {
      const id = await ready(
          minimal('binary signature ' + message, {
            type: 'webhook',
            authentication: {
              type: 'hmac-sha256',
              message,
              secretRef,
              ...(message === 'timestamp-body' ? { windowSeconds: 30 } : {}),
            },
            body: { type: 'bytes' },
          }),
        ),
        ep = await endpoint(id),
        body = Buffer.from([0, 255, 128, 254, 10]);
      const ts = String(Math.floor(Date.now() / 1000)),
        bytes = message === 'body' ? body : Buffer.concat([Buffer.from(ts + '.'), body]),
        sig = 'sha256=' + createHmac('sha256', value).update(bytes).digest('hex');
      const headers =
        message === 'body'
          ? { 'x-hub-signature-256': sig }
          : { 'x-graphgoblin-signature': sig, 'x-graphgoblin-timestamp': ts };
      const r = await post(ep.path, body, { headers, contentType: 'application/octet-stream' });
      status(r, 202);
      assert.deepEqual(r.data, { accepted: true });
      const rr = await waitCount(id, 1);
      const sn = await waitRun(rr[0].id);
      assert.equal(sn.status, 'succeeded');
      const t = await get(`/runs/${rr[0].id}/thread`);
      assert.deepEqual(t.data.invocation.trigger.payload, {
        encoding: 'base64',
        data: body.toString('base64'),
      });
      return { ack: r.data, payload: t.data.invocation.trigger.payload };
    },
  );
await test(
  'Webhooks',
  'W-secret-not-ready',
  'missing signing secret',
  '503 HOOK_NOT_READY without creating run',
  async () => {
    const id = await ready(
        minimal('missing secret', {
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: 'body',
            secretRef: 'qa-final-absent-secret',
          },
        }),
      ),
      ep = await endpoint(id);
    const r = await post(ep.path, '{');
    status(r, 503, 'HOOK_NOT_READY');
    assert.equal((await runs(id)).length, 0);
    return r.data;
  },
);
await test(
  'Templates',
  'T-ordinary-runtime',
  'copied template supports ordinary save/publish/run',
  '201 copy; save replacement graph; publish 200; manual API run succeeds without harness',
  async () => {
    const c = await post('/templates/starter/draft', { name: tag + ' ordinary copy' });
    status(c, 201);
    const id = c.data.loop.id;
    const def = minimal('ordinary replacement');
    await save(id, def);
    await publish(id);
    const rid = await start(id, { templateCopy: true });
    const sn = await waitRun(rid);
    assert.equal(sn.status, 'succeeded');
    assert.deepEqual(sn.result, { templateCopy: true });
    return { loopId: id, runId: rid, status: sn.status, result: sn.result };
  },
);
await test(
  'Instance and method',
  'ENV-no-active-runs',
  'QA leaves no active runs',
  'GET active runs returns empty list; QA pollers were disarmed',
  async () => {
    const r = await get('/runs?status=queued,running,waiting,paused&limit=500');
    status(r, 200);
    assert.equal(r.data.items.length, 0);
    return r.data;
  },
);
const notTestable = [
  [
    'NT-browser-decisions',
    'Browser decision editor: kind changes, graph/edge edits, held text, undo and inspector rendering',
    'API-only assignment; needs actual browser interaction.',
  ],
  [
    'NT-browser-github',
    'T2 GitHub preset preview/apply/undo',
    'Explicitly skipped as editor-only; cannot qualify it through API calls.',
  ],
  [
    'NT-live-llm',
    'LLM decision runtime provider response, confidence and reasoning',
    'Live Codex/Claude/harness execution prohibited; authored config round trips passed.',
  ],
  [
    'NT-live-classifier',
    'Classifier runtime Choice/Noul/Score provider mathematics and transport',
    'No live inference/provider calls permitted; classifier config round trip passed.',
  ],
  [
    'NT-receipt-fault-states',
    'Events pending/failed/historical filtered state transitions and retry metadata',
    'Healthy API deterministically exposed admitted/deduplicated; fault injection or imported historical receipt states needed for remaining states.',
  ],
  [
    'NT-restart-recovery',
    'Restart/crash recovery of gates, receipt intent and permanent keys',
    'Starting, stopping or restarting this server was prohibited; cross-version key permanence was tested live.',
  ],
];
fs.writeFileSync(
  path.join(root, 'not-testable.json'),
  JSON.stringify(
    notTestable.map(([id, name, actual]) => ({
      id,
      name,
      expected: 'Requires separate environment or surface',
      actual,
      result: 'NOT TESTABLE',
      system: 'Not testable here',
      evidence: 'Scope restriction',
    })),
    null,
    2,
  ),
);
