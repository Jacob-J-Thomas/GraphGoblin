import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/test-app.js';
import {
  TemplateInstantiateResponseSchema,
  TemplateListResponseSchema,
} from '@graphgoblin/contracts';
import { LOCAL_OWNER } from '../container.js';
describe('template catalog and instances', () => {
  let app: TestApp | undefined;
  afterEach(async () => {
    await app?.close();
  });
  it('loads the source-only starter, allocates distinct drafts, and preserves the immutable owner binding', async () => {
    app = await createTestApp();
    const listed = await app.app.inject({ method: 'GET', url: '/templates' });
    expect(listed.statusCode, listed.body).toBe(200);
    const { items } = TemplateListResponseSchema.parse(listed.json());
    expect(items.map((entry) => entry.manifest.id)).toEqual(['starter', 'implementation']);
    const settings = items[0]?.defaultSettings;
    expect(settings).not.toBeNull();
    const created = await app.app.inject({
      method: 'POST',
      url: '/templates/starter/instantiate',
      payload: { settings },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { instance } = TemplateInstantiateResponseSchema.parse(created.json());
    const repeated = await app.app.inject({
      method: 'POST',
      url: '/templates/starter/instantiate',
      payload: { settings },
    });
    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(TemplateInstantiateResponseSchema.parse(repeated.json()).instance.parentLoopId).not.toBe(
      instance.parentLoopId,
    );
    expect(instance.loops).toHaveLength(1);
    const parent = await app.container.repos.loops.getLoop(instance.parentLoopId);
    expect(parent?.draftVersionId).toBe(instance.loops[0]?.versionId);
    expect(parent?.currentVersionId).toBeUndefined();
    const stored = await app.container.templates.store.get(LOCAL_OWNER, instance.id);
    expect(stored?.instance).toEqual(instance);
    expect(await app.container.templates.store.get('other', instance.id)).toBeUndefined();
    const received = await app.app.inject({
      method: 'GET',
      url: '/template-instances/' + instance.id,
    });
    expect(received.statusCode).toBe(200);
    expect(received.json()).toEqual(instance);
    const definition = await app.container.repos.loops.getVersion(instance.loops[0]!.versionId);
    expect(
      definition?.definition.nodes.find((node) => node.kind === 'inference')?.config,
    ).toMatchObject({
      session: { policy: 'fresh' },
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
    });
  });
  it('refuses missing role prerequisites, invalid settings, and unknown IDs without creating loops', async () => {
    app = await createTestApp();
    const settings = {
      kind: 'starter',
      instruction: 'Summarize',
      maxIterations: 10,
      roles: { assistant: { harness: 'codex', model: 'not-in-catalog', effort: 'low' } },
    };
    const checked = await app.app.inject({
      method: 'POST',
      url: '/templates/starter/prerequisites',
      payload: { settings },
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({ canInstantiate: false, canRun: false });
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/instantiate',
          payload: { settings },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/instantiate',
          payload: { settings: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.app.inject({ method: 'GET', url: '/templates/absent' })).statusCode).toBe(
      404,
    );
    expect(
      (
        await app.app.inject({
          method: 'GET',
          url: '/template-instances/00000000000000000000000000',
        })
      ).statusCode,
    ).toBe(404);
    expect(await app.container.repos.loops.listLoops(LOCAL_OWNER)).toEqual([]);
  });
  it('uses loops read/write scopes and owner isolation without a new template scope', async () => {
    app = await createTestApp({ requireApiKey: true });
    const key = await app.container.repos.apiKeys.create(LOCAL_OWNER, 'read only', ['loops:read']);
    const headers = { authorization: 'Bearer ' + key.token };
    const listed = await app.app.inject({ method: 'GET', url: '/templates', headers });
    expect(listed.statusCode).toBe(200);
    const settings = TemplateListResponseSchema.parse(listed.json()).items[0]!.defaultSettings;
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/prerequisites',
          payload: { settings },
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/instantiate',
          payload: { settings },
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.app.inject({ method: 'GET', url: '/templates' })).statusCode).toBe(401);
  });
});

describe('editable starter execution', () => {
  let app: TestApp | undefined;
  afterEach(async () => {
    await app?.close();
  });
  async function editedStarter() {
    app = await createTestApp();
    const entry = TemplateListResponseSchema.parse(
      (await app.app.inject({ method: 'GET', url: '/templates' })).json(),
    ).items[0]!;
    const created = TemplateInstantiateResponseSchema.parse(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/instantiate',
          payload: { settings: entry.defaultSettings },
        })
      ).json(),
    ).instance;
    const version = await app.container.repos.loops.getVersion(created.loops[0]!.versionId);
    if (!version) throw new Error('missing starter draft');
    const current = version.definition.nodes.find((node) => node.kind === 'inference');
    if (!current || current.kind !== 'inference') throw new Error('missing starter inference');
    const alternative = (await app.container.repos.catalog.list()).find(
      (model) => model.harness === 'codex' && model.enabled && model.model !== current.config.model,
    );
    if (!alternative) throw new Error('missing alternative fixture model');
    current.config.model = alternative.model;
    current.config.effort = alternative.defaultEffort;
    current.config.prompt.template =
      'An edited instruction with {{ invocation.trigger.payload | json }}';
    await app.container.repos.loops.saveDraft(created.parentLoopId, version.definition);
    const publish = await app.app.inject({
      method: 'POST',
      url: '/loops/' + created.parentLoopId + '/publish',
    });
    expect(publish.statusCode, publish.body).toBe(200);
    return { instance: created, model: alternative.model };
  }
  it('retains instance metadata while allowing an edited instruction/model and later published versions', async () => {
    const { instance, model } = await editedStarter();
    const started = await app!.app.inject({
      method: 'POST',
      url: '/loops/' + instance.parentLoopId + '/runs',
      payload: { input: 'hello' },
    });
    expect(started.statusCode, started.body).toBe(202);
    await app!.idle();
    expect(
      await app!.container.repos.runs.get(started.json<{ run: { id: string } }>().run.id),
    ).toMatchObject({ status: 'succeeded' });
    expect(app!.harness.started[0]?.model).toBe(model);
    const retained = await app!.container.templates.get(LOCAL_OWNER, instance.id);
    expect(retained.settings).toEqual(instance.settings);
    const published = await app!.container.repos.loops.getLatestPublished(instance.parentLoopId);
    if (!published) throw new Error('missing published version');
    published.definition.name = 'Another edited version';
    await app!.container.repos.loops.saveDraft(instance.parentLoopId, published.definition);
    expect(
      (
        await app!.app.inject({
          method: 'POST',
          url: '/loops/' + instance.parentLoopId + '/publish',
        })
      ).statusCode,
    ).toBe(200);
    const newer = await app!.app.inject({
      method: 'POST',
      url: '/loops/' + instance.parentLoopId + '/runs',
      payload: {},
    });
    expect(newer.statusCode, newer.body).toBe(202);
    await app!.idle();
    expect(
      await app!.container.repos.runs.get(newer.json<{ run: { id: string } }>().run.id),
    ).toMatchObject({ status: 'succeeded' });
  });
  it('resumes an ordinary starter inference failure and rechecks repaired readiness before retrying', async () => {
    const { instance } = await editedStarter();
    app!.harness.script([
      { error: { code: 'harness_quota_exhausted', message: 'quota exhausted' } },
    ]);
    const started = await app!.app.inject({
      method: 'POST',
      url: '/loops/' + instance.parentLoopId + '/runs',
      payload: {},
    });
    expect(started.statusCode, started.body).toBe(202);
    await app!.idle();
    const id = started.json<{ run: { id: string } }>().run.id;
    expect(await app!.container.repos.runs.get(id)).toMatchObject({
      status: 'failed',
      failure: { code: 'HARNESS_QUOTA_EXHAUSTED', resumable: true },
    });
    expect(app!.harness.started).toHaveLength(1);
    app!.harness.preflightResult = { ok: false, authenticated: false, problems: ['fixture'] };
    const unavailable = await app!.app.inject({
      method: 'POST',
      url: '/runs/' + id + '/resume',
      payload: {},
    });
    expect(unavailable.statusCode, unavailable.body).toBe(200);
    await app!.idle();
    expect(await app!.container.repos.runs.get(id)).toMatchObject({
      status: 'failed',
      failure: { code: 'TEMPLATE_PREREQUISITE_UNAVAILABLE', resumable: true },
    });
    expect(app!.harness.started).toHaveLength(1);
    expect(app!.harness.resumed).toHaveLength(0);
    app!.harness.preflightResult = { ok: true, authenticated: true, problems: [] };
    app!.harness.script([{ finalText: 'Recovered starter output' }]);
    const resumed = await app!.app.inject({
      method: 'POST',
      url: '/runs/' + id + '/resume',
      payload: {},
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    await app!.idle();
    expect(await app!.container.repos.runs.get(id)).toMatchObject({ id, status: 'succeeded' });
    expect(app!.harness.started).toHaveLength(1);
    expect(app!.harness.resumed).toHaveLength(1);
    expect(
      (await app!.container.repos.events.read(id)).filter((event) => event.type === 'run.resumed'),
    ).toHaveLength(2);
  });
  it('refuses the actual current harness account before any node or provider turn', async () => {
    const { instance } = await editedStarter();
    app!.harness.preflightResult = { ok: false, authenticated: false, problems: ['fixture'] };
    const started = await app!.app.inject({
      method: 'POST',
      url: '/loops/' + instance.parentLoopId + '/runs',
      payload: {},
    });
    expect(started.statusCode, started.body).toBe(202);
    await app!.idle();
    const id = started.json<{ run: { id: string } }>().run.id;
    expect(await app!.container.repos.runs.get(id)).toMatchObject({
      status: 'failed',
      failure: { code: 'TEMPLATE_PREREQUISITE_UNAVAILABLE' },
    });
    expect(app!.harness.started).toHaveLength(0);
    expect(
      (await app!.container.repos.events.read(id)).some((event) => event.type === 'node.started'),
    ).toBe(false);
  });
});
