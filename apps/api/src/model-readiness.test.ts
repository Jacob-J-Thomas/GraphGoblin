import { afterEach, describe, expect, it } from 'vitest';
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
  return LoopDefinitionSchema.parse(value);
};

describe('public authoring readiness', () => {
  it.each([
    'checking',
    'unknown',
    'cli-missing',
    'cli-incompatible',
    'auth',
    'quota',
    'transport',
  ] as const)(
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
      expect(body.issues.filter((i) => i.nodeId === 'work')).toContainEqual(
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
    },
  );
  it.each(['claude', 'codex'] as const)(
    'shares %s probes across nodes and both validations, then refreshes on the next operation',
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
      expect(harness.probes).toBe(1);
      const loopId = created.json<{ loop: { id: string } }>().loop.id;
      harness.preflightResult = readinessFailure(id, 'quota');
      const saved = await app.app.inject({
        method: 'PUT',
        url: '/loops/' + loopId + '/draft',
        payload: { definition: value },
      });
      expect(saved.statusCode).toBe(200);
      expect(harness.probes).toBe(2);
      expect(saved.body).toContain('HARNESS_READINESS_QUOTA');
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
      expect(harness.probes).toBe(3);
      await Promise.all(
        [1, 2].map(() =>
          app!.app.inject({
            method: 'POST',
            url: '/loops/' + loopId + '/validate',
            payload: { definition: value },
          }),
        ),
      );
      expect(harness.probes).toBe(5);
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
    expect(harness.probes).toBe(1);
    expect(response.body).toContain('HARNESS_READINESS_UNKNOWN');
    expect(response.body).not.toContain('PRIVATE_PROBE_MARKER');
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
