import {
  EvaluationProvenanceSchema,
  PrimitiveAnswerSchema,
  type EvaluationProvenance,
  type PrimitiveAnswer,
  type RunEvent,
} from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { describeEvent, strategyName } from '../projections.js';

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
      return `Noul ${answer.holds ? 'true' : 'false'}`;
    case 'score':
      return `Score ${answer.score}`;
  }
}

/** The selected evaluation's cause and ordered evidence in owner-facing words. */
export function EvaluationDetails({ event }: { event: RunEvent | undefined }) {
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
            <li key={criterion.index}>
              <p>
                Criterion {criterion.index + 1} ({strategyName(criterion.strategy)}):{' '}
                {criterion.status === 'skipped'
                  ? `skipped: ${criterion.reason.message}`
                  : criterion.status === 'error'
                    ? `error: ${criterion.diagnostic.message}`
                    : `${criterion.status === 'matched' ? 'matched' : 'did not match'}${criterion.holds !== undefined ? `; predicate ${criterion.holds ? 'true' : 'false'}` : ''}${criterion.confidence !== undefined ? `; confidence ${criterion.confidence}` : ''}${criterion.minConfidence !== undefined ? `; required ${criterion.minConfidence}` : ''}`}
                {criterion.model ? `; model ${criterion.model}` : ''}
                {criterion.classifierModel ? `; classifier ${criterion.classifierModel}` : ''}
              </p>
              {'reasoning' in criterion && criterion.reasoning ? (
                <p className="whitespace-pre-wrap">Judge reasoning: {criterion.reasoning}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : event.type === 'run.failed' ? (
        rejection ? (
          <section aria-label="Rejected classifier evaluation" className="mt-2 grid gap-2 text-sm">
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
                  <dd>{rejection.answer.trueProbability}</dd>
                </>
              ) : null}
              {rejection.answer.confidence !== null ? (
                <>
                  <dt>Confidence</dt>
                  <dd>{rejection.answer.confidence}</dd>
                </>
              ) : null}
              <dt>Minimum confidence</dt>
              <dd>{rejection.minConfidence}</dd>
              <dt>Evaluator</dt>
              <dd>{rejection.provenance.kind}</dd>
            </dl>
          </section>
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
                <dd>{event.answer.holds ? 'true' : 'false'}</dd>
                <dt>Side port</dt>
                <dd>
                  <code>{event.portId}</code>
                </dd>
                {event.answer.kind === 'classifier' ? (
                  <>
                    <dt>True probability</dt>
                    <dd>{event.answer.trueProbability}</dd>
                  </>
                ) : null}
                {event.answer.kind === 'llm' ? (
                  <>
                    <dt>Reasoning excerpt</dt>
                    <dd className="whitespace-pre-wrap">{event.answer.reasoning}</dd>
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
            {event.answer.confidence !== null ? (
              <>
                <dt>
                  {event.provenance.kind === 'llm' ? 'Self-reported confidence' : 'Confidence'}
                </dt>
                <dd>
                  {event.answer.confidence}
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
