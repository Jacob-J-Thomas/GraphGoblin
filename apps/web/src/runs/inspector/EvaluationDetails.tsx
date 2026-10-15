import {
  ClassifierAnswerSchema,
  EvaluationProvenanceSchema,
  type ClassifierAnswer,
  type EvaluationObservation,
  type EvaluationProvenance,
  type ExitCriterionEvaluation,
  type LoopDefinition,
  type RunEvent,
} from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { Fragment } from 'react';
import {
  answerDescription,
  describeEvent,
  observationDescription,
  strategyName,
} from '../projections.js';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function rejectedEvaluation(event: RunEvent) {
  if (event.type !== 'run.failed') return undefined;
  const details = record(event.failure.details),
    acceptance = record(details['acceptance']);
  const observation = record(details['observation']);
  const answer = ClassifierAnswerSchema.safeParse(observation['answer']);
  const provenance = EvaluationProvenanceSchema.safeParse(details['provenance']);
  const minimum = acceptance['minConfidence'];
  if (
    acceptance['status'] !== 'rejected' ||
    acceptance['code'] !== 'EVALUATION_RESULT_REJECTED' ||
    typeof minimum !== 'number' ||
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    minimum > 1 ||
    observation['kind'] !== 'classifier' ||
    !answer.success ||
    !provenance.success
  )
    return undefined;
  return { answer: answer.data, provenance: provenance.data, minConfidence: minimum };
}
function Identity({ value }: { value: EvaluationProvenance }) {
  return (
    <>
      <dt>Evaluator</dt>
      <dd>{value.kind}</dd>
      {(['provider', 'classifierId', 'model', 'effort'] as const).map((key) =>
        value[key] !== null ? (
          <Fragment key={key}>
            <dt>
              {
                {
                  provider: 'Provider',
                  classifierId: 'Classifier',
                  model: 'Model',
                  effort: 'Effort',
                }[key]
              }
            </dt>
            <dd>
              <code>{value[key]}</code>
            </dd>
          </Fragment>
        ) : value.kind === 'llm' && (key === 'model' || key === 'effort') ? (
          <Fragment key={key}>
            <dt>{key === 'model' ? 'Model' : 'Effort'}</dt>
            <dd>Not recorded</dd>
          </Fragment>
        ) : null,
      )}
    </>
  );
}
function truthThreshold(
  definition: LoopDefinition | undefined,
  nodeId: string | undefined,
  index?: number,
) {
  const node = definition?.nodes.find((n) => n.id === nodeId);
  const config =
    node?.kind === 'decision'
      ? node.config
      : node?.kind === 'exit' && index !== undefined
        ? node.config.criteria[index]
        : undefined;
  const predicate =
    config && 'when' in config
      ? config.when === 'predicate'
        ? config.predicate
        : undefined
      : config;
  return predicate?.kind === 'classifier' && predicate.answer.type === 'noul'
    ? (predicate.truthThreshold ?? 0.5)
    : undefined;
}
function ClassifierDetails({ answer, prefix = '' }: { answer: ClassifierAnswer; prefix?: string }) {
  return (
    <>
      {answer.type === 'score' ? (
        <ul
          aria-label={`${prefix}${prefix ? 'rubric' : 'Rubric'} anchors`}
          className="mt-2 grid gap-1 text-sm"
        >
          {Object.entries(answer.legend)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([index, label]) => (
              <li key={index}>
                Anchor <code>{index}</code>: {label}
              </li>
            ))}
        </ul>
      ) : null}
      {answer.type !== 'noul' && answer.probabilities ? (
        <ul
          aria-label={
            answer.type === 'score'
              ? `${prefix}${prefix ? 'rubric' : 'Rubric'} index probabilities`
              : `${prefix}Alternative probabilities`
          }
          className="mt-2 grid gap-1 text-sm"
        >
          {Object.entries(answer.probabilities).map(([key, value]) => (
            <li key={key}>
              <code>{key}</code>: {value}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
function ObservationDetails({
  observation,
  provenance,
  threshold,
}: {
  observation: EvaluationObservation;
  provenance: EvaluationProvenance;
  threshold: number | undefined;
}) {
  const answer = observation.kind === 'classifier' ? observation.answer : undefined;
  const confidence =
    answer?.confidence ?? (observation.kind !== 'classifier' ? observation.confidence : null);
  return (
    <>
      {answer?.type === 'noul' ? (
        <>
          <dt>True probability</dt>
          <dd>{answer.trueProbability ?? 'Not recorded'}</dd>
          <dt>True-probability threshold</dt>
          <dd>{threshold ?? 'Unknown (run version unavailable)'}</dd>
        </>
      ) : null}
      {confidence !== null || provenance.kind !== 'expression' ? (
        <>
          <dt>{provenance.kind === 'llm' ? 'Self-reported confidence' : 'Confidence'}</dt>
          <dd>
            {confidence ?? 'Not recorded'}
            {provenance.kind === 'llm' ? (
              <span className="ml-1 text-muted">
                (reported by the evaluator; informational only, not a calibrated classifier score)
              </span>
            ) : null}
          </dd>
        </>
      ) : null}
      {observation.kind !== 'classifier' && provenance.kind === 'llm' ? (
        <>
          <dt>Reasoning excerpt</dt>
          <dd className="whitespace-pre-wrap">{observation.reasoning ?? 'Not recorded'}</dd>
        </>
      ) : null}
    </>
  );
}
function matchDescription(
  criterion: Extract<ExitCriterionEvaluation, { observation: EvaluationObservation }>,
) {
  const match = criterion.match;
  switch (match.type) {
    case 'boolean':
      return `Boolean is ${match.value}`;
    case 'noul':
      return `Noul is ${match.value}`;
    case 'choice':
      return `Choice option ID is one of ${match.optionIds.join(', ')}`;
    case 'score':
      return `Score ${{ lt: '<', lte: '≤', eq: '=', gte: '≥', gt: '>' }[match.operator]} ${match.value}`;
  }
}
function ExitCriterionDetail({
  criterion,
  definition,
  nodeId,
}: {
  criterion: ExitCriterionEvaluation;
  definition: LoopDefinition | undefined;
  nodeId: string;
}) {
  return (
    <li>
      <p>
        Criterion {criterion.index + 1} ({strategyName(criterion.strategy)}):{' '}
        {criterion.status === 'skipped'
          ? `skipped: ${criterion.reason.message}`
          : criterion.status === 'error'
            ? `error: ${criterion.diagnostic.message}`
            : `${criterion.status === 'matched' ? 'matched' : 'did not match'}${'observation' in criterion ? '' : `; predicate ${criterion.holds === null ? 'unknown (not recorded)' : criterion.holds}`}`}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {criterion.status === 'error' ? (
          <>
            <dt>Diagnostic</dt>
            <dd>
              <code>{criterion.diagnostic.code}</code>
            </dd>
          </>
        ) : null}
        {'provenance' in criterion && criterion.provenance ? (
          <Identity value={criterion.provenance} />
        ) : null}
        {'observation' in criterion ? (
          <>
            <dt>Raw answer</dt>
            <dd>{observationDescription(criterion.observation)}</dd>
            <dt>Match rule</dt>
            <dd>{matchDescription(criterion)}</dd>
            <dt>
              {criterion.provenance.kind === 'llm' ? 'Raw answer acceptance' : 'Acceptance gate'}
            </dt>
            <dd>
              {criterion.acceptance === null
                ? 'Unknown (not recorded)'
                : criterion.acceptance.status === 'accepted'
                  ? 'Accepted'
                  : `Rejected below configured classifier minimum ${criterion.acceptance.minConfidence}`}
            </dd>
            {criterion.configuredMinConfidence !== undefined ? (
              <>
                <dt>Configured classifier minimum</dt>
                <dd>{criterion.configuredMinConfidence}</dd>
              </>
            ) : null}
            <ObservationDetails
              observation={criterion.observation}
              provenance={criterion.provenance}
              threshold={truthThreshold(definition, nodeId, criterion.index)}
            />
            {criterion.rejection ? (
              <>
                <dt>Confidence gate</dt>
                <dd>
                  {criterion.rejection.kind === 'classifier-confidence'
                    ? 'Classifier confidence'
                    : 'Self-reported LLM confidence'}{' '}
                  gate rejected{' '}
                  {criterion.rejection.confidence === null
                    ? 'confidence was not reported; required minimum'
                    : `${criterion.rejection.confidence}${criterion.rejection.kind === 'llm-reported-confidence' ? ' (reported by Codex)' : ''} below`}{' '}
                  {criterion.rejection.minimum}; treated as a nonmatch.
                </dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {'observation' in criterion && criterion.observation.kind === 'classifier' ? (
        <ClassifierDetails
          answer={criterion.observation.answer}
          prefix={`Criterion ${criterion.index + 1} `}
        />
      ) : null}
    </li>
  );
}
/** Existing evaluation inspection, projected from evaluator-specific factual observations. */
export function EvaluationDetails({
  event,
  definition,
}: {
  event: RunEvent | undefined;
  definition?: LoopDefinition | undefined;
}) {
  if (!event || !['decision.made', 'exit.evaluated', 'run.failed'].includes(event.type))
    return null;
  const rejection = rejectedEvaluation(event);
  if (event.type === 'run.failed' && !rejection) return null;
  return (
    <Card title="Evaluation details">
      <p>{describeEvent(event)}</p>
      {event.type === 'exit.evaluated' ? (
        <ol aria-label="Exit criteria" className="grid gap-2 text-sm">
          {event.criteria.map((criterion) => (
            <ExitCriterionDetail
              key={criterion.index}
              criterion={criterion}
              definition={definition}
              nodeId={event.nodeId}
            />
          ))}
        </ol>
      ) : event.type === 'decision.made' ? (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>
              {event.observation.kind === 'route'
                ? 'Route ID'
                : event.observation.kind === 'classifier' &&
                    event.observation.answer.type === 'choice'
                  ? 'Option ID'
                  : event.observation.kind === 'classifier' &&
                      event.observation.answer.type === 'score'
                    ? 'Score'
                    : 'Answer'}
            </dt>
            <dd>
              {event.observation.kind === 'route'
                ? event.observation.routeId
                : event.observation.kind === 'classifier' &&
                    event.observation.answer.type === 'score'
                  ? event.observation.answer.score
                  : event.observation.kind === 'classifier' &&
                      event.observation.answer.type === 'choice'
                    ? event.observation.answer.optionId
                    : observationDescription(event.observation)}
            </dd>
            <dt>
              {event.observation.kind === 'classifier' && event.observation.answer.type === 'score'
                ? 'Band port'
                : event.observation.kind === 'classifier' &&
                    event.observation.answer.type === 'noul'
                  ? 'Side port'
                  : 'Selected port'}
            </dt>
            <dd>
              <code>{event.portId}</code>
            </dd>
            <Identity value={event.provenance} />
            <ObservationDetails
              observation={event.observation}
              provenance={event.provenance}
              threshold={truthThreshold(definition, event.nodeId)}
            />
          </dl>
          {event.observation.kind === 'classifier' ? (
            <ClassifierDetails answer={event.observation.answer} />
          ) : null}
          {event.diagnostics.length ? (
            <ul aria-label="Evaluation diagnostics" className="mt-2 grid gap-2 text-sm">
              {event.diagnostics.map((diagnostic, index) => (
                <li key={index}>
                  {diagnostic.code}: {diagnostic.message}
                  <span className="text-muted"> ({diagnostic.provenance.kind})</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : rejection ? (
        <>
          <section aria-label="Rejected classifier evaluation" className="mt-2 grid gap-2 text-sm">
            <p>
              Classifier result rejected by the confidence gate. No decision was accepted and no
              route was selected.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt>Proposed answer</dt>
              <dd>{answerDescription(rejection.answer)}</dd>
              <ObservationDetails
                observation={{ kind: 'classifier', answer: rejection.answer }}
                provenance={rejection.provenance}
                threshold={truthThreshold(
                  definition,
                  event.type === 'run.failed' ? event.failure.nodeId : undefined,
                )}
              />
              <dt>Minimum confidence</dt>
              <dd>{rejection.minConfidence}</dd>
              <Identity value={rejection.provenance} />
            </dl>
          </section>
          <ClassifierDetails answer={rejection.answer} />
        </>
      ) : null}
    </Card>
  );
}
