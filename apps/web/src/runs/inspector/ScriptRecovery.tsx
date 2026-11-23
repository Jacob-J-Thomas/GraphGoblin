import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, Dialog, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import { assertOpen, type WriteGate } from './RunControls.js';

/** The consent under review: the run, node and observed sequence shown when it was opened. */
export interface ScriptReview {
  gate: WriteGate;
  runId: string;
  nodeId: string;
  observedSeq: number;
}

/** A retry as chosen: the visit that chose it and the review it was chosen in, frozen. */
interface Retry {
  owner: object;
  kind: 'resume' | 'replay';
  review: ScriptReview;
}

/** The inspector view's script retry for the run it shows (#416). */
export interface ScriptRetry {
  /** The view's write gate now: a review opens under it, and a retry is sent only under it. */
  readonly availability: WriteGate;
  /** A retry this visit chose is queued or in flight; no review opens and none other is sent. */
  readonly pending: boolean;
  /** Why this visit's latest retry failed, until a new review replaces that report. */
  readonly failure: string | undefined;
  /** The review whose retry succeeded: that review is finished. */
  readonly completed: ScriptReview | undefined;
  /** Send `kind` with the consent of `review`, which must be open under the current gate. */
  readonly send: (kind: 'resume' | 'replay', review: ScriptReview) => void;
  /** Clear this visit's settled report as a new review opens; a pending retry keeps it. */
  readonly reset: () => void;
}

/**
 * The inspector's script retry (#416), owned by the view rather than by the run section that
 * presents it. The section is withheld while an unproved row cannot be presented; a retry sent or
 * queued before that stays the only one, and the controls shown again stay disabled until it
 * settles and then report its actual outcome. A retry belongs to the visit (`owner`) that chose
 * it: another run, or a later visit, shows neither its pending state nor its outcome.
 */
export function useScriptRetry({
  owner,
  availability,
}: {
  owner: object;
  availability: WriteGate;
}): ScriptRetry {
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const action = useMutation({
    mutationFn: async ({ kind, review }: Retry) => {
      assertOpen(review.gate);
      const command = { observedSeq: review.observedSeq, retryUncertainScript: true as const };
      return kind === 'resume'
        ? runs.resume(client, review.runId, command)
        : runs.replay(client, review.runId, review.nodeId, command);
    },
    onError: (_error, { review }) => {
      void queryClient.invalidateQueries({ queryKey: keys.run(review.runId) });
    },
    onSuccess: (next, { kind, review }) => {
      if (kind === 'replay') {
        if (review.gate.shown()) void navigate(`/runs/${next.id}`);
      } else {
        void queryClient.invalidateQueries({ queryKey: keys.run(review.runId) });
      }
    },
  });
  // The latest retry this view sent, only while the visit that chose it is shown.
  const own = action.variables?.owner === owner ? action.variables : undefined;
  const pending = own !== undefined && action.isPending;
  return {
    availability,
    pending,
    failure: own && action.isError ? errorMessage(action.error) : undefined,
    completed: own && action.isSuccess ? own.review : undefined,
    send: (kind, review) => {
      if (pending || review.gate !== availability || !availability.open()) return;
      action.mutate({ owner, kind, review });
    },
    reset: () => {
      // Resetting would detach the view from a retry still unresolved, and hide its outcome.
      if (!pending) action.reset();
    },
  };
}

/** Consent is an action: opening or cancelling this dialog never resumes a script. */
export function ScriptRecovery({
  run,
  retry,
}: {
  run: RunSnapshot;
  /** The view's retry, from `useScriptRetry` for the visit showing this run. */
  retry: ScriptRetry;
}) {
  const { availability } = retry;
  // A review belongs to the gate it was opened under: an outage or a reconnect expires it (#416).
  // It is presentation: it ends with the section that shows it, and once its retry succeeds.
  const [review, setReview] = useState<ScriptReview>();
  const open = review !== undefined && review.gate === availability && review !== retry.completed;
  const nodeId = run.failure?.nodeId ?? run.currentNodeId;
  if (!run.recovery.scriptConsent || !nodeId) return null;
  const unavailable = availability.blocked !== undefined;
  const replayAction = run.recovery.replay.find((node) => node.nodeId === nodeId)?.action;
  const uncertain =
    run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' ||
    run.failure?.script?.state === 'outcome-uncertain';
  const canResume =
    run.recovery.resume.allowed || run.recovery.resume.code === 'SCRIPT_CONSENT_REQUIRED';
  const send = (kind: 'resume' | 'replay') => {
    if (review) retry.send(kind, review);
  };
  return (
    <>
      {/* A retry already queued or sent stays the only one until it settles, even after an outage
          expired its review or the section showing it was withheld: reopening would reset it and
          hide its outcome (#416). */}
      <Button
        variant="outline"
        disabled={unavailable || retry.pending}
        onClick={() => {
          if (retry.pending || !availability.open()) return;
          retry.reset();
          setReview({
            gate: availability,
            runId: run.id,
            nodeId,
            observedSeq: run.recovery.observedSeq,
          });
        }}
      >
        Recover script
      </Button>
      {/* A write already sent keeps its outcome after an outage expires the review. */}
      {retry.failure !== undefined && !open ? (
        <HelpText tone="bad" role="alert">
          {retry.failure}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        onClose={() => {
          if (!retry.pending) setReview(undefined);
        }}
        title="Recover script"
        footer={
          <>
            <Button
              onClick={() => send('resume')}
              disabled={retry.pending || unavailable || !canResume}
            >
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => send('replay')}
              disabled={
                retry.pending ||
                unavailable ||
                !run.recovery.replay.some(
                  (node) =>
                    node.nodeId === nodeId &&
                    !node.action.allowed &&
                    node.action.code === 'SCRIPT_CONSENT_REQUIRED',
                )
              }
            >
              Replay
            </Button>
            <Button variant="outline" onClick={() => setReview(undefined)} disabled={retry.pending}>
              Cancel
            </Button>
          </>
        }
      >
        <p>
          {uncertain
            ? 'The previous script attempt may already have produced its effect. Resume runs the script again and may repeat that effect.'
            : 'Resume tries this script again in the same run.'}
        </p>
        {!canResume && !run.recovery.resume.allowed ? (
          <p>Resume unavailable: {run.recovery.resume.message}</p>
        ) : null}
        <ReplayConsequences
          effects={run.recovery.replay.find((node) => node.nodeId === nodeId)?.effects ?? []}
        />
        <p>
          Replay starts a new run from this node and runs the script again. Cancel leaves this run
          failed without running anything.
        </p>
        {replayAction &&
        !replayAction.allowed &&
        replayAction.code !== 'SCRIPT_CONSENT_REQUIRED' ? (
          <p>Replay unavailable: {replayAction.message}</p>
        ) : null}
        {retry.failure !== undefined ? <HelpText tone="bad">{retry.failure}</HelpText> : null}
      </Dialog>
    </>
  );
}
