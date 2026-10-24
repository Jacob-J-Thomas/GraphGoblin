import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});
function eventLoop(name = 'target'): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'event', eventType: 'ready' },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'trigger.payload' } },
    ],
    edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

describe('targeted Events (#343)', () => {
  it('refuses a missing target without broadcasting', async () => {
    await t.publishLoop(eventLoop());
    const response = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'ready' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await t.app.inject('/events')).json()).toMatchObject({ items: [] });
  });
  it('records one explicit destination and a durable admission identity', async () => {
    const loopId = await t.publishLoop(eventLoop());
    const other = await t.publishLoop(eventLoop('other'));
    const response = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { loopId, type: 'ready' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      target: { loopId, triggerNodeId: 'start' },
      admissionId: expect.any(String),
      delivery: { state: 'pending' },
    });
    await t.container.manager.waitForWebhookRecovery();
    await t.idle();
    expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
    expect(await t.container.repos.runs.list({ loopId: other })).toEqual([]);
  });
  it('refuses and logs the 997-level payload with a bounded diagnostic', async () => {
    const loopId = await t.publishLoop(eventLoop());
    const payload =
      '{"loopId":' +
      JSON.stringify(loopId) +
      ',"type":"ready","payload":{"v":' +
      '['.repeat(997) +
      '0' +
      ']'.repeat(997) +
      '}}';
    const response = await t.app.inject({
      method: 'POST',
      url: '/events',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'EVENT_PAYLOAD_TOO_DEEP' });
    expect(response.body.length).toBeLessThan(512);
    expect(t.logger.lines).toContainEqual(
      expect.objectContaining({ level: 'warn', obj: { code: 'EVENT_PAYLOAD_TOO_DEEP' } }),
    );
  });
});

async function post(loopId: string, extra: Record<string, unknown> = {}) {
  return t.app.inject({
    method: 'POST',
    url: '/events',
    payload: { loopId, type: 'ready', ...extra },
  });
}
async function settle() {
  await t.container.manager.waitForWebhookRecovery();
  await t.idle();
}
async function listed() {
  return (await t.app.inject('/events')).json<{
    items: {
      id: string;
      admissionId: string;
      target: { versionId: string };
      runIds: string[];
      delivery: { state: string; attempts: number; failureCode?: string };
    }[];
  }>().items;
}
async function fault(on: string) {
  await t.container.handle.client.execute(
    `CREATE TRIGGER event_fault ${on} BEGIN SELECT RAISE(ABORT, 'private-fault'); END`,
  );
}
async function clearFault() {
  await t.container.handle.client.execute('DROP TRIGGER event_fault');
}

