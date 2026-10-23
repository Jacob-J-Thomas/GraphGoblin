import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type EvaluationObservation } from '@graphgoblin/contracts';
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
  it.each<{ type: string; observation: EvaluationObservation }>([
    {
      type: 'Noul',
      observation: {
        kind: 'classifier',
        answer: { type: 'noul', holds: false, trueProbability: 0.2, confidence: 0.8 },
      },
    },
    {
      type: 'Score',
      observation: {
        kind: 'classifier',
        answer: {
          type: 'score',
          score: 0.25,
          confidence: null,
          legend: { '0': 'Low', '1': 'High' },
          probabilities: null,
        },
      },
    },
  ])(
    'keeps the $type observation separate from the Limit reached port',
    ({ type, observation }) => {
      render(
        <EvaluationDetails
          event={event('run', 1, 'decision.made', {
            nodeId: 'check',
            portId: 'limit-reached',
            diagnostics: [],
            observation,
            provenance: {
              kind: 'classifier',
              provider: 'typesafe',
              classifierId: 'jev',
              model: 'synthetic',
              effort: null,
            },
            gate: {
              previousPasses: 3,
              passes: 3,
              repeatRouteId: 'retry',
              maxPasses: 3,
              elapsedSeconds: 5,
              limit: 'max-passes',
            },
          })}
        />,
      );
      expect(screen.getByText('Selected port').nextElementSibling).toHaveTextContent(
        'limit-reached',
      );
      expect(screen.queryByText('Band port')).toBeNull();
      expect(screen.queryByText('Side port')).toBeNull();
      if (type === 'Score')
        expect(screen.getByText(/Scored 0.25 to band retry/)).toBeInTheDocument();
    },
  );
  it.each([null, 'max-passes', 'max-run-time'] as const)(
    'shows recorded gate pass counts and limit %s independently of the observation',
    (limit) => {
      render(
        <EvaluationDetails
          event={event('run', 1, 'decision.made', {
            nodeId: 'check',
            portId: limit ? 'limit-reached' : 'done',
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
              routeId: limit ? 'repeat' : 'done',
              confidence: null,
              reasoning: null,
            },
            gate: {
              previousPasses: 3,
              passes: 3,
              repeatRouteId: 'repeat',
              maxPasses: limit === 'max-run-time' ? 4 : 3,
              ...(limit === 'max-run-time' ? { maxRunTimeSeconds: 10 } : {}),
              elapsedSeconds: 12,
              limit,
            },
          })}
        />,
      );
      expect(screen.getByText('Previous passes').nextElementSibling).toHaveTextContent(/^3$/);
      expect(screen.getByText('Current passes').nextElementSibling).toHaveTextContent(/^3$/);
      expect(screen.getByText('Elapsed from run start').nextElementSibling).toHaveTextContent(
        '12 seconds',
      );
      expect(screen.getByText('Limit stopping repeat').nextElementSibling).toHaveTextContent(
        limit === 'max-passes'
          ? 'Maximum passes'
          : limit === 'max-run-time'
            ? 'Maximum run time'
            : 'None',
      );
    },
  );

  it.each(['success', 'failure', 'exhausted'] as const)(
    'shows terminal exit outcome %s',
    (outcome) => {
      render(
        <EvaluationDetails
          event={event('run', 1, 'exit.evaluated', { nodeId: 'done', outcome })}
        />,
      );
      expect(screen.getByText(/Exit outcome:/)).toHaveTextContent(outcome);
      expect(screen.queryByRole('list', { name: 'Exit criteria' })).toBeNull();
    },
  );
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

  it('replaces the result pointer with the reason when the exit returned nothing', () => {
    const reason =
      'Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure.';
    render(
      <EvaluationDetails
        event={event('run', 1, 'exit.evaluated', { nodeId: 'done', outcome: 'success' })}
        exitReturns={reason}
      />,
    );
    expect(screen.getByText(/Exit outcome:/)).toHaveTextContent(
      `Exit outcome: success. This exit is terminal. ${reason}`,
    );
    expect(screen.queryByText(/See the run result/)).toBeNull();
  });
});

