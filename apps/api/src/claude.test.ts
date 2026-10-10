import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessPreflightSchema } from '@graphgoblin/contracts';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import {
  ClaudeHarness,
  claudeModelCapabilities,
  claudePolicy,
  CLAUDE_FABLE_MODEL,
} from '@graphgoblin/infrastructure/claude';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { loadConfig } from './config.js';
import { runPreflight } from './preflight.js';
import { DEFAULT_MODEL_CATALOG } from '@graphgoblin/infrastructure/sqlite';
let t: TestApp;
let claude: FakeHarness;
const definition = (model = 'claude-opus-5-5', extra: Record<string, unknown> = {}) =>
  singleNodeLoop('claude-loop', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: {
      harness: 'claude',
      model,
      effort: 'xhigh',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template: 'Return synthetic result.' },
      ...extra,
    },
  });
beforeEach(async () => {
  claude = new FakeHarness([], 'claude');
  claude.preflightResult = {
    ok: true,
    version: '2.1.285',
    authenticated: true,
    problems: [],
    authMethod: 'claude.ai',
    supportedPolicies: [
      claudePolicy({ sandbox: 'read-only', approval: 'never' }, undefined, 'win32'),
    ],
    models: claudeModelCapabilities(),
  };
  t = await createTestApp({ harnesses: { codex: new FakeHarness(), claude } });
});
afterEach(async () => {
  await t.close();
});
describe('Claude public integration', () => {
  it('keeps safe policy/model facts in the public typed preflight response', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/harness/preflight' });
    expect(response.statusCode).toBe(200);
    const item = response
      .json<{ items: ({ harness: string } & ReturnType<typeof HarnessPreflightSchema.parse>)[] }>()
      .items.find((e) => e.harness === 'claude');
    expect(item).toMatchObject({
      authenticated: true,
      authMethod: 'claude.ai',
      models: expect.arrayContaining([
        expect.objectContaining({
          model: CLAUDE_FABLE_MODEL,
        }),
      ]),
    });
    claude.preflight = () => Promise.reject(new Error('PRIVATE_AUTH_MARKER'));
    const failed = await t.app.inject({ method: 'GET', url: '/harness/preflight' });
    expect(failed.body).not.toContain('PRIVATE_AUTH_MARKER');
    expect(failed.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          harness: 'claude',
          ok: false,
          problems: ['Claude preflight failed'],
        }),
      ]),
    });
  });
  it.each(['claude-opus-5-5', CLAUDE_FABLE_MODEL])(
    'runs exact %s inference and preserves normal output/usage',
    async (model) => {
      claude.script([
        {
          structured: { ok: true },
          finalText: 'Synthetic result.',
          usage: { inputTokens: 2, outputTokens: 3 },
        },
      ]);
      const loopId = await t.publishLoop(definition(model));
      const started = await t.app.inject({
        method: 'POST',
        url: '/loops/' + loopId + '/runs',
        payload: { input: null },
      });
      expect(started.statusCode, started.body).toBe(202);
      await t.idle();
      const run = await t.container.repos.runs.get(started.json<{ run: { id: string } }>().run.id);
      expect(run?.status).toBe('succeeded');
      expect(claude.started[0]).toMatchObject({
        model,
        effort: 'xhigh',
        options: { sandbox: 'read-only', approval: 'never' },
      });
    },
  );
  it('rejects static unsupported policy consistently across authoring endpoints', async () => {
    const loopId = await t.publishLoop(definition());
    const bad = definition('claude-opus-5-5', {
      harnessOptions: { sandbox: 'workspace-write', approval: 'never' },
    });
    for (const [method, url] of [
      ['POST', '/loops'],
      ['PUT', '/loops/' + loopId + '/draft'],
      ['POST', '/loops/' + loopId + '/validate'],
    ] as const) {
      const result = await t.app.inject({ method, url, payload: { definition: bad } });
      expect(result.statusCode).toBe(400);
      expect(result.body).toContain('harnessOptions/sandbox');
    }
    const imported = await t.app.inject({ method: 'POST', url: '/loops/import', payload: bad });
    expect(imported.statusCode).toBe(400);
    expect(imported.body).toContain('harnessOptions.sandbox');
  });
  it('blocks unavailable Claude publication without substituting Codex', async () => {
    claude.preflightResult = {
      ok: false,
      authenticated: false,
      problems: ['Claude account login required'],
    };
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: definition() },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ loop: { id: string } }>().loop.id;
    const validated = await t.app.inject({
      method: 'POST',
      url: '/loops/' + id + '/validate',
      payload: { definition: definition() },
    });
    expect(validated.json()).toMatchObject({
      publishable: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'HARNESS_UNAVAILABLE' })]),
    });
    expect(
      (await t.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' })).statusCode,
    ).toBe(422);
    expect(claude.started).toEqual([]);
  });
  it('seeds Fable enabled, admits owner defaults and respects later owner disablement', async () => {
    expect(await t.container.repos.catalog.findOne('claude', CLAUDE_FABLE_MODEL)).toMatchObject({
      enabled: true,
      source: 'harness',
    });
    const settings = await t.app.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        defaults: { byHarness: { claude: { model: CLAUDE_FABLE_MODEL, effort: 'xhigh' } } },
      },
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const loopId = await t.publishLoop(definition(CLAUDE_FABLE_MODEL));
    const disabled = await t.app.inject({
      method: 'PATCH',
      url: '/model-catalog/claude/' + CLAUDE_FABLE_MODEL,
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    const validation = await t.app.inject({
      method: 'POST',
      url: '/loops/' + loopId + '/validate',
      payload: { definition: definition(CLAUDE_FABLE_MODEL) },
    });
    expect(validation.json()).toMatchObject({
      publishable: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'MODEL_DISABLED' })]),
    });
    const enabled = await t.app.inject({
      method: 'PATCH',
      url: '/model-catalog/claude/' + CLAUDE_FABLE_MODEL,
      payload: { enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    const corrected = await t.app.inject({
      method: 'POST',
      url: '/loops/' + loopId + '/validate',
      payload: { definition: definition(CLAUDE_FABLE_MODEL) },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({ publishable: true });
  });
  it('parses only explicit owner executable configuration without installation fallback', () => {
    expect(loadConfig({ GG_CLAUDE_BINARY: 'C:/owned/claude.exe' }).claudeBinary).toBe(
      'C:/owned/claude.exe',
    );
    expect(() => loadConfig({ GG_CLAUDE_BINARY: '' })).toThrow();
    expect(new ClaudeHarness().id).toBe('claude');
  });
  it('keeps missing optional Claude a warning, but fails configured Claude readiness', async () => {
    claude.preflightResult = {
      ok: false,
      authenticated: false,
      problems: ['Claude is not installed'],
    };
    const base = {
      config: t.container.config,
      nodeVersion: '22.14.0',
      harnesses: t.container.ports.harnesses,
      pendingMigrations: () => Promise.resolve(0),
      jevKey: () => Promise.resolve(undefined),
      jevEnabled: () => Promise.resolve(false),
      catalog: () => Promise.resolve(DEFAULT_MODEL_CATALOG),
    };
    const optional = await runPreflight(base);
    expect(optional.ok).toBe(true);
    expect(optional.checks.find((c) => c.id === 'jev')?.message).toContain(
      'classifier is unavailable',
    );
    expect(optional.checks.find((c) => c.id === 'jev')?.message).not.toContain('fall back');
    expect(optional.checks.find((c) => c.id === 'harness.claude')?.status).toBe('warn');
    const required = await runPreflight({
      ...base,
      config: {
        ...base.config,
        defaults: {
          byHarness: {
            ...base.config.defaults.byHarness,
            claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
          },
        },
      },
    });
    expect(required.ok).toBe(false);
    expect(required.checks.find((c) => c.id === 'harness.claude')?.status).toBe('fail');
    const noPort = await runPreflight({
      ...base,
      harnesses: { codex: new FakeHarness() },
      config: {
        ...base.config,
        defaults: {
          byHarness: {
            ...base.config.defaults.byHarness,
            claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
          },
        },
      },
    });
    expect(noPort.checks).toContainEqual(
      expect.objectContaining({ id: 'harness.claude', status: 'fail' }),
    );
  });
});
