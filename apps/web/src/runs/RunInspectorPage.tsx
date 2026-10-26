import { ExecutionContext, RecordedEvent } from './inspector/ExecutionEvidence.js';
import type { RunEvent } from '@graphgoblin/contracts';
import { RunLimits } from './inspector/RunLimits.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraphGoblinApiError, runs } from '@graphgoblin/api-client';
import { Link, useParams } from 'react-router';
import { keys, useLoopVersion, useRun, useRunThread } from '../api/queries.js';
import { Page } from '../components/layout/index.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, BoundedValue, Card } from '../components/ui/index.js';
import { ProgressDrawer } from './inspector/ProgressDrawer.js';
import { EvaluationDetails } from './inspector/EvaluationDetails.js';
import { RunControls } from './inspector/RunControls.js';
import { ScriptRecovery } from './inspector/ScriptRecovery.js';
import { SessionRecoveryControls } from './inspector/SessionRecoveryControls.js';
import { ThreadViewer } from './inspector/ThreadViewer.js';
import { Timeline } from './inspector/Timeline.js';
import { WaitPanel } from './inspector/WaitPanel.js';
import { DeliveryPanel } from './inspector/DeliveryPanel.js';
import { useRunEvents } from './useRunEvents.js';
import { useRunHistory } from './useRunHistory.js';
import { useApi } from '../api/context.js';
import { describeEvent, exitReturnSummary, lastGateSummary, nodeName } from './projections.js';

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
    void queryClient.invalidateQueries({ queryKey: keys.thread(runId) });
    void queryClient.invalidateQueries({ queryKey: ['run-observation', runId] });
  });
  const client = useApi();
  const history = useRunHistory(runId, log);
  const selectedSeq = history.selectedSeq;
  const seq = selectedSeq ?? log.lastSeq;
  const selectedEvent = history.selectedEvent;
  const observation = useQuery({
    queryKey: ['run-observation', runId],
    queryFn: ({ signal }) => runs.observation(client, runId, { signal }),
  });
  const present = (events: (RunEvent | undefined)[]) =>
    events.filter((event): event is RunEvent => event !== undefined);
  const evidence = present([
    observation.data?.lifecycle,
    observation.data?.exit,
    observation.data?.gate,
    observation.data?.finished,
  ]);
  const latestExit = observation.data?.exit;
  const finished = observation.data?.finished;
  // Whole-run cancellation and recovery evidence, whatever window the Timeline is browsing.
  const cancellation = observation.data
    ? present([observation.data.cancelRequested, observation.data.cancelled])
    : undefined;
  const recovery = present([
    ...(observation.data?.freshSessionChoices ?? []),
    observation.data?.lifecycle?.type === 'run.failed' ? observation.data.lifecycle : undefined,
  ]);
  const resolveSeq = selectedSeq ?? (selectedEvent?.type === 'node.finished' ? seq : undefined);
  const selectedThread = useQuery({
    queryKey: ['run-thread-at', runId, resolveSeq],
    queryFn: async ({ signal }) => ({
      thread: await runs.thread(client, runId, { at: resolveSeq! }, { signal }),
      seq: resolveSeq!,
    }),
    placeholderData: (previous) => previous,
    enabled: resolveSeq !== undefined,
    gcTime: 0,
    staleTime: Infinity,
  });
  const beforeThread = useQuery({
    queryKey: ['run-thread-before', runId, resolveSeq],
    queryFn: ({ signal }) => runs.thread(client, runId, { at: Math.max(0, seq - 1) }, { signal }),
    enabled: resolveSeq !== undefined && selectedEvent?.type === 'node.finished',
    gcTime: 0,
    staleTime: Infinity,
  });
  const shownThread =
    resolveSeq === undefined ? threadQuery.data : (selectedThread.data?.thread ?? threadQuery.data);
  const shownSeq = resolveSeq === undefined ? undefined : selectedThread.data?.seq;
  const threadError = resolveSeq === undefined ? threadQuery.error : selectedThread.error;
  // Node and route labels come from the pinned version, so it is always read (#255).
  const versionQuery = useLoopVersion(runQuery.data?.loopId ?? '', runQuery.data?.versionId ?? '');
  const definition = versionQuery.data?.definition;
  const gateSummary = lastGateSummary(evidence, definition);
  const returnSummary = threadQuery.data
    ? exitReturnSummary(evidence, definition, threadQuery.data.invocation.returnDefaults)
    : undefined;

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
                {run.currentNodeId ? (
                  <span className="min-w-0 wrap-anywhere">
                    at {nodeName(definition, run.currentNodeId)}
                  </span>
                ) : null}
                <Link to={`/loops/${run.loopId}/edit`} className={META_LINK}>
                  loop
                </Link>
                {run.recovery.replayOf ? (
                  <span>
                    Replay run {run.id} from{' '}
                    <Link to={`/runs/${run.recovery.replayOf.runId}`} className={META_LINK}>
                      {run.recovery.replayOf.runId}
                    </Link>{' '}
                    at {run.recovery.replayOf.nodeId}
                  </span>
                ) : null}
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
                <ScriptRecovery run={run} />
              </div>
            </header>
            {run.status === 'failed' && run.failure ? (
              <Alert title={`Failed: ${run.failure.code}`}>
                {run.failure.code === 'SCRIPT_OUTCOME_UNCERTAIN' ? (
                  <p>
                    The previous script attempt may already have produced its effect. Resume runs
                    the script again and may repeat that effect.
                  </p>
                ) : run.failure.code === 'SCRIPT_START_FAILED' ? (
                  <p>The script process did not start. Resume tries to start it again.</p>
                ) : (
                  run.failure.message
                )}
                {run.recovery.resume.allowed ? ' (resumable)' : ''}
                <FailedChildLink details={run.failure.details} />
              </Alert>
            ) : null}
            {observation.error ? (
              <Alert>Run evidence could not be read: {observation.error.message}</Alert>
            ) : null}
            <SessionRecoveryControls run={run} events={recovery} />
            {latestExit ? (
              <Card title="Exit evaluation" bodyClassName="min-w-0 wrap-anywhere">
                <p>{describeEvent(latestExit, definition)}</p>
                {gateSummary ? <p>{gateSummary}</p> : null}
                {returnSummary ? <p data-testid="exit-returns">{returnSummary}</p> : null}
              </Card>
            ) : null}
            {/* A null return is a value: show the row's recorded result, or the finish event's
                when the row has none. */}
            {run.result !== undefined ||
            (finished?.type === 'run.finished' ? finished.result : undefined) !== undefined ? (
              <Card title="Result">
                <BoundedValue
                  value={
                    run.result !== undefined
                      ? run.result
                      : finished?.type === 'run.finished'
                        ? finished.result
                        : undefined
                  }
                  label="Result"
                  testId="run-result"
                  fileName={`run-${run.id}-result`}
                />
              </Card>
            ) : null}
            <RunLimits run={run} />
            <ExecutionContext
              run={run}
              cancellation={cancellation}
              cancellationUnavailable={observation.isError}
              definition={definition}
              definitionLoading={versionQuery.isPending}
            />
            <WaitPanel run={run} definition={definition} />
            <DeliveryPanel run={run} />
          </>
        )}
      </QueryState>
      <div className="grid items-start gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Timeline
          events={history.rows}
          definition={definition}
          total={log.lastSeq}
          following={log.mode === 'live'}
          hasOlder={history.hasOlder}
          hasNewer={history.hasNewer}
          busy={history.busy}
          onOlder={() => {
            void history.older();
          }}
          onNewer={() => {
            void history.newer();
          }}
          onLive={() => {
            void history.live();
          }}
          onPause={history.pause}
          status={log.status}
          error={history.error ?? log.error}
          selected={seq}
          onSelect={history.select}
        />
        <div className="grid min-w-0 gap-section">
          {history.payload ? (
            <Card title={`Event ${history.selectedSeq} payload`}>
              <BoundedValue
                value={history.payload}
                label="Event payload"
                testId="event-payload"
                fileName={`run-${runId}-event-${history.selectedSeq}`}
              />
            </Card>
          ) : null}
          {selectedEvent?.type === 'child_run.started' ||
          selectedEvent?.type === 'child_run.finished' ? (
            <ChildRunDetails runId={selectedEvent.childRunId} />
          ) : null}
          <RecordedEvent event={selectedEvent} />
          <EvaluationDetails
            event={selectedEvent}
            definition={definition}
            definitionLoading={versionQuery.isPending}
            exitReturns={returnSummary}
          />
          {threadError &&
          !(threadError instanceof GraphGoblinApiError && threadError.status === 404) ? (
            <Alert>Thread read failed: {threadError.message}</Alert>
          ) : null}
          {resolveSeq !== undefined && (selectedThread.isFetching || shownSeq !== resolveSeq) ? (
            <p className="text-sm text-muted" aria-live="polite">
              Reading the thread at event {resolveSeq}…
            </p>
          ) : null}
          {beforeThread.error ? (
            <Alert>Patch comparison could not be read: {beforeThread.error.message}</Alert>
          ) : null}
          {shownThread ? (
            <ThreadViewer
              current={shownThread}
              events={selectedEvent ? [selectedEvent] : []}
              seq={shownSeq ?? seq}
              live={shownSeq === undefined}
              before={shownSeq === resolveSeq ? beforeThread.data : undefined}
              definition={definition}
            />
          ) : (
            <p className="text-sm text-muted">The thread is not available yet.</p>
          )}
          <p className="text-xs text-muted">
            Activity below covers the retained history window. Earlier activity is available through
            Load older.
          </p>
          <ProgressDrawer events={log.events} definition={definition} />
        </div>
      </div>
    </Page>
  );
}
