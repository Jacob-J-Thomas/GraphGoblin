import {
  ClassifierAnswerSchema,
  EvaluationProvenanceSchema,
  type ClassifierAnswer,
  type EvaluationObservation,
  type EvaluationProvenance,
  type LoopDefinition,
  type RunEvent,
} from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { Fragment } from 'react';
import { answerDescription, describeEvent, observationDescription } from '../projections.js';

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
        ) : value.kind !== 'expression' &&
          (key === 'provider' ||
            key === 'model' ||
            (key === 'effort' && value.kind === 'llm') ||
            (key === 'classifierId' && value.kind === 'classifier')) ? (
          <Fragment key={key}>
            <dt>
              {
                {
                  model: 'Model',
                  effort: 'Effort',
                  provider: 'Provider',
                  classifierId: 'Classifier',
                }[key]
              }
            </dt>
            <dd>Not recorded</dd>
          </Fragment>
        ) : null,
      )}
    </>
  );
}
function truthThreshold(definition: LoopDefinition | undefined, nodeId: string | undefined) {
  const node = definition?.nodes.find((n) => n.id === nodeId);
  return node?.kind === 'decision' &&
    node.config.kind === 'classifier' &&
    node.config.answer.type === 'noul'
    ? (node.config.truthThreshold ?? 0.5)
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
      {answer.type !== 'noul' && answer.probabilities === null ? (
        <p className="mt-2 text-sm text-muted">Alternative probabilities: not recorded.</p>
      ) : null}
    </>
  );
}

function DecisionAcceptance({
  event,
  definition,
  definitionLoading,
}: {
  event: Extract<RunEvent, { type: 'decision.made' }>;
  definition: LoopDefinition | undefined;
  definitionLoading: boolean;
}) {
  if (event.observation.kind !== 'classifier') return null;
  const node = definition?.nodes.find((node) => node.id === event.nodeId);
  const config =
    node?.kind === 'decision' && node.config.kind === 'classifier' ? node.config : undefined;
  const confidence = event.observation.answer.confidence;
  return (
    <>
      <dt>Confidence acceptance</dt>
      <dd>
        {!definition && definitionLoading
          ? 'Loading run-version configuration…'
          : !config
            ? 'Not recorded (classifier configuration unavailable)'
            : config.minConfidence === undefined
              ? 'No minimum configured in run version'
              : confidence === null
                ? `Not recorded; run-version minimum ${config.minConfidence}`
                : `${confidence >= config.minConfidence ? 'Meets' : 'Below'} run-version minimum ${config.minConfidence}`}
      </dd>
    </>
  );
}
/**
 * The chosen route as authored in the immutable run version: its readable label and, for a
 * classifier Choice option or Noul side, the criterion the classifier was given. A refused repeat
 * keeps its observed route here while Selected port says Limit reached (#129).
 */
function ChosenRoute({
  event,
  definition,
  definitionLoading,
}: {
  event: Extract<RunEvent, { type: 'decision.made' }>;
  definition: LoopDefinition | undefined;
  definitionLoading: boolean;
}) {
  const node = definition?.nodes.find((n) => n.id === event.nodeId);
  const config = node?.kind === 'decision' ? node.config : undefined;
  const chosen = event.gate?.limit ? event.gate.repeatRouteId : event.portId;
  const rows: { id: string; label: string; criteria?: string }[] = !config
    ? []
    : config.kind !== 'classifier'
      ? config.routes
      : config.answer.type === 'choice'
        ? config.answer.options
        : config.answer.type === 'noul'
          ? [config.answer.true, config.answer.false]
          : config.answer.bands;
  const row = rows.find((candidate) => candidate.id === chosen);
  return (
    <>
      <dt>Label</dt>
      {/* Labels may be 120 characters without a break opportunity: wrap them, never widen. */}
      <dd className="min-w-0 wrap-anywhere">
        {!definition && definitionLoading
          ? 'Loading run-version configuration…'
          : !config
            ? 'Not recorded (decision configuration unavailable)'
            : (row?.label ?? 'Not in the run-version configuration')}
      </dd>
      {row?.criteria !== undefined ? (
        <>
          <dt>Criterion</dt>
          <dd className="min-w-0 whitespace-pre-wrap wrap-anywhere">{row.criteria}</dd>
        </>
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
      {observation.kind !== 'classifier' &&
      (provenance.kind === 'llm' || observation.reasoning !== null) ? (
        <>
          <dt>Reasoning excerpt</dt>
          <dd className="whitespace-pre-wrap">{observation.reasoning ?? 'Not recorded'}</dd>
        </>
      ) : null}
    </>
  );
}
/** Existing evaluation inspection, projected from evaluator-specific factual observations. */
export function EvaluationDetails({
  event,
  definition,
  definitionLoading = false,
  exitReturns,
}: {
  event: RunEvent | undefined;
  definition?: LoopDefinition | undefined;
  definitionLoading?: boolean;
  /** Why the run recorded no value, or why the history cannot show that (projections.ts). */
  exitReturns?: string | undefined;
}) {
  if (!event || !['decision.made', 'exit.evaluated', 'run.failed'].includes(event.type))
    return null;
  const rejection = rejectedEvaluation(event);
  if (event.type === 'run.failed' && !rejection) return null;
  return (
    <Card title="Evaluation details">
      <p>{describeEvent(event)}</p>
      {event.type === 'exit.evaluated' ? (
        <p>
          Exit outcome: {event.outcome}. This exit is terminal.{' '}
          {exitReturns ?? 'See the run result for the returned value.'}
        </p>
      ) : event.type === 'decision.made' ? (
        <>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
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
              {event.portId === 'limit-reached'
                ? 'Selected port'
                : event.observation.kind === 'classifier' &&
                    event.observation.answer.type === 'score'
                  ? 'Band port'
                  : event.observation.kind === 'classifier' &&
                      event.observation.answer.type === 'noul'
                    ? 'Side port'
                    : 'Selected port'}
            </dt>
            <dd>
              <code>{event.portId}</code>
            </dd>
            <ChosenRoute
              event={event}
              definition={definition}
              definitionLoading={definitionLoading}
            />
            {event.gate ? (
              <>
                <dt>Previous passes</dt>
                <dd>{event.gate.previousPasses}</dd>
                <dt>Current passes</dt>
                <dd>{event.gate.passes}</dd>
                <dt>Repeat route</dt>
                <dd>
                  <code>{event.gate.repeatRouteId}</code>
                </dd>
                <dt>Maximum passes</dt>
                <dd>{event.gate.maxPasses}</dd>
                <dt>Maximum run time</dt>
                <dd>
                  {event.gate.maxRunTimeSeconds === undefined
                    ? 'Not configured'
                    : `${event.gate.maxRunTimeSeconds} seconds`}
                </dd>
                <dt>Elapsed from run start</dt>
                <dd>{event.gate.elapsedSeconds} seconds</dd>
                <dt>Limit stopping repeat</dt>
                <dd>
                  {event.gate.limit === 'max-passes'
                    ? 'Maximum passes'
                    : event.gate.limit === 'max-run-time'
                      ? 'Maximum run time'
                      : 'None'}
                </dd>
              </>
            ) : null}
            <Identity value={event.provenance} />
            <DecisionAcceptance
              event={event}
              definition={definition}
              definitionLoading={definitionLoading}
            />
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
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
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