it('refuses invalid loop identities, ownership, scope, unpublished and ineligible entries', async () => {
  const loopId = await t.publishLoop(eventLoop());
  expect((await post('invalid')).json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect((await post('00000000000000000000000000')).json()).toMatchObject({
    code: 'LOOP_NOT_FOUND',
  });
  const other = await t.container.repos.apiKeys.create('other', 'other', ['events:write']);
  const foreign = await t.app.inject({
    method: 'POST',
    url: '/events',
    headers: { authorization: `Bearer ${other.token}` },
    payload: { loopId, type: 'ready' },
  });
  expect(foreign.statusCode).toBe(404);
  const readOnly = await t.container.repos.apiKeys.create('local', 'read', ['events:read']);
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${readOnly.token}` },
        payload: { loopId, type: 'ready' },
      })
    ).statusCode,
  ).toBe(403);
  expect((await post(loopId, { triggerNodeId: 'done' })).json()).toMatchObject({
    code: 'EVENT_TRIGGER_NOT_FOUND',
  });
  expect((await post(loopId, { type: 'different' })).json()).toMatchObject({
    code: 'EVENT_TRIGGER_NOT_FOUND',
  });
  const draft = (
    await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: eventLoop('draft') },
    })
  ).json<{ loop: { id: string } }>();
  expect((await post(draft.loop.id)).json()).toMatchObject({ code: 'VERSION_NOT_PUBLISHED' });
  expect(await listed()).toEqual([]);
});

it('requires explicit disambiguation and scopes identical request keys to each recipient', async () => {
  const definition = eventLoop();
  definition.nodes.push({
    id: 'second',
    kind: 'trigger',
    label: 'Second',
    config: { type: 'event', eventType: 'ready' },
  });
  definition.edges.push({ id: 'b', from: { node: 'second', port: 'out' }, to: { node: 'done' } });
  const loopId = await t.publishLoop(definition);
  const other = await t.publishLoop(eventLoop('other'));
  expect((await post(loopId)).json()).toMatchObject({ code: 'EVENT_TRIGGER_AMBIGUOUS' });
  const responses = await Promise.all([
    post(loopId, { triggerNodeId: 'start', dedupeKey: 'same' }),
    post(loopId, { triggerNodeId: 'second', dedupeKey: 'same' }),
    post(other, { dedupeKey: 'same' }),
  ]);
  expect(responses.map((r) => r.statusCode)).toEqual([202, 202, 202]);
  await settle();
  expect(await t.container.repos.runs.list({ loopId })).toHaveLength(2);
  expect(await t.container.repos.runs.list({ loopId: other })).toHaveLength(1);
  expect((await post(loopId, { dedupeKey: 'same' })).json()).toMatchObject({
    code: 'EVENT_TRIGGER_AMBIGUOUS',
  });
});

it('reuses one original delivery across concurrent keyed retries and admits unkeyed repeats', async () => {
  const loopId = await t.publishLoop(eventLoop());
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => post(loopId, { dedupeKey: 'key', payload: { a: 1 } })),
  );
  expect(new Set(replies.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
  await settle();
  const first = (await listed())[0]!;
  const thread = await t.app.inject(`/runs/${first.runIds[0]!}/thread`);
  expect(thread.statusCode).toBe(200);
  expect(thread.json()).toMatchObject({ invocation: { trigger: { dedupeKey: 'key' } } });
  expect(
    (await post(loopId, { dedupeKey: 'key', payload: { changed: true } })).json(),
  ).toMatchObject({
    id: first.id,
    admissionId: first.admissionId,
    duplicate: true,
    runIds: first.runIds,
    delivery: { state: 'admitted' },
  });
  await post(loopId);
  await post(loopId);
  await settle();
  expect(await t.container.repos.runs.list({ loopId })).toHaveLength(3);
});

it.each(['BEFORE INSERT ON inbound_events', 'BEFORE INSERT ON event_receipts'])(
  'never acknowledges an unsaved receipt: %s',
  async (on) => {
    const loopId = await t.publishLoop(eventLoop());
    await fault(on);
    const response = await post(loopId, { dedupeKey: 'retry' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'EVENT_ADMISSION_FAILED' });
    expect(response.body).not.toContain('private-fault');
    expect(await listed()).toEqual([]);
    expect((await t.container.handle.client.execute('SELECT * FROM event_receipts')).rows).toEqual(
      [],
    );
    await clearFault();
    expect((await post(loopId, { dedupeKey: 'retry' })).statusCode).toBe(202);
    await settle();
    expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
  },
);

it.each([
  'BEFORE INSERT ON runs',
  'BEFORE INSERT ON run_events',
  "BEFORE UPDATE OF status ON event_receipts WHEN NEW.status='admitted'",
  'BEFORE UPDATE OF run_ids ON inbound_events',
])('recovers the same intent after atomic admission failure: %s', async (on) => {
  const loopId = await t.publishLoop(eventLoop());
  await fault(on);
  const response = await post(loopId, { dedupeKey: 'retry' });
  expect(response.statusCode).toBe(202);
  await settle();
  const [pending] = await listed();
  expect(pending).toMatchObject({
    delivery: { state: 'pending', attempts: 1, failureCode: 'EVENT_ADMISSION_RETRY' },
    runIds: [],
  });
  expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(409);
  expect((await post(loopId, { dedupeKey: 'retry' })).json()).toMatchObject({
    id: pending!.id,
    duplicate: true,
  });
  const [row] = (await t.container.handle.client.execute('SELECT intent FROM event_receipts')).rows;
  const serialized = row?.intent;
  if (typeof serialized !== 'string') throw new Error('saved intent missing');
  const intent = JSON.parse(serialized) as { run: { id: string } };
  await clearFault();
  t.clock.advance(5000);
  await t.container.manager.retryPendingWebhooks();
  await settle();
  expect((await listed())[0]).toMatchObject({
    admissionId: pending!.admissionId,
    delivery: { state: 'admitted' },
    runIds: [intent.run.id],
  });
  expect(
    (await t.container.repos.events.read(intent.run.id)).filter((e) => e.type === 'run.queued'),
  ).toHaveLength(1);
});

it('pins the accepted version through later publication and keyed retries', async () => {
  const loopId = await t.publishLoop(eventLoop());
  await fault('BEFORE INSERT ON runs');
  await post(loopId, { dedupeKey: 'pin' });
  await settle();
  const original = (await listed())[0]!;
  const draft = eventLoop('edited');
  draft.nodes[1]!.config = { returns: '"new"' };
  const edited = await t.app.inject({
    method: 'PUT',
    url: `/loops/${loopId}/draft`,
    payload: { definition: draft },
  });
  expect(edited.statusCode).toBe(200);
  expect((await t.app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode).toBe(
    200,
  );
  expect((await post(loopId, { dedupeKey: 'pin' })).json()).toMatchObject({
    target: { versionId: original.target.versionId },
  });
  await clearFault();
  t.clock.advance(5000);
  await t.container.manager.retryPendingWebhooks();
  await settle();
  const [run] = await t.container.repos.runs.list({ loopId });
  expect(run?.versionId).toBe(original.target.versionId);
  expect(run?.result).toBeNull();
});

it('preserves node expression dedupe and refuses expression failures before accepting', async () => {
  const definition = eventLoop();
  definition.nodes[0]!.config = { type: 'event', eventType: 'ready', dedupeKey: 'issue' };
  const loopId = await t.publishLoop(definition);
  await post(loopId, { payload: { issue: 7 } });
  await post(loopId, { payload: { issue: 7 }, dedupeKey: 'new-request' });
  await settle();
  expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
  expect(await listed()).toContainEqual(
    expect.objectContaining({ delivery: { state: 'deduplicated', attempts: 0 }, runIds: [] }),
  );
  const broken = eventLoop('broken');
  broken.nodes[0]!.config = { type: 'event', eventType: 'ready', dedupeKey: '$error("private")' };
  const brokenId = await t.publishLoop(broken);
  const response = await post(brokenId);
  expect(response.statusCode).toBe(422);
  expect(response.json()).toMatchObject({ code: 'EVENT_KEY_EXPRESSION_FAILED' });
  expect(response.body).not.toContain('private');
  expect(t.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'warn',
      msg: 'event key expression failed',
      obj: { code: 'EVENT_KEY_EXPRESSION_FAILED', loopId: brokenId, nodeId: 'start' },
    }),
  );
});

it('bounds persistent admission failures and keeps failed keyed deliveries truthful', async () => {
  const loopId = await t.publishLoop(eventLoop());
  await fault('BEFORE INSERT ON runs');
  await post(loopId, { dedupeKey: 'fails' });
  await settle();
  for (let i = 0; i < 7; i++) {
    t.clock.advance(300_000);
    await t.container.manager.retryPendingWebhooks();
  }
  const failed = (await listed())[0]!;
  expect(failed).toMatchObject({
    delivery: { state: 'failed', attempts: 8, failureCode: 'EVENT_ADMISSION_EXHAUSTED' },
  });
  await clearFault();
  expect((await post(loopId, { dedupeKey: 'fails' })).json()).toMatchObject({
    id: failed.id,
    duplicate: true,
    delivery: { state: 'failed' },
  });
  await t.container.manager.retryPendingWebhooks();
  expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
});

it(
  'runs independent requests concurrently within configured capacity',
  { timeout: 30_000 },
  async () => {
    await t.close();
    t = await createTestApp({ env: { GG_MAX_CONCURRENT_RUNS: '2' } });
    t.harness.script([{ delayMs: 60_000 }, { delayMs: 60_000 }]);
    const definition = eventLoop();
    definition.nodes.splice(1, 0, {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { harness: 'codex', prompt: { template: 'work' } },
    });
    definition.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ];
    const loopId = await t.publishLoop(definition);
    try {
      const responses = await Promise.all([post(loopId), post(loopId)]);
      expect(responses.map((r) => r.statusCode)).toEqual([202, 202]);
      await vi.waitFor(
        async () => {
          expect(t.harness.started).toHaveLength(2);
          expect((await t.container.repos.runs.list({ loopId })).map((r) => r.status)).toEqual([
            'running',
            'running',
          ]);
        },
        { timeout: 20_000 },
      );
    } finally {
      for (const run of await t.container.repos.runs.list({ loopId })) {
        expect(
          (await t.app.inject({ method: 'POST', url: `/runs/${run.id}/cancel` })).statusCode,
        ).toBe(200);
      }
      await settle();
    }
    expect((await t.container.repos.runs.list({ loopId })).map((r) => r.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  },
);

it('keeps URL webhook acknowledgements and targeting; refuses deep input with a safe logged code', async () => {
  const definition = eventLoop();
  definition.nodes[0]!.config = { type: 'webhook' };
  const loopId = await t.publishLoop(definition);
  const other = await t.publishLoop(eventLoop('other'));
  const { webhooks } = (await t.app.inject(`/loops/${loopId}/triggers`)).json<{
    webhooks: { path: string }[];
  }>();
  const path = webhooks[0]!.path;
  const deep = '{"v":' + '['.repeat(997) + '0' + ']'.repeat(997) + '}';
  const refused = await t.app.inject({
    method: 'POST',
    url: path,
    payload: deep,
    headers: { 'content-type': 'application/json' },
  });
  expect(refused.statusCode).toBe(422);
  expect(refused.json()).toMatchObject({ code: 'WEBHOOK_PAYLOAD_TOO_DEEP' });
  expect(refused.body.length).toBeLessThan(512);
  expect(t.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'warn',
      obj: expect.objectContaining({ code: 'WEBHOOK_PAYLOAD_TOO_DEEP' }),
    }),
  );
  for (let i = 0; i < 2; i++)
    expect(
      (await t.app.inject({ method: 'POST', url: path, payload: { ok: true } })).json(),
    ).toEqual({ accepted: true });
  await settle();
  expect(await t.container.repos.runs.list({ loopId })).toHaveLength(2);
  expect(await t.container.repos.runs.list({ loopId: other })).toEqual([]);
});

it('admits the shared receipt nesting boundary and refuses the next container before saving', async () => {
  const loopId = await t.publishLoop(eventLoop());
  for (const [depth, status] of [
    [994, 202],
    [995, 422],
  ] as const) {
    const payload =
      '{"loopId":' +
      JSON.stringify(loopId) +
      ',"type":"ready","payload":{"v":' +
      '['.repeat(depth) +
      '0' +
      ']'.repeat(depth) +
      '}}';
    const response = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(status);
  }
  await settle();
  const validation = (
    await t.container.handle.client.execute(
      'SELECT json_valid(intent) AS valid FROM event_receipts',
    )
  ).rows;
  expect(validation).toEqual([{ valid: 1 }]);
  expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
});

it('classifies a corrupt saved intent as failed without retrying or rewriting it', async () => {
  const loopId = await t.publishLoop(eventLoop());
  await fault('BEFORE INSERT ON runs');
  await post(loopId, { dedupeKey: 'corrupt' });
  await settle();
  const initial = (await listed())[0]!;
  await clearFault();
  await t.container.handle.client.execute("UPDATE event_receipts SET intent='{'");
  t.clock.advance(5000);
  await t.container.manager.retryPendingWebhooks();
  expect((await listed())[0]).toMatchObject({
    delivery: { state: 'failed', failureCode: 'EVENT_INTENT_CONFLICT', attempts: 2 },
  });
  expect((await post(loopId, { dedupeKey: 'corrupt' })).json()).toMatchObject({
    id: initial.id,
    duplicate: true,
    delivery: { state: 'failed' },
  });
  expect(
    (await t.container.handle.client.execute('SELECT intent FROM event_receipts')).rows,
  ).toEqual([{ intent: '{' }]);
});

it('refuses malformed Unicode request keys instead of accepting an unstable SQLite identity', async () => {
  const loopId = await t.publishLoop(eventLoop());
  expect((await post(loopId, { dedupeKey: String.fromCharCode(0xd800) })).statusCode).toBe(400);
  expect(await listed()).toEqual([]);
});

it('refuses non-finite deeply nested JSON without entering a recursive validator', async () => {
  const loopId = await t.publishLoop(eventLoop());
  const payload =
    '{"loopId":' +
    JSON.stringify(loopId) +
    ',"type":"ready","payload":' +
    '['.repeat(15000) +
    '1e999' +
    ']'.repeat(15000) +
    '}';
  const response = await t.app.inject({
    method: 'POST',
    url: '/events',
    payload,
    headers: { 'content-type': 'application/json' },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(response.body.length).toBeLessThan(512);
  expect(await listed()).toEqual([]);
});

it.each(['EVENT_ADMISSION_EXHAUSTED', 'EVENT_INTENT_CONFLICT'] as const)(
  'releases the authored node key after %s for a new request key',
  async (failureCode) => {
    const definition = eventLoop();
    definition.nodes[0]!.config = { type: 'event', eventType: 'ready', dedupeKey: 'issue' };
    const loopId = await t.publishLoop(definition);
    await fault('BEFORE INSERT ON runs');
    expect((await post(loopId, { payload: { issue: 7 }, dedupeKey: 'r1' })).statusCode).toBe(202);
    await settle();
    if (failureCode === 'EVENT_ADMISSION_EXHAUSTED') {
      for (let i = 0; i < 7; i++) {
        t.clock.advance(300_000);
        await t.container.manager.retryPendingWebhooks();
      }
      await clearFault();
    } else {
      await clearFault();
      await t.container.handle.client.execute("UPDATE event_receipts SET intent='{'");
      t.clock.advance(5000);
      await t.container.manager.retryPendingWebhooks();
    }
    const failed = (await listed())[0]!;
    expect(failed.delivery).toMatchObject({ state: 'failed', failureCode });
    expect((await post(loopId, { payload: { issue: 7 }, dedupeKey: 'r1' })).json()).toMatchObject({
      id: failed.id,
      duplicate: true,
      delivery: { state: 'failed', failureCode },
    });
    const next = await post(loopId, { payload: { issue: 7 }, dedupeKey: 'r2' });
    expect(next.statusCode).toBe(202);
    expect(next.json()).toMatchObject({ delivery: { state: 'pending' } });
    expect(next.json<{ id: string }>().id).not.toBe(failed.id);
    await settle();
    expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
    expect(await listed()).toContainEqual(
      expect.objectContaining({
        id: next.json<{ id: string }>().id,
        delivery: { state: 'admitted', attempts: 0 },
      }),
    );
  },
);

it('returns a typed stored-history error for a corrupt keyed retry without rewriting it', async () => {
  const loopId = await t.publishLoop(eventLoop());
  await fault('BEFORE INSERT ON runs');
  await post(loopId, { dedupeKey: 'corrupt-inbound' });
  await settle();
  await clearFault();
  await t.container.handle.client.execute("UPDATE inbound_events SET payload='private-corruption'");
  const response = await post(loopId, { dedupeKey: 'corrupt-inbound' });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toMatchObject({ code: 'STORED_EVENT_INVALID' });
  expect(response.body).not.toContain('private-corruption');
  expect(
    (await t.container.handle.client.execute('SELECT payload FROM inbound_events')).rows,
  ).toEqual([{ payload: 'private-corruption' }]);
  expect(
    (await t.container.handle.client.execute('SELECT id FROM event_receipts')).rows,
  ).toHaveLength(1);
  expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
});

it.each(['', 'before\u0000after'])(
  'refuses request key %j before saving any delivery',
  async (dedupeKey) => {
    const loopId = await t.publishLoop(eventLoop());
    const responses = await Promise.all([post(loopId, { dedupeKey }), post(loopId, { dedupeKey })]);
    await settle();
    expect(responses.map((r) => r.statusCode)).toEqual([400, 400]);
    for (const response of responses) {
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ path: '/dedupeKey' })],
      });
    }
    expect(await listed()).toEqual([]);
    expect((await t.container.handle.client.execute('SELECT id FROM event_receipts')).rows).toEqual(
      [],
    );
    expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
  },
);

it.each([' ', 'x'])(
  'preserves the literal request key %j across retries and run admission',
  async (dedupeKey) => {
    const loopId = await t.publishLoop(eventLoop());
    const first = await post(loopId, { dedupeKey });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ dedupeKey, duplicate: false });
    await settle();
    const retry = await post(loopId, { dedupeKey });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({
      id: first.json<{ id: string }>().id,
      admissionId: first.json<{ admissionId: string }>().admissionId,
      dedupeKey,
      duplicate: true,
      delivery: { state: 'admitted' },
    });
    const [run] = await t.container.repos.runs.list({ loopId });
    expect(await t.container.repos.runs.list({ loopId })).toHaveLength(1);
    expect((await t.app.inject(`/runs/${run!.id}/thread`)).json()).toMatchObject({
      invocation: { trigger: { dedupeKey } },
    });
  },
);

// A lone surrogate would be stored as U+FFFD, so it is refused like NUL; U+FFFD itself is valid.
it.each(['', 'before\u0000after', 'before\ud800after', ' ', 'x', 'before�after'])(
  'preserves webhook key refusal and literal-key deduplication for %j',
  async (key) => {
    const invalid = key === '' || key.includes('\u0000') || key.includes('\ud800');
    const definition = eventLoop();
    definition.nodes[0]!.config = { type: 'webhook', dedupeKey: 'issue' };
    const loopId = await t.publishLoop(definition);
    const { webhooks } = (await t.app.inject(`/loops/${loopId}/triggers`)).json<{
      webhooks: { path: string }[];
    }>();
    for (let i = 0; i < 2; i++) {
      const response = await t.app.inject({
        method: 'POST',
        url: webhooks[0]!.path,
        payload: { issue: key },
      });
      expect(response.statusCode).toBe(invalid ? 422 : 202);
      expect(response.json()).toEqual(
        invalid ? expect.objectContaining({ code: 'KEY_INVALID' }) : { accepted: true },
      );
    }
    await settle();
    expect(await t.container.repos.runs.list({ loopId })).toHaveLength(invalid ? 0 : 1);
    expect(await listed()).toHaveLength(invalid ? 0 : 2);
    if (invalid)
      expect(
        (await t.container.handle.client.execute('SELECT id FROM webhook_receipts')).rows,
      ).toEqual([]);
  },
);

it('refuses an authored Event key containing NUL before saving any delivery', async () => {
  const definition = eventLoop();
  definition.nodes[0]!.config = { type: 'event', eventType: 'ready', dedupeKey: 'issue' };
  const loopId = await t.publishLoop(definition);
  const response = await post(loopId, { payload: { issue: 'before\u0000after' } });
  await settle();
  expect(response.statusCode).toBe(422);
  expect(response.json()).toMatchObject({ code: 'EVENT_KEY_INVALID' });
  expect(await listed()).toEqual([]);
  expect((await t.container.handle.client.execute('SELECT id FROM event_receipts')).rows).toEqual(
    [],
  );
  expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
});

it('admits a later due Event in the same sweep despite persistent first-receipt metadata failure', async () => {
  const loops = [await t.publishLoop(eventLoop('bad')), await t.publishLoop(eventLoop('healthy'))];
  await fault('BEFORE INSERT ON runs');
  const deliveries: { id: string }[] = [];
  for (const loopId of loops) {
    deliveries.push((await post(loopId, { dedupeKey: 'retry' })).json<{ id: string }>());
    await settle();
  }
  await clearFault();
  const sql = t.container.handle.client;
  await sql.execute(
    `CREATE TRIGGER event_fault BEFORE INSERT ON runs WHEN NEW.loop_id='${loops[0]}' BEGIN SELECT RAISE(ABORT,'run fault'); END`,
  );
  await sql.execute(
    `CREATE TRIGGER event_metadata_fault BEFORE UPDATE ON event_receipts WHEN OLD.inbound_id='${deliveries[0]!.id}' BEGIN SELECT RAISE(ABORT,'metadata fault'); END`,
  );
  for (let i = 0; i < 2; i++) {
    t.clock.advance(300_001);
    await t.container.manager.retryPendingWebhooks();
    await settle();
    expect((await listed()).find((event) => event.id === deliveries[0]!.id)).toMatchObject({
      delivery: { state: 'pending', attempts: 1 },
      runIds: [],
    });
    expect((await listed()).find((event) => event.id === deliveries[1]!.id)).toMatchObject({
      delivery: { state: 'admitted' },
    });
    expect(await t.container.repos.runs.list({ loopId: loops[1]! })).toHaveLength(1);
  }
  expect(t.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'error',
      obj: expect.objectContaining({ code: 'EVENT_RECOVERY_FAILED' }),
    }),
  );
});
