import {
  EvaluationProvenanceSchema,
  PrimitiveAnswerSchema,
  type EvaluationProvenance,
  type ExitCriterionEvaluation,
  type LoopDefinition,
  type PrimitiveAnswer,
  type RunEvent,
} from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { answerDescription, describeEvent, strategyName } from '../projections.js';

interface RejectedEvaluation {
  answer: PrimitiveAnswer;
  provenance: EvaluationProvenance;
  minConfidence: number;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read only the typed classifier rejection evidence carried in a run failure. */
function rejectedEvaluation(event: RunEvent): RejectedEvaluation | undefined {
  if (event.type !== 'run.failed') return undefined;
  const details = record(event.failure.details);
  const acceptance = record(details['acceptance']);
  if (
    acceptance['status'] !== 'rejected' ||
    acceptance['code'] !== 'EVALUATION_RESULT_REJECTED' ||
    typeof acceptance['minConfidence'] !== 'number' ||
    acceptance['minConfidence'] < 0 ||
    acceptance['minConfidence'] > 1
  )
    return undefined;
  const answer = PrimitiveAnswerSchema.safeParse(details['answer']);
  const provenance = EvaluationProvenanceSchema.safeParse(details['provenance']);
  if (!answer.success || !provenance.success) return undefined;
  return {
    answer: answer.data,
    provenance: provenance.data,
    minConfidence: acceptance['minConfidence'],
  };
}

function evidenceAnswer(answer: PrimitiveAnswer): string {
  switch (answer.type) {
    case 'choice':
      return `Choice option ${answer.optionId}`;
    case 'noul':
      return `Noul ${answer.holds === null ? 'unknown (not recorded)' : answer.holds ? 'true' : 'false'}`;
    case 'score':
      return `Score ${answer.score}`;
  }
}

function matchDescription(
  criterion: Extract<ExitCriterionEvaluation, { answer: PrimitiveAnswer }>,
): string {
  switch (criterion.match.type) {
    case 'noul':
      return `Noul is ${criterion.match.value ? 'true' : 'false'}`;
    case 'choice':
      return `Choice option ID is one of ${criterion.match.optionIds.join(', ')}`;
    case 'score': {
      const operator = { lt: '<', lte: '≤', eq: '=', gte: '≥', gt: '>' }[criterion.match.operator];
      return `Score ${operator} ${criterion.match.value}`;
    }
  }
}

function confidenceText(value: number | null, llm: boolean): string {
  if (value === null) return 'Not reported';
  return llm ? `${value} (reported by Codex)` : String(value);
}

function noulTruthThreshold(
  definition: LoopDefinition | undefined,
  nodeId: string | undefined,
  index?: number,
): number | undefined {
  if (!definition || !nodeId) return undefined;
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return undefined;
  if (node.kind === 'decision') {
    if (node.config.answer.type !== 'noul' || node.config.evaluation.kind !== 'classifier')
      return undefined;
    return node.config.evaluation.truthThreshold ?? 0.5;
  }
  if (node.kind === 'exit' && index !== undefined) {
    const criterion = node.config.criteria[index];
    if (
      criterion?.when === 'predicate' &&
      criterion.answer.type === 'noul' &&
      criterion.evaluation.kind === 'classifier'
    )
      return criterion.evaluation.truthThreshold ?? 0.5;
  }
  return undefined;
}

function ExitCriterionDetail({
  criterion,
  definition,
  nodeId,
}: {
  criterion: ExitCriterionEvaluation;
  definition?: LoopDefinition | undefined;
  nodeId: string;
}) {
  const strategy = strategyName(criterion.strategy);
  return (
    <li>
      <p>
        Criterion {criterion.index + 1} ({strategy}):{' '}
        {criterion.status === 'skipped'
          ? `skipped: ${criterion.reason.message}`
          : criterion.status === 'error'
            ? `error: ${criterion.diagnostic.message}`
            : 'answer' in criterion
              ? `${criterion.status === 'matched' ? 'matched' : 'did not match'}`
              : `${criterion.status === 'matched' ? 'matched' : 'did not match'}${criterion.holds === null ? '; predicate unknown (not recorded)' : `; predicate ${criterion.holds}`}`}
      </p>
      {criterion.status === 'skipped' || criterion.status === 'error' ? (
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
            <>
              <dt>Evaluator</dt>
              <dd>{criterion.provenance.kind}</dd>
              {criterion.provenance.provider ? (
                <>
                  <dt>Provider</dt>
                  <dd>{criterion.provenance.provider}</dd>
                </>
              ) : null}
              {criterion.provenance.classifierId ? (
                <>
                  <dt>Classifier</dt>
                  <dd>
                    <code>{criterion.provenance.classifierId}</code>
                  </dd>
                </>
              ) : null}
              {criterion.provenance.model ? (
                <>
                  <dt>Model</dt>
                  <dd>
                    <code>{criterion.provenance.model}</code>
                  </dd>
                </>
              ) : null}
              {criterion.provenance.effort ? (
                <>
                  <dt>Effort</dt>
                  <dd>{criterion.provenance.effort}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
      ) : 'answer' in criterion ? (
        <>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Raw answer</dt>
            <dd>{answerDescription(criterion.answer)}</dd>
            <dt>Match rule</dt>
            <dd>{matchDescription(criterion)}</dd>
            <dt>Acceptance gate</dt>
            <dd>
              {criterion.acceptance === null
                ? 'Unknown (not recorded)'
                : criterion.acceptance.status === 'accepted'
                  ? 'Accepted'
                  : `Rejected at classifier confidence ${criterion.acceptance.minConfidence}`}
            </dd>
            <dt>Evaluator</dt>
            <dd>{criterion.provenance.kind}</dd>
            {criterion.provenance.provider ? (
              <>
                <dt>Provider</dt>
                <dd>{criterion.provenance.provider}</dd>
              </>
            ) : null}
            {criterion.provenance.classifierId ? (
              <>
                <dt>Classifier</dt>
                <dd>
                  <code>{criterion.provenance.classifierId}</code>
                </dd>
              </>
            ) : null}
            {criterion.provenance.model ? (
              <>
                <dt>Model</dt>
                <dd>
                  <code>{criterion.provenance.model}</code>
                </dd>
              </>
            ) : null}
            {criterion.provenance.effort ? (
              <>
                <dt>Effort</dt>
                <dd>{criterion.provenance.effort}</dd>
              </>
            ) : null}
            {criterion.configuredMinConfidence !== undefined ? (
              <>
                <dt>Configured classifier minimum</dt>
                <dd>{criterion.configuredMinConfidence}</dd>
              </>
            ) : null}
            {criterion.answer.type === 'noul' && criterion.answer.kind === 'classifier' ? (
              <>
                <dt>True probability</dt>
                <dd>{criterion.answer.trueProbability ?? 'Not recorded'}</dd>
                <dt>True-probability threshold</dt>
                <dd>
                  {noulTruthThreshold(definition, nodeId, criterion.index) ??
                    'Unknown (run version unavailable)'}
                </dd>
              </>
            ) : null}
            {(criterion.answer.type === 'noul' && criterion.answer.kind !== 'expression') ||
            criterion.answer.confidence !== null ? (
              <>
                <dt>
                  {criterion.provenance.kind === 'llm' ? 'Self-reported confidence' : 'Confidence'}
                </dt>
                <dd>
                  {criterion.answer.confidence === null
                    ? 'Not recorded'
                    : confidenceText(
                        criterion.answer.confidence,
                        criterion.provenance.kind === 'llm',
                      )}
                </dd>
              </>
            ) : null}
            {criterion.rejection ? (
              <>
                <dt>Confidence gate</dt>
                <dd>
                  {criterion.rejection.kind === 'classifier-confidence'
                    ? 'Classifier confidence'
                    : 'Self-reported LLM confidence'}{' '}
                  gate rejected{' '}
                  {confidenceText(
                    criterion.rejection.confidence,
                    criterion.rejection.kind === 'llm-reported-confidence',
                  )}{' '}
                  below {criterion.rejection.minimum}; treated as a nonmatch.
                </dd>
              </>
            ) : null}
          </dl>
          {criterion.answer.type === 'noul' && criterion.answer.kind === 'llm' ? (
            <p className="mt-1 whitespace-pre-wrap text-sm">
              Reasoning excerpt: {criterion.answer.reasoning ?? 'Not recorded'}
            </p>
          ) : null}
          {criterion.answer.type === 'score' ? (
            <ul
              aria-label={`Criterion ${criterion.index + 1} rubric anchors`}
              className="mt-1 grid gap-1 text-sm"
            >
              {Object.entries(criterion.answer.legend)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([index, text]) => (
                  <li key={index}>
                    Anchor <code>{index}</code>: {text}
                  </li>
                ))}
            </ul>
          ) : null}
          {criterion.answer.type !== 'noul' && criterion.answer.probabilities ? (
            <ul
              aria-label={
                criterion.answer.type === 'score'
                  ? `Criterion ${criterion.index + 1} rubric index probabilities`
                  : `Criterion ${criterion.index + 1} answer probabilities`
              }
              className="mt-1 grid gap-1 text-sm"
            >
              {Object.entries(criterion.answer.probabilities).map(([key, probability]) => (
                <li key={key}>
                  <code>{key}</code>: {probability}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** The selected evaluation's cause and ordered evidence in owner-facing words. */
export function EvaluationDetails({
  event,
  definition,
}: {
  event: RunEvent | undefined;
  definition?: LoopDefinition | undefined;
}) {
  if (
    event?.type !== 'exit.evaluated' &&
    event?.type !== 'decision.made' &&
    event?.type !== 'run.failed'
  )
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
      ) : event.type === 'run.failed' ? (
        rejection ? (
          <>
            <section
              aria-label="Rejected classifier evaluation"
              className="mt-2 grid gap-2 text-sm"
            >
              <p>
                Classifier result rejected by the confidence gate. No decision was accepted and no
                route was selected.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt>Proposed answer</dt>
                <dd>{evidenceAnswer(rejection.answer)}</dd>
                {rejection.answer.type === 'noul' && rejection.answer.kind === 'classifier' ? (
                  <>
                    <dt>True probability</dt>
                    <dd>{rejection.answer.trueProbability ?? 'Not recorded'}</dd>
                    <dt>True-probability threshold</dt>
                    <dd>
                      {noulTruthThreshold(definition, event.failure.nodeId) ??
                        'Unknown (run version unavailable)'}
                    </dd>
                  </>
                ) : null}
                {(rejection.answer.type === 'noul' && rejection.answer.kind !== 'expression') ||
                rejection.answer.confidence !== null ? (
                  <>
                    <dt>Confidence</dt>
                    <dd>{rejection.answer.confidence ?? 'Not recorded'}</dd>
                  </>
                ) : null}
                <dt>Minimum confidence</dt>
                <dd>{rejection.minConfidence}</dd>
                <dt>Evaluator</dt>
                <dd>{rejection.provenance.kind}</dd>
                {rejection.provenance.provider ? (
                  <>
                    <dt>Provider</dt>
                    <dd>{rejection.provenance.provider}</dd>
                  </>
                ) : null}
                {rejection.provenance.classifierId ? (
                  <>
                    <dt>Classifier</dt>
                    <dd>
                      <code>{rejection.provenance.classifierId}</code>
                    </dd>
                  </>
                ) : null}
                {rejection.provenance.model ? (
                  <>
                    <dt>Model</dt>
                    <dd>
                      <code>{rejection.provenance.model}</code>
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
            {rejection.answer.type === 'score' ? (
              <ul aria-label="Rubric anchors" className="mt-2 grid gap-1 text-sm">
                {Object.entries(rejection.answer.legend)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([index, label]) => (
                    <li key={index}>
                      Anchor <code>{index}</code>: {label}
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        ) : null
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {event.answer.type === 'choice' ? (
              <>
                <dt>Option ID</dt>
                <dd>
                  <code>{event.answer.optionId}</code>
                </dd>
              </>
            ) : event.answer.type === 'noul' ? (
              <>
                <dt>Answer</dt>
                <dd>
                  {event.answer.holds === null
                    ? 'Unknown (not recorded)'
                    : event.answer.holds
                      ? 'true'
                      : 'false'}
                </dd>
                <dt>Side port</dt>
                <dd>
                  <code>{event.portId}</code>
                </dd>
                {event.answer.kind === 'classifier' ? (
                  <>
                    <dt>True probability</dt>
                    <dd>{event.answer.trueProbability ?? 'Not recorded'}</dd>
                    <dt>True-probability threshold</dt>
                    <dd>
                      {noulTruthThreshold(definition, event.nodeId) ??
                        'Unknown (run version unavailable)'}
                    </dd>
                  </>
                ) : null}
                {event.answer.kind === 'llm' ? (
                  <>
                    <dt>Reasoning excerpt</dt>
                    <dd className="whitespace-pre-wrap">
                      {event.answer.reasoning ?? 'Not recorded'}
                    </dd>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <dt>Score</dt>
                <dd>{event.answer.score}</dd>
                <dt>Band port</dt>
                <dd>
                  <code>{event.portId}</code>
                </dd>
              </>
            )}
            <dt>Evaluator</dt>
            <dd>{event.provenance.kind}</dd>
            {event.provenance.provider ? (
              <>
                <dt>Provider</dt>
                <dd>{event.provenance.provider}</dd>
              </>
            ) : null}
            {event.provenance.classifierId ? (
              <>
                <dt>Classifier</dt>
                <dd>
                  <code>{event.provenance.classifierId}</code>
                </dd>
              </>
            ) : null}
            {event.provenance.kind === 'llm' ? (
              <>
                <dt>Model</dt>
                <dd>
                  {event.provenance.model ? <code>{event.provenance.model}</code> : 'Not recorded'}
                </dd>
              </>
            ) : event.provenance.model ? (
              <>
                <dt>Model</dt>
                <dd>
                  <code>{event.provenance.model}</code>
                </dd>
              </>
            ) : null}
            {event.provenance.kind === 'llm' ? (
              <>
                <dt>Effort</dt>
                <dd>{event.provenance.effort ?? 'Not recorded'}</dd>
              </>
            ) : event.provenance.effort ? (
              <>
                <dt>Effort</dt>
                <dd>{event.provenance.effort}</dd>
              </>
            ) : null}
            {(event.answer.type === 'noul' && event.answer.kind !== 'expression') ||
            event.answer.confidence !== null ? (
              <>
                <dt>
                  {event.provenance.kind === 'llm' ? 'Self-reported confidence' : 'Confidence'}
                </dt>
                <dd>
                  {event.answer.confidence === null ? 'Not recorded' : event.answer.confidence}
                  {event.provenance.kind === 'llm' ? (
                    <span className="ml-1 text-muted">
                      (reported by the evaluator; not a calibrated classifier score)
                    </span>
                  ) : null}
                </dd>
              </>
            ) : null}
          </dl>
          {event.answer.type === 'score' ? (
            <ul aria-label="Rubric anchors" className="mt-2 grid gap-1 text-sm">
              {Object.entries(event.answer.legend)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([index, label]) => (
                  <li key={index}>
                    Anchor <code>{index}</code>: {label}
                  </li>
                ))}
            </ul>
          ) : null}
          {event.answer.type !== 'noul' && event.answer.probabilities ? (
            <ul
              aria-label={
                event.answer.type === 'score'
                  ? 'Rubric index probabilities'
                  : 'Alternative probabilities'
              }
              className="mt-2 grid gap-1 text-sm"
            >
              {Object.entries(event.answer.probabilities).map(([optionId, probability]) => (
                <li key={optionId}>
                  <code>{optionId}</code>: {probability}
                </li>
              ))}
            </ul>
          ) : null}
          {event.diagnostics.length > 0 ? (
            <ul aria-label="Evaluation diagnostics" className="mt-2 grid gap-2 text-sm">
              {event.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>
                  {diagnostic.code}: {diagnostic.message}
                  <span className="text-muted"> ({diagnostic.provenance.kind})</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  );
}
