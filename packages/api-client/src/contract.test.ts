/**
 * Contract tests: the client against the real API, booted in-process over an in-memory database
 * with fake harnesses, listening on an ephemeral port.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  LoopDefinitionInput as ContractLoopDefinition,
  RunEvent,
} from '@graphgoblin/contracts';
import { fakeUlid, legacyHarnessLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import {
  apiKeys,
  createGraphGoblinClient,
  events,
  GraphGoblinApiError,
  loops,
  modelCatalog,
  runs,
  secrets,
  settings,
  subscribeRunEvents,
  system,
  waitForRun,
  type GraphGoblinClient,
} from './index.js';

const waitLoop: ContractLoopDefinition = {
  schemaVersion: 1,
  name: 'wait-for-input',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
    { id: 'wait', kind: 'wait', label: 'W', config: { mode: 'input', prompt: 'go?' } },
    { id: 'done', kind: 'exit', label: 'D', config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};

async function listen(t: TestApp): Promise<string> {
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
}

async function until(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('against the in-process API (local trusted mode)', () => {
  let t: TestApp;
  let baseUrl: string;
  let client: GraphGoblinClient;

  beforeAll(async () => {
    t = await createTestApp();
    baseUrl = await listen(t);
    client = createGraphGoblinClient({ baseUrl: `${baseUrl}/` });
  });
  afterAll(async () => {
    await t.close();
  });

  it('reads system endpoints', async () => {
    expect(await system.health(client)).toEqual({ status: 'ok' });
    expect((await system.version(client)).name).toBe('graphgoblin-api');
    const preflight = await system.preflight(client);
    expect(preflight[0]?.harness).toBe('codex');
    const installation = await system.installation(client);
    expect(installation.checks.find((c) => c.id === 'database')?.status).toBe('ok');
  });

  it('reads, runs and replays an old stored loop through the generated client', async () => {
    const created = await loops.create(client, minimalLoop());
    const published = await loops.publish(client, created.loop.id);
    await t.container.handle.client.execute({
      sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
      args: [JSON.stringify(legacyHarnessLoop()), published.id],
    });
    const detail = await loops.get(client, created.loop.id);
    expect(detail.current?.definition.settings.defaults).not.toHaveProperty('harness');
    expect(detail.current?.definition.nodes[1]).toMatchObject({ config: { harness: 'codex' } });
    const exported = await loops.export(client, created.loop.id);
    const imported = await loops.import(client, exported);
    expect(imported.draft.definition).toEqual(exported.loop);
    const started = await runs.start(client, created.loop.id, {});
    await t.idle();
    expect((await runs.get(client, started.id)).status).toBe('succeeded');
    const replay = await runs.replay(client, started.id, 'infer');
    await t.idle();
    expect((await runs.get(client, replay.id)).status).toBe('succeeded');
  });

  it('manages a loop through its whole lifecycle', async () => {
    const created = await loops.create(client, minimalLoop());
    const loopId = created.loop.id;
    expect(created.issues).toEqual([]);
    expect((await loops.list(client)).map((l) => l.id)).toContain(loopId);

    const renamed = { ...minimalLoop(), name: 'renamed' };
    const token = (await loops.get(client, loopId)).draftToken as string;
    const saved = await loops.saveDraft(client, loopId, renamed, { ifMatch: token });
    expect(saved.draft.definition.name).toBe('renamed');
    expect(saved.draftToken).not.toBe(token);
    // A second save from the same stale copy is a conflict carrying the server's token.
    const conflict = await loops
      .saveDraft(client, loopId, { ...renamed, name: 'stale' }, { ifMatch: token })
      .catch((error: unknown) => error);
    expect(conflict).toMatchObject({
      status: 409,
      code: 'DRAFT_CONFLICT',
      problem: { draftToken: saved.draftToken },
    });
    expect(await loops.validate(client, loopId, renamed)).toEqual({
      issues: [],
      publishable: true,
    });

    const version = await loops.publish(client, loopId);
    expect(version.loopId).toBe(loopId);
    const detail = await loops.get(client, loopId);
    expect(detail.current?.id).toBe(version.id);

    const history = await loops.versions(client, loopId);
    expect(history.map((v) => v.id)).toContain(version.id);
    expect((await loops.version(client, loopId, version.id)).id).toBe(version.id);

    const exported = await loops.export(client, loopId);
    expect(exported.loop.name).toBe('renamed');
    await loops.saveDraft(client, loopId, { ...renamed, name: 'next draft' });
    expect((await loops.export(client, loopId, { draft: true })).loop.name).toBe('next draft');

    const imported = await loops.import(client, exported);
    expect(imported.loop.id).not.toBe(loopId);

    await loops.remove(client, imported.loop.id);
    await expect(loops.get(client, imported.loop.id)).rejects.toMatchObject({
      name: 'GraphGoblinApiError',
      status: 404,
      code: 'LOOP_NOT_FOUND',
    });
  });

  it('turns problem details into GraphGoblinApiError, including validation errors', async () => {
    const error = await runs.get(client, fakeUlid('missing')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphGoblinApiError);
    expect(error).toMatchObject({ status: 404, code: 'RUN_NOT_FOUND' });
    expect((error as GraphGoblinApiError).problem?.type).toMatch(/run-not-found$/);

    const invalid = await secrets.set(client, '1-bad-name', 'x').catch((e: unknown) => e);
    expect(invalid).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect((invalid as GraphGoblinApiError).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.any(String) })]),
    );
  });

  it('starts a run, waits for it, and inspects it', async () => {
    const { loop } = await loops.create(client, minimalLoop());
    await loops.publish(client, loop.id);
    const started = await runs.start(client, loop.id);
    const { run, finished } = await waitForRun(client, started.id, {
      timeoutMs: 5000,
      pollMs: 10,
    });
    expect(finished).toBe(true);
    expect(run.status).toBe('succeeded');

    expect((await runs.list(client, { loopId: loop.id })).map((r) => r.id)).toEqual([run.id]);
    expect((await runs.thread(client, run.id)).invocation.source).toBe('manual.api');
    const page = await runs.events(client, run.id, { after: 0, limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextAfter).toBe(page.items[1]?.seq);
    expect(await runs.sessions(client, run.id)).toEqual([]);
  });

  it('drives a waiting run: input, signals, pause, resume, cancel', async () => {
    const { loop } = await loops.create(client, waitLoop);
    await loops.publish(client, loop.id);

    const first = await runs.start(client, loop.id, { input: { topic: 'x' } });
    await until(async () => (await runs.get(client, first.id)).status === 'waiting');
    const pending = await waitForRun(client, first.id, { timeoutMs: 30, pollMs: 10 });
    expect(pending).toMatchObject({ finished: false, run: { status: 'waiting' } });
    expect((await runs.signal(client, first.id, 'nudge')).woke).toBe(false);
    expect((await runs.signal(client, first.id, 'nudge', { n: 1 })).woke).toBe(false);
    await runs.provideInput(client, first.id, { ok: true });
    expect((await waitForRun(client, first.id, { timeoutMs: 5000, pollMs: 10 })).run.status).toBe(
      'succeeded',
    );
    const fork = await runs.replay(client, first.id, 'start');
    expect(fork.id).not.toBe(first.id);
    await until(async () => (await runs.get(client, fork.id)).status === 'waiting');
    expect((await runs.thread(client, fork.id)).invocation.replayOf).toEqual({
      runId: first.id,
      nodeId: 'start',
    });

    const second = await runs.start(client, loop.id);
    await until(async () => (await runs.get(client, second.id)).status === 'waiting');
    expect((await runs.pause(client, second.id)).status).toBe('paused');
    expect((await runs.resume(client, second.id)).status).toBe('waiting'); // paused while parked: back to waiting (docs/05)
    await until(async () => (await runs.get(client, second.id)).status === 'waiting');
    await runs.cancel(client, second.id);
    expect((await waitForRun(client, second.id, { timeoutMs: 5000, pollMs: 10 })).run.status).toBe(
      'cancelled',
    );
  });

  it('streams run events over SSE until the run finishes, and resumes from a sequence', async () => {
    const { loop } = await loops.create(client, waitLoop);
    await loops.publish(client, loop.id);
    const run = await runs.start(client, loop.id);
    await until(async () => (await runs.get(client, run.id)).status === 'waiting');

    const seen: RunEvent[] = [];
    const subscription = subscribeRunEvents({
      client,
      runId: run.id,
      onEvent: (event) => {
        seen.push(event);
        if (event.type === 'run.waiting') void runs.provideInput(client, run.id, 'go');
      },
    });
    await subscription.done;
    expect(seen.at(-1)?.type).toBe('run.finished');
    expect(seen.map((e) => e.seq)).toEqual(seen.map((_, i) => i + 1));
    expect(subscription.lastSeq).toBe(seen.at(-1)?.seq);

    const tail: RunEvent[] = [];
    await subscribeRunEvents({
      client,
      runId: run.id,
      after: seen.length - 2,
      onEvent: (event) => {
        tail.push(event);
      },
    }).done;
    expect(tail.map((e) => e.seq)).toEqual([seen.length - 1, seen.length]);
  });

  it('rejects the SSE subscription for an unknown run without retrying', async () => {
    let attempts = 0;
    const subscription = subscribeRunEvents({
      client,
      runId: fakeUlid('missing'),
      onEvent: () => undefined,
      onError: () => {
        attempts += 1;
      },
    });
    await expect(subscription.done).rejects.toMatchObject({ status: 404, code: 'RUN_NOT_FOUND' });
    expect(attempts).toBe(0);
  });

  it('preserves catalog warning paths when validation and publication succeed', async () => {
    const definition = { ...minimalLoop(), settings: { defaults: { model: 'not-in-catalog' } } };
    const { loop } = await loops.create(client, definition);
    const validated = await loops.validate(client, loop.id, definition);
    expect(validated.publishable).toBe(true);
    expect(validated.issues).toEqual([
      expect.objectContaining({
        code: 'MODEL_NOT_IN_CATALOG',
        severity: 'warning',
        path: 'settings.defaults.model',
      }),
    ]);
    const published = await client.POST('/loops/{id}/publish', {
      params: { path: { id: loop.id } },
    });
    expect(published.response.status).toBe(200);
    expect(published.data?.issues).toEqual(validated.issues);
  });

  it('covers settings, secrets, API keys, the model catalog, and inbound events', async () => {
    expect(await settings.update(client, { theme: 'dark' })).toMatchObject({ theme: 'dark' });
    expect(await settings.get(client)).toMatchObject({ theme: 'dark' });
    await settings.remove(client, 'theme');
    expect(await settings.get(client)).not.toHaveProperty('theme');
    await expect(settings.remove(client, 'theme')).rejects.toMatchObject({
      code: 'SETTING_NOT_FOUND',
    });

    expect((await secrets.set(client, 'token', 's3cret')).name).toBe('token');
    expect((await secrets.list(client)).map((s) => s.name)).toContain('token');
    await secrets.remove(client, 'token');

    const created = await apiKeys.create(client, { label: 'ci', scopes: ['loops:read'] });
    expect(created.token).toEqual(expect.any(String));
    expect((await apiKeys.list(client)).map((k) => k.id)).toContain(created.key.id);
    await apiKeys.revoke(client, created.key.id);

    await t.container.repos.catalog.upsert({
      harness: 'codex',
      model: 'test-model',
      source: 'litellm',
      displayName: 'Test',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const entry = await modelCatalog.upsert(client, 'codex', 'test-model', {
      displayName: 'Test',
      efforts: ['low'],
      defaultEffort: 'low',
    });
    expect(entry.source).toBe('litellm');
    expect(entry.enabled).toBe(true);
    expect((await modelCatalog.setEnabled(client, 'codex', 'test-model', false)).enabled).toBe(
      false,
    );
    expect((await modelCatalog.setEnabled(client, 'codex', 'gpt-6-luna', false)).source).toBe(
      'harness',
    );
    await expect(
      modelCatalog.upsert(client, 'codex', 'gpt-6-luna', {
        displayName: 'Edited',
        efforts: ['low'],
        defaultEffort: 'low',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'MODEL_MANAGED_BY_HARNESS' });
    await expect(modelCatalog.remove(client, 'codex', 'gpt-6-luna')).rejects.toMatchObject({
      status: 409,
      code: 'MODEL_MANAGED_BY_HARNESS',
    });
    await expect(modelCatalog.setEnabled(client, 'codex', 'missing', true)).rejects.toMatchObject({
      status: 404,
      code: 'MODEL_NOT_FOUND',
    });
    await expect(
      modelCatalog.upsert(client, 'future', 'new', {
        source: 'litellm',
        displayName: 'New',
        efforts: ['low'],
        defaultEffort: 'low',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'LITELLM_NOT_CONFIGURED' });
    expect((await modelCatalog.list(client)).map((m) => m.model)).toContain('test-model');
    await modelCatalog.remove(client, 'codex', 'test-model');

    const published = await events.publish(client, { type: 'demo', payload: { a: 1 } });
    expect((await events.list(client)).map((e) => e.id)).toContain(published.id);
  });
});

describe('against the in-process API (API keys required)', () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    t = await createTestApp({ requireApiKey: true });
    baseUrl = await listen(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it('sends the bearer key and client kind on REST calls and on the SSE stream', async () => {
    await expect(loops.list(createGraphGoblinClient({ baseUrl }))).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });

    const { token } = await t.container.repos.apiKeys.create('local', 'test', ['*']);
    const client = createGraphGoblinClient({ baseUrl, apiKey: token, client: 'ui' });
    const { loop } = await loops.create(client, minimalLoop());
    await loops.publish(client, loop.id);
    const run = await runs.start(client, loop.id);
    await subscribeRunEvents({ client, runId: run.id, onEvent: () => undefined }).done;
    expect((await runs.thread(client, run.id)).invocation.source).toBe('manual.ui');

    const mcp = createGraphGoblinClient({ baseUrl, apiKey: token, client: 'mcp' });
    const viaMcp = await runs.start(mcp, loop.id);
    await waitForRun(mcp, viaMcp.id, { timeoutMs: 5000, pollMs: 10 });
    expect((await runs.thread(mcp, viaMcp.id)).invocation.source).toBe('manual.mcp');
  });
});
