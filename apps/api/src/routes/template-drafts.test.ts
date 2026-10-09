import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplateDraftResponseSchema } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from '../testing/test-app.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createDraft(kind: string, name?: string) {
  const response = await app!.app.inject({
    method: 'POST',
    url: '/templates/' + kind + '/draft',
    payload: name === undefined ? {} : { name },
  });
  expect(response.statusCode, response.body).toBe(201);
  return TemplateDraftResponseSchema.parse(response.json());
}

describe('editable template starting points', () => {
  it.each(['starter', 'implementation', 'review', 'qa'])(
    'creates exactly one ordinary %s draft without credentials, readiness or repository settings',
    async (kind) => {
      app = await createTestApp({ env: { GG_DEFAULTS: '{"byHarness":{}}' } });
      app.harness.preflightResult = { ok: false, authenticated: false, problems: ['unavailable'] };
      const preflight = vi.spyOn(app.harness, 'preflight');
      const created = await createDraft(kind);
      expect(created.loop).not.toHaveProperty('currentVersionId');
      expect(created.draft.status).toBe('draft');
      expect(created.issues).toContainEqual(expect.objectContaining({ code: 'MODEL_UNRESOLVED' }));
      expect(created.draft.definition.settings.workingDirectory).toEqual({ kind: 'temp' });
      expect(
        created.draft.definition.nodes.filter((node) => node.kind === 'inference'),
      ).not.toHaveLength(0);
      for (const node of created.draft.definition.nodes) {
        expect(['script', 'subloop', 'heartbeat']).not.toContain(node.kind);
        if (node.kind === 'trigger') expect(node.config.subtype).toBe('manual');
        if (node.kind === 'inference') {
          expect(node.config.model).toBeUndefined();
          expect(node.config.effort).toBeUndefined();
          expect(node.config.prompt.template).toContain('invocation.trigger.payload');
          expect(node.config.session).toEqual({ policy: 'fresh' });
          expect(node.config.harnessOptions.networkAccess).toBe(false);
          expect(node.config.timeoutSeconds).toBeGreaterThan(0);
        }
      }
      expect(await app.container.repos.loops.listLoops('local')).toHaveLength(1);
      expect(await app.container.repos.loops.listVersions(created.loop.id)).toEqual([
        created.draft,
      ]);
      expect(
        await app.container.templates.store.bindingForLoop('local', created.loop.id),
      ).toBeUndefined();
      expect(
        (await app.app.inject({ method: 'GET', url: '/loops/' + created.loop.id })).json(),
      ).not.toHaveProperty('templateInstanceId');
      expect((await app.app.inject({ method: 'GET', url: '/runs' })).json()).toMatchObject({
        items: [],
      });
      expect(preflight).not.toHaveBeenCalled();
      expect(app.harness.started).toHaveLength(0);
    },
  );

  it('creates independent copies, keeps supplied names literal, and does not alter the package', async () => {
    app = await createTestApp();
    const name = 'Literal {{ vars.private }}; $(not-a-command)';
    const first = await createDraft('implementation', name);
    const second = await createDraft('implementation', name);
    expect(first.loop.id).not.toBe(second.loop.id);
    expect(first.draft.id).not.toBe(second.draft.id);
    expect(first.draft.definition.name).toBe(name);
    first.draft.definition.nodes[1]!.label = 'A user edit';
    expect((await app.container.templates.catalog.draft('implementation')).nodes[1]!.label).toBe(
      'Workflow instructions',
    );
  });

  it.each(['missing', 'disabled', 'no-harness'])(
    'retains truthful %s model readiness issues without blocking draft creation',
    async (state) => {
      app = await createTestApp(state === 'no-harness' ? { harnesses: {} } : {});
      if (state === 'missing') await app.container.repos.catalog.delete('codex', 'gpt-6-luna');
      if (state === 'disabled')
        await app.container.repos.catalog.setEnabled('codex', 'gpt-6-luna', false);
      const created = await createDraft('starter');
      expect(created.issues).toContainEqual(
        expect.objectContaining({
          code:
            state === 'missing'
              ? 'MODEL_NOT_IN_CATALOG'
              : state === 'disabled'
                ? 'MODEL_DISABLED'
                : 'HARNESS_UNAVAILABLE',
        }),
      );
      expect(
        (await app.app.inject({ method: 'POST', url: '/loops/' + created.loop.id + '/publish' }))
          .statusCode,
      ).toBe(422);
    },
  );

  it('saves normal prompt edits before defaults are configured and publishes after explicit configuration', async () => {
    app = await createTestApp({ env: { GG_DEFAULTS: '{"byHarness":{}}' } });
    const created = await createDraft('starter');
    const definition = created.draft.definition;
    const assistant = definition.nodes.find((node) => node.kind === 'inference');
    if (!assistant || assistant.kind !== 'inference') throw new Error('missing assistant');
    assistant.config.prompt.template = 'Edited instruction {{ invocation.trigger.payload | json }}';
    const save = await app.app.inject({
      method: 'PUT',
      url: '/loops/' + created.loop.id + '/draft',
      payload: { definition },
    });
    expect(save.statusCode, save.body).toBe(200);
    expect(save.json()).toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: 'MODEL_UNRESOLVED' })]),
    });
    expect(
      (await app.app.inject({ method: 'POST', url: '/loops/' + created.loop.id + '/publish' }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await app.app.inject({
          method: 'PUT',
          url: '/settings',
          payload: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } } },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.app.inject({ method: 'POST', url: '/loops/' + created.loop.id + '/publish' }))
        .statusCode,
    ).toBe(200);
    const started = await app.app.inject({
      method: 'POST',
      url: '/loops/' + created.loop.id + '/runs',
      payload: { input: 'Supplied task' },
    });
    expect(started.statusCode, started.body).toBe(202);
    await app.idle();
    expect(
      await app.container.repos.runs.get(started.json<{ run: { id: string } }>().run.id),
    ).toMatchObject({ status: 'succeeded' });
    expect(app.harness.started[0]?.model).toBe('gpt-6-luna');
    expect(app.harness.started[0]?.turn.prompt).toContain('Edited instruction');
  });

  it('still rejects explicit invalid choices and preserves the previous draft', async () => {
    app = await createTestApp();
    const created = await createDraft('starter');
    const definition = structuredClone(created.draft.definition);
    const node = definition.nodes.find((item) => item.kind === 'inference');
    if (!node || node.kind !== 'inference') throw new Error('missing assistant');
    node.config.model = 'not-in-catalog';
    const response = await app.app.inject({
      method: 'PUT',
      url: '/loops/' + created.loop.id + '/draft',
      payload: { definition },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ code: 'EVALUATION_INVALID_CONFIGURATION' });
    expect((await app.container.repos.loops.getVersion(created.draft.id))?.definition).toEqual(
      created.draft.definition,
    );
  });

  it('refuses unknown templates and invalid requests without creating anything', async () => {
    app = await createTestApp();
    for (const [kind, body, code] of [
      ['absent-template', {}, 404],
      ['starter', { name: ' ' }, 400],
      ['starter', { settings: {} }, 400],
    ] as const) {
      const response = await app.app.inject({
        method: 'POST',
        url: '/templates/' + kind + '/draft',
        payload: body,
      });
      expect(response.statusCode, response.body).toBe(code);
    }
    expect(await app.container.repos.loops.listLoops('local')).toEqual([]);
  });

  it('uses loops:write and keeps the newly created draft owner scoped', async () => {
    app = await createTestApp({ requireApiKey: true });
    const reader = await app.container.repos.apiKeys.create('local', 'reader', ['loops:read']);
    const author = await app.container.repos.apiKeys.create('other', 'author', ['loops:write']);
    expect(
      (await app.app.inject({ method: 'POST', url: '/templates/starter/draft', payload: {} }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.app.inject({
          method: 'POST',
          url: '/templates/starter/draft',
          payload: {},
          headers: { authorization: 'Bearer ' + reader.token },
        })
      ).statusCode,
    ).toBe(403);
    const response = await app.app.inject({
      method: 'POST',
      url: '/templates/starter/draft',
      payload: {},
      headers: { authorization: 'Bearer ' + author.token },
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = TemplateDraftResponseSchema.parse(response.json());
    expect(created.loop.ownerId).toBe('other');
    expect(
      (
        await app.app.inject({
          method: 'GET',
          url: '/loops/' + created.loop.id,
          headers: { authorization: 'Bearer ' + reader.token },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('bounded manual starting-point execution', () => {
  async function execute(kind: string, turns: unknown[]) {
    app = await createTestApp();
    app.harness.script(
      turns.map((value) => ({
        finalText: typeof value === 'string' ? value : JSON.stringify(value),
      })),
    );
    const created = await createDraft(kind);
    expect(
      (await app.app.inject({ method: 'POST', url: '/loops/' + created.loop.id + '/publish' }))
        .statusCode,
    ).toBe(200);
    const response = await app.app.inject({
      method: 'POST',
      url: '/loops/' + created.loop.id + '/runs',
      payload: {
        input: { task: 'Supplied bounded task', source: 'function answer() { return 42; }' },
      },
    });
    expect(response.statusCode, response.body).toBe(202);
    await app.idle();
    return app.container.repos.runs.get(response.json<{ run: { id: string } }>().run.id);
  }

  it('plans, implements and verifies a supplied task through distinct turns', async () => {
    const run = await execute('implementation', [
      'Scoped plan',
      'Proposed patch and observed checks',
      {
        status: 'passed',
        summary: 'Evidence satisfies the task',
        checks: ['Checked supplied source'],
      },
    ]);
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'success' });
    expect(app!.harness.started).toHaveLength(3);
    expect(app!.harness.started[1]?.turn.prompt).toContain('Scoped plan');
    expect(app!.harness.started[2]?.turn.prompt).toContain('Proposed patch');
  });

  it('reviews, fixes, then reviews again and preserves the prior findings as context', async () => {
    const run = await execute('review', [
      { status: 'changes-needed', summary: 'Missing guard', findings: ['Guard empty input'] },
      'Added guard',
      { status: 'approved', summary: 'Guard verified', findings: [] },
    ]);
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'success', iteration: 2 });
    expect(app!.harness.started).toHaveLength(3);
    expect(app!.harness.started[1]?.turn.prompt).toContain('Guard empty input');
    expect(app!.harness.started[2]?.turn.prompt).toContain('Added guard');
  });

  it('exhausts repeated review findings without returning approval', async () => {
    const finding = {
      status: 'changes-needed',
      summary: 'Still failing',
      findings: ['Required fix'],
    };
    const run = await execute('review', [
      finding,
      'First attempt',
      finding,
      'Second attempt',
      finding,
      'Third attempt',
    ]);
    expect(run).toMatchObject({ status: 'exhausted', outcome: 'exhausted', iteration: 3 });
    expect(app!.harness.started).toHaveLength(6);
  });

  it('assesses QA evidence with a separate challenge and reports missing evidence as failure', async () => {
    const run = await execute('qa', [
      'Acceptance criterion',
      { status: 'inconclusive', summary: 'Missing observations', evidence: [] },
      { assessment: 'sound', summary: 'Missing evidence correctly identified' },
    ]);
    expect(run).toMatchObject({ status: 'failed', outcome: 'failure' });
    expect(app!.harness.started).toHaveLength(3);
    expect(app!.harness.started[2]?.turn.prompt).toContain('Missing observations');
  });

  it('exhausts one unsound QA rerun without claiming a passing assessment', async () => {
    const qa = { status: 'pass', summary: 'Proposed result', evidence: ['Insufficient assertion'] };
    const challenge = { assessment: 'unsound', summary: 'Evidence insufficient' };
    const run = await execute('qa', ['Acceptance criterion', qa, challenge, qa, challenge]);
    expect(run).toMatchObject({ status: 'exhausted', outcome: 'exhausted', iteration: 2 });
    expect(app!.harness.started).toHaveLength(5);
  });
});
