import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessId, LoopIssue } from '@graphgoblin/contracts';
import { LoopExportSchema, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { readinessFailure } from '@graphgoblin/domain';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

class CountingHarness extends FakeHarness {
  probes = 0;
  rejectProbe = false;
  override preflight() {
    this.probes++;
    if (this.rejectProbe) return Promise.reject(new Error('PRIVATE_PROBE_MARKER'));
    return super.preflight();
  }
}
let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const definition = (harness: HarnessId = 'claude') => {
  const node = {
    id: 'work',
    kind: 'inference' as const,
    label: 'Work',
    config: {
      harness,
      model: harness === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
      effort: 'high',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template: 'No turn' },
    },
  };
  const value = singleNodeLoop('Readiness', node);
  value.nodes.push({ ...value.nodes.find((n) => n.id === 'work')!, id: 'work2' });
  value.edges.find((edge) => edge.from.node === 'work')!.to.node = 'work2';
  value.edges.push({ id: 'e3', from: { node: 'work2', port: 'out' }, to: { node: 'done' } });
  return LoopDefinitionSchema.parse(value);
};

describe('public authoring readiness', () => {
  it.each(['unknown', 'cli-missing', 'cli-incompatible', 'auth', 'quota', 'transport'] as const)(
    'maps %s to a readiness issue, permits saving, and blocks publication',
    async (state) => {
      const harness = new CountingHarness([], 'claude');
      harness.preflightResult = readinessFailure('claude', state);
      app = await createTestApp({ harnesses: { claude: harness } });
      const created = await app.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition: definition() },
      });
      expect(created.statusCode).toBe(201);
      const body = created.json<{ loop: { id: string }; issues: LoopIssue[] }>();
      expect(body.issues.some((i) => i.code.startsWith('HARNESS_READINESS_'))).toBe(false);
      expect(harness.probes).toBe(0);
      const validated = await app.app.inject({
        method: 'POST',
        url: '/loops/' + body.loop.id + '/validate',
        payload: { definition: definition() },
      });
      expect(
        validated.json<{ issues: LoopIssue[] }>().issues.filter((i) => i.nodeId === 'work'),
      ).toContainEqual(
        expect.objectContaining({
          code: 'HARNESS_READINESS_' + state.toUpperCase().replaceAll('-', '_'),
        }),
      );
      expect(body.issues.some((i) => i.code.startsWith('MODEL_'))).toBe(false);
      expect(harness.probes).toBe(1);
      const published = await app.app.inject({
        method: 'POST',
        url: '/loops/' + body.loop.id + '/publish',
      });
      expect(published.statusCode).toBe(422);
      expect(harness.probes).toBe(2);
      harness.preflightResult = { state: 'ready', ok: true, authenticated: true, problems: [] };
      expect(
        (await app.app.inject({ method: 'POST', url: '/loops/' + body.loop.id + '/publish' }))
          .statusCode,
      ).toBe(200);
    },
  );
  it.each(['claude', 'codex'] as const)(
    'never probes %s during draft writes, and refreshes once per validation',
    async (id) => {
      const harness = new CountingHarness([], id);
      app = await createTestApp({ harnesses: { [id]: harness } });
      const value = definition(id);
      const created = await app.app.inject({
        method: 'POST',
        url: '/loops',
        payload: { definition: value },
      });
      expect(created.statusCode).toBe(201);
      expect(harness.probes).toBe(0);
      const loopId = created.json<{ loop: { id: string } }>().loop.id;
      harness.preflightResult = readinessFailure(id, 'quota');
      const saved = await app.app.inject({
        method: 'PUT',
        url: '/loops/' + loopId + '/draft',
        payload: { definition: value },
      });
      expect(saved.statusCode).toBe(200);
      expect(harness.probes).toBe(0);
      expect(saved.body).not.toContain('HARNESS_READINESS_');
      const exported = LoopExportSchema.parse({
        format: 'graphgoblin-loop',
        formatVersion: value.schemaVersion,
        exportedAt: new Date().toISOString(),
        loop: value,
      });
      const imported = await app.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: exported,
      });
      expect(imported.statusCode, imported.body).toBe(201);
      expect(harness.probes).toBe(0);
      await Promise.all(
        [1, 2].map(() =>
          app!.app.inject({
            method: 'POST',
            url: '/loops/' + loopId + '/validate',
            payload: { definition: value },
          }),
        ),
      );
      expect(harness.probes).toBe(2);
    },
  );
  it('shares rejected probes within a request and sanitizes the unknown result', async () => {
    const harness = new CountingHarness([], 'claude');
    harness.rejectProbe = true;
    app = await createTestApp({ harnesses: { claude: harness } });
    const response = await app.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: definition() },
    });
    expect(response.statusCode).toBe(201);
    expect(harness.probes).toBe(0);
    const validated = await app.app.inject({
      method: 'POST',
      url: '/loops/' + response.json<{ loop: { id: string } }>().loop.id + '/validate',
      payload: { definition: definition() },
    });
    expect(harness.probes).toBe(1);
    expect(validated.body).toContain('HARNESS_READINESS_UNKNOWN');
    expect(validated.body).not.toContain('PRIVATE_PROBE_MARKER');
  });
  it('reports disabled and removed selections independently of failed CLI lookups', async () => {
    const harness = new CountingHarness([], 'claude');
    harness.preflightResult = readinessFailure('claude', 'auth');
    app = await createTestApp({ harnesses: { claude: harness } });
    await app.app.inject({
      method: 'PATCH',
      url: '/model-catalog/claude/claude-opus-5-5',
      payload: { enabled: false },
    });
    const disabled = await app.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: definition() },
    });
    expect(disabled.statusCode).toBe(201);
    expect(disabled.body).toContain('MODEL_DISABLED');
    const value = definition();
    for (const node of value.nodes)
      if (node.kind === 'inference') node.config.model = 'removed-model';
    const removed = await app.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: value },
    });
    expect(removed.statusCode).toBe(400);
    expect(removed.body).toContain('MODEL_NOT_IN_CATALOG');
    expect(harness.probes).toBe(0);
  });
});

