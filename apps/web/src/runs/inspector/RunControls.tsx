import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { isTerminal } from '@graphgoblin/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, Checkbox, Dialog, HelpText, Select } from '../../components/ui/index.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * Whether the inspector may send a write for the run it shows (#416). The inspector issues a new
 * gate whenever the visit, the run or the outage boundary changes, so a gate captured earlier (by
 * an open review, a queued mutation or a pending preview) stays spent after a reconnect or an
 * A→B→A visit. Outside the inspector, `OPEN_GATE` keeps ordinary behaviour.
 */
export interface WriteGate {
  /** Why this view cannot send writes now; undefined while it can. */
  readonly blocked: string | undefined;
  /** This gate is still the view's current one and its live connectivity and read checks pass. */
  readonly open: () => boolean;
  /** The visit that issued this gate is still shown (an outage alone does not end it). */
  readonly shown: () => boolean;
}

export const OPEN_GATE: WriteGate = { blocked: undefined, open: () => true, shown: () => true };

export const NOT_SENT =
  'Not sent: this view lost its connection to the run. Read the run again before retrying.';

/** Checked immediately before each API write, after any queued or delayed mutation step. */
export function assertOpen(gate: WriteGate): void {
  if (!gate.open()) throw new Error(NOT_SENT);
}

/** Everything a command sends, frozen when it is chosen: a refetch can replace these options. */
type Command =
  | { kind: 'cancel' | 'pause'; runId: string; gate: WriteGate }
  | { kind: 'resume'; runId: string; gate: WriteGate; observedSeq: number }
  | {
      kind: 'replay';
      runId: string;
      gate: WriteGate;
      nodeId: string;
      observedSeq: number;
      consent: boolean;
    };

/** Recovery decisions and their explanations always come from the server. */
export function RunControls({
  run,
  availability = OPEN_GATE,
}: {
  run: RunSnapshot;
  availability?: WriteGate;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The gate a replay review was opened under. A new gate (an outage, a reconnect) expires it.
  const [review, setReview] = useState<WriteGate>();
  const open = review !== undefined && review === availability;
  const [nodeId, setNodeId] = useState('');
  const [consent, setConsent] = useState(false);
  const [replaySeq, setReplaySeq] = useState(run.recovery.observedSeq);
  const refresh = (runId: string) =>
    void queryClient.invalidateQueries({ queryKey: keys.run(runId) });
  const action = useMutation({
    mutationFn: async (command: Command) => {
      assertOpen(command.gate);
      switch (command.kind) {
        case 'replay':
          return runs.replay(client, command.runId, command.nodeId, {
            observedSeq: command.observedSeq,
            ...(command.consent ? { retryUncertainScript: true } : {}),
          });
        case 'resume':
          return runs.resume(client, command.runId, { observedSeq: command.observedSeq });
        default:
          return runs[command.kind](client, command.runId);
      }
    },
    onSuccess: (next, command) => {
      refresh(command.runId);
      if (command.kind === 'replay') {
        setReview(undefined);
        // A sent replay opens its new run only while the visit that asked for it is shown.
        if (command.gate.shown()) void navigate(`/runs/${next.id}`);
      }
    },
    onError: (_error, command) => refresh(command.runId),
  });
  const { resume, replay } = run.recovery;
  const unavailable = availability.blocked !== undefined;
  const selected = replay.find((node) => node.nodeId === nodeId);
  const needsConsent =
    selected && !selected.action.allowed && selected.action.code === 'SCRIPT_CONSENT_REQUIRED';
  // A second pointer click stays in the same intent even if a fast retry already failed again.
  // Use the browser's click count instead of introducing a debounce window; keyboard clicks are 0.
  // Nothing is queued once the gate the command captured is spent.
  const send = (command: Command, clickCount = 0) => {
    if (clickCount > 1 || !command.gate.open()) return;
    action.mutate(command);
  };
  return (
    <div className="grid min-w-0 max-w-xl gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isTerminal(run.status) && run.status !== 'paused' ? (
          <Button
            variant="outline"
            onClick={() => send({ kind: 'pause', runId: run.id, gate: availability })}
            disabled={action.isPending || unavailable}
          >
            <Icon name="paused" /> Pause
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={(event) =>
            send(
              {
                kind: 'resume',
                runId: run.id,
                gate: availability,
                observedSeq: run.recovery.observedSeq,
              },
              event.detail,
            )
          }
          disabled={action.isPending || !resume.allowed || unavailable}
          aria-describedby={`resume-reason-${run.id}`}
        >
          <Icon name="running" /> Resume
        </Button>
        {!isTerminal(run.status) ? (
          <Button
            variant="destructive"
            onClick={() => send({ kind: 'cancel', runId: run.id, gate: availability })}
            disabled={action.isPending || unavailable}
          >
            <Icon name="cancelled" /> Cancel run
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => {
            if (!availability.open()) return;
            action.reset();
            setReplaySeq(run.recovery.observedSeq);
            setConsent(false);
            setNodeId(
              replay.find((node) => node.action.allowed)?.nodeId ?? replay[0]?.nodeId ?? '',
            );
            setReview(availability);
          }}
          disabled={action.isPending || unavailable}
        >
          Replay...
        </Button>
      </div>
      <p id={`resume-reason-${run.id}`} className="text-sm text-muted">
        {resume.allowed
          ? `Resume continues run ${run.id}.`
          : `Resume unavailable: ${resume.message}`}
        {!resume.allowed && resume.parentRunId ? (
          <>
            {' '}
            <Link to={`/runs/${resume.parentRunId}`} className="text-link underline">
              Open parent {resume.parentRunId}
            </Link>
          </>
        ) : null}
      </p>
      {action.isError && !open ? (
        <HelpText tone="bad" role="alert">
          {errorMessage(action.error)}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        title="Replay as a new run"
        onClose={() => {
          if (!action.isPending) setReview(undefined);
        }}
        footer={
          <>
            <Button
              disabled={
                action.isPending ||
                unavailable ||
                !(selected?.action.allowed || (needsConsent && consent))
              }
              onClick={(event) => {
                if (!review) return;
                send(
                  {
                    kind: 'replay',
                    runId: run.id,
                    gate: review,
                    nodeId,
                    observedSeq: replaySeq,
                    consent,
                  },
                  event.detail,
                );
              }}
            >
              Create replay run
            </Button>
            <Button
              variant="outline"
              disabled={action.isPending}
              onClick={() => setReview(undefined)}
            >
              Cancel
            </Button>
          </>
        }
      >
        <p>Source run {run.id}. The fork starts from recorded state before the selected node.</p>
        <ReplayConsequences effects={selected?.effects ?? []} />
        <label htmlFor={`replay-node-${run.id}`}>Replay from node</label>
        <Select
          id={`replay-node-${run.id}`}
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
            setConsent(false);
          }}
          aria-describedby={`replay-reason-${run.id}`}
        >
          {replay.map((node) => (
            <option key={node.nodeId} value={node.nodeId}>
              {node.label} ({node.nodeId})
            </option>
          ))}
        </Select>
        <p id={`replay-reason-${run.id}`} aria-live="polite">
          {selected
            ? selected.action.allowed
              ? 'Replay is available at this node.'
              : selected.action.message
            : run.recovery.replayDefault.allowed
              ? 'No replay node selected.'
              : run.recovery.replayDefault.message}
        </p>
        {needsConsent ? (
          <label>
            <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)} />I
            explicitly allow the current uncertain script to run again; its effect may already have
            happened.
          </label>
        ) : null}
        {selected && !selected.action.allowed && selected.action.replayRunId ? (
          <Link to={`/runs/${selected.action.replayRunId}`}>
            Open existing replay {selected.action.replayRunId}
          </Link>
        ) : null}
        {action.isError && open ? (
          <HelpText tone="bad" role="alert">
            {errorMessage(action.error)}
          </HelpText>
        ) : null}
      </Dialog>
    </div>
  );
}
