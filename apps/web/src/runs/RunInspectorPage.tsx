import { ExecutionContext, RecordedEvent } from './inspector/ExecutionEvidence.js';
import type { LoopDefinition, RunEvent } from '@graphgoblin/contracts';
import { RunLimits } from './inspector/RunLimits.js';
import { HistoryEligibilityControls, useHistoryConfirmation } from './HistoryEligibility.js';
import { formatDateTime, isOfflineError } from '../lib/utils.js';
import { isTerminal } from '@graphgoblin/domain';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { GraphGoblinApiError, runs } from '@graphgoblin/api-client';
import { Link, useParams } from 'react-router';
import { keys, useLoopVersion, useRun, useRunThread } from '../api/queries.js';
import { Page } from '../components/layout/index.js';
import { OfflineState, QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, Badge, BoundedValue, Card } from '../components/ui/index.js';
import { ProgressDrawer } from './inspector/ProgressDrawer.js';
import { EvaluationDetails } from './inspector/EvaluationDetails.js';
import { RunControls, type WriteGate } from './inspector/RunControls.js';
import {
  getInspectorRead,
  markInspectorReadLoss,
  trackInspectorRead,
  useInspectorRead,
} from './inspector-read-provenance.js';
import { ScriptRecovery, useScriptRetry } from './inspector/ScriptRecovery.js';
import {
  SessionRecoveryControls,
  useSessionRecovery,
} from './inspector/SessionRecoveryControls.js';
import { ThreadViewer } from './inspector/ThreadViewer.js';
import { Timeline } from './inspector/Timeline.js';
import { WaitPanel } from './inspector/WaitPanel.js';
import { DeliveryPanel } from './inspector/DeliveryPanel.js';
import { useRunEvents } from './useRunEvents.js';
import { useRunHeaderStatus } from './useRunHeaderStatus.js';
import type { HeaderStatus } from './run-header-status.js';
import { useRunHistory } from './useRunHistory.js';
import { useLiveRefresh } from './useLiveRefresh.js';
import { useApi } from '../api/context.js';
import { describeEvent, exitReturnSummary, lastGateSummary, nodeName } from './projections.js';

const META_LINK = 'touch-target font-medium text-link underline-offset-[3px] hover:underline';

type Observation = Awaited<ReturnType<typeof runs.observation>>;

/**
 * Whether an observation may later be kept on screen through an outage (#416): every field the
 * run section shows has its expected kind and names this run. An empty observation is an observed
 * answer too. This decides eligibility only; the read's ordinary answer and errors are unchanged.
 */
function eligibleObservation(read: Observation, runId: string): boolean {
  const ours = (event: RunEvent | undefined, ...types: RunEvent['type'][]) =>
    event === undefined || (event.runId === runId && types.includes(event.type));
  const choices: readonly RunEvent[] | undefined = read.freshSessionChoices;
  return (
    ours(
      read.lifecycle,
      'run.started',
      'run.resumed',
      'run.finished',
      'run.failed',
      'run.cancelled',
    ) &&
    ours(read.exit, 'exit.evaluated') &&
    ours(read.gate, 'decision.made') &&
    ours(read.finished, 'run.finished') &&
    ours(read.cancelRequested, 'run.cancel_requested') &&
    ours(read.cancelled, 'run.cancelled') &&
    (choices ?? []).every(
      (event) =>
        event.runId === runId && event.type === 'run.resumed' && event.freshSession !== undefined,
    )
  );
}

/**
 * The browser's latest disconnect, as a position comparable with inspector read starts (#416);
 * zero before any. Recorded in the connectivity transition itself, for every inspector visit.
 */
let browserLoss = 0;
const browserLossListeners = new Set<() => void>();
let watchingBrowser = false;

function watchBrowser(notify: () => void): () => void {
  if (!watchingBrowser) {
    watchingBrowser = true;
    const record = (online: boolean) => {
      if (online) return;
      browserLoss = markInspectorReadLoss();
      for (const listener of [...browserLossListeners]) listener();
    };
    // A view first opened while offline starts after a disconnect it did not see.
    record(onlineManager.isOnline());
    onlineManager.subscribe(record);
  }
  browserLossListeners.add(notify);
  const stop = onlineManager.subscribe(() => notify());
  return () => {
    browserLossListeners.delete(notify);
    stop();
  };
}
const browserOnline = () => onlineManager.isOnline();
const browserLossSnapshot = () => browserLoss;

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
 * The header's execution status (#386): the record's, or a lifecycle event the record has not
 * caught up with yet. Presentation only; controls, recovery and the failure stay the record's.
 */
