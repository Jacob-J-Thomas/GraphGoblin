import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type LoopIssue } from '@graphgoblin/contracts';
import { blocksPublication, rejectsDraftAdmission } from './model-issues.js';

const definition = () =>
  LoopDefinitionSchema.parse({
    schemaVersion: 3,
    name: 'Authoring',
    nodes: [
      { id: 'work', kind: 'inference', label: 'Work', config: { prompt: { template: 'Work' } } },
    ],
    edges: [],
  });
const issue = (code: string, path: string, nodeId?: string): LoopIssue => ({
  code,
  path,
  severity: 'error',
  message: 'Configure this selection',
  ...(nodeId ? { nodeId } : {}),
});

describe('definition-aware draft admission', () => {
  it('permits inherited unresolved readiness while keeping publication blocked', () => {
    for (const field of ['model', 'effort']) {
      const value = issue(
        field === 'model' ? 'MODEL_UNRESOLVED' : 'EFFORT_UNRESOLVED',
        'config.' + field,
        'work',
      );
      expect(rejectsDraftAdmission(definition(), value)).toBe(false);
      expect(blocksPublication(value)).toBe(true);
    }
    for (const level of ['owner', 'process'])
      expect(
        rejectsDraftAdmission(
          definition(),
          issue('MODEL_NOT_IN_CATALOG', level + '.defaults.byHarness.codex.model'),
        ),
      ).toBe(false);
  });
  it('keeps explicit inference and loop defaults and classifier errors invalid', () => {
    const input = definition();
    const node = input.nodes[0]!;
    if (node.kind !== 'inference') throw new Error('missing work');
    node.config.model = 'unknown-model';
    node.config.effort = 'high';
    expect(
      rejectsDraftAdmission(input, issue('MODEL_NOT_IN_CATALOG', 'config.model', 'work')),
    ).toBe(true);
    expect(rejectsDraftAdmission(input, issue('EFFORT_UNSUPPORTED', 'config.effort', 'work'))).toBe(
      true,
    );
    expect(
      rejectsDraftAdmission(
        input,
        issue('MODEL_NOT_IN_CATALOG', 'settings.defaults.byHarness.codex.model'),
      ),
    ).toBe(true);
    expect(
      rejectsDraftAdmission(
        input,
        issue('CLASSIFIER_MODEL_NOT_FOUND', 'config.evaluation.modelRef', 'work'),
      ),
    ).toBe(true);
    expect(
      rejectsDraftAdmission(input, {
        ...issue('HARNESS_UNAVAILABLE', 'config.harness', 'work'),
        severity: 'warning',
      }),
    ).toBe(false);
  });
  it.each(['decision', 'exit'] as const)(
    'distinguishes inherited and explicit %s evaluator values',
    (kind) => {
      const evaluation = {
        kind: 'llm',
        harness: 'codex',
        question: '?',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
      };
      const answer = {
        type: 'noul',
        true: { label: 'Yes', criteria: 'Ready' },
        false: { label: 'No', criteria: 'Not ready' },
      };
      const config =
        kind === 'decision'
          ? {
              answer: {
                ...answer,
                true: { ...answer.true, id: 'yes' },
                false: { ...answer.false, id: 'no' },
              },
              evaluation,
            }
          : {
              criteria: [
                {
                  when: 'predicate',
                  answer,
                  evaluation,
                  match: { type: 'noul', value: true },
                  outcome: 'success',
                },
              ],
            };
      const input = LoopDefinitionSchema.parse({
        ...definition(),
        nodes: [{ id: 'work', kind, label: 'Work', config }],
      });
      const path = kind === 'decision' ? 'config.evaluation.' : 'config.criteria.0.evaluation.';
      expect(rejectsDraftAdmission(input, issue('MODEL_UNRESOLVED', path + 'model', 'work'))).toBe(
        false,
      );
      expect(
        rejectsDraftAdmission(input, issue('EFFORT_UNRESOLVED', path + 'effort', 'work')),
      ).toBe(false);
      const node = input.nodes[0]!;
      const actual =
        node.kind === 'decision'
          ? node.config.evaluation
          : node.kind === 'exit' && node.config.criteria[0]?.when === 'predicate'
            ? node.config.criteria[0].evaluation
            : undefined;
      if (!actual || actual.kind !== 'llm') throw new Error('missing evaluator');
      actual.model = { mode: 'explicit', value: 'unknown-model' };
      actual.effort = { mode: 'explicit', value: 'high' };
      expect(
        rejectsDraftAdmission(input, issue('MODEL_NOT_IN_CATALOG', path + 'model', 'work')),
      ).toBe(true);
      expect(
        rejectsDraftAdmission(input, issue('EFFORT_UNSUPPORTED', path + 'effort', 'work')),
      ).toBe(true);
      expect(
        rejectsDraftAdmission(
          input,
          issue('MODEL_NOT_IN_CATALOG', 'config.criteria.10.evaluation.model', 'work'),
        ),
      ).toBe(true);
    },
  );
});
