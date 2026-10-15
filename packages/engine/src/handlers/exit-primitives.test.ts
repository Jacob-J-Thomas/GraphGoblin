import { describe, it, expect } from 'vitest';
import { ExitPredicateSchema, RunEventSchema, type PredicateConfig } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from '../testing/index.js';
async function scenario(
  predicate: PredicateConfig,
  match: unknown = { type: 'boolean', value: true },
) {
  const e = await createTestEngine();
  const criterion = ExitPredicateSchema.parse({
    when: 'predicate',
    predicate,
    match,
    outcome: 'success',
  });
  const def = singleNodeLoop(
    'predicate',
    {
      id: 'prep',
      kind: 'mutate',
      label: 'Prep',
      config: {
        operations: [{ op: 'set', path: '/vars/saved', value: { kind: 'literal', value: 42 } }],
      },
    },
    {
      criteria: [criterion],
      default: 'loop-back',
      loopBack: { targetNodeId: 'prep' },
      return: { mapping: 'vars.saved' },
    },
  );
  def.settings = { maxIterations: 1 };
  def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'prep' } });
  return { e, def };
}
const llm: PredicateConfig = {
  kind: 'llm',
  instructions: 'Done?',
  harness: 'codex',
  model: { mode: 'inherit' },
  effort: { mode: 'inherit' },
};
const classifier = { kind: 'classifier' as const, model: 'jev', question: 'Done?' };
describe('separate boolean predicate execution', () => {
  it.each([true, false])(
    'evaluates strict expression %s without writing an output',
    async (holds) => {
      const { e, def } = await scenario({ kind: 'expression', jsonata: String(holds) });
      const r = await e.runToIdle(e.publish(def).loopId);
      expect(r.outcome).toBe(holds ? 'success' : 'exhausted');
      expect((await e.manager.getThread(r.id))?.outputs).not.toHaveProperty('done');
      const event = e.events(r.id).find((event) => event.type === 'exit.evaluated');
      expect(RunEventSchema.safeParse(event).success).toBe(true);
      expect(event).toMatchObject({
        criteria: [{ observation: { kind: 'boolean', holds, confidence: null, reasoning: null } }],
      });
    },
  );
  it('keeps Codex boolean confidence gates separate from decision routing', async () => {
    const { e, def } = await scenario(llm, {
      type: 'boolean',
      value: true,
      minReportedConfidence: 0.8,
    });
    e.ports.codexDecider.evaluateBoolean = () =>
      Promise.resolve({ holds: true, confidence: 0.7, reasoning: 'Needs checks' });
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.outcome).toBe('exhausted');
    expect(e.ports.codexDecider.routes).toEqual([]);
    expect(e.events(r.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      criteria: [{ status: 'not-matched', rejection: { kind: 'llm-reported-confidence' } }],
    });
  });
  it.each([true, false])(
    'matches Noul chosen boolean %s after confidence acceptance',
    async (value) => {
      const { e, def } = await scenario(
        {
          ...classifier,
          answer: {
            type: 'noul',
            true: { label: 'Yes', criteria: 'Done' },
            false: { label: 'No', criteria: 'Pending' },
          },
        },
        { type: 'noul', value },
      );
      e.ports.jev.classifyNoul = () =>
        Promise.resolve({ type: 'noul', trueProbability: value ? 0.8 : 0.2 });
      const r = await e.runToIdle(e.publish(def).loopId);
      expect(r.outcome).toBe('success');
    },
  );
  it('never treats a rejected classifier result as a false match', async () => {
    const { e, def } = await scenario(
      {
        ...classifier,
        minConfidence: 0.9,
        answer: {
          type: 'noul',
          true: { label: 'Yes', criteria: 'Done' },
          false: { label: 'No', criteria: 'Pending' },
        },
      },
      { type: 'noul', value: false },
    );
    e.ports.jev.classifyNoul = () => Promise.resolve({ type: 'noul', trueProbability: 0.3 });
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.outcome).toBe('exhausted');
  });
  it.each(['lt', 'lte', 'eq', 'gte', 'gt'] as const)(
    'evaluates fractional Score comparison %s',
    async (operator) => {
      const { e, def } = await scenario(
        { ...classifier, answer: { type: 'score', anchors: ['Low', 'High'] } },
        { type: 'score', operator, value: 0.5 },
      );
      e.ports.jev.score = () =>
        Promise.resolve({
          type: 'score',
          score: 0.5,
          confidence: null,
          legend: { '0': 'Low', '1': 'High' },
          probabilities: null,
        });
      const r = await e.runToIdle(e.publish(def).loopId);
      expect(r.outcome).toBe(['lt', 'gt'].includes(operator) ? 'exhausted' : 'success');
    },
  );
  it('matches classifier Choice ids without using labels', async () => {
    const { e, def } = await scenario(
      {
        ...classifier,
        answer: {
          type: 'choice',
          options: [
            { id: 'ready', label: 'Yes', criteria: 'Done' },
            { id: 'pending', label: 'No', criteria: 'Not done' },
          ],
        },
      },
      { type: 'choice', optionIds: ['ready'] },
    );
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.outcome).toBe('success');
  });
  it('records typed predicate errors before failing the run', async () => {
    const { e, def } = await scenario({ kind: 'expression', jsonata: 'missing' });
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
    expect(e.events(r.id).find((event) => event.type === 'exit.evaluated')).toMatchObject({
      result: { kind: 'failed' },
    });
  });
});
