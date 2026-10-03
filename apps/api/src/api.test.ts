import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunRecord } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid, kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

function waitLoop(name = 'wait'): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
      {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: {
          mode: 'input',
          prompt: 'Approve?',
          inputSchema: { type: 'object', required: ['ok'] },
        },
      },
      { id: 'done', kind: 'exit', label: 'D', config: { return: { mapping: 'lastOutput.value' } } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
      { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

describe('system routes', () => {
  it('serves health, version, openapi, and preflight', async () => {
    expect((await t.app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await t.app.inject('/version')).json()).toMatchObject({ name: 'graphgoblin-api' });
    const openapi = (await t.app.inject('/openapi.json')).json<{
      openapi: string;
      paths: Record<string, unknown>;
    }>();
    expect(openapi.openapi).toBe('3.1.0');
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining(['/loops', '/runs/{id}/events', '/secrets/{name}']),
    );
    const preflight = (await t.app.inject('/harness/preflight')).json<{
      items: { harness: string; ok: boolean }[];
    }>();
    expect(preflight.items).toEqual([
      { harness: 'codex', ok: true, version: 'fake', authenticated: true, problems: [] },
    ]);
    t.harness.preflight = () => Promise.reject(new Error('codex missing'));
    const broken = (await t.app.inject('/harness/preflight')).json<{
      items: { ok: boolean; problems: string[] }[];
    }>();
    expect(broken.items[0]).toMatchObject({ ok: false, problems: ['codex missing'] });
    delete t.container.ports.harnesses.codex;
    const none = (await t.app.inject('/harness/preflight')).json<{
      items: { problems: string[] }[];
    }>();
    expect(none.items[0]?.problems[0]).toMatch(/no harness adapter/);
  });

  it('returns problem details for unknown routes and validation failures', async () => {
    const missing = await t.app.inject('/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(/problem\+json/);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const invalid = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: { nope: true } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('loops', () => {
  it('creates, reads, drafts, validates, publishes, exports, imports, and deletes', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: minimalLoop() },
    });
    expect(created.statusCode).toBe(201);
    const { loop, draft, issues } = created.json<{
      loop: { id: string };
      draft: { id: string; status: string };
      issues: unknown[];
    }>();
    expect(draft.status).toBe('draft');
    expect(issues).toEqual([]);

    expect((await t.app.inject('/loops')).json()).toMatchObject({ items: [{ id: loop.id }] });
    const detail = (await t.app.inject(`/loops/${loop.id}`)).json<{
      draft?: { id: string };
      current?: unknown;
    }>();
    expect(detail.draft?.id).toBe(draft.id);
    expect(detail.current).toBeUndefined();

    const broken = minimalLoop();
    broken.edges = [];
    const validated = (
      await t.app.inject({
        method: 'POST',
        url: `/loops/${loop.id}/validate`,
        payload: { definition: broken },
      })
    ).json<{ publishable: boolean; issues: { code: string }[] }>();
    expect(validated.publishable).toBe(false);
    expect(validated.issues.map((i) => i.code)).toContain('PORT_UNCONNECTED');

    const badDraft = await t.app.inject({
      method: 'PUT',
      url: `/loops/${loop.id}/draft`,
      payload: { definition: broken },
    });
    expect(badDraft.statusCode).toBe(200);
    const rejected = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ code: 'LOOP_INVALID' });

    await t.app.inject({
      method: 'PUT',
      url: `/loops/${loop.id}/draft`,
      payload: { definition: minimalLoop() },
    });
    const published = await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ version: { status: 'published', version: 1 } });
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` })).statusCode,
    ).toBe(409);

    const versions = (await t.app.inject(`/loops/${loop.id}/versions`)).json<{
      items: { id: string }[];
    }>();
    expect(versions.items).toHaveLength(1);
    expect(
      (await t.app.inject(`/loops/${loop.id}/versions/${versions.items[0]!.id}`)).statusCode,
    ).toBe(200);
    expect((await t.app.inject(`/loops/${loop.id}/versions/nope`)).statusCode).toBe(404);

    const exported = await t.app.inject(`/loops/${loop.id}/export`);
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({
      format: 'graphgoblin-loop',
      loop: { name: 'minimal' },
    });
    expect((await t.app.inject(`/loops/${loop.id}/export?draft=true`)).statusCode).toBe(404);

    const imported = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: exported.json<object>(),
    });
    expect(imported.statusCode).toBe(201);
    const importedBare = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: kitchenSinkLoop() as unknown as object,
    });
    expect(importedBare.statusCode).toBe(201);
    const badImport = await t.app.inject({
      method: 'POST',
      url: '/loops/import',
      payload: { hello: 'world' },
    });
    expect(badImport.statusCode).toBe(400);
    expect(badImport.json()).toMatchObject({ code: 'LOOP_IMPORT_ERROR' });

    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loop.id}` })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject(`/loops/${loop.id}`)).statusCode).toBe(404);
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: `/loops/${loop.id}/draft`,
          payload: { definition: minimalLoop() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${loop.id}/publish` })).statusCode,
    ).toBe(404);
  });

  it('refuses to delete a loop with active runs and exports drafts on request', async () => {
    const id = await t.publishLoop(waitLoop());
    const started = await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
    expect(started.statusCode).toBe(202);
    await t.idle();
    const blocked = await t.app.inject({ method: 'DELETE', url: `/loops/${id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'LOOP_IN_USE' });
    await t.app.inject({
      method: 'PUT',
      url: `/loops/${id}/draft`,
      payload: { definition: { ...waitLoop(), name: 'draft-name' } },
    });
    const draftExport = await t.app.inject(`/loops/${id}/export?draft=true`);
    expect(draftExport.json()).toMatchObject({ loop: { name: 'draft-name' } });
    const noDraftLoop = await t.publishLoop(minimalLoop());
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${noDraftLoop}/publish` })).json(),
    ).toMatchObject({ code: 'NO_DRAFT' });
  });
});

describe('runs', () => {
  it('starts a run, lists, reads the thread and events, and streams nothing when complete', async () => {
    const id = await t.publishLoop(minimalLoop());
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${id}/runs`,
      payload: { input: { topic: 'x' } },
      headers: { 'x-graphgoblin-client': 'ui' },
    });
    expect(started.statusCode).toBe(202);
    const { run } = started.json<{ run: RunRecord }>();
    await t.idle();

    const fetched = (await t.app.inject(`/runs/${run.id}`)).json<RunRecord>();
    expect(fetched.status).toBe('succeeded');
    const thread = (await t.app.inject(`/runs/${run.id}/thread`)).json<{
      invocation: { source: string; trigger: { payload: unknown } };
    }>();
    expect(thread.invocation.source).toBe('manual.ui');
    expect(thread.invocation.trigger.payload).toEqual({ topic: 'x' });

    const events = (await t.app.inject(`/runs/${run.id}/events`)).json<{
      items: { type: string; seq: number }[];
      nextAfter: number;
    }>();
    expect(events.items.map((e) => e.type)).toContain('run.finished');
    expect(events.nextAfter).toBe(events.items.at(-1)?.seq);
    const page = (await t.app.inject(`/runs/${run.id}/events?after=${events.nextAfter}`)).json<{
      items: unknown[];
      nextAfter: number;
    }>();
    expect(page.items).toEqual([]);
    expect(page.nextAfter).toBe(events.nextAfter);
    const limited = (await t.app.inject(`/runs/${run.id}/events?limit=2`)).json<{
      items: unknown[];
    }>();
    expect(limited.items).toHaveLength(2);
    const resumed = (
      await t.app.inject({ url: `/runs/${run.id}/events`, headers: { 'last-event-id': '3' } })
    ).json<{ items: { seq: number }[] }>();
    expect(resumed.items[0]?.seq).toBe(4);

    const list = (
      await t.app.inject(`/runs?loopId=${id}&status=succeeded,failed&parent=none&limit=10`)
    ).json<{ items: RunRecord[] }>();
    expect(list.items.map((r) => r.id)).toEqual([run.id]);
    expect((await t.app.inject(`/runs?status=bogus`)).json<{ code: string }>().code).toBeDefined();
    expect(
      (await t.app.inject(`/runs?parent=${run.id}&before=${FIXTURE_TS}`)).json<{
        items: unknown[];
      }>().items,
    ).toEqual([]);
    expect((await t.app.inject(`/runs/${run.id}/sessions`)).json()).toEqual({ items: [] });
    expect((await t.app.inject(`/runs/${run.id}/artifacts/nope`)).statusCode).toBe(404);
  });

  it('controls a waiting run: input validation, signals, pause, resume, cancel', async () => {
    const id = await t.publishLoop(waitLoop());
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    expect((await t.app.inject(`/runs/${run.id}`)).json<RunRecord>().status).toBe('waiting');

    const badInput = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/input`,
      payload: { input: { nope: 1 } },
    });
    expect(badInput.statusCode).toBe(400);
    expect(badInput.json()).toMatchObject({ code: 'INVALID_INPUT' });
    const signal = (
      await t.app.inject({
        method: 'POST',
        url: `/runs/${run.id}/signals/go`,
        payload: { payload: { x: 1 } },
      })
    ).json<{ woke: boolean }>();
    expect(signal.woke).toBe(false);
    expect(
      (await t.app.inject({ method: 'POST', url: `/runs/${run.id}/pause` })).json<RunRecord>()
        .status,
    ).toBe('paused');
    const conflict = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/input`,
      payload: { input: { ok: true } },
    });
    expect(conflict.statusCode).toBe(409);
    expect(
      (await t.app.inject({ method: 'POST', url: `/runs/${run.id}/resume` })).json<RunRecord>()
        .status,
    ).toBe('running');
    await t.idle();
    const provided = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/input`,
      payload: { input: { ok: true } },
    });
    expect(provided.statusCode).toBe(200);
    await t.idle();
    const done = (await t.app.inject(`/runs/${run.id}`)).json<RunRecord>();
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ ok: true });

    const second = (
      await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const cancelled = (
      await t.app.inject({ method: 'POST', url: `/runs/${second.run.id}/cancel` })
    ).json<RunRecord>();
    expect(cancelled.status).toBe('cancelled');
    expect(
      (await t.app.inject({ method: 'POST', url: `/runs/${second.run.id}/cancel` })).statusCode,
    ).toBe(409);
    expect(
      (await t.app.inject({ method: 'POST', url: `/runs/${fakeUlid('nope')}/cancel` })).statusCode,
    ).toBe(404);
    expect(
      (await t.app.inject({ method: 'POST', url: `/loops/${fakeUlid('nope')}/runs`, payload: {} }))
        .statusCode,
    ).toBe(404);
  });

  it('hides runs of other owners and serves artifacts', async () => {
    const id = await t.publishLoop(minimalLoop());
    const version = await t.container.repos.loops.getLatestPublished(id);
    const foreignId = fakeUlid('foreign-run');
    const invocationId = fakeUlid('foreign-invocation');
    const thread = createInitialThread({
      runId: foreignId,
      loopId: id,
      versionId: version!.id,
      invocation: {
        id: invocationId,
        source: 'manual.api',
        trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
      },
    });
    await t.container.repos.runs.create(
      {
        id: foreignId,
        ownerId: 'someone-else',
        loopId: id,
        versionId: version!.id,
        invocationId,
        status: 'succeeded',
        iteration: 1,
        createdAt: FIXTURE_TS,
        lastEventSeq: 0,
      },
      thread,
    );
    expect((await t.app.inject(`/runs/${foreignId}`)).statusCode).toBe(404);
    expect((await t.app.inject(`/runs/${foreignId}/thread`)).statusCode).toBe(404);
    expect((await t.app.inject('/runs')).json<{ items: unknown[] }>().items).toEqual([]);

    t.harness.script([
      { finalText: 'hello from codex', items: [{ id: 'i1', type: 'message', summary: 'hello' }] },
    ]);
    const inferLoop: LoopDefinitionInput = {
      schemaVersion: 1,
      name: 'infer',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'hi' } } },
        { id: 'done', kind: 'exit', label: 'D', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
        { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const inferId = await t.publishLoop(inferLoop);
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${inferId}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const withArtifacts = (await t.app.inject(`/runs/${run.id}/thread`)).json<{
      artifacts: { id: string }[];
    }>();
    expect(withArtifacts.artifacts).toHaveLength(1);
    const artifact = await t.app.inject(
      `/runs/${run.id}/artifacts/${withArtifacts.artifacts[0]!.id}`,
    );
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers['content-type']).toMatch(/json/);
    expect(artifact.body).toContain('hello');
    const sessions = (await t.app.inject(`/runs/${run.id}/sessions`)).json<{
      items: { sessionId: string; status: string }[];
    }>();
    expect(sessions.items[0]).toMatchObject({ sessionId: 'fake-session-1', status: 'finished' });
  });
});

describe('settings, secrets, api keys, catalog, events', () => {
  it('round-trips settings and secrets without exposing values', async () => {
    expect((await t.app.inject('/settings')).json()).toEqual({});
    expect(
      (
        await t.app.inject({
          method: 'PUT',
          url: '/settings',
          payload: { defaultModel: 'gpt-6-luna', nested: { a: 1 } },
        })
      ).json(),
    ).toEqual({ defaultModel: 'gpt-6-luna', nested: { a: 1 } });
    expect((await t.app.inject({ method: 'DELETE', url: '/settings/nested' })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject({ method: 'DELETE', url: '/settings/nested' })).statusCode).toBe(
      404,
    );

    const put = await t.app.inject({
      method: 'PUT',
      url: '/secrets/jev-key',
      payload: { value: 'super-secret' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('super-secret');
    const list = await t.app.inject('/secrets');
    expect(list.json()).toMatchObject({ items: [{ name: 'jev-key' }] });
    expect(list.body).not.toContain('super-secret');
    expect(await t.container.ports.secrets.resolve('jev-key')).toBe('super-secret');
    expect(
      (await t.app.inject({ method: 'PUT', url: '/secrets/bad name!', payload: { value: 'x' } }))
        .statusCode,
    ).toBe(400);
    expect((await t.app.inject({ method: 'DELETE', url: '/secrets/jev-key' })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject({ method: 'DELETE', url: '/secrets/jev-key' })).statusCode).toBe(
      404,
    );
  });

  it('manages api keys and the model catalog', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: { label: 'ci' },
    });
    expect(created.statusCode).toBe(201);
    const { key, token } = created.json<{
      key: { id: string; scopes: string[] };
      token: string;
    }>();
    expect(key.scopes).toEqual(['*']);
    expect(token).toMatch(/^gg_/);
    const listed = (await t.app.inject('/api-keys')).json<{ items: { id: string }[] }>();
    expect(listed.items.map((k) => k.id)).toEqual([key.id]);
    expect((await t.app.inject({ method: 'DELETE', url: `/api-keys/${key.id}` })).statusCode).toBe(
      204,
    );
    expect((await t.app.inject({ method: 'DELETE', url: `/api-keys/${key.id}` })).statusCode).toBe(
      404,
    );

    const catalog = (await t.app.inject('/model-catalog')).json<{ items: { model: string }[] }>();
    expect(catalog.items.map((m) => m.model)).toContain('gpt-6-luna');
    const upsert = await t.app.inject({
      method: 'PUT',
      url: '/model-catalog/codex/gpt-7-test',
      payload: { displayName: 'Test', efforts: ['low', 'high'], defaultEffort: 'low' },
    });
    expect(upsert.statusCode).toBe(200);
    expect(upsert.json()).toMatchObject({ model: 'gpt-7-test', enabled: true });
    const inconsistent = await t.app.inject({
      method: 'PUT',
      url: '/model-catalog/codex/gpt-7-test',
      payload: { displayName: 'Test', efforts: ['low'], defaultEffort: 'max' },
    });
    expect(inconsistent.statusCode).toBe(400);
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/model-catalog/codex/gpt-7-test' })).statusCode,
    ).toBe(204);
    expect(
      (await t.app.inject({ method: 'DELETE', url: '/model-catalog/codex/gpt-7-test' })).statusCode,
    ).toBe(404);
  });

  it('publishes and lists inbound events', async () => {
    const published = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'issue-ready', payload: { n: 1 }, dedupeKey: 'k' },
    });
    expect(published.statusCode).toBe(202);
    expect(published.json()).toMatchObject({
      type: 'issue-ready',
      payload: { n: 1 },
      dedupeKey: 'k',
      ownerId: 'local',
    });
    await t.app.inject({ method: 'POST', url: '/events', payload: { type: 'second' } });
    const list = (await t.app.inject('/events')).json<{ items: { type: string }[] }>();
    expect(list.items.map((e) => e.type)).toEqual(['second', 'issue-ready']);
  });
});

describe('authentication', () => {
  it('rejects bad keys in local mode and honours scopes', async () => {
    const bad = await t.app.inject({ url: '/loops', headers: { authorization: 'Bearer gg_nope' } });
    expect(bad.statusCode).toBe(401);
    const malformed = await t.app.inject({
      url: '/loops',
      headers: { authorization: 'Basic abc' },
    });
    expect(malformed.statusCode).toBe(401);
    const created = (
      await t.app.inject({
        method: 'POST',
        url: '/api-keys',
        payload: { label: 'reader', scopes: ['loops:read'] },
      })
    ).json<{ token: string }>();
    const headers = { authorization: `Bearer ${created.token}` };
    expect((await t.app.inject({ url: '/loops', headers })).statusCode).toBe(200);
    const forbidden = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: minimalLoop() },
      headers,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: 'FORBIDDEN' });
    const wildcard = (
      await t.app.inject({
        method: 'POST',
        url: '/api-keys',
        payload: { label: 'admin', scopes: ['*'] },
      })
    ).json<{ token: string }>();
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/loops',
          payload: { definition: minimalLoop() },
          headers: { authorization: `Bearer ${wildcard.token}` },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('requires a key when configured, except for public routes', async () => {
    const strict = await createTestApp({ requireApiKey: true });
    try {
      expect((await strict.app.inject('/healthz')).statusCode).toBe(200);
      expect((await strict.app.inject('/openapi.json')).statusCode).toBe(200);
      expect((await strict.app.inject('/loops')).statusCode).toBe(401);
      const { token } = await strict.container.repos.apiKeys.create('local', 'bootstrap', ['*']);
      expect(
        (await strict.app.inject({ url: '/loops', headers: { authorization: `Bearer ${token}` } }))
          .statusCode,
      ).toBe(200);
      const scoped = await strict.container.repos.apiKeys.create('local', 'mcp', ['runs:write']);
      const id = await strict.publishLoop(minimalLoop(), { authorization: `Bearer ${token}` });
      const started = await strict.app.inject({
        method: 'POST',
        url: `/loops/${id}/runs`,
        payload: {},
        headers: { authorization: `Bearer ${scoped.token}`, 'x-graphgoblin-client': 'mcp' },
      });
      expect(started.statusCode).toBe(202);
      await strict.idle();
      const run = started.json<{ run: RunRecord }>().run;
      const thread = (
        await strict.app.inject({
          url: `/runs/${run.id}/thread`,
          headers: { authorization: `Bearer ${scoped.token}` },
        })
      ).json<{ invocation: { source: string; caller: { kind: string } } }>();
      expect(thread.invocation.source).toBe('manual.mcp');
      expect(thread.invocation.caller.kind).toBe('api-key');
    } finally {
      await strict.close();
    }
  });
});
