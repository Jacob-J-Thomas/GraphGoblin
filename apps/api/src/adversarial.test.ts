import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { minimalLoop, fakeUlid } from '@graphgoblin/contracts/testing';
import { asyncIterableOf } from '@graphgoblin/engine/testing';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { signPayload } from '@graphgoblin/infrastructure/http';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { loadMasterKey } from './master-key.js';

const opened: TestApp[] = [];
async function app(options: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(options);
  opened.push(t);
  return t;
}
afterEach(async () => {
  for (const t of opened.splice(0)) await t.close();
});
function triggerLoop(name: string, config: unknown, emit?: string): LoopDefinitionInput {
  const def = minimalLoop();
  def.name = name;
  def.nodes[0] = { id: 'start', kind: 'trigger', label: 'Start', config: config as never };
  if (emit)
    def.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { return: { mapping: '42', channels: [{ kind: 'event', eventType: emit }] } },
    };
  return def;
}
async function hook(t: TestApp) {
  await t.container.repos.secretsFor('local').set('hook', 'secret-marker');
  const id = await t.publishLoop(
    triggerLoop('hook', {
      subtype: 'webhook',
      signature: { secretRef: 'hook', scheme: 'hmac-sha256' },
      replayWindowSeconds: 300,
    }),
  );
  const list = (await t.app.inject(`/loops/${id}/triggers`)).json<{
    webhooks: { path: string }[];
  }>();
  return { id, path: list.webhooks[0]!.path };
}
function signed(t: TestApp, body: string, delta = 0) {
  const timestamp = new Date(t.clock.now().getTime() + delta).toISOString();
  return {
    'content-type': 'application/json',
    'x-graphgoblin-timestamp': timestamp,
    'x-graphgoblin-signature': signPayload('secret-marker', timestamp, body),
  };
}
async function start(t: TestApp, id: string) {
  const response = await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  expect(response.statusCode).toBe(202);
  await t.idle();
  return response.json<{ run: RunRecord }>().run;
}

