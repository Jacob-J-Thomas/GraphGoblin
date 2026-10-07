import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { event } from '../../__fixtures__/fake-api.js';
import { EvaluationDetails } from './EvaluationDetails.js';

describe('EvaluationDetails', () => {
  it('renders errors, absent optional evidence, and false low-confidence results in plain words', () => {
    render(
      <EvaluationDetails
        event={event('run', 1, 'exit.evaluated', {
          nodeId: 'done',
          iteration: 1,
          maxIterations: 5,
          criteria: [
            { index: 0, strategy: 'expression', status: 'not-matched' },
            {
              index: 1,
              strategy: 'jev',
              status: 'not-matched',
              holds: true,
              confidence: 0.4,
              minConfidence: 0.8,
            },
            {
              index: 2,
              strategy: 'codex',
              status: 'error',
              diagnostic: {
                code: 'DECIDER_TIMEOUT',
                message: 'Decision provider request timed out',
              },
            },
          ],
          result: {
            kind: 'failed',
            diagnostic: { code: 'DECIDER_TIMEOUT', message: 'Decision provider request timed out' },
          },
        })}
      />,
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Criterion 1 (expression): did not match',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'predicate true; confidence 0.4; required 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Criterion 3 (Codex): error: Decision provider request timed out',
    );
  });
  it('renders nothing for a different event', () => {
    const { container, rerender } = render(<EvaluationDetails event={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<EvaluationDetails event={event('run', 1, 'run.cancelled', {})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels LLM confidence as self-reported and marks missing historical settings', () => {
    render(
      <EvaluationDetails
        event={event('run', 1, 'decision.made', {
          nodeId: 'pick',
          answer: { type: 'choice', optionId: 'yes', confidence: 0.7, probabilities: null },
          portId: 'yes',
          provenance: {
            kind: 'llm',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          diagnostics: [],
        })}
      />,
    );
    expect(screen.getByText('Self-reported confidence')).toBeInTheDocument();
    expect(
      screen.getByText(/reported by the evaluator; not a calibrated classifier score/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).toHaveLength(2);
    expect(screen.getByText('0.7')).toBeInTheDocument();
  });
});
