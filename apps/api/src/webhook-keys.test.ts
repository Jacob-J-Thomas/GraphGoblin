import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WebhookAuthentication, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { signPayload, signRawBody } from '@graphgoblin/infrastructure/http';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

function definition(
  authentication: WebhookAuthentication,
  dedupeKey?: string,
): LoopDefinitionInput {
  const value = minimalLoop();
  value.nodes[0]!.config = {
    type: 'webhook',
    authentication,
    ...(dedupeKey === undefined ? {} : { dedupeKey }),
  };
  return value;
}
const recipes: WebhookAuthentication[] = [
  { type: 'none' },
  { type: 'hmac-sha256', message: 'body', header: 'x-signature', secretRef: 'key' },
  {
    type: 'hmac-sha256',
    message: 'timestamp-body',
    header: 'x-signature',
    secretRef: 'key',
    windowSeconds: 1,
  },
];
async function setup(auth: WebhookAuthentication, key?: string) {
  await t.app.inject({ method: 'PUT', url: '/secrets/key', payload: { value: 'synthetic' } });
  const id = await t.publishLoop(definition(auth, key));
  const endpoint = (await t.app.inject(`/loops/${id}/triggers`)).json<{
    webhooks: { path: string }[];
  }>().webhooks[0]!;
  const send = (raw: string, headers: Record<string, string> = {}) => {
    const timestamp = t.clock.now().toISOString();
    return t.app.inject({
      method: 'POST',
      url: endpoint.path,
      payload: raw,
      headers: {
        'content-type': 'application/json',
        ...headers,
        ...(auth.type === 'none'
          ? {}
          : {
              [auth.header]:
                auth.message === 'body'
                  ? signRawBody('synthetic', Buffer.from(raw))
                  : signPayload('synthetic', timestamp, raw),
              'x-graphgoblin-timestamp': timestamp,
            }),
      },
    });
  };
  return { id, send };
}

describe.each(recipes)('uniform webhook keys: $type $message', (auth) => {
  it('rejects absent/null/empty/513-character results before claim, preserving literal whitespace and 512 characters', async () => {
    const { id, send } = await setup(auth, 'key');
    const claim = vi.spyOn(t.container.ports.admission, 'claim');
    for (const payload of [{}, { key: null }, { key: '' }, { key: 'k'.repeat(513) }])
      expect((await send(JSON.stringify(payload))).json()).toMatchObject({
        status: 422,
        code: 'KEY_INVALID',
      });
    expect(claim).not.toHaveBeenCalled();
    expect((await t.app.inject('/events')).json()).toEqual({ items: [], nextCursor: null });
    for (const key of ['k'.repeat(512), ' ', '  ', false, 0, { id: 1 }, ['a']]) {
      expect((await send(JSON.stringify({ key }))).statusCode).toBe(202);
      await t.idle();
    }
    const runs = await t.container.repos.runs.list({ loopId: id });
    const keys = await Promise.all(
      runs.map(
        async (run) =>
          (await t.container.repos.runs.getInitialThread(run.id))!.invocation.trigger.dedupeKey,
      ),
    );
    expect(keys.sort()).toEqual(
      ['k'.repeat(512), ' ', '  ', 'false', '0', '{"id":1}', '["a"]'].sort(),
    );
  });
  it('uses payload and credential-free header bindings; invalid key expressions stay expression failures', async () => {
    const binding = await setup(
      auth,
      '$string(id) & ":" & $headers."x-delivery" & ":" & $string($exists($headers."x-signature"))',
    );
    expect((await binding.send('{"id":7}', { 'x-delivery': 'delivery' })).statusCode).toBe(202);
    await t.idle();
    const [run] = await t.container.repos.runs.list({ loopId: binding.id });
    expect(
      (await t.container.repos.runs.getInitialThread(run!.id))!.invocation.trigger.dedupeKey,
    ).toBe('7:delivery:false');
    const invalid = await setup(auth, '$error("private diagnostic")');
    const response = await invalid.send('{}');
    expect(response.json()).toMatchObject({ status: 422, code: 'EXPRESSION_FAILED' });
    expect(response.body).not.toContain('private diagnostic');
  });
  it('never invents a key and permits repeated unkeyed bodies', async () => {
    const { id, send } = await setup(auth);
    expect((await send('{}')).statusCode).toBe(202);
    expect((await send('{}')).statusCode).toBe(202);
    await t.idle();
    const runs = await t.container.repos.runs.list({ loopId: id });
    expect(runs).toHaveLength(2);
    for (const run of runs)
      expect(
        (await t.container.repos.runs.getInitialThread(run.id))!.invocation.trigger,
      ).not.toHaveProperty('dedupeKey');
  });
  it('consumes concurrent keys once, confirms a lost acknowledgement and blocks v2 long after the auth window', async () => {
    const { id, send } = await setup(auth, 'key');
    const original = t.container.ports.admission.claim.bind(t.container.ports.admission);
    vi.spyOn(t.container.ports.admission, 'claim').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('lost acknowledgement');
    });
    const responses = await Promise.all([send('{"key":"once"}'), send('{"key":"once"}')]);
    expect(responses.map((response) => response.json<unknown>())).toEqual([
      { accepted: true },
      { accepted: true },
    ]);
    await t.idle();
    expect(await t.container.repos.runs.list({ loopId: id })).toHaveLength(1);
    t.clock.advance(365 * 86400 * 1000);
    const replacement = definition(auth, 'key');
    replacement.name = 'second version';
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${id}/draft`,
          payload: { definition: replacement },
        })
      ).statusCode,
    ).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(
      200,
    );
    expect((await send('{"key":"once","new":true}')).json()).toEqual({ accepted: true });
    await t.idle();
    expect(await t.container.repos.runs.list({ loopId: id })).toHaveLength(1);
    expect(
      (await t.container.repos.inbound.page('local')).items.filter(
        (event) => event.delivery?.state === 'deduplicated',
      ),
    ).toHaveLength(2);
  });
});
