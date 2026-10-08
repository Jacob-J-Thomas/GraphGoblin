import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { event } from '../../__fixtures__/fake-api.js';
import { EvaluationDetails } from './EvaluationDetails.js';

function noulDefinition(truthThreshold?: number) {
  return LoopDefinitionSchema.parse({
    schemaVersion: 2,
    name: 'Noul threshold fixture',
    nodes: [
      {
        id: 'check',
        kind: 'decision',
        label: 'Check',
        config: {
          answer: {
            type: 'noul',
            true: { id: 'true', label: 'True', criteria: 'The check passes' },
            false: { id: 'false', label: 'False', criteria: 'The check fails' },
          },
          evaluation: {
            kind: 'classifier',
            model: 'jev',
            question: 'Check the evidence.',
            ...(truthThreshold === undefined ? {} : { truthThreshold }),
          },
        },
      },
    ],
    edges: [],
  });
}

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

  it('shows typed Noul and fractional Score evidence with stable ports and rubric anchors', () => {
    const noul = event('run', 1, 'decision.made', {
      nodeId: 'check',
      answer: {
        type: 'noul',
        kind: 'llm',
        holds: false,
        confidence: 0.74,
        reasoning: 'The evidence does not satisfy the criterion.',
      },
      portId: 'false',
      provenance: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'gpt-5.6',
        effort: 'low',
      },
      diagnostics: [],
    });
    const { rerender } = render(<EvaluationDetails event={noul} />);
    expect(screen.getByText('Answer').parentElement).toHaveTextContent('false');
    expect(screen.getByText('Side port').parentElement).toHaveTextContent('false');
    expect(screen.getByText('Reasoning excerpt').parentElement).toHaveTextContent(
      'The evidence does not satisfy the criterion.',
    );

    rerender(
      <EvaluationDetails
        event={event('run', 2, 'decision.made', {
          nodeId: 'grade',
          answer: {
            type: 'score',
            score: 1.25,
            confidence: 0.92,
            legend: { '2': 'Fully meets', '0': 'Does not meet', '1': 'Partly meets' },
            probabilities: { '1': 0.92 },
          },
          portId: 'middle',
          provenance: {
            kind: 'classifier',
            provider: 'typesafe',
            classifierId: 'jev',
            model: 'jev-latest',
            effort: null,
          },
          diagnostics: [],
        })}
      />,
    );
    expect(screen.getByText('Score').parentElement).toHaveTextContent('1.25');
    expect(screen.getByText('Band port').parentElement).toHaveTextContent('middle');
    const anchors = screen.getByRole('list', { name: 'Rubric anchors' });
    expect([...anchors.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Anchor 0: Does not meet',
      'Anchor 1: Partly meets',
      'Anchor 2: Fully meets',
    ]);
    expect(screen.getByRole('list', { name: 'Rubric index probabilities' })).toHaveTextContent(
      '1: 0.92',
    );
  });

  it('shows a confidence-gate rejection as a proposed answer with no selected route', () => {
    render(
      <EvaluationDetails
        event={event('run', 3, 'run.failed', {
          failure: {
            code: 'EVALUATION_RESULT_REJECTED',
            message: 'Classifier result did not meet minimum confidence.',
            nodeId: 'check',
            resumable: false,
            details: {
              answer: {
                type: 'noul',
                kind: 'classifier',
                holds: false,
                trueProbability: 0.3,
                confidence: 0.42,
              },
              provenance: {
                kind: 'classifier',
                provider: 'typesafe',
                classifierId: 'jev',
                model: 'jev-latest',
                effort: null,
              },
              acceptance: {
                status: 'rejected',
                code: 'EVALUATION_RESULT_REJECTED',
                minConfidence: 0.8,
              },
            },
          },
        })}
        definition={noulDefinition(0.2)}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Rejected classifier evaluation' }),
    ).toHaveTextContent('No decision was accepted and no route was selected.');
    expect(screen.getByText('Proposed answer').parentElement).toHaveTextContent('Noul false');
    expect(screen.getByText('True probability').parentElement).toHaveTextContent('0.3');
    expect(screen.getByText('Confidence').parentElement).toHaveTextContent('0.42');
    expect(screen.getByText('Minimum confidence').parentElement).toHaveTextContent('0.8');
    expect(screen.getByText('True-probability threshold').parentElement).toHaveTextContent('0.2');
    expect(screen.getByText('Provider').parentElement).toHaveTextContent('typesafe');
    expect(screen.getByText('Classifier').parentElement).toHaveTextContent('jev');
    expect(screen.getByText('Model').parentElement).toHaveTextContent('jev-latest');
  });

  it('shows the default Noul threshold for accepted classifier evidence', () => {
    render(
      <EvaluationDetails
        event={event('run', 4, 'decision.made', {
          nodeId: 'check',
          answer: {
            type: 'noul',
            kind: 'classifier',
            holds: true,
            trueProbability: 0.73,
            confidence: 0.91,
          },
          portId: 'true',
          provenance: {
            kind: 'classifier',
            provider: 'typesafe',
            classifierId: 'jev',
            model: 'jev-latest',
            effort: null,
          },
          diagnostics: [],
        })}
        definition={noulDefinition()}
      />,
    );
    expect(screen.getByText('True-probability threshold').parentElement).toHaveTextContent('0.5');
  });

  it('keeps the rejected Score rubric and classifier identity when alternatives are absent', () => {
    render(
      <EvaluationDetails
        event={event('run', 5, 'run.failed', {
          failure: {
            code: 'EVALUATION_RESULT_REJECTED',
            message: 'Classifier result did not meet minimum confidence.',
            nodeId: 'grade',
            resumable: false,
            details: {
              answer: {
                type: 'score',
                score: 1.25,
                confidence: 0.3,
                legend: { '0': 'Low', '1': 'Moderate', '2': 'High' },
                probabilities: null,
              },
              provenance: {
                kind: 'classifier',
                provider: 'typesafe',
                classifierId: 'jev',
                model: 'jev-latest',
                effort: null,
              },
              acceptance: {
                status: 'rejected',
                code: 'EVALUATION_RESULT_REJECTED',
                minConfidence: 0.8,
              },
            },
          },
        })}
      />,
    );
    expect(screen.getByRole('list', { name: 'Rubric anchors' })).toHaveTextContent(
      'Anchor 1: Moderate',
    );
    expect(screen.getByText('Provider').parentElement).toHaveTextContent('typesafe');
    expect(screen.getByText('Classifier').parentElement).toHaveTextContent('jev');
    expect(screen.getByText('Model').parentElement).toHaveTextContent('jev-latest');
  });
});
