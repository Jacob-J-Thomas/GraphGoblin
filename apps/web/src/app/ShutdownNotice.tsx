import { GraphGoblinApiError, unwrap, type ResponseBody } from '@graphgoblin/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../api/context.js';
import { Button, Dialog } from '../components/ui/index.js';

type ShutdownState = ResponseBody<'/system/shutdown', 'get'>;
function checkedSnapshot(snapshot: ShutdownState): ShutdownState {
  if (typeof snapshot.controlToken !== 'string' || snapshot.controlToken === '')
    throw new Error('Gateway shutdown response is missing its control token.');
  return snapshot;
}

const KEY = ['gateway-shutdown'] as const;
const PHASE_TITLE: Record<ShutdownState['phase'], string> = {
  running: 'Gateway is running',
  draining: 'Gateway is draining',
  'awaiting-choice': 'Gateway is draining',
  forcing: 'Gateway is force stopping',
  'drain-failed': 'Gateway drain failed',
  'force-failed': 'Force stop failed',
  exiting: 'Gateway is exiting after failed cleanup',
  ready: 'Gateway is stopping',
  stopped: 'Gateway stopped',
};
const TERMINAL = new Set<ShutdownState['phase']>(['ready', 'stopped', 'exiting']);

/** Names are optional decoration: restricted/unavailable run reads must never hide the choice. */
function RunLink({ id }: { id: string }) {
  const client = useApi();
  const name = useQuery({
    queryKey: ['shutdown-run-name', id],
    queryFn: async ({ signal }) => {
      const run = unwrap(await client.GET('/runs/{id}', { params: { path: { id } }, signal }));
      return run.pinned.name;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <Link className="text-link underline wrap-anywhere" to={`/runs/${id}`}>
      {name.data ? `${name.data} — ${id}` : id}
    </Link>
  );
}

function Work({ ids }: { ids: string[] }) {
  return ids.length ? (
    <ul className="max-h-40 list-disc overflow-auto pl-5">
      {ids.map((id) => (
        <li key={id}>
          <RunLink id={id} />
        </li>
      ))}
    </ul>
  ) : (
    <p>No active run identities reported. Cleanup may still be finishing.</p>
  );
}

/** A phase/incarnation token change unmounts this confirmation and requires a new choice. */
function ShutdownChoices({
  state,
  choose,
}: {
  state: ShutdownState;
  choose: (choice: 'wait' | 'force', token: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const canForce = state.choices.includes('force');
  const canWait = state.choices.includes('wait');
  const failedForce = state.phase === 'force-failed';
  const ids = state.activeRunIds;
  const send = (choice: 'wait' | 'force') => {
    setConfirm(false);
    choose(choice, state.controlToken);
  };
  return (
    <>
      {canWait ? (
        <Button size="sm" onClick={() => send('wait')}>
          Keep waiting
        </Button>
      ) : null}
      {canForce ? (
        <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}>
          {failedForce ? 'Force exit' : 'Force stop'}
        </Button>
      ) : null}
      {confirm && canForce ? (
        <Dialog
          open
          onClose={() => setConfirm(false)}
          title={failedForce ? 'Force exit after failed cleanup?' : 'Force stop active work?'}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Go back
              </Button>
              <Button variant="destructive" onClick={() => send('force')}>
                {failedForce ? 'Confirm force exit' : 'Confirm force stop'}
              </Button>
            </>
          }
        >
          <p>
            {failedForce
              ? 'Exit without confirmed cleanup. The lock stays for next-start reclamation; native processes may still need inspection.'
              : 'Interrupt the active executors and queued family work listed below, including required children. Already saved waits and paused runs stay saved.'}
          </p>
          <Work ids={ids} />
          <p>
            External effects may be uncertain. Interrupted work does not automatically resume;
            inspect the run evidence before an explicit replay. Work may finish or a required child
            may start while you decide.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

/** Observation never sends a shutdown action, including on unmount, reload or navigation. */
export function ShutdownNotice() {
  const client = useApi();
  const cache = useQueryClient();
  const [message, setMessage] = useState('');
  const action = useMutation({
    retry: false,
    mutationFn: async ({ choice, token }: { choice: 'wait' | 'force'; token: string }) => {
      await cache.cancelQueries({ queryKey: KEY });
      const result = await client.POST('/system/shutdown', {
        body: { action: choice },
        params: { header: { 'x-graphgoblin-shutdown-token': token } },
      });
      if (result.response.status === 409 && result.error)
        return { state: checkedSnapshot(result.error), conflict: true };
      return { state: checkedSnapshot(unwrap(result)), conflict: false };
    },
    onSuccess: ({ state, conflict }) => {
      cache.setQueryData(KEY, state);
      setMessage(
        conflict
          ? 'Shutdown changed in another tab or control. Showing the current gateway state.'
          : '',
      );
    },
    onError: (error) => {
      setMessage(
        error instanceof GraphGoblinApiError && (error.status === 401 || error.status === 403)
          ? 'The shutdown action was refused. Actions require system:write permission.'
          : 'The action outcome is unknown. It will not be retried automatically. Check gateway state before trying again.',
      );
      void cache.invalidateQueries({ queryKey: KEY });
    },
  });
  const status = useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => {
      const snapshot = unwrap(await client.GET('/system/shutdown', { signal, cache: 'no-store' }));
      return checkedSnapshot(snapshot);
    },
    enabled: !action.isPending,
    retry: false,
    staleTime: 1000,
    // A running gateway is checked every ten seconds, a shutting-down one every two, so
    // ready/exiting still observe HTTP closure. After a failure this query does not poll: an
    // explicit check reads it again, and the app's reachability probe (startReachability)
    // refetches it once the API answers after a transport failure. No action is ever retried.
    refetchInterval: (query) =>
      query.state.error || query.state.data?.phase === 'stopped'
        ? false
        : query.state.data?.phase === 'running'
          ? 10_000
          : 2000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const state = status.data;
  const networkFailure = status.error instanceof GraphGoblinApiError && status.error.status === 0;
  // A key without system:read cannot observe shutdown; that is not a shutdown to report.
  const forbidden =
    status.error instanceof GraphGoblinApiError &&
    (status.error.status === 401 || status.error.status === 403);
  if ((!state || state.phase === 'running') && (!status.error || forbidden) && !message)
    return null;
  const closing = state !== undefined && networkFailure;
  const terminal = state !== undefined && TERMINAL.has(state.phase);
  const available = !status.error && !terminal && !action.isPending;
  const failedForce = state?.phase === 'force-failed';
  const ids = state?.activeRunIds ?? [];
  const unconfirmed = state?.unconfirmedRunIds ?? [];
  const title = closing
    ? 'Gateway stopped or disconnected'
    : status.error
      ? 'Cannot read gateway shutdown state'
      : state
        ? PHASE_TITLE[state.phase]
        : 'Gateway shutdown state unavailable';
  const send = (choice: 'wait' | 'force', token: string) => {
    setMessage('');
    action.mutate({ choice, token });
  };
  return (
    <section
      aria-label="Gateway shutdown"
      className="grid gap-2 border-b border-status-warn-border bg-status-warn-bg px-6 py-3 text-sm wrap-anywhere"
    >
      <h2 aria-live="polite" className="font-semibold text-status-warn-fg">
        {title}
      </h2>
      {closing || terminal ? (
        <p>
          {closing
            ? 'The shutdown connection closed; the gateway may have stopped. Check its process if the disconnect was unexpected.'
            : 'HTTP is closing. This page keeps the last observed state.'}{' '}
          No shutdown action will be retried automatically.
        </p>
      ) : state && state.phase !== 'running' ? (
        <>
          <p>
            Independent starts are refused. Active work is finishing; queued independent work
            remains recoverable after restart. Durable waits and paused runs remain saved.
          </p>
          {state.phase === 'awaiting-choice' ? (
            <p>
              The gateway grace period elapsed. Keep waiting without a hidden kill timer, or
              deliberately interrupt the active work.
            </p>
          ) : state.phase === 'forcing' ? (
            <p>
              Interrupting active work and checking cleanup before releasing the store. External
              effects may be uncertain.
            </p>
          ) : null}
          {state.phase === 'draining' ? (
            <p>
              Waiting never starts a browser countdown. Any further choice comes from the gateway.
            </p>
          ) : null}
          {state.error ? <p>{state.error}</p> : null}
          {failedForce ? (
            <p>
              A further force exits with failure without confirmed cleanup. The store lock stays for
              reclamation on the next start. Inspect logs and native processes first.
            </p>
          ) : null}
          {state.phase === 'drain-failed' ? (
            <p>
              The listener, store and lock remain held. Inspect gateway logs; no further choice is
              available.
            </p>
          ) : null}
          <Work ids={ids} />
          {unconfirmed.length ? (
            <div>
              <p>Unconfirmed termination evidence (may be from an earlier stop):</p>
              <Work ids={unconfirmed} />
            </div>
          ) : null}
        </>
      ) : null}
      {status.error && !closing ? (
        <p>Shutdown status is unavailable. Check the connection and system:read permission.</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {state && available ? (
          <ShutdownChoices key={state.controlToken} state={state} choose={send} />
        ) : null}
        {status.error ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMessage('');
              void status.refetch();
            }}
          >
            Check gateway state
          </Button>
        ) : null}
      </div>
    </section>
  );
}
