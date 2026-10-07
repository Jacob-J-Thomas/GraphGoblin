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
        <ul aria-label="Skipped strategies" className="grid gap-2 text-sm">
          {event.skipped.map((skip, index) => (
            <li key={index}>
              Skipped {strategyName(skip.strategy)}: {skip.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
