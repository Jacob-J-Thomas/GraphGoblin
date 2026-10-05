import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keys, useRun, useRunThread } from '../api/queries.js';
import { Page } from '../components/layout/index.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, Card } from '../components/ui/index.js';
import { prettyJson } from '../lib/utils.js';
import { ProgressDrawer } from './inspector/ProgressDrawer.js';
import { RunControls } from './inspector/RunControls.js';
import { ThreadViewer } from './inspector/ThreadViewer.js';
import { Timeline } from './inspector/Timeline.js';
import { WaitPanel } from './inspector/WaitPanel.js';
import { useRunEvents } from './useRunEvents.js';

const META_LINK = 'font-medium text-link underline-offset-[3px] hover:underline';

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
                <span>iteration {run.iteration}</span>
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
              </Alert>
            ) : null}
            {run.result !== undefined ? (
              <Card title="Result">
                <pre
                  className="overflow-auto rounded-md border border-default bg-code-bg px-3 py-2 text-[12.5px] text-code-fg"
                  data-testid="run-result"
                >
                  {prettyJson(run.result)}
                </pre>
              </Card>
            ) : null}
            <WaitPanel run={run} />
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
          {threadQuery.data ? (
            <ThreadViewer current={threadQuery.data} events={log.events} seq={seq} />
          ) : (
            <p className="text-sm text-muted">The thread is not available yet.</p>
          )}
          <ProgressDrawer events={log.events} />
        </div>
      </div>
    </Page>
  );
}
