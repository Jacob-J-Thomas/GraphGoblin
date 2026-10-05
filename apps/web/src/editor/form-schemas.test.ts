import { fieldMeta, NodeConfigSchemas } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { NODE_FORM_SCHEMAS } from './form-schemas.js';

const valid = {
  routes: [
    { label: 'yes', description: '' },
    { label: 'no', description: '' },
  ],
  question: 'q',
  strategy: ['codex'],
};

describe('node form schemas', () => {
  it('adds catalog controls to the Codex form without mutating the decision contract or classifier', () => {
    const contract = NodeConfigSchemas.decision.shape;
    const form = NODE_FORM_SCHEMAS.decision.shape;
    expect(fieldMeta(form.codex.unwrap().shape.model).control).toBe('model');
    expect(fieldMeta(form.codex.unwrap().shape.effort).control).toBe('effort');
    expect(fieldMeta(contract.codex.unwrap().shape.model).control).toBeUndefined();
    expect(form.jev).toBe(contract.jev);
    expect(NODE_FORM_SCHEMAS.inference).toBe(NodeConfigSchemas.inference);
  });

  it.each([undefined, {}, { model: 'unknown', effort: 'max' }])(
    'preserves canonical decision parsing with codex %j',
    (codex) => {
      const input = { ...valid, codex };
      expect(NODE_FORM_SCHEMAS.decision.parse(input)).toEqual(
        NodeConfigSchemas.decision.parse(input),
      );
    },
  );

  it.each([
    {
      ...valid,
      routes: [
        { label: 'yes', description: '' },
        { label: 'yes', description: '' },
      ],
    },
    { ...valid, strategy: ['codex', 'codex'] },
    { ...valid, strategy: ['expression'] },
    { ...valid, codex: { model: '', effort: 'unknown' } },
  ])('preserves canonical validation including decision refinements', (input) => {
    expect(NODE_FORM_SCHEMAS.decision.safeParse(input).error?.issues).toEqual(
      NodeConfigSchemas.decision.safeParse(input).error?.issues,
    );
  });
});
