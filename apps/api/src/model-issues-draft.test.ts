import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type LoopIssue } from '@graphgoblin/contracts';
import { blocksPublication, rejectsDraftAdmission } from './model-issues.js';

const definition = () =>
  LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
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
      rejectsDraftAdmission(input, issue('CLASSIFIER_MODEL_NOT_FOUND', 'config.modelRef', 'work')),
    ).toBe(true);
    expect(
      rejectsDraftAdmission(input, {
        ...issue('HARNESS_UNAVAILABLE', 'config.harness', 'work'),
        severity: 'warning',
      }),
    ).toBe(false);
  });
  it.each(['decision'] as const)(
    'distinguishes inherited and explicit %s evaluator values',
    (kind) => {
      const evaluation = {
        kind: 'llm',
        harness: 'codex',
        instructions: '?',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
      };
      const config =
        kind === 'decision'
          ? {
              ...evaluation,
              routes: [
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ],
            }
          : {};
      const input = LoopDefinitionSchema.parse({
        ...definition(),
        nodes: [{ id: 'work', kind, label: 'Work', config }],
      });
      const path = 'config.';
      expect(rejectsDraftAdmission(input, issue('MODEL_UNRESOLVED', path + 'model', 'work'))).toBe(
        false,
      );
      expect(
        rejectsDraftAdmission(input, issue('EFFORT_UNRESOLVED', path + 'effort', 'work')),
      ).toBe(false);
      const node = input.nodes[0]!;
      const actual = node.kind === 'decision' ? node.config : undefined;
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
        rejectsDraftAdmission(input, issue('MODEL_NOT_IN_CATALOG', 'config.unknown.model', 'work')),
      ).toBe(true);
    },
  );
});
