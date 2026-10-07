import type { RunEvent } from '@graphgoblin/contracts';
import { Card } from '../../components/ui/index.js';
import { describeEvent, strategyName } from '../projections.js';

/** The selected evaluation's cause and ordered evidence in owner-facing words. */
export function EvaluationDetails({ event }: { event: RunEvent | undefined }) {
  if (event?.type !== 'exit.evaluated' && event?.type !== 'decision.made') return null;
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
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Option ID</dt>
            <dd>
              <code>{event.answer.optionId}</code>
            </dd>
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
          {event.answer.probabilities ? (
            <ul aria-label="Alternative probabilities" className="mt-2 grid gap-1 text-sm">
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