describe('adversarial API invariants', () => {
  it('12: every advertised private route rejects missing and revoked credentials', async () => {
    const t = await app({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'revoked', ['*']);
    await t.container.repos.apiKeys.revoke('local', key.record.id);
    const paths = t.app.swagger().paths!;
    let checked = 0;
    for (const [path, operations] of Object.entries(paths)) {
      if (['/healthz', '/version', '/openapi.json'].includes(path) || path.startsWith('/hooks/'))
        continue;
      for (const method of Object.keys(operations)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
        const url = path.replace(/\{[^}]+\}/g, fakeUlid('id'));
        for (const headers of [{}, { authorization: `Bearer ${key.token}` }]) {
          const res = await t.app.inject({ method: method.toUpperCase() as 'GET', url, headers });
          expect(res.statusCode, `${method} ${path}`).toBe(401);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(25);
    for (const path of ['/healthz', '/version', '/openapi.json'])
      expect((await t.app.inject(path)).statusCode).toBe(200);
    for (const path of [
      '/healthz-private',
      '/docs-private',
      '/openapi.json-private',
      '/hook/anything',
    ])
      expect((await t.app.inject(path)).statusCode).toBe(401);
    expect((await t.app.inject('/docs/anything')).statusCode).toBe(404);
  });

  it('ADV-008: a credential without read scope cannot enumerate private resources', async () => {
    const t = await app({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'write only', ['runs:write']);
    for (const url of [
      '/loops',
      '/settings',
      '/secrets',
      '/api-keys',
      '/model-catalog',
      '/events',
      '/harness/preflight',
      '/system/preflight',
    ]) {
      expect(
        (await t.app.inject({ url, headers: { authorization: `Bearer ${key.token}` } })).statusCode,
        url,
      ).toBe(403);
    }
    // runs:write implies runs:read.
    expect(
      (await t.app.inject({ url: '/runs', headers: { authorization: `Bearer ${key.token}` } }))
        .statusCode,
    ).toBe(200);
  });

  /**
   * The documented scope of every advertised private route (docs/07). A new route must be added
   * here, so its scope is a decision rather than an accident.
   */
  const ROUTE_SCOPES: Record<string, string> = {
    'GET /loops': 'loops:read',
    'POST /loops': 'loops:write',
    'POST /loops/import': 'loops:write',
    'GET /loops/{id}': 'loops:read',
    'DELETE /loops/{id}': 'loops:write',
    'PUT /loops/{id}/draft': 'loops:write',
    'POST /loops/{id}/validate': 'loops:read',
    'POST /loops/{id}/publish': 'loops:write',
    'GET /loops/{id}/versions': 'loops:read',
    'GET /loops/{id}/versions/{versionId}': 'loops:read',
    'GET /loops/{id}/export': 'loops:read',
    'GET /loops/{id}/triggers': 'loops:read',
    'POST /triggers/cron/preview': 'loops:read',
    'POST /loops/{id}/runs': 'runs:write',
    'GET /runs': 'runs:read',
    'GET /runs/{id}': 'runs:read',
    'GET /runs/{id}/thread': 'runs:read',
    'GET /runs/{id}/events': 'runs:read',
    'GET /runs/{id}/sessions': 'runs:read',
    'GET /runs/{id}/artifacts/{artifactId}': 'runs:read',
    'POST /runs/{id}/cancel': 'runs:write',
    'POST /runs/{id}/pause': 'runs:write',
    'POST /runs/{id}/resume': 'runs:write',
    'POST /runs/{id}/input': 'runs:write',
    'POST /runs/{id}/signals/{name}': 'runs:write',
    'POST /runs/{id}/replay': 'runs:write',
    'GET /settings': 'settings:read',
    'PUT /settings': 'settings:write',
    'DELETE /settings/{key}': 'settings:write',
    'GET /model-catalog': 'settings:read',
    'GET /classifier-models': 'settings:read',
    'PUT /classifier-models/{id}': 'settings:write',
    'PATCH /classifier-models/{id}': 'settings:write',
    'DELETE /classifier-models/{id}': 'settings:write',
    'PUT /model-catalog/{harness}/{model}': 'settings:write',
    'PATCH /model-catalog/{harness}/{model}': 'settings:write',
    'DELETE /model-catalog/{harness}/{model}': 'settings:write',
    'GET /secrets': 'secrets:read',
    'PUT /secrets/{name}': 'secrets:write',
    'DELETE /secrets/{name}': 'secrets:write',
    'GET /api-keys': 'api-keys:read',
    'POST /api-keys': 'api-keys:write',
    'DELETE /api-keys/{id}': 'api-keys:write',
    'GET /events': 'events:read',
    'POST /events': 'events:write',
    'GET /system/preflight': 'system:read',
    'GET /harness/preflight': 'system:read',
  };

  it('ADV-008: every advertised route against every scope', async () => {
    const t = await app({ requireApiKey: true });
    const scopes = [...new Set(Object.values(ROUTE_SCOPES))];
    const resources = [...new Set(scopes.map((s) => s.split(':')[0]!))];
    const tokens = new Map<string, string>();
    for (const scope of [...scopes, '*']) {
      tokens.set(scope, (await t.container.repos.apiKeys.create('local', scope, [scope])).token);
    }
    const advertised: string[] = [];
    for (const [path, operations] of Object.entries(t.app.swagger().paths!)) {
      if (['/healthz', '/version'].includes(path) || path.startsWith('/hooks/')) continue;
      for (const method of Object.keys(operations)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method))
          advertised.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(advertised.sort()).toEqual(Object.keys(ROUTE_SCOPES).sort());
    for (const route of advertised) {
      const required = ROUTE_SCOPES[route]!;
      const [method, path] = route.split(' ') as ['GET', string];
      // An unknown id gets past authorization (404, 400, 409, or success) without touching data.
      const url = path.replace(/\{([^}]+)\}/g, (_, name: string) =>
        ['id', 'versionId'].includes(name) ? fakeUlid('scope-table') : 'scope-table',
      );
      for (const scope of [...scopes, '*']) {
        const [resource, action] = scope.split(':');
        const allowed =
          scope === '*' ||
          scope === required ||
          (required === `${resource}:read` && action === 'write');
        const response = await t.app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${tokens.get(scope)}`, accept: 'application/json' },
        });
        if (allowed) expect(response.statusCode, `${route} with ${scope}`).not.toBe(403);
        else expect(response.statusCode, `${route} with ${scope}`).toBe(403);
      }
    }
    expect(resources).toEqual([
      'loops',
      'runs',
      'settings',
      'secrets',
      'api-keys',
      'events',
      'system',
    ]);
    await t.idle();
  });

  const CLASSIFIER_SECRET_SCOPE_CASES = [
    { scopes: ['settings:write'], status: 403 },
    { scopes: ['settings:write', 'secrets:read'], status: 403 },
    { scopes: ['secrets:write'], status: 403 },
    { scopes: ['settings:read', 'secrets:write'], status: 403 },
    { scopes: ['settings:write', 'secrets:write'], status: 200 },
    { scopes: ['*'], status: 200 },
  ];
  it.each(CLASSIFIER_SECRET_SCOPE_CASES)(
    'ADV-008: classifier PUT secretRef requires both write scopes (%j)',
    async ({ scopes, status }) => {
      const t = await app({ requireApiKey: true });
      const key = await t.container.repos.apiKeys.create(
        'local',
        'conditional classifier scope',
        scopes,
      );
      await t.container.repos.secretsFor('local').set('github-token', 'private-owner-secret');
      const response = await t.app.inject({
        method: 'PUT',
        url: '/classifier-models/kev',
        headers: { authorization: `Bearer ${key.token}` },
        payload: {
          provider: 'http',
          displayName: 'Kev',
          providerModel: 'kev',
          primitives: ['choice'],
          endpoint: 'http://127.0.0.1:8008',
          secretRef: 'github-token',
        },
      });
      expect(response.statusCode).toBe(status);
      if (status === 403) {
        expect(response.json()).toHaveProperty('code', 'FORBIDDEN');
        expect(await t.container.repos.classifiers.findOne('local', 'kev')).toBeUndefined();
      } else expect(response.json()).toMatchObject({ enabled: false, configured: true });
      expect(response.body).not.toContain('private-owner-secret');
    },
  );

  it('ADV-008: local trusted mode keeps full access without a key', async () => {
    const t = await app();
    for (const url of ['/loops', '/runs', '/settings', '/secrets', '/api-keys', '/events']) {
      expect((await t.app.inject(url)).statusCode, url).toBe(200);
    }
  });

  it('12: every mutating route rejects a valid key with no write scopes', async () => {
    const t = await app({ requireApiKey: true });
    const key = await t.container.repos.apiKeys.create('local', 'no scopes', []);
    let checked = 0;
    for (const [path, operations] of Object.entries(t.app.swagger().paths!)) {
      if (path.startsWith('/hooks/') || path.endsWith('/validate')) continue;
      for (const method of Object.keys(operations)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
        let payload: Record<string, unknown> | undefined;
        if (path === '/loops' || path.endsWith('/draft')) payload = { definition: minimalLoop() };
        else if (path.endsWith('/import') || path === '/settings' || path.endsWith('/runs'))
          payload = {};
        else if (path.endsWith('/input')) payload = { input: null };
        else if (path.includes('/signals/')) payload = { payload: null };
        else if (path.startsWith('/secrets/') && method === 'put')
          payload = { value: 'scope-test' };
        else if (path === '/api-keys' && method === 'post') payload = { label: 'scope-test' };
        else if (path === '/events') payload = { type: 'scope-test', payload: null };
        else if (path.startsWith('/model-catalog/') && method === 'put')
          payload = { displayName: 'Model', efforts: ['low'], defaultEffort: 'low' };
        else if (path.startsWith('/model-catalog/') && method === 'patch')
          payload = { enabled: false };
        else if (path.endsWith('/replay')) payload = { nodeId: 'scope-test' };
        const url = path.replace(/\{([^}]+)\}/g, (_, name: string) =>
          name === 'id' ? fakeUlid('id') : 'scope-test',
        );
        const response = await t.app.inject({
          method: method.toUpperCase() as 'POST',
          url,
          headers: { authorization: `Bearer ${key.token}` },
          ...(payload ? { payload } : {}),
        });
        expect(response.statusCode, `${method} ${path}`).toBe(403);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });

  it('12/13: API keys cannot bypass signatures; signatures bind exact body bytes', async () => {
    const t = await app();
    const h = await hook(t);
    const key = await t.container.repos.apiKeys.create('local', 'admin', ['*']);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: h.path,
          payload: {},
          headers: { authorization: `Bearer ${key.token}` },
        })
      ).statusCode,
    ).toBe(401);
    const headers = signed(t, '{"a":1}');
    expect(
      (await t.app.inject({ method: 'POST', url: h.path, payload: '{ "a": 1 }', headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ method: 'POST', url: h.path, payload: '{"a":1}', headers })).statusCode,
    ).toBe(202);
    expect(
      (await t.app.inject({ method: 'POST', url: h.path, payload: '{"a":1}', headers })).statusCode,
    ).toBe(409);
    await t.idle();
  });
  it.each([-300001, -299999, 299999, 300001])(
    '13: timestamp window boundary %i ms',
    async (delta) => {
      const t = await app();
      const h = await hook(t);
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: h.path,
            payload: '{}',
            headers: signed(t, '{}', delta),
          })
        ).statusCode,
      ).toBe(Math.abs(delta) < 300000 ? 202 : 401);
      await t.idle();
    },
  );
  it('13: byte limit, 61st delivery and deleted endpoint are rejected', async () => {
    const t = await app();
    const h = await hook(t);
    const big = 'x'.repeat(1024 * 1024 + 1);
    expect(
      (await t.app.inject({ method: 'POST', url: h.path, payload: big, headers: signed(t, big) }))
        .statusCode,
    ).toBe(413);
    for (let i = 0; i < 60; i++)
      expect((await t.app.inject({ method: 'POST', url: h.path, payload: {} })).statusCode).toBe(
        401,
      );
    const limited = await t.app.inject({ method: 'POST', url: h.path, payload: {} });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${h.id}` })).statusCode).toBe(204);
    expect(
      (await t.app.inject({ method: 'POST', url: h.path, payload: '{}', headers: signed(t, '{}') }))
        .statusCode,
    ).toBe(404);
  });

  it.each([1, 2, 10])(
    '14: event chain with %i loops terminates without repetition',
    async (count) => {
      const t = await app();
      for (let i = 0; i < count; i++)
        await t.publishLoop(
          triggerLoop(
            `event-${i}`,
            { subtype: 'event', eventType: `event-${i}` },
            `event-${(i + 1) % count}`,
          ),
        );
      const response = await t.app.inject({
        method: 'POST',
        url: '/events',
        payload: { type: 'event-0', payload: null },
      });
      expect(response.statusCode).toBe(202);
      await t.idle();
      const runs = await t.container.repos.runs.list({});
      expect(runs).toHaveLength(Math.min(count, 8));
      expect(new Set(runs.map((r) => r.loopId)).size).toBe(runs.length);
      expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
    },
  );

  it('15: a draft cron is not armed', async () => {
    const t = await app();
    const response = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: triggerLoop('draft-cron', { subtype: 'cron', expression: '* * * * *' }),
      },
    });
    const id = response.json<{ loop: { id: string } }>().loop.id;
    const triggers = (await t.app.inject(`/loops/${id}/triggers`)).json<{ schedules: unknown[] }>();
    expect(triggers.schedules).toEqual([]);
  });

  it('4: deletion is refused while a version is pinned by an active run', async () => {
    const t = await app();
    const def = minimalLoop();
    def.nodes.push({
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'input', prompt: '?' },
    });
    def.edges[0] = { id: 'first', from: { node: 'start', port: 'out' }, to: { node: 'wait' } };
    def.edges.push({ id: 'next', from: { node: 'wait', port: 'out' }, to: { node: 'done' } });
    const id = await t.publishLoop(def);
    const r = await start(t, id);
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${id}` })).statusCode).toBe(409);
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: minimalLoop() },
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
    await t.container.manager.provideInput(r.id, 'original');
    await t.idle();
    expect((await t.container.manager.getRun(r.id))?.versionId).toBe(r.versionId);
    expect((await t.container.manager.getThread(r.id))?.outputs['wait']?.value).toBe('original');
  });

  it('16: disconnect during replay validation unsubscribes before headers are sent', async () => {
    const t = await app();
    const r = await start(t, await t.publishLoop(minimalLoop()));
    let release!: () => void;
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = t.container.ports.events.read.bind(t.container.ports.events);
    vi.spyOn(t.container.ports.events, 'read').mockImplementation(async (...args) => {
      await parked;
      return read(...args);
    });
    const unsubscribe = vi.fn();
    const subscribe = t.container.ports.events.subscribe.bind(t.container.ports.events);
    vi.spyOn(t.container.ports.events, 'subscribe').mockImplementation((...args) => {
      const dispose = subscribe(...args);
      return () => {
        unsubscribe();
        dispose();
      };
    });
    const base = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    try {
      let settled = false;
      const pending = fetch(`${base}/runs/${r.id}/events`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      }).then(
        (response) => {
          settled = true;
          return response;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await vi.waitFor(() => expect(t.container.ports.events.subscribe).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      controller.abort();
      expect(await pending).toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    } finally {
      controller.abort();
      release();
    }
  });

  it.each(['99999', '-1', 'not-a-number'])(
    '16: terminal SSE with Last-Event-ID %s always closes',
    async (cursor) => {
      const t = await app();
      const r = await start(t, await t.publishLoop(minimalLoop()));
      const response = await t.app.inject({
        url: `/runs/${r.id}/events`,
        headers: { accept: 'text/event-stream', 'last-event-id': cursor },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(': connected');
      if (cursor === '99999') expect(response.body).not.toContain('id: ');
      else expect(response.body).toContain('event: run.finished');
    },
  );
  it('16: 1000 persisted events stream in sequence without duplicates', async () => {
    const t = await app();
    const def = minimalLoop();
    def.nodes[1] = {
      id: 'done',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'input', prompt: '?' },
    };
    // This is an engine store fixture: publication requires an exit, so retain an unreachable exit.
    def.nodes.push({ id: 'exit', kind: 'exit', label: 'Exit', config: {} });
    def.edges.push({ id: 'end', from: { node: 'done', port: 'out' }, to: { node: 'exit' } });
    const r = await start(t, await t.publishLoop(def));
    const before = await t.container.ports.events.read(r.id);
    await t.container.ports.events.append(
      r.id,
      Array.from({ length: 999 - before.length }, () => ({
        type: 'signal.received' as const,
        name: 'burst',
        payload: null,
      })),
    );
    await t.container.ports.events.append(r.id, [
      { type: 'run.finished', status: 'succeeded', outcome: 'success' },
    ]);
    await t.container.repos.runs.update(r.id, { status: 'succeeded' });
    const res = await t.app.inject({
      url: `/runs/${r.id}/events`,
      headers: { accept: 'text/event-stream' },
    });
    expect([...res.body.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))).toEqual(
      Array.from({ length: 1000 }, (_, i) => i + 1),
    );
  });

  it('17: traversal, long paths, and Range cannot disclose files outside static root', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'gg-adversarial-static-'));
    try {
      await writeFile(join(dist, 'index.html'), '<title>SAFE SHELL</title>');
      const t = await app({ env: { GG_WEB_DIST: dist } });
      for (const path of [
        '/app/../package.json',
        '/app/%2e%2e/package.json',
        '/app/%2e%2e%2fpackage.json',
        '/app/..%5cpackage.json',
        '/app/%252e%252e/package.json',
        '/app/' + 'x'.repeat(9000),
      ]) {
        const response = await t.app.inject(path);
        expect(response.body).not.toContain('"dependencies"');
        expect(response.statusCode).toBeLessThan(500);
      }
      const response = await t.app.inject({
        url: '/app/index.html',
        headers: { range: 'bytes=0-5' },
      });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe('<title');
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  it('18: secrets never appear in read responses or invalid-request errors', async () => {
    const t = await app();
    const secret = 'unique-secret-ADV-18';
    const write = await t.app.inject({
      method: 'PUT',
      url: '/secrets/test',
      payload: { value: secret },
    });
    expect(write.body).not.toContain(secret);
    for (const url of ['/secrets', '/secrets/test', '/openapi.json', '/settings', '/events'])
      expect((await t.app.inject(url)).body).not.toContain(secret);
    const error = await t.app.inject({
      method: 'PUT',
      url: '/secrets/test',
      payload: { value: { secret } },
    });
    expect(error.statusCode).toBe(400);
    expect(error.body).not.toContain(secret);
    expect(JSON.stringify(t.logger.lines)).not.toContain(secret);
    await expect(loadMasterKey({ dataDir: t.dataDir, masterKey: 'bad' })).rejects.toThrow(
      /32 bytes/,
    );
    await writeFile(join(t.dataDir, 'master.key'), 'corrupt');
    await expect(loadMasterKey({ dataDir: t.dataDir })).rejects.toThrow(/32-byte/);
  });

  it('19: malformed JSON, 10 MB bodies, strict unknowns and numeric strings are rejected', async () => {
    const t = await app();
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: '{bad',
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/events',
          payload: 'x'.repeat(10 * 1024 * 1024),
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(413);
    for (const definition of [
      { ...minimalLoop(), unknown: 1 },
      { ...minimalLoop(), settings: { maxIterations: '3' } },
    ])
      expect(
        (await t.app.inject({ method: 'POST', url: '/loops', payload: { definition } })).statusCode,
      ).toBe(400);
  });
  it('ADV-004 review: a parent started during a DELETE never pins the deleted loop', async () => {
    const t = await app();
    const child = await t.publishLoop({ ...minimalLoop(), name: 'racing-child' });
    const def = minimalLoop();
    def.name = 'racing-parent';
    def.nodes.push(
      { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: '?' } },
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child } } },
    );
    def.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
      { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'sub' } },
      { id: 'c', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ];
    const parent = await t.publishLoop(def);
    const disarm = t.container.triggers.disarmLoop.bind(t.container.triggers);
    let started: Promise<{ statusCode: number; json: <T>() => T }> | undefined;
    // The parent's start request arrives between the in-use check and the deletion.
    vi.spyOn(t.container.triggers, 'disarmLoop').mockImplementationOnce(async (id) => {
      started = t.app.inject({ method: 'POST', url: `/loops/${parent}/runs`, payload: {} });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return disarm(id);
    });
    const deleted = await t.app.inject({ method: 'DELETE', url: `/loops/${child}` });
    expect(deleted.statusCode).toBe(204);
    const response = await started!;
    expect(response.statusCode).toBe(202);
    const runId = response.json<{ run: RunRecord }>().run.id;
    const [queued] = await t.container.repos.events.read(runId, 0, 1);
    expect(queued).not.toHaveProperty('subloopVersions');
    await t.idle();
    await t.container.manager.provideInput(runId, null);
    await t.idle();
    // It started after the deletion: nothing was pinned, and the subloop fails as for any
    // reference to a deleted loop, instead of a pinned version vanishing underneath it.
    expect((await t.container.manager.getRun(runId))?.failure?.code).toBe('SUBLOOP_NOT_FOUND');
  });

  it('ADV-004 review: a loop an active run can still start as a subloop cannot be deleted', async () => {
    const t = await app();
    const child = await t.publishLoop({ ...minimalLoop(), name: 'pinned-child' });
    const def = minimalLoop();
    def.name = 'waiting-parent';
    def.nodes.push(
      { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: '?' } },
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child } } },
    );
    def.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
      { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'sub' } },
      { id: 'c', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ];
    const parent = await t.publishLoop(def);
    const run = await start(t, parent);
    const refused = await t.app.inject({ method: 'DELETE', url: `/loops/${child}` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'LOOP_IN_USE' });
    await t.container.manager.provideInput(run.id, null);
    await t.idle();
    expect((await t.container.manager.getRun(run.id))?.status).toBe('succeeded');
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${child}` })).statusCode).toBe(204);
  });

  it('ADV-009: every ULID id route validates before repository lookup', async () => {
    const t = await app();
    let checked = 0;
    for (const [path, methods] of Object.entries(t.app.swagger().paths!)) {
      // Classifier catalog ids are URL-safe names, rather than entity ULIDs.
      if (!path.includes('{id}') || path.startsWith('/classifier-models/')) continue;
      for (const method of Object.keys(methods)) {
        if (!['get', 'post', 'put', 'delete'].includes(method)) continue;
        const response = await t.app.inject({
          method: method.toUpperCase() as 'GET',
          url: path.replace('{id}', 'not-a-ulid').replace(/\{[^}]+\}/g, 'x'),
        });
        expect(response.statusCode, `${method} ${path}`).toBe(400);
        expect(response.json(), `${method} ${path}`).toMatchObject({ code: 'VALIDATION_FAILED' });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // A version id is a ULID too.
    const id = await t.publishLoop(minimalLoop());
    expect((await t.app.inject(`/loops/${id}/versions/not-a-ulid`)).statusCode).toBe(400);
  });

  it.each(['missing-terminal', 'usage-only', 'expired-resume'])(
    '8: Codex adapter boundary %s',
    async (scenario) => {
      const t = await app();
      const harness = new CodexHarness({
        clientFactory: () => ({
          startThread: () => ({
            runStreamed: () =>
              Promise.resolve({
                events: asyncIterableOf(
                  scenario === 'usage-only'
                    ? [
                        { type: 'thread.started', thread_id: 's' },
                        {
                          type: 'turn.completed',
                          usage: { input_tokens: 7, output_tokens: 0, cached_input_tokens: 0 },
                        },
                      ]
                    : [{ type: 'thread.started', thread_id: 's' }],
                ),
              }),
          }),
          resumeThread: () => ({
            runStreamed: () => Promise.reject(new Error('session no longer exists')),
          }),
        }),
      });
      const request = {
        workingDirectory: t.dataDir,
        options: { sandbox: 'read-only' as const, approval: 'never' as const, configOverrides: {} },
        turn: { prompt: 'x' },
      };
      const session =
        scenario === 'expired-resume'
          ? harness.resume('gone', request, new AbortController().signal)
          : harness.start(request, new AbortController().signal);
      const events = [];
      for await (const event of session.events) events.push(event);
      if (scenario === 'usage-only') {
        expect(await session.result).toMatchObject({ finalText: '', usage: { inputTokens: 7 } });
      } else await expect(session.result).rejects.toMatchObject({ code: expect.any(String) });
      expect(events.length).toBeGreaterThan(0);
    },
  );
});
