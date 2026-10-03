import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { isTerminal } from '@graphgoblin/domain';
import type { ContextThread, RunEvent } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../api/context.js';
import { keys, useRun, useRunThread } from '../api/queries.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, Badge, Button, Card } from '../components/ui.js';
import { JsonSchemaForm } from '../forms/JsonSchemaForm.js';
import { errorMessage, formatDateTime, prettyJson } from '../lib/utils.js';
import {
  describeEvent,
  initialThreadFrom,
  nodeActivity,
  patchDiff,
  threadAt,
} from './projections.js';
import { useRunEvents, type StreamStatus } from './useRunEvents.js';

function Controls({ run }: { run: RunSnapshot }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'pause' | 'resume') => runs[kind](client, run.id),
    onSuccess: refresh,
  });
  if (isTerminal(run.status)) return null;
  return (
    <div className="flex gap-2">
      {run.status === 'paused' ? (
        <Button
          variant="outline"
          onClick={() => action.mutate('resume')}
          disabled={action.isPending}
        >
          Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => action.mutate('pause')}
          disabled={action.isPending}
        >
          Pause
        </Button>
      )}
      <Button
        variant="destructive"
        onClick={() => action.mutate('cancel')}
        disabled={action.isPending}
      >
        Cancel run
      </Button>
      {action.isError ? (
        <span className="text-xs text-orange-800">{errorMessage(action.error)}</span>
      ) : null}
    </div>
  );
}

function WaitPanel({ run }: { run: RunSnapshot }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const waiting = run.waiting;
  const respond = useMutation({
    mutationFn: async (value: unknown) => {
      if (waiting?.kind === 'signal') {
        await runs.signal(client, run.id, waiting.signalName ?? '', value as never);
      } else {
        await runs.provideInput(client, run.id, (value ?? null) as never);
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.run(run.id) }),
  });
  if (run.status !== 'waiting' || !waiting) return null;
  if (waiting.kind !== 'input' && waiting.kind !== 'signal') {
    return (
      <Alert tone="info">
        Waiting for {waiting.kind}
        {waiting.until ? ` until ${formatDateTime(waiting.until)}` : ''} at{' '}
        <code>{waiting.nodeId}</code>.
      </Alert>
    );
  }
  return (
    <Card
      title={
        waiting.kind === 'input'
          ? 'Input requested'
          : `Waiting for signal "${waiting.signalName ?? ''}"`
      }
    >
      {waiting.prompt ? <p className="mb-2 text-sm whitespace-pre-wrap">{waiting.prompt}</p> : null}
      <JsonSchemaForm
        schema={waiting.kind === 'input' ? waiting.inputSchema : undefined}
        submitLabel={waiting.kind === 'input' ? 'Submit input' : 'Send signal'}
        busy={respond.isPending}
        onSubmit={(value) => respond.mutate(value)}
      />
      {respond.isError ? <Alert>{errorMessage(respond.error)}</Alert> : null}
    </Card>
  );
}

