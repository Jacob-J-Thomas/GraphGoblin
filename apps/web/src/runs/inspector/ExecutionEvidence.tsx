import type { LoopDefinition, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { useState } from 'react';
import { BoundedValue, Button, Card, Disclosure } from '../../components/ui/index.js';
import { downloadJson } from '../../lib/utils.js';
import { cancellationSummary, nodeName } from '../projections.js';

/** Read-only evidence, separate from failure/resume eligibility and stream status. */
export function ExecutionContext({
  run,
  cancellation,
  cancellationUnavailable = false,
  definition,
  definitionLoading,
}: {
  run: RunRecord;
  /**
   * The latest cancellation and the request that led to it, read from the server for the whole
   * run (never from the browsed window); undefined until that read answers.
   */
  cancellation: readonly RunEvent[] | undefined;
  cancellationUnavailable?: boolean;
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
      {run.status === 'cancelled' ? (
        <p className="text-sm wrap-anywhere">
          {cancellation
            ? (cancellationSummary(cancellation) ??
              'Cancelled; terminal cancellation event not recorded, so its actor cannot be established.')
            : cancellationUnavailable
              ? 'Cancelled. The cancellation record could not be read.'
              : 'Cancelled. Reading the cancellation record…'}
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
