import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { CredentialChangedError } from '../../api/credential-dispatch.js';
import { keys } from '../../api/queries.js';
import { Button, Dialog, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import {
  crossed,
  expiredReviewFocus,
  notSentByKey,
  requestedBeforeKey,
  reviewClosedByKey,
  sameCredential,
  sendWrite,
  useClosedByKey,
  WRAPPING_LABEL,
  type WriteGate,
} from './RunControls.js';

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
  /**
   * This visit's latest retry was sent under an earlier accepted credential and settled under a
   * later one (#562): only that it was requested is reported, never its outcome.
   */
  readonly notice: string | undefined;
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
  // The retry that settled under a later accepted credential than it was sent under (#562).
  const [requested, setRequested] = useState<Retry>();
  const action = useMutation({
    mutationFn: ({ kind, review }: Retry) =>
      sendWrite(client, review.gate, (client) => {
        const command = { observedSeq: review.observedSeq, retryUncertainScript: true as const };
        return kind === 'resume'
          ? runs.resume(client, review.runId, command)
          : runs.replay(client, review.runId, review.nodeId, command);
      }),
    onError: (error, retry) => {
      void queryClient.invalidateQueries({ queryKey: keys.run(retry.review.runId) });
      if (!(error instanceof CredentialChangedError) && crossed(retry.review.gate))
        setRequested(retry);
    },
    onSuccess: (next, retry) => {
      const { kind, review } = retry;
      if (crossed(review.gate)) {
        // Neither its new run nor a navigation to it is shown under the current credential.
        setRequested(retry);
        void queryClient.invalidateQueries({ queryKey: keys.run(review.runId) });
      } else if (kind === 'replay') {
        if (review.gate.shown()) void navigate(`/runs/${next.id}`);
      } else {
        void queryClient.invalidateQueries({ queryKey: keys.run(review.runId) });
      }
    },
  });
  // The latest retry this view sent, only while the visit that chose it is shown.
  const own = action.variables?.owner === owner ? action.variables : undefined;
  const pending = own !== undefined && action.isPending;
  const name = own?.kind === 'replay' ? 'Replay' : 'Resume';
  // Its outcome is shown only under the accepted credential it was chosen under.
  const failure =
    own && action.isError
      ? action.error instanceof CredentialChangedError
        ? notSentByKey(name)
        : requested !== own && sameCredential(own.review.gate, availability)
          ? errorMessage(action.error)
          : undefined
      : undefined;
  return {
    availability,
    pending,
    failure,
    notice: own && requested === own && !pending ? requestedBeforeKey(name) : undefined,
    completed: own && action.isSuccess ? own.review : undefined,
    send: (kind, review) => {
      if (pending || review.gate !== availability || !availability.open()) return;
      action.mutate({ owner, kind, review });
    },
    reset: () => {
      // Resetting would detach the view from a retry still unresolved, and hide its outcome.
      if (pending) return;
      action.reset();
      setRequested(undefined);
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
  // A review belongs to the gate it was opened under: an outage, a reconnect (#416) or another
  // accepted API key (#562) expires it. It is presentation: it ends with the section that shows
  // it, and once its retry succeeds.
  const [review, setReview] = useState<ScriptReview>();
  const open = review !== undefined && review.gate === availability && review !== retry.completed;
  const expiry = useClosedByKey(availability, open ? review.gate : undefined, retry.pending);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const nodeId = run.failure?.nodeId ?? run.currentNodeId;
  // A retry that settled under a later API key is reported even once no consent is asked for.
  if (!run.recovery.scriptConsent || !nodeId)
    return retry.notice !== undefined ? (
      <p role="status" className="text-sm">
        {retry.notice}
      </p>
    ) : null;
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
        ref={triggerRef}
        variant="outline"
        className={WRAPPING_LABEL.md}
        disabled={unavailable || retry.pending}
        onClick={() => {
          if (retry.pending || !availability.open()) return;
          retry.reset();
          expiry.clear();
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
      {/* Always present, so a polite announcement is heard; it takes no space while empty. */}
      <p ref={statusRef} role="status" tabIndex={-1} className="text-sm empty:absolute">
        {retry.notice ?? (expiry.closed ? reviewClosedByKey('Recover script') : undefined)}
      </p>
      {/* A write already sent keeps its outcome after an outage expires the review. */}
      {retry.failure !== undefined && !open ? (
        <HelpText tone="bad" role="alert">
          {retry.failure}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        returnFocus={() =>
          expiredReviewFocus(expiry.expired, triggerRef.current, statusRef.current)
        }
        onClose={() => {
          if (!retry.pending) setReview(undefined);
        }}
        title="Recover script"
        footer={
          <>
            <Button
              className={WRAPPING_LABEL.md}
              onClick={() => send('resume')}
              disabled={retry.pending || unavailable || !canResume}
            >
              Resume
            </Button>
            <Button
              variant="outline"
              className={WRAPPING_LABEL.md}
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
            <Button
              variant="outline"
              className={WRAPPING_LABEL.md}
              onClick={() => setReview(undefined)}
              disabled={retry.pending}
            >
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