function HeaderStatusBadge({ status }: { status: HeaderStatus }) {
  return status.kind === 'updating' ? (
    <Badge tone="neutral" data-status-updating="">
      Updating status…
    </Badge>
  ) : (
    <RunStatusBadge status={status.status} />
  );
}

/**
 * Where the run is, beside the header status. A record's position is shown only with the
 * record's own status: beside a newer event's status or an unresolved one it could be stale. A
 * finished record's node is the last one its record names, which need not be where the run ended:
 * the event sequence can advance before the position is projected.
 */
function HeaderPosition({
  status,
  nodeId,
  definition,
}: {
  status: HeaderStatus;
  nodeId: string | undefined;
  definition: LoopDefinition | undefined;
}) {
  if (status.kind === 'event')
    return (
      <span className="min-w-0 wrap-anywhere">
        Status from event #{status.seq}; the run record is updating.
      </span>
    );
  if (status.kind === 'updating' || !nodeId) return null;
  return (
    <span className="min-w-0 wrap-anywhere">
      {isTerminal(status.status) ? 'Last node in run record: ' : 'at '}
      {nodeName(definition, nodeId)}
    </span>
  );
}

/**
 * One run: its status and controls, failure or result, the waiting-for-input form, then the
 * timeline beside the thread at the chosen event (with that event's patch) and node progress.
 *
 * Through a transport outage (#416) the run section keeps the last run this view read with a
 * qualified receipt, labelled as last observed, and every control that writes stays unavailable
 * until a run read that started after the outage began has committed. A cold or unproved row
 * stays unavailable. The Timeline and thread below keep their own behaviour.
 */
