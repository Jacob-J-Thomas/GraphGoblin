import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

/** A mutate node looping back from the exit until the iteration ceiling. */
function loopBackLoop(routed: boolean): LoopDefinitionInput {
  const def = singleNodeLoop(
    routed ? 'routed' : 'automatic',
    {
      id: 'mut',
      kind: 'mutate',
      label: 'Mut',
      config: {
        operations: [{ op: 'set', path: '/vars/seen', value: { kind: 'literal', value: 1 } }],
      },
    },
    { default: 'loop-back', loopBack: { targetNodeId: 'mut' } },
  );
  def.settings = { maxIterations: 3 };
  def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'mut' } });
  if (routed) {
    // Manual canvas routes (#44) on a forward edge and on the loop-back.
    def.edges[0] = { ...def.edges[0]!, ui: { route: [120] } };
    def.edges[2] = { ...def.edges[2]!, ui: { route: [520, -140, -60] } };
  }
  return def;
}

describe('manual edge routes (#44)', () => {
  it('are layout only: a routed loop runs exactly as the same loop without routes', async () => {
    const outcomes = [];
    for (const routed of [false, true]) {
      const engine = await createTestEngine();
      const version = engine.publish(loopBackLoop(routed));
      // The published version pins the routes with the rest of the definition.
      expect(version.definition.edges.find((e) => e.id === 'back')?.ui).toEqual(
        routed ? { route: [520, -140, -60] } : undefined,
      );
      const run = await engine.runToIdle(version.loopId);
      const thread = await engine.manager.getThread(run.id);
      outcomes.push({
        status: run.status,
        outcome: run.outcome,
        iteration: run.iteration,
        events: engine.eventTypes(run.id),
        routes: engine
          .events(run.id)
          .flatMap((e) => (e.type === 'node.finished' ? [`${e.nodeId}:${String(e.route)}`] : [])),
        visits: thread?.counters.nodeVisits,
      });
    }
    expect(outcomes[0]!.iteration).toBe(3);
    expect(outcomes[1]).toEqual(outcomes[0]);
  });
});
