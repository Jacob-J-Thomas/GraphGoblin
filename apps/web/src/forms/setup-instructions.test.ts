import { describe, expect, it } from 'vitest';
import { setupInstruction } from './setup-instructions.js';

const classifier = (answer: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'classifier',
  model: '',
  question: '',
  answer,
  ...extra,
});

describe('setupInstruction', () => {
  it('gives instructions only for blank or missing required setup fields', () => {
    expect(setupInstruction({ type: 'event', eventType: '' }, 'eventType')).toBe(
      'Enter an event type',
    );
    expect(setupInstruction({ type: 'event' }, 'eventType')).toBe('Enter an event type');
    const choice = classifier({ type: 'choice', options: [{ id: 'a', criteria: ' ' }] });
    expect(setupInstruction(choice, 'model')).toBe('Choose a classifier');
    expect(setupInstruction(choice, 'question')).toBe('Enter a question for the classifier');
    expect(setupInstruction(choice, 'answer.options.0.criteria')).toBe('Describe this option');
    const noul = classifier({ type: 'noul', true: { criteria: '' }, false: { criteria: 'no' } });
    expect(setupInstruction(noul, 'answer.true.criteria')).toBe('Describe this option');
    const score = classifier({ type: 'score', anchors: ['low', ''], bands: [{ max: 0.5 }] });
    expect(setupInstruction(score, 'answer.anchors.1')).toBe('Describe this score anchor');
    expect(setupInstruction(score, 'answer.bands.0.min')).toBe(
      "Set each band's lower and upper bound",
    );
  });

  it('keeps the schema message for a non-empty value that is still invalid', () => {
    expect(setupInstruction({ type: 'event', eventType: '9 bad type!' }, 'eventType')).toBe(
      undefined,
    );
    const score = classifier(
      { type: 'score', anchors: ['low', 'high'], bands: [{ min: 0.8, max: 0.2 }] },
      { model: 'unknown-model', question: 'Is it good?' },
    );
    expect(setupInstruction(score, 'model')).toBe(undefined);
    expect(setupInstruction(score, 'question')).toBe(undefined);
    expect(setupInstruction(score, 'answer.anchors.0')).toBe(undefined);
    expect(setupInstruction(score, 'answer.bands.0.min')).toBe(undefined);
  });

  it('leaves other node kinds, other fields and non-objects alone', () => {
    expect(setupInstruction({ kind: 'expression', jsonata: '' }, 'jsonata')).toBe(undefined);
    expect(setupInstruction(classifier({ type: 'choice', options: [] }), 'context')).toBe(
      undefined,
    );
    expect(setupInstruction(undefined, 'model')).toBe(undefined);
    expect(setupInstruction('text', 'model')).toBe(undefined);
  });
});
