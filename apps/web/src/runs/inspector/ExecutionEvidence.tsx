import type { LoopDefinition, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { useState } from 'react';
import { BoundedValue, Button, Card, Disclosure } from '../../components/ui/index.js';
import { downloadJson } from '../../lib/utils.js';
import { cancellationSummary, nodeName } from '../projections.js';

/** Read-only evidence, separate from failure/resume eligibility and stream status. */
export function ExecutionContext({
  run,
  events,
  definition,
  definitionLoading,
}: {
  run: RunRecord;
  events: readonly RunEvent[];
  definition: LoopDefinition | undefined;
  definitionLoading: boolean;
}) {
  const [showRun, setShowRun] = useState(false);
  const [showDefinition, setShowDefinition] = useState(false);
  return (
    <Card title="Execution context">
      <p className="text-sm wrap-anywhere">
        {run.pinned.label} · version ID <code>{run.versionId}</code>
      </p>
      {!definition ? (
        <p className="text-sm text-muted">
          {definitionLoading
            ? 'Loading pinned definition…'
            : 'Pinned definition unavailable. Authored node and route labels are not recorded in the available history.'}
        </p>
      ) : null}
      {events.length > 0 && (events[0]?.type !== 'run.queued' || !events[0].initialThread) ? (
        <p className="text-sm text-muted">
          Initial thread not recorded. Historical reconstruction uses the documented fallback and
          may be incomplete.
        </p>
      ) : null}
      {run.status === 'cancelled' ? (
        <p className="text-sm wrap-anywhere">
          {cancellationSummary(events) ??
            ((events.at(-1)?.seq ?? 0) < run.lastEventSeq
              ? 'Cancelled. Cancellation history is incomplete; actor not available yet.'
              : 'Cancelled; terminal cancellation event not recorded, so its actor cannot be established.')}
          {run.currentNodeId
            ? ` Recorded node position: ${nodeName(definition, run.currentNodeId)}.`
            : ' Node position not recorded.'}
        </p>
      ) : null}
      <Disclosure label="Exact run record" variant="row" open={showRun} onOpenChange={setShowRun}>
        {showRun ? (
          <ExactValue value={run} label="Exact run record" fileName={`run-${run.id}-record`} />
        ) : null}
      </Disclosure>
      {definition ? (
        <Disclosure
          label="Pinned definition JSON"
          variant="row"
          open={showDefinition}
          onOpenChange={setShowDefinition}
        >
          {showDefinition ? (
            <ExactValue
              value={definition}
              label="Pinned definition JSON"
              fileName={`run-${run.id}-definition`}
            />
          ) : null}
        </Disclosure>
      ) : null}
    </Card>
  );
}

/** Every selected event is inspectable and downloadable without formatting away evidence. */
export function RecordedEvent({ event }: { event: RunEvent | undefined }) {
  const [open, setOpen] = useState(false);
  if (!event) return null;
  return (
    <Disclosure
      label={`Exact recorded event #${event.seq}`}
      variant="row"
      open={open}
      onOpenChange={setOpen}
    >
      {open ? (
        <ExactValue
          value={event}
          label="Exact recorded event"
          testId="recorded-event-json"
          fileName={`run-${event.runId}-event-${event.seq}`}
        />
      ) : null}
    </Disclosure>
  );
}

/** Keep a download available even for a value small enough to need no preview controls. */
function ExactValue({
  value,
  label,
  fileName,
  testId,
}: {
  value: unknown;
  label: string;
  fileName: string;
  testId?: string;
}) {
  return (
    <div className="grid gap-2">
      <BoundedValue value={value} label={label} labelled {...(testId ? { testId } : {})} />
      <Button
        size="sm"
        aria-label={`Download ${label} as JSON`}
        onClick={() => downloadJson(`${fileName}.json`, value)}
      >
        Download JSON
      </Button>
    </div>
  );
}
