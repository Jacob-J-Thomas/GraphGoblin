import { expect, it } from 'vitest';
import { FakeHarness, createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import type { HarnessPreflight } from '@graphgoblin/contracts';

class ProbedHarness extends FakeHarness {
  probes = 0;
  override preflight(): Promise<HarnessPreflight> {
    this.probes += 1;
    return super.preflight();
  }
}

// Claude's catalog rows are seeded from the adapter's capability table, so request resolution
// checks the catalog and never probes the CLI per request; manual admission checks the ready
// capabilities once per start (apps/api run-readiness).
it.each(['supported', 'unsupported'] as const)(
  'resolves a Claude request against the catalog without probing the harness: %s',
  async (state) => {
    const engine = await createTestEngine({
      defaults: { byHarness: { claude: { model: 'claude-opus-5-5', effort: 'high' } } },
    });
    const harness = new ProbedHarness([], 'claude');
    engine.ports.harnesses.claude = harness;
    engine.ports.modelCatalog.entries = [
      {
        harness: 'claude',
        model: 'claude-opus-5-5',
        displayName: 'Opus',
        source: 'harness',
        enabled: true,
        efforts: state === 'supported' ? ['low', 'high'] : ['low'],
        defaultEffort: 'low',
      },
    ];
    const version = engine.publish(
      singleNodeLoop('Capability guard', {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          harness: 'claude',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: 'q' },
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    if (state === 'unsupported') {
      expect(run).toMatchObject({
        status: 'failed',
        failure: {
          nodeId: 'work',
          code: 'EVALUATION_INVALID_CONFIGURATION',
          // One details shape for every source: code and path, plus where the default lives.
          details: {
            code: 'EFFORT_UNSUPPORTED',
            path: 'effort',
            level: 'process',
            harness: 'claude',
          },
        },
      });
      expect(harness.started).toEqual([]);
    } else {
      expect(run.status).toBe('succeeded');
      expect(harness.started).toMatchObject([{ model: 'claude-opus-5-5', effort: 'high' }]);
    }
    expect(harness.probes).toBe(0);
    engine.manager.stop();
  },
);