/** Chosen-route evidence (#129): the authored label, and a classifier's criterion, from the run version. */
describe('EvaluationDetails chosen route', () => {
  const definition = LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Chosen route fixture',
    nodes: [
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'classifier',
          model: 'jev',
          question: 'Is the work done?',
          maxPasses: 3,
          answer: {
            type: 'choice',
            options: [
              { id: 'again', label: 'Again', repeat: true, criteria: 'More work is needed' },
              { id: 'done', label: 'Done', criteria: 'The work is complete' },
            ],
          },
        },
      },
      {
        id: 'route',
        kind: 'decision',
        label: 'Route',
        config: {
          kind: 'expression',
          jsonata: '"ship"',
          routes: [
            { id: 'ship', label: 'Ship it' },
            { id: 'hold', label: 'Hold' },
          ],
        },
      },
      {
        id: 'grade',
        kind: 'decision',
        label: 'Grade',
        config: {
          kind: 'classifier',
          model: 'jev',
          question: 'Grade it.',
          answer: {
            type: 'score',
            anchors: ['Poor', 'Fair', 'Good'],
            bands: [
              { id: 'low', label: 'Needs work', min: 0, max: 1 },
              { id: 'high', label: 'Good enough', min: 1, max: 2 },
            ],
          },
        },
      },
    ],
    edges: [],
  });
  const classifier = {
    kind: 'classifier',
    provider: 'typesafe',
    classifierId: 'jev',
    model: 'jev-latest',
    effort: null,
  } as const;
  const expression = {
    kind: 'expression',
    provider: null,
    classifierId: null,
    model: null,
    effort: null,
  } as const;
  const choice = (optionId: string) =>
    ({
      kind: 'classifier',
      answer: { type: 'choice', optionId, confidence: 0.9, probabilities: null },
    }) as const;
  const row = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling;

  it('names a Choice option and the criterion the classifier was given', () => {
    render(
      <EvaluationDetails
        definition={definition}
        event={event('run', 1, 'decision.made', {
          nodeId: 'gate',
          portId: 'done',
          diagnostics: [],
          provenance: classifier,
          observation: choice('done'),
          gate: {
            previousPasses: 2,
            passes: 2,
            repeatRouteId: 'again',
            maxPasses: 3,
            elapsedSeconds: 1,
            limit: null,
          },
        })}
      />,
    );
    expect(row('Label')).toHaveTextContent('Done');
    expect(row('Criterion')).toHaveTextContent('The work is complete');
  });

  it('keeps the refused repeat option while Selected port is Limit reached', () => {
    render(
      <EvaluationDetails
        definition={definition}
        event={event('run', 1, 'decision.made', {
          nodeId: 'gate',
          portId: 'limit-reached',
          diagnostics: [],
          provenance: classifier,
          observation: choice('again'),
          gate: {
            previousPasses: 3,
            passes: 3,
            repeatRouteId: 'again',
            maxPasses: 3,
            elapsedSeconds: 1,
            limit: 'max-passes',
          },
        })}
      />,
    );
    expect(row('Selected port')).toHaveTextContent('limit-reached');
    expect(row('Label')).toHaveTextContent('Again');
    expect(row('Criterion')).toHaveTextContent('More work is needed');
  });

  it('names an expression route and a Score band without inventing a criterion', () => {
    const { unmount } = render(
      <EvaluationDetails
        definition={definition}
        event={event('run', 1, 'decision.made', {
          nodeId: 'route',
          portId: 'ship',
          diagnostics: [],
          provenance: expression,
          observation: { kind: 'route', routeId: 'ship', confidence: null, reasoning: null },
        })}
      />,
    );
    expect(row('Label')).toHaveTextContent('Ship it');
    expect(screen.queryByText('Criterion', { selector: 'dt' })).toBeNull();
    unmount();
    render(
      <EvaluationDetails
        definition={definition}
        event={event('run', 1, 'decision.made', {
          nodeId: 'grade',
          portId: 'high',
          diagnostics: [],
          provenance: classifier,
          observation: {
            kind: 'classifier',
            answer: {
              type: 'score',
              score: 1.25,
              confidence: 0.7,
              legend: { '0': 'Poor', '1': 'Fair', '2': 'Good' },
              probabilities: null,
            },
          },
        })}
      />,
    );
    expect(row('Label')).toHaveTextContent('Good enough');
    expect(screen.queryByText('Criterion', { selector: 'dt' })).toBeNull();
  });

  it('says when the run version is loading, unavailable, or lacks the chosen route', () => {
    const made = (nodeId: string) =>
      event('run', 1, 'decision.made', {
        nodeId,
        portId: 'ship',
        diagnostics: [],
        provenance: expression,
        observation: { kind: 'route', routeId: 'ship', confidence: null, reasoning: null },
      });
    const { rerender } = render(<EvaluationDetails event={made('route')} definitionLoading />);
    expect(row('Label')).toHaveTextContent('Loading run-version configuration…');
    rerender(<EvaluationDetails event={made('route')} />);
    expect(row('Label')).toHaveTextContent('Not recorded (decision configuration unavailable)');
    rerender(<EvaluationDetails event={made('gate')} definition={definition} />);
    expect(row('Label')).toHaveTextContent('Not in the run-version configuration');
  });
});
