import type { RunEvent } from '@graphgoblin/contracts';
import { RunLimits } from './inspector/RunLimits.js';
import { useQueryClient } from '@tanstack/react-query';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keys, useLoopVersion, useRun, useRunThread } from '../api/queries.js';
import { Page } from '../components/layout/index.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, BoundedValue, Card } from '../components/ui/index.js';
import { ProgressDrawer } from './inspector/ProgressDrawer.js';
import { EvaluationDetails } from './inspector/EvaluationDetails.js';
import { RunControls } from './inspector/RunControls.js';
import { SessionRecoveryControls } from './inspector/SessionRecoveryControls.js';
import { ThreadViewer } from './inspector/ThreadViewer.js';
import { Timeline } from './inspector/Timeline.js';
import { WaitPanel } from './inspector/WaitPanel.js';
import { DeliveryPanel } from './inspector/DeliveryPanel.js';
import { useRunEvents } from './useRunEvents.js';
import { describeEvent, exitReturnSummary, lastGateSummary } from './projections.js';

const META_LINK = 'touch-target font-medium text-link underline-offset-[3px] hover:underline';

function ChildRunDetails({ runId }: { runId: string }) {
  const query = useRun(runId);
  return (
    <Card title="Child run">
      {query.error instanceof GraphGoblinApiError && query.error.status === 404 ? (
        <p className="text-sm text-muted">
          Child run {runId} is no longer available. Its loop may have been deleted. This parent
          run's history is preserved.
        </p>
      ) : (
        <QueryState query={query} what="Child run">
          {(run) => (
            <p>
              <Link to={`/runs/${run.id}`} className={META_LINK}>
                {run.id}
              </Link>{' '}
              <RunStatusBadge status={run.status} />
            </p>
          )}
        </QueryState>
      )}
    </Card>
  );
}

/** A subloop failure is the failure of a child run (#251); its details name that run. */
function FailedChildLink({ details }: { details: unknown }) {
  const childRunId =
    typeof details === 'object' && details !== null && 'childRunId' in details
      ? details.childRunId
      : undefined;
  if (typeof childRunId !== 'string') return null;
  return (
    <>
      {' '}
      <Link to={`/runs/${childRunId}`} className={META_LINK}>
        failed child run
      </Link>
    </>
  );
}

/**
 * One run: its status and controls, failure or result, the waiting-for-input form, then the
 * timeline beside the thread at the chosen event (with that event's patch) and node progress.
 */
