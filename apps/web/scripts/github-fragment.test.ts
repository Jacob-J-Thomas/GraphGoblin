import { LoopDefinitionSchema, type JsonValue } from '@graphgoblin/contracts';
import { applyMutations } from '@graphgoblin/domain';
import { createTestEngine } from '@graphgoblin/engine/testing';
import { describe, expect, it } from 'vitest';
import { previewGitHubPreset } from '../src/editor/github-fragment.js';
import { newLoopDefinition } from '../src/editor/model.js';

const setup = {
  owner: 'octo-team',
  repository: 'service',
  label: 'ready',
  baseBranch: 'main',
  secretRef: 'hook',
};
const payload = (): JsonValue => ({
  repository: { full_name: 'octo-team/service' },
  action: 'labeled',
  issue: { number: 1 },
  label: { name: 'ready' },
});

describe('generated GitHub fragments on fake engine ports', () => {
  it('quotes a hyphenated trigger ID and restores the entire output record including schemaRef', async () => {
    const source = newLoopDefinition('restore');
    source.nodes[0]!.id = 'hook-with-hyphens';
    source.edges[0]!.from.node = 'hook-with-hyphens';
    const preview = previewGitHubPreset(source, 'hook-with-hyphens', 'issues-labeled', setup);
    const config = LoopDefinitionSchema.parse(preview.definition).nodes.find(
      (node) => node.kind === 'mutate',
    )!;
    if (config.kind !== 'mutate') throw new Error('Missing restore');
    const engine = await createTestEngine();
    try {
      const version = engine.publish(source);
      const run = await engine.runToIdle(version.loopId);
      const thread = (await engine.manager.getThread(run.id))!;
      const output = {
        nodeId: 'hook-with-hyphens',
        value: { a: 1 },
        at: '2026-10-15T12:00:00.000Z',
        schemaRef: 'schema:payload',
      };
      const restored = await applyMutations(
        { ...thread, outputs: { 'hook-with-hyphens': output } },
        config.config.operations,
        {
          nodeId: 'restore-output',
          now: () => output.at,
          newId: () => 'id',
        },
      );
      expect(restored.thread.lastOutput).toEqual(output);
    } finally {
      engine.manager.stop();
    }
  });

  it('runs the generated fragment on fake engine ports: matching input is restored; ignored input succeeds quietly', async () => {
    const source = newLoopDefinition('engine fragment');
    source.nodes[1]!.config = { outcome: 'success', returns: 'lastOutput', destinations: [] };
    const preview = previewGitHubPreset(source, 'start', 'issues-labeled', setup);
    const engine = await createTestEngine();
    try {
      const version = engine.publish(preview.definition);
      const matched = await engine.runToIdle(version.loopId, payload(), {
        source: 'webhook',
        triggerNodeId: 'start',
      });
      const thread = (await engine.manager.getThread(matched.id))!;
      expect(matched.status).toBe('succeeded');
      expect(matched.result).toEqual(thread.outputs['start']);
      expect(thread.lastOutput).toEqual(thread.outputs['start']);
      expect(thread.lastOutput!.nodeId).toBe('start');
      expect(thread.lastOutput!.value).toEqual(payload());
      const ignored = await engine.runToIdle(
        version.loopId,
        { action: 'ping' },
        { source: 'webhook', triggerNodeId: 'start' },
      );
      const quiet = (await engine.manager.getThread(ignored.id))!;
      expect(ignored.status).toBe('succeeded');
      expect(ignored.result).toBeUndefined();
      expect(quiet.counters.nodeVisits['done']).toBeUndefined();
      expect(quiet.counters.nodeVisits['restore-output']).toBeUndefined();
      expect(
        engine.events(ignored.id).filter((event) => event.type === 'exit.evaluated'),
      ).toMatchObject([{ nodeId: 'quiet-exit', outcome: 'success' }]);
    } finally {
      engine.manager.stop();
    }
  });
});
