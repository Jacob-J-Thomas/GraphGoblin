import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { event } from '../../__fixtures__/fake-api.js';
import { EvaluationDetails } from './EvaluationDetails.js';

function noulDefinition(truthThreshold?: number) {
  return LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Noul threshold fixture',
    nodes: [
      {
        id: 'check',
        kind: 'decision',
        label: 'Check',
        config: {
          kind: 'classifier',
          model: 'jev',
          question: 'Check the evidence.',
          ...(truthThreshold === undefined ? {} : { truthThreshold }),
          answer: {
            type: 'noul',
            true: { id: 'true', label: 'True', criteria: 'The check passes' },
            false: { id: 'false', label: 'False', criteria: 'The check fails' },
          },
        },
      },
    ],
    edges: [],
  });
}

describe('EvaluationDetails', () => {
  it('distinguishes loading classifier configuration from unavailable historical configuration', () => {
    const decision = event('run', 1, 'decision.made', {
      nodeId: 'check',
      portId: 'true',
      diagnostics: [],
      provenance: {
        kind: 'classifier',
        provider: 'typesafe',
        classifierId: 'jev',
        model: 'jev-latest',
        effort: null,
      },
      observation: {
        kind: 'classifier',
        answer: { type: 'noul', holds: true, trueProbability: 0.8, confidence: 0.8 },
      },
    });
    const { rerender } = render(<EvaluationDetails event={decision} definitionLoading />);
    expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(
      'Loading run-version configuration…',
    );
    expect(
      screen.queryByText('Not recorded (classifier configuration unavailable)'),
    ).not.toBeInTheDocument();
    rerender(
      <EvaluationDetails event={decision} definition={noulDefinition()} definitionLoading />,
    );
    expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(
      'No minimum configured in run version',
    );
    rerender(<EvaluationDetails event={decision} />);
    expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(
      'Not recorded (classifier configuration unavailable)',
    );
  });
  it('shows an expression route with no provider, classifier evidence or invented confidence', () => {
    render(
      <EvaluationDetails
        event={event('run', 1, 'decision.made', {
          nodeId: 'pick',
          portId: 'ship',
          diagnostics: [],
          provenance: {
            kind: 'expression',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          observation: { kind: 'route', routeId: 'ship', confidence: null, reasoning: null },
        })}
      />,
    );
    expect(screen.getByText('Route ID').parentElement).toHaveTextContent('ship');
    expect(screen.queryByText('Confidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Confidence acceptance')).not.toBeInTheDocument();
  });

  it('shows confidence and reasoning when they were recorded on a historical expression fact', () => {
    render(
      <EvaluationDetails
        event={event('run', 1, 'decision.made', {
          nodeId: 'pick',
          portId: 'ship',
          diagnostics: [],
          provenance: {
            kind: 'expression',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          observation: {
            kind: 'route',
            routeId: 'ship',
            confidence: 0.4,
            reasoning: 'Recorded historical explanation.',
          },
        })}
      />,
    );
    expect(screen.getByText('Confidence').parentElement).toHaveTextContent('0.4');
    expect(screen.getByText('Reasoning excerpt').parentElement).toHaveTextContent(
      'Recorded historical explanation.',
    );
    expect(screen.queryByText('Self-reported confidence')).not.toBeInTheDocument();
  });

  it.each([
    [undefined, 0.8, 'No minimum configured in run version'],
    [0.7, 0.8, 'Meets run-version minimum 0.7'],
    [0.9, 0.8, 'Below run-version minimum 0.9'],
    [0.7, null, 'Not recorded; run-version minimum 0.7'],
  ] as const)(
    'shows recorded Choice evidence and factual confidence comparison %#',
    (minimum, confidence, expected) => {
      const definition = noulDefinition();
      const node = definition.nodes[0]!;
      if (node.kind !== 'decision' || node.config.kind !== 'classifier')
        throw new Error('Missing classifier fixture');
      node.config.answer = {
        type: 'choice',
        options: [
          { id: 'ship', label: 'Ship', criteria: 'Ready' },
          { id: 'review', label: 'Review', criteria: 'Needs work' },
        ],
      };
      if (minimum !== undefined) node.config.minConfidence = minimum;
      const { rerender } = render(
        <EvaluationDetails
          definition={definition}
          event={event('run', 1, 'decision.made', {
            nodeId: 'check',
            portId: 'ship',
            diagnostics: [],
            provenance: {
              kind: 'classifier',
              provider: 'http',
              classifierId: 'local',
              model: 'local-v1',
              effort: null,
            },
            observation: {
              kind: 'classifier',
              answer: {
                type: 'choice',
                optionId: 'ship',
                confidence,
                probabilities: { ship: 0.8, review: 0.2 },
              },
            },
          })}
        />,
      );
      expect(screen.getByText('Option ID').parentElement).toHaveTextContent('ship');
      expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(expected);
      expect(screen.getByRole('list', { name: 'Alternative probabilities' })).toHaveTextContent(
        'review: 0.2',
      );
      rerender(
        <EvaluationDetails
          event={event('run', 2, 'decision.made', {
            nodeId: 'check',
            portId: 'ship',
            diagnostics: [],
            provenance: {
              kind: 'classifier',
              provider: null,
              classifierId: null,
              model: null,
              effort: null,
            },
            observation: {
              kind: 'classifier',
              answer: { type: 'choice', optionId: 'ship', confidence: null, probabilities: null },
            },
          })}
        />,
      );
      expect(screen.getByText('Confidence acceptance').parentElement).toHaveTextContent(
        'Not recorded (classifier configuration unavailable)',
      );
      expect(screen.getByText('Alternative probabilities: not recorded.')).toBeInTheDocument();
      expect(screen.getByText('Model').parentElement).toHaveTextContent('Not recorded');
    },
  );

  it('preserves a historical boolean observation without inventing a route answer or reasoning', () => {
    render(
      <EvaluationDetails
        event={event('run', 1, 'decision.made', {
          nodeId: 'check',
          portId: 'old-port',
          diagnostics: [],
          provenance: {
            kind: 'llm',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          observation: { kind: 'boolean', holds: null, confidence: null, reasoning: null },
        })}
      />,
    );
    expect(screen.getByText('Answer').parentElement).toHaveTextContent('unknown (not recorded)');
    expect(screen.getByText('Selected port').parentElement).toHaveTextContent('old-port');
    expect(screen.getByText('Reasoning excerpt').parentElement).toHaveTextContent('Not recorded');
    expect(screen.queryByText('Route ID')).not.toBeInTheDocument();
  });
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
              provenance: {
                kind: 'expression',
                provider: null,
                classifierId: null,
                model: null,
                effort: null,
              },
              acceptance: { status: 'accepted' },
              match: {
                type: 'boolean',
                value: false,
              },
              observation: {
                kind: 'boolean',
                holds: true,
                confidence: null,
                reasoning: null,
              },
            },
            {
              index: 1,
              strategy: 'classifier',
              status: 'not-matched',
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
              observation: {
                kind: 'classifier',
                answer: {
                  type: 'noul',
                  holds: false,
                  trueProbability: 0.3,
                  confidence: 0.42,
                },
              },
            },
            {
              index: 2,
              strategy: 'llm',
              status: 'not-matched',
              provenance: {
                kind: 'llm',
                provider: 'codex',
                classifierId: null,
                model: 'gpt-6.1',
                effort: 'low',
              },
              acceptance: { status: 'accepted' },
              match: {
                type: 'boolean',
                value: false,
                minReportedConfidence: 0.8,
              },
              rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence: 0.61 },
              observation: {
                kind: 'boolean',
                holds: false,
                confidence: 0.61,
                reasoning: 'The evidence was not sufficient.',
              },
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
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent('Boolean true');
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Boolean is false',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Rejected below configured classifier minimum 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Classifier confidence gate rejected 0.42 below 0.8',
    );
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'Self-reported LLM confidence gate rejected 0.61 (reported by Codex) below 0.8',
    );
    expect(screen.getByText('Raw answer acceptance').parentElement).toHaveTextContent('Accepted');
    expect(screen.getByRole('list', { name: 'Exit criteria' })).toHaveTextContent(
      'The evidence was not sufficient.',
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
              provenance: {
                kind: 'classifier',
                provider: 'typesafe',
                classifierId: 'jev',
                model: 'jev-latest',
                effort: null,
              },
              acceptance: null,
              match: { type: 'score', operator: 'eq', value: 1.25 },
              observation: {
                kind: 'classifier',
                answer: {
                  type: 'score',
                  score: 1.25,
                  confidence: null,
                  legend: { '0': 'Low', '1': 'Medium', '2': 'High' },
                  probabilities: { '1': 0.7 },
                },
              },
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
          portId: 'yes',
          provenance: {
            kind: 'llm',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          diagnostics: [],
          observation: {
            kind: 'route',
            routeId: 'yes',
            confidence: 0.7,
            reasoning: 'Chose the declared route.',
          },
        })}
      />,
    );
    expect(screen.getByText('Self-reported confidence')).toBeInTheDocument();
    expect(
      screen.getByText(
        /reported by the evaluator; informational only, not a calibrated classifier score/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded')).toHaveLength(3);
    expect(screen.getByText('0.7')).toBeInTheDocument();
  });

  it('shows typed Noul and fractional Score evidence with stable ports and rubric anchors', () => {
    const noul = event('run', 1, 'decision.made', {
      nodeId: 'check',
      portId: 'false',
      provenance: {
        kind: 'llm',
        provider: 'codex',
        classifierId: null,
        model: 'gpt-5.6',
        effort: 'low',
      },
      diagnostics: [],
      observation: {
        kind: 'route',
        routeId: 'false',
        confidence: 0.74,
        reasoning: 'The evidence does not satisfy the criterion.',
      },
    });
    const { rerender } = render(<EvaluationDetails event={noul} />);
    expect(screen.getByText('Route ID').parentElement).toHaveTextContent('false');
    expect(screen.getByText('Selected port').parentElement).toHaveTextContent('false');
    expect(screen.getByText('Reasoning excerpt').parentElement).toHaveTextContent(
      'The evidence does not satisfy the criterion.',
    );

    rerender(
      <EvaluationDetails
        event={event('run', 2, 'decision.made', {
          nodeId: 'grade',
          portId: 'middle',
          provenance: {
            kind: 'classifier',
            provider: 'typesafe',
            classifierId: 'jev',
            model: 'jev-latest',
            effort: null,
          },
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'score',
              score: 1.25,
              confidence: 0.92,
              legend: { '2': 'Fully meets', '0': 'Does not meet', '1': 'Partly meets' },
              probabilities: { '1': 0.92 },
            },
          },
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
          provenance: {
            kind: 'llm',
            provider: 'codex',
            classifierId: null,
            model: null,
            effort: null,
          },
          acceptance: null,
          match: {
            type: 'boolean',
            value: true,
            minReportedConfidence: 0.8,
          },
          rejection: { kind: 'llm-reported-confidence', minimum: 0.8, confidence: null },
          observation: {
            kind: 'boolean',
            holds: null,
            confidence: null,
            reasoning: null,
          },
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
    expect(criteria).toHaveTextContent('Boolean unknown (not recorded)');
    expect(within(criteria).getByText('Unknown (not recorded)')).toBeInTheDocument();
    expect(within(criteria).getAllByText('Not recorded')).toHaveLength(4);
    expect(criteria).toHaveTextContent('Reasoning excerptNot recorded');
    expect(criteria).toHaveTextContent(
      'Self-reported LLM confidence gate rejected confidence was not reported; required minimum 0.8; treated as a nonmatch.',
    );

    rerender(
      <EvaluationDetails
        event={event('run', 2, 'decision.made', {
          nodeId: 'check',
          portId: 'true',
          provenance: {
            kind: 'classifier',
            provider: 'typesafe',
            classifierId: 'jev',
            model: 'jev-latest',
            effort: null,
          },
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'noul',
              holds: null,
              trueProbability: null,
              confidence: null,
            },
          },
        })}
      />,
    );
    expect(screen.getByText('Answer').parentElement).toHaveTextContent('unknown (not recorded)');
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
              observation: {
                kind: 'classifier',
                answer: {
                  type: 'noul',
                  holds: false,
                  trueProbability: 0.3,
                  confidence: 0.42,
                },
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
          portId: 'true',
          provenance: {
            kind: 'classifier',
            provider: 'typesafe',
            classifierId: 'jev',
            model: 'jev-latest',
            effort: null,
          },
          diagnostics: [],
          observation: {
            kind: 'classifier',
            answer: {
              type: 'noul',
              holds: true,
              trueProbability: 0.73,
              confidence: 0.91,
            },
          },
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
              observation: {
                kind: 'classifier',
                answer: {
                  type: 'score',
                  score: 1.25,
                  confidence: 0.3,
                  legend: { '0': 'Low', '1': 'Moderate', '2': 'High' },
                  probabilities: null,
                },
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