export function RunInspectorPage() {
  const { runId = '' } = useParams();
  const queryClient = useQueryClient();
  const runQuery = useRun(runId);
  const threadQuery = useRunThread(runId);
  const log = useRunEvents(runId, () => {
    void queryClient.invalidateQueries({ queryKey: keys.run(runId) });
    // The thread exists once the run has started; fetch it as soon as events show progress.
    if (!queryClient.getQueryData(keys.thread(runId))) {
      void queryClient.invalidateQueries({ queryKey: keys.thread(runId) });
    }
  });
  const [selectedSeq, setSelectedSeq] = useState<number | undefined>();
  const seq = selectedSeq ?? log.lastSeq;
  const selectedEvent = log.events.find((event) => event.seq === seq);
  const firstEvent = log.events[0];
  const latestExit = log.events.filter((event) => event.type === 'exit.evaluated').at(-1);
  const finished = log.events.findLast(
    (event): event is Extract<RunEvent, { type: 'run.finished' }> => event.type === 'run.finished',
  );
  // The exit's configuration explains a run that returned nothing, so a finished exit needs it too.
  const needsPinnedDefinition =
    latestExit !== undefined ||
    selectedEvent?.type === 'decision.made' ||
    selectedEvent?.type === 'run.failed' ||
    (firstEvent !== undefined && (firstEvent.type !== 'run.queued' || !firstEvent.initialThread));
  const versionQuery = useLoopVersion(
    runQuery.data?.loopId ?? '',
    runQuery.data?.versionId ?? '',
    needsPinnedDefinition,
  );
  const definition = versionQuery.data?.definition;
  const gateSummary = lastGateSummary(log.events);
  const returnSummary = exitReturnSummary(
    log.events,
    definition,
    threadQuery.data?.invocation.returnDefaults,
  );

  return (
    <Page wide>
      <QueryState query={runQuery} what="Run">
        {(run) => (
          <>
            {/* DOM order is title, meta links, then controls (the keyboard order before the
                cutover); the grid only places the controls at the top right. */}
            <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 max-sm:grid-cols-1">
              <div className="col-start-1 row-start-1 flex flex-wrap items-center gap-x-4 gap-y-3">
                <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xl font-semibold tracking-[-0.01em] text-heading">
                  Run{' '}
                  <span className="font-mono text-md font-medium tracking-normal text-muted">
                    {run.id}
                  </span>
                </h1>
                <RunStatusBadge status={run.status} />
              </div>
              <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
                {run.currentNodeId ? <span>at {run.currentNodeId}</span> : null}
                <Link to={`/loops/${run.loopId}/edit`} className={META_LINK}>
                  loop
                </Link>
                {run.parentRunId ? (
                  <Link to={`/runs/${run.parentRunId}`} className={META_LINK}>
                    parent run
                  </Link>
                ) : null}
                <Link to={`/runs?parent=${run.id}`} className={META_LINK}>
                  child runs
                </Link>
              </div>
              <div className="col-start-2 row-start-1 justify-self-end max-sm:col-start-1 max-sm:row-start-3 max-sm:justify-self-start">
                <RunControls run={run} />
              </div>
            </header>
            {run.failure ? (
              <Alert title={`Failed: ${run.failure.code}`}>
                {run.failure.message}
                {run.failure.resumable ? ' (resumable)' : ''}
                <FailedChildLink details={run.failure.details} />
              </Alert>
            ) : null}
            <SessionRecoveryControls run={run} events={log.events} />
            {latestExit ? (
              <Card title="Exit evaluation">
                <p>{describeEvent(latestExit)}</p>
                {gateSummary ? <p>{gateSummary}</p> : null}
                {returnSummary ? <p data-testid="exit-returns">{returnSummary}</p> : null}
              </Card>
            ) : null}
            {/* A null return is a value: show the row's recorded result, or the finish event's
                when the row has none. */}
            {run.result !== undefined || finished?.result !== undefined ? (
              <Card title="Result">
                <BoundedValue
                  value={run.result !== undefined ? run.result : finished?.result}
                  label="Result"
                  testId="run-result"
                  fileName={`run-${run.id}-result`}
                />
              </Card>
            ) : null}
            <RunLimits run={run} />
            <WaitPanel run={run} />
            <DeliveryPanel run={run} />
          </>
        )}
      </QueryState>
      <div className="grid items-start gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Timeline
          events={log.events}
          status={log.status}
          error={log.error}
          selected={seq}
          onSelect={setSelectedSeq}
        />
        <div className="grid min-w-0 gap-section">
          {selectedEvent?.type === 'child_run.started' ||
          selectedEvent?.type === 'child_run.finished' ? (
            <ChildRunDetails runId={selectedEvent.childRunId} />
          ) : null}
          <EvaluationDetails
            event={selectedEvent}
            definition={definition}
            definitionLoading={versionQuery.isPending}
            exitReturns={returnSummary}
          />
          {threadQuery.data ? (
            <ThreadViewer
              current={threadQuery.data}
              events={log.events}
              seq={seq}
              definition={definition}
              historyBytes={log.bytes}
            />
          ) : (
            <p className="text-sm text-muted">The thread is not available yet.</p>
          )}
          <ProgressDrawer events={log.events} />
        </div>
      </div>
    </Page>
  );
}
