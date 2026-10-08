import { render, screen, within } from '@testing-library/react';
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
            {
              index: 0,
              strategy: 'expression',
              status: 'not-matched',
              answer: { type: 'noul', kind: 'expression', holds: true, confidence: null },
              provenance: {
                kind: 'expression',
                provider: null,
                classifierId: null,
                model: null,
                effort: null,
              },
              acceptance: { status: 'accepted' },
              match: { type: 'noul', value: false },
            },
            {
              index: 1,
              strategy: 'classifier',
              status: 'not-matched',
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
              match: { type: 'noul', value: false },
              configuredMinConfidence: 0.8,
              rejection: { kind: 'classifier-confidence', minimum: 0.8, confidence: 0.42 },
            },
            {
              index: 2,
              strategy: 'llm',
              status: 'not-matched',
              answer: {
                type: 'noul',
                kind: 'llm',
                holds: false,
                confidence: 0.61,
                reasoning: 'The evidence was not sufficient.',
              },
              provenance: {
                kind: 'llm',
                provider: 'codex',
                classifierId: null,
                model: 'gpt-6.1',
                effort: 'low',
              },
              acceptance: { status: 'accepted' },
              match: { type: 'noul', value: false, minReportedConfidence: 0.8 },
              rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence: 0.61 },
            },
            {
              index: 3,
              strategy: 'classifier',
              status: 'error',
              diagnostic: {
                code: 'EVALUATION_PROVIDER_FAILED',
                message: 'Decision provider request timed out',
              },
              provenance: {
                kind: 'classifier',
                provider: 'typesafe',
                classifierId: 'jev',
                model: 'jev-latest',
                effort: null,
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
      'Criterion 1 (Expression): did not match',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent('Noul true');
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent('Noul is false');
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Rejected at classifier confidence 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Classifier confidence gate rejected 0.42 below 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Self-reported LLM confidence gate rejected 0.61 (reported by Codex) below 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Reasoning excerpt: The evidence was not sufficient.',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Criterion 4 (Classifier): error: Decision provider request timed out',
    );
    const failedCriterion = within(
      screen.getByRole('list', { name: 'Exit criteria' }),
    ).getAllByRole('listitem')[3]!;
    expect(within(failedCriterion).getByText('Diagnostic').parentElement).toHaveTextContent(
      'EVALUATION_PROVIDER_FAILED',
    );
    expect(within(failedCriterion).getByText('Provider').parentElement).toHaveTextContent(
      'typesafe',
    );
    expect(within(failedCriterion).getByText('Classifier').parentElement).toHaveTextContent('jev');
    expect(within(failedCriterion).getByText('Model').parentElement).toHaveTextContent(
      'jev-latest',
    );
  });

  it('renders known evaluator identity retained on converted historical errors', () => {
    // Current-format conversion records the identity facts it could establish from old history.
    render(
      <EvaluationDetails
        event={event('run', 1, 'exit.evaluated', {
          nodeId: 'done',
          iteration: 2,
          maxIterations: 5,
          criteria: [
            {
              index: 0,
              strategy: 'llm',
              status: 'error',
              diagnostic: {
                code: 'EVALUATION_PROVIDER_FAILED',
                message: 'Recorded provider failure',
              },
              provenance: {
                kind: 'llm',
                provider: 'codex',
                classifierId: null,
                model: 'gpt-6-luna',
                effort: null,
              },
            },
          ],
          result: {
            kind: 'failed',
            diagnostic: {
              code: 'EVALUATION_PROVIDER_FAILED',
              message: 'Recorded provider failure',
            },
          },
        })}
      />,
    );
    const criteria = screen.getByRole('list', { name: 'Exit criteria' });
    expect(criteria).toHaveTextContent('EVALUATION_PROVIDER_FAILED');
    expect(screen.getByText('Evaluator').parentElement).toHaveTextContent('llm');
    expect(screen.getByText('Provider').parentElement).toHaveTextContent('codex');
    expect(screen.getByText('Model').parentElement).toHaveTextContent('gpt-6-luna');
  });

  it('keeps exact fractional Score and labels historical acceptance and predicate facts as unknown', () => {
    render(
      <EvaluationDetails
        event={event('run', 2, 'exit.evaluated', {
          nodeId: 'done',
          iteration: 3,
          maxIterations: 5,
          criteria: [
            {
              index: 0,
              strategy: 'classifier',
              status: 'not-matched',
              answer: {
                type: 'score',
                score: 1.25,
                confidence: null,
                legend: { '0': 'Low', '1': 'Medium', '2': 'High' },
                probabilities: { '1': 0.7 },
              },
              provenance: {
                kind: 'classifier',
                provider: 'typesafe',
                classifierId: 'jev',
                model: 'jev-latest',
                effort: null,
              },
              acceptance: null,
              match: { type: 'score', operator: 'eq', value: 1.25 },
            },
            { index: 1, strategy: 'max-iterations', status: 'not-matched', holds: null },
          ],
          result: { kind: 'completed', reason: 'default-success', outcome: 'success' },
        })}
      />,
    );
    const criteria = screen.getByRole('list', { name: 'Exit criteria' });
    expect(criteria).toHaveTextContent('Score 1.25');
    expect(criteria).toHaveTextContent('Score = 1.25');
    expect(within(criteria).getByText('Unknown (not recorded)')).toBeInTheDocument();
    expect(criteria).toHaveTextContent('predicate unknown (not recorded)');
    expect(screen.getByRole('list', { name: 'Criterion 1 rubric anchors' })).toHaveTextContent(
      'Anchor 1: Medium',
    );
    expect(
      screen.getByRole('list', { name: 'Criterion 1 rubric index probabilities' }),
    ).toHaveTextContent('1: 0.7');
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

  it('labels unknown Noul history instead of treating nulls as false or empty evidence', () => {
    const historicalExit = event('run', 1, 'exit.evaluated', {
      nodeId: 'done',
      iteration: 2,
      maxIterations: 5,
      criteria: [
        {
          index: 0,
          strategy: 'llm',
          status: 'not-matched',
          answer: { type: 'noul', kind: 'llm', holds: null, confidence: null, reasoning: null },
          provenance: {
            kind: 'llm',
            provider: 'codex',
            classifierId: null,
            model: null,
            effort: null,
          },
          acceptance: null,
          match: { type: 'noul', value: true },
        },
      ],
      result: {
        kind: 'completed',
        reason: 'criterion-matched',
        outcome: 'failure',
        criterionIndex: 0,
      },
    });
    const { rerender } = render(<EvaluationDetails event={historicalExit} />);
    const criteria = screen.getByRole('list', { name: 'Exit criteria' });
    expect(criteria).toHaveTextContent('Noul unknown (not recorded)');
    expect(within(criteria).getByText('Unknown (not recorded)')).toBeInTheDocument();
    expect(within(criteria).getByText('Not recorded')).toBeInTheDocument();
    expect(criteria).toHaveTextContent('Reasoning excerpt: Not recorded');

    rerender(
      <EvaluationDetails
        event={event('run', 2, 'decision.made', {
          nodeId: 'check',
          answer: {
            type: 'noul',
            kind: 'classifier',
            holds: null,
            trueProbability: null,
            confidence: null,
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
      />,
    );
    expect(screen.getByText('Answer').parentElement).toHaveTextContent('Unknown (not recorded)');
    expect(screen.getByText('True probability').parentElement).toHaveTextContent('Not recorded');
    expect(screen.getByText('Confidence').parentElement).toHaveTextContent('Not recorded');
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
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Rejected classifier evaluation' }),
    ).toHaveTextContent('No decision was accepted and no route was selected.');
    expect(screen.getByText('Proposed answer').parentElement).toHaveTextContent('Noul false');
    expect(screen.getByText('True probability').parentElement).toHaveTextContent('0.3');
    expect(screen.getByText('Confidence').parentElement).toHaveTextContent('0.42');
    expect(screen.getByText('Minimum confidence').parentElement).toHaveTextContent('0.8');
  });
});