export function RunInspectorPage() {
  const { runId = '' } = useParams();
  const runQuery = useRun(runId);
  const threadQuery = useRunThread(runId);
  const live = useLiveRefresh(runId);
  const client = useApi();
  const queryClient = useQueryClient();
  const header = useRunHeaderStatus(runId);
  const observation = useQuery({
    queryKey: keys.observation(runId),
    // A successful read, under the credentials it was sent with, is lifecycle evidence for the
    // header (#386); the answer itself is unchanged, and a cached one is not a new read. Its
    // receipt lets the run section keep this evidence through an outage (#416).
    queryFn: (context) =>
      trackInspectorRead(
        header.registry.source.client === client ? header.registry : undefined,
        context,
        async () => {
          const lease = header.registry.lease(runId);
          const read = await runs.observation(client, runId, { signal: context.signal });
          if (!context.signal.aborted) header.registry.lifecycle(lease, read.lifecycle);
          return read;
        },
        (read) => eligibleObservation(read, runId),
      ),
  });
  // The stream delivers every accepted batch to the header's evidence itself, whatever window
  // is shown (#386).
  const log = useRunEvents(runId, live.notify);
  // One status for the header's badge and position; controls and recovery take the record.
  const shownStatus = runQuery.data && header.status(runQuery.data);
  const history = useRunHistory(runId, log);
  const selectedSeq = history.selectedSeq;
  const seq = selectedSeq ?? log.lastSeq;
  const selectedEvent = history.selectedEvent;

  // #416. Receipts and losses are read-start positions. `loss` keeps the start of the latest
  // outage even after it ends, so freshness is always `committed > boundary`, never `loss > 0`;
  // a positive `committed` alone only lets the last observed run stay on screen.
  const runRead = useInspectorRead(header.registry, keys.run(runId));
  const observationRead = useInspectorRead(header.registry, keys.observation(runId));
  const online = useSyncExternalStore(watchBrowser, browserOnline);
  const lastBrowserLoss = useSyncExternalStore(watchBrowser, browserLossSnapshot);
  // A credential change empties the receipt's loss as well: remember the newest boundary seen for
  // the run shown, so only a later qualified read of it can release it. Another run opened in this
  // view starts from its own receipts; the browser's loss applies to every run.
  const [latch, setLatch] = useState({ runId, loss: 0 });
  const remembered = latch.runId === runId ? latch.loss : 0;
  const boundary = Math.max(lastBrowserLoss, runRead.loss, remembered);
  if (latch.runId !== runId || boundary > latch.loss) setLatch({ runId, loss: boundary });
  const run = runQuery.data;
  const down = !online || runQuery.fetchStatus === 'paused' || isOfflineError(runQuery.error);
  const fresh = boundary === 0 || runRead.committed > boundary;
  const outage = down || !fresh;
  // A definitive refusal keeps its ordinary error; a later transport error cannot resurrect it.
  const refused = runQuery.isError && !isOfflineError(runQuery.error);
  // Whether the run section presents the run: during an outage a cold or unproved row never is.
  const presented = run !== undefined && !refused && (!outage || runRead.committed > 0);
  const blocked = !online
    ? 'This browser is offline.'
    : down
      ? 'The GraphGoblin API cannot be reached; reconnecting.'
      : fresh
        ? undefined
        : 'Reconnecting: reading this run again.';
  const observationBoundary = Math.max(boundary, observationRead.loss);
  const observationFresh =
    observationBoundary === 0 || observationRead.committed > observationBoundary;
  // During an outage, observation evidence is shown only from a qualified read of it.
  const observed = !outage || observationRead.committed > 0 ? observation.data : undefined;

  const present = (events: (RunEvent | undefined)[]) =>
    events.filter((event): event is RunEvent => event !== undefined);
  const evidence = present([
    observed?.lifecycle,
    observed?.exit,
    observed?.gate,
    observed?.finished,
  ]);
  const latestExit = observed?.exit;
  const finished = observed?.finished;
  // Whole-run cancellation and recovery evidence, whatever window the Timeline is browsing.
  const cancellation = observed
    ? present([observed.cancelRequested, observed.cancelled])
    : undefined;
  const recovery = present([
    ...(observed?.freshSessionChoices ?? []),
    observed?.lifecycle?.type === 'run.failed' ? observed.lifecycle : undefined,
  ]);

  // The view's write gate: replaced when the visit, the outage boundary or availability changes,
  // so a review or queued command captured earlier cannot act after a reconnect or A→B→A.
  const latestGate = useRef<WriteGate | undefined>(undefined);
  const shownVisit = useRef<object | undefined>(undefined);
  const visit = useMemo(() => ({ runId }), [runId]);
  const gate = useMemo<WriteGate>(() => {
    const key = keys.run(runId);
    const self: WriteGate = {
      blocked,
      shown: () => shownVisit.current === visit,
      open: () => {
        if (blocked !== undefined || latestGate.current !== self || !onlineManager.isOnline())
          return false;
        const read = getInspectorRead(header.registry, key);
        // A newer browser or run-read loss starts another outage: this gate is spent.
        if (Math.max(browserLoss, read.loss) > boundary) return false;
        if (boundary > 0 && !(read.committed > boundary)) return false;
        const state = queryClient.getQueryState(key);
        return state?.fetchStatus !== 'paused' && !isOfflineError(state?.error);
      },
    };
    return self;
  }, [blocked, boundary, header.registry, queryClient, runId, visit]);
  // Start fresh session also needs the observation that recorded the failure read after the
  // outage; its action matches its run, node, visit and failure sequence. The gate keeps
  // the observation boundary it was issued after: a later loss of the observation read alone
  // spends it, even once the observation has been read again. Like the view's write gate, it is
  // replaced when that boundary or the evidence's freshness changes, and only the latest committed
  // one can open: once a loss has been shown, a receipt replaced later (a removed query, another
  // credential generation) that starts again without that loss cannot reopen an earlier choice.
  // The receipt checks still cover the time before the loss is committed.
  const latestSessionGate = useRef<WriteGate | undefined>(undefined);
  const sessionGate = useMemo<WriteGate>(() => {
    const key = keys.observation(runId);
    const since = observationBoundary;
    const evidenceBlocked =
      gate.blocked ?? (observationFresh ? undefined : 'Reading the run evidence again.');
    const self: WriteGate = {
      blocked: evidenceBlocked,
      shown: gate.shown,
      open: () => {
        if (evidenceBlocked !== undefined || latestSessionGate.current !== self || !gate.open())
          return false;
        const read = getInspectorRead(header.registry, key);
        if (read.loss > since) return false;
        return since === 0 || read.committed > since;
      },
    };
    return self;
  }, [gate, header.registry, observationBoundary, observationFresh, runId]);
  useLayoutEffect(() => {
    latestGate.current = gate;
    shownVisit.current = visit;
    return () => {
      latestGate.current = undefined;
      shownVisit.current = undefined;
    };
  }, [gate, visit]);
  useLayoutEffect(() => {
    latestSessionGate.current = sessionGate;
    return () => {
      latestSessionGate.current = undefined;
    };
  }, [sessionGate]);
  // The choice belongs to this visit, not to the run section that presents it: while the section
  // is withheld, a choice queued before keeps its pending state, and the control shown again
  // reports its own outcome. Withholding, qualification and the gate above are unchanged.
  const sessionRecovery = useSessionRecovery({
    owner: visit,
    run: presented ? run : undefined,
    events: recovery,
    availability: sessionGate,
  });
  // Script recovery and the delete-ready confirmation are owned the same way. A retry or
  // confirmation sent before the section was withheld stays the only one: the controls shown again
  // stay disabled until it settles, then report its actual outcome. Their reviews belong to the
  // section and end with it; the write checks are the ones they always made.
  const scriptRetry = useScriptRetry({ owner: visit, availability: gate });
  const historyConfirmation = useHistoryConfirmation({ owner: visit, availability: gate });

  // At most one otherwise-unserved read per outage boundary: the shared probe already rereads a
  // failed query, a read in flight is joined, and one started before the loss settles first (it
  // cannot qualify). The observation is read again only where Start fresh session needs it.
  const reread = useRef('');
  const needsEvidence =
    run?.status === 'failed' && run.failure?.code === 'HARNESS_SESSION_MISSING' && fresh;
  useEffect(() => {
    if (!online || runQuery.status !== 'success' || runQuery.fetchStatus !== 'idle') return;
    const evidenceDue =
      needsEvidence &&
      !observationFresh &&
      observation.status === 'success' &&
      observation.fetchStatus === 'idle';
    const target = !fresh
      ? { key: keys.run(runId), ticket: `${runId}:run:${boundary}` }
      : evidenceDue
        ? { key: keys.observation(runId), ticket: `${runId}:observation:${observationBoundary}` }
        : undefined;
    if (!target || reread.current === target.ticket) return;
    reread.current = target.ticket;
    void queryClient.refetchQueries(
      { queryKey: target.key, exact: true, type: 'active' },
      { cancelRefetch: false },
    );
  }, [
    boundary,
    fresh,
    needsEvidence,
    observation.fetchStatus,
    observation.status,
    observationBoundary,
    observationFresh,
    online,
    queryClient,
    runId,
    runQuery.fetchStatus,
    runQuery.status,
  ]);
  // Only a selected event reads a historical thread. Following live shows the current thread,
  // whose read stays bounded however long the history grows; a completion's patch diff reads its
  // exact boundaries once the reader selects it (#186).
  const currentThreadShown = selectedSeq === undefined;
  useEffect(() => {
    live.showCurrentThread(currentThreadShown);
  }, [live, currentThreadShown]);
  const selectedThread = useQuery({
    queryKey: ['run-thread-at', runId, selectedSeq],
    queryFn: async ({ signal }) => ({
      thread: await runs.thread(client, runId, { at: selectedSeq! }, { signal }),
      seq: selectedSeq!,
    }),
    enabled: selectedSeq !== undefined,
    gcTime: 0,
    staleTime: Infinity,
  });
  const beforeThread = useQuery({
    queryKey: ['run-thread-before', runId, selectedSeq],
    queryFn: ({ signal }) =>
      runs.thread(client, runId, { at: Math.max(0, selectedSeq! - 1) }, { signal }),
    enabled: selectedSeq !== undefined && selectedEvent?.type === 'node.finished',
    gcTime: 0,
    staleTime: Infinity,
  });
  // The thread on screen: the current thread while following, or a selected event's exact thread
  // once read. While a selection is read, the thread shown just before it stays with its own
  // label, so leaving the current thread keeps showing it rather than an older selection's.
  const resolved = currentThreadShown
    ? threadQuery.data && { runId, thread: threadQuery.data, seq: undefined }
    : selectedThread.data && { runId, ...selectedThread.data };
  const [preceding, setPreceding] = useState(resolved);
  if (resolved && (resolved.thread !== preceding?.thread || resolved.seq !== preceding?.seq))
    setPreceding(resolved);
  const shown =
    resolved ??
    (preceding?.runId === runId ? preceding : undefined) ??
    (threadQuery.data && { thread: threadQuery.data, seq: undefined });
  const shownThread = shown?.thread;
  const shownSeq = shown?.seq;
  const threadError = currentThreadShown ? threadQuery.error : selectedThread.error;
  // Node and route labels come from the pinned version, so it is always read (#255).
  const versionQuery = useLoopVersion(runQuery.data?.loopId ?? '', runQuery.data?.versionId ?? '');
  const definition = versionQuery.data?.definition;
  // In an outage the run section names nodes by their recorded IDs and omits summaries that no
  // qualified read supplied (#416). The Timeline below keeps the pinned labels.
  const sectionDefinition = outage ? undefined : definition;
  const gateSummary = outage ? undefined : lastGateSummary(evidence, definition);
  // A selected exit's explanation reads the observation, thread and version it always read; only
  // the run section's copy of it is withheld through an outage.
  const exitReturns = threadQuery.data
    ? exitReturnSummary(
        present([
          observation.data?.lifecycle,
          observation.data?.exit,
          observation.data?.gate,
          observation.data?.finished,
        ]),
        definition,
        threadQuery.data.invocation.returnDefaults,
      )
    : undefined;
  const returnSummary = outage ? undefined : exitReturns;

  return (
    <Page wide>
      {/* One keyed position for the run section, current or last observed, so a draft or an
          open control survives the switch; another run starts a new section. During an outage
          a cold or unproved row is never presented as the run (#416). */}
      {presented ? (
        <Fragment key={run.id}>
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
              {shownStatus ? <HeaderStatusBadge status={shownStatus} /> : null}
            </div>
            <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              {shownStatus ? (
                <HeaderPosition
                  status={shownStatus}
                  nodeId={run.currentNodeId}
                  definition={sectionDefinition}
                />
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
              <RunControls run={run} availability={gate} />
              <ScriptRecovery run={run} retry={scriptRetry} />
            </div>
          </header>
          {outage ? (
            <Alert tone="warn" title="Last observed, may be out of date">
              {blocked} The run below is the last one this browser read. Changes to it stay
              unavailable until it is read again.
            </Alert>
          ) : null}
          {run.status === 'failed' && run.failure ? (
            <Alert title={`Failed: ${run.failure.code}`}>
              {run.failure.code === 'SCRIPT_OUTCOME_UNCERTAIN' ? (
                <p>
                  The previous script attempt may already have produced its effect. Resume runs the
                  script again and may repeat that effect.
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
          <SessionRecoveryControls run={run} events={recovery} recovery={sessionRecovery} />
          {latestExit ? (
            <Card title="Exit evaluation" bodyClassName="min-w-0 wrap-anywhere">
              <p>{describeEvent(latestExit, sectionDefinition)}</p>
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
          <div className="grid gap-2">
            <p className="text-sm text-muted">
              {run.deletionApproval
                ? `Delete-ready: confirmed by ${run.deletionApproval.confirmedBy.id} at ${formatDateTime(run.deletionApproval.confirmedAt)}.`
                : 'History retained.'}
            </p>
            <HistoryEligibilityControls runIds={[run.id]} confirmation={historyConfirmation} />
          </div>
          {/* While the run is last observed, execution context names nodes by their recorded IDs,
              says the pinned definition is unavailable rather than loading, and takes a
              cancellation's actor and sequence numbers only from a qualified observation. */}
          <ExecutionContext
            run={run}
            cancellation={cancellation}
            cancellationUnavailable={observation.isError || (outage && observed === undefined)}
            definition={sectionDefinition}
            definitionLoading={!outage && versionQuery.isPending}
          />
          <WaitPanel run={run} definition={sectionDefinition} availability={gate} />
          <DeliveryPanel run={run} />
        </Fragment>
      ) : run !== undefined && !refused && outage ? (
        down ? (
          <OfflineState what="Run" />
        ) : (
          <p role="status" className="text-sm text-muted">
            This run has not been confirmed since the connection was lost. It is shown again once it
            is read.
          </p>
        )
      ) : (
        <QueryState query={runQuery} what="Run">
          {() => null}
        </QueryState>
      )}
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
            exitReturns={exitReturns}
          />
          {threadError &&
          !(threadError instanceof GraphGoblinApiError && threadError.status === 404) ? (
            <Alert>Thread read failed: {threadError.message}</Alert>
          ) : null}
          {selectedSeq !== undefined && (selectedThread.isFetching || shownSeq !== selectedSeq) ? (
            <p className="text-sm text-muted" aria-live="polite">
              Reading the thread at event {selectedSeq}…
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
              before={shownSeq === selectedSeq ? beforeThread.data : undefined}
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