function ThreadViewer({
  current,
  events,
  seq,
}: {
  current: ContextThread;
  events: RunEvent[];
  seq: number;
}) {
  const initial = useMemo(() => initialThreadFrom(current), [current]);
  const thread = useMemo(() => threadAt(initial, events, seq), [initial, events, seq]);
  const selected = events.find((e) => e.seq === seq);
  const diff = useMemo(() => {
    if (selected?.type !== 'node.finished') return undefined;
    return patchDiff(threadAt(initial, events, seq - 1), thread, selected.patch);
  }, [selected, initial, events, seq, thread]);
  return (
    <div className="space-y-3">
      {diff ? (
        <Card title={`Patch from ${selected?.type === 'node.finished' ? selected.nodeId : ''}`}>
          {diff.length === 0 ? <p className="text-xs text-slate-500">No changes.</p> : null}
          <ul className="space-y-1 text-xs" aria-label="Patch diff">
            {diff.map((line, i) => (
              <li key={i} className="rounded bg-slate-50 p-1">
                <Badge>{line.op}</Badge> <code>{line.path}</code>
                {line.from ? (
                  <>
                    {' '}
                    from <code>{line.from}</code>
                  </>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <pre className="overflow-auto bg-orange-50 p-1 whitespace-pre-wrap">
                    − {prettyJson(line.before) || '(absent)'}
                  </pre>
                  <pre className="overflow-auto bg-sky-50 p-1 whitespace-pre-wrap">
                    + {prettyJson(line.after) || '(absent)'}
                  </pre>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={`Thread at event ${seq}`}>
        <h3 className="text-xs font-semibold text-slate-600">
          Messages ({thread.messages.length})
        </h3>
        <ol className="mb-2 space-y-1 text-sm" aria-label="Messages">
          {thread.messages.map((m) => (
            <li key={m.id} className="rounded border border-slate-100 p-1">
              <Badge>{m.role}</Badge> <span className="text-xs text-slate-500">{m.nodeId}</span>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </li>
          ))}
        </ol>
        <h3 className="text-xs font-semibold text-slate-600">Variables</h3>
        <pre className="mb-2 overflow-auto rounded bg-slate-50 p-1 text-xs" aria-label="Variables">
          {prettyJson(thread.vars)}
        </pre>
        <details>
          <summary className="cursor-pointer text-xs text-slate-600">Full thread JSON</summary>
          <pre className="overflow-auto text-xs" data-testid="thread-json">
            {prettyJson(thread)}
          </pre>
        </details>
      </Card>
    </div>
  );
}

function ProgressDrawer({ events }: { events: RunEvent[] }) {
  const activity = nodeActivity(events);
  return (
    <details className="rounded border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer text-sm font-semibold">
        Node progress ({activity.size} nodes)
      </summary>
      {[...activity.entries()].map(([nodeId, items]) => (
        <div key={nodeId} className="mt-2">
          <h3 className="font-mono text-xs">{nodeId}</h3>
          <ul className="text-xs">
            {items.map((e) => (
              <li key={e.seq}>
                <code>{e.type}</code>{' '}
                {prettyJson(
                  'progress' in e ? e.progress : 'usage' in e ? e.usage : describeEvent(e),
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

const STREAM_LABEL: Record<StreamStatus, string> = {
  connecting: 'connecting…',
  live: 'live',
  finished: 'complete',
  error: 'stream error',
};

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
    <div className="space-y-3 p-4">
      <QueryState query={runQuery} what="Run">
        {(run) => (
          <>
            <header className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-sm font-semibold">Run {run.id}</h1>
              <RunStatusBadge status={run.status} />
              <span className="text-xs text-slate-600">iteration {run.iteration}</span>
              {run.currentNodeId ? (
                <span className="text-xs text-slate-600">at {run.currentNodeId}</span>
              ) : null}
              <Link
                to={`/loops/${run.loopId}/edit`}
                className="text-xs text-sky-800 hover:underline"
              >
                loop
              </Link>
              {run.parentRunId ? (
                <Link
                  to={`/runs/${run.parentRunId}`}
                  className="text-xs text-sky-800 hover:underline"
                >
                  parent run
                </Link>
              ) : null}
              <Link to={`/runs?parent=${run.id}`} className="text-xs text-sky-800 hover:underline">
                child runs
              </Link>
              <div className="ml-auto">
                <Controls run={run} />
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
                <pre className="text-xs" data-testid="run-result">
                  {prettyJson(run.result)}
                </pre>
              </Card>
            ) : null}
            <WaitPanel run={run} />
          </>
        )}
      </QueryState>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card title={`Timeline (${log.events.length} events, ${STREAM_LABEL[log.status]})`}>
          {log.error ? <Alert>{log.error}</Alert> : null}
          <ol className="max-h-[60vh] overflow-auto text-xs" aria-label="Timeline">
            {log.events.map((event) => (
              <li key={event.seq}>
                <button
                  type="button"
                  aria-current={event.seq === seq ? 'true' : undefined}
                  className={`w-full rounded px-1 text-left hover:bg-slate-100 ${event.seq === seq ? 'bg-emerald-50' : ''}`}
                  onClick={() => setSelectedSeq(event.seq)}
                >
                  <span className="text-slate-400">#{event.seq}</span> <code>{event.type}</code>{' '}
                  {describeEvent(event)}
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-3">
          {threadQuery.data ? (
            <ThreadViewer current={threadQuery.data} events={log.events} seq={seq} />
          ) : (
            <p className="text-sm text-slate-500">The thread is not available yet.</p>
          )}
          <ProgressDrawer events={log.events} />
        </div>
      </div>
    </div>
  );
}