it.each(['validate', 'preflight'] as const)(
  'probes distinct harnesses concurrently during %s',
  async (operation) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    class GatedHarness extends CountingHarness {
      override async preflight() {
        const result = super.preflight();
        await barrier;
        return result;
      }
    }
    const claude = new GatedHarness([], 'claude');
    const codex = new GatedHarness([], 'codex');
    app = await createTestApp({ harnesses: { claude, codex } });
    const value = definition();
    const codexNodes = definition('codex').nodes.filter((n) => n.kind === 'inference');
    value.nodes.push(...codexNodes.map((n) => ({ ...n, id: n.id + '-codex' })));
    value.edges.find((edge) => edge.from.node === 'work2')!.to.node = 'work-codex';
    value.edges.push(
      {
        id: 'e4',
        from: { node: 'work-codex', port: 'out' },
        to: { node: 'work2-codex', port: 'in' },
      },
      { id: 'e5', from: { node: 'work2-codex', port: 'out' }, to: { node: 'done', port: 'in' } },
    );
    // The repository is a supported port; avoid a draft write in this concurrency-only test.
    const created = await app.container.repos.loops.create('local', value);
    const pending = app.app.inject(
      operation === 'preflight'
        ? { method: 'GET', url: '/harness/preflight' }
        : {
            method: 'POST',
            url: '/loops/' + created.loop.id + '/validate',
            payload: { definition: value },
          },
    );
    // Start injection before waiting for port arrivals.
    const response = Promise.resolve(pending);
    try {
      await vi.waitFor(
        () => {
          expect(claude.probes).toBe(1);
          expect(codex.probes).toBe(1);
        },
        { timeout: 1500 },
      );
    } finally {
      release();
      await response;
    }
    const completed = await response;
    expect(completed.statusCode).toBe(200);
    if (operation === 'validate') expect(completed.json().publishable).toBe(true);
  },
);

it('rejects run admission with fresh readiness before starting a turn', async () => {
  const harness = new CountingHarness([], 'codex');
  harness.preflightResult = readinessFailure('codex', 'quota');
  app = await createTestApp({ harnesses: { codex: harness } });
  const created = await app.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: definition('codex') },
  });
  const run = await app.app.inject({
    method: 'POST',
    url: '/loops/' + created.json<{ loop: { id: string } }>().loop.id + '/runs',
    payload: { allowDraft: true, versionId: created.json<{ draft: { id: string } }>().draft.id },
  });
  expect(run.statusCode).toBe(422);
  expect(run.body).toContain('HARNESS_READINESS_QUOTA');
  expect(harness.probes).toBe(1);
  expect(harness.started).toEqual([]);
});

it('does not probe while creating a template draft', async () => {
  const harness = new CountingHarness([], 'codex');
  harness.rejectProbe = true;
  app = await createTestApp({ harnesses: { codex: harness } });
  const response = await app.app.inject({
    method: 'POST',
    url: '/templates/starter/draft',
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  expect(harness.probes).toBe(0);
  expect(response.body).not.toContain('HARNESS_READINESS_');
});

it('checks published readiness when an empty versionId uses the normal published fallback', async () => {
  const harness = new CountingHarness([], 'codex');
  app = await createTestApp({ harnesses: { codex: harness } });
  const created = await app.app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: definition('codex') },
  });
  const id = created.json<{ loop: { id: string } }>().loop.id;
  expect(
    (await app.app.inject({ method: 'POST', url: '/loops/' + id + '/publish' })).statusCode,
  ).toBe(200);
  const probesBeforeRun = harness.probes;
  harness.preflightResult = readinessFailure('codex', 'quota');
  const run = await app.app.inject({
    method: 'POST',
    url: '/loops/' + id + '/runs',
    payload: { versionId: '' },
  });
  expect(run.statusCode).toBe(422);
  expect(harness.probes).toBe(probesBeforeRun + 1);
  expect(harness.started).toEqual([]);
});
