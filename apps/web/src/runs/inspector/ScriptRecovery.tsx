import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, Dialog, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import { assertOpen, OPEN_GATE, type WriteGate } from './RunControls.js';

/** The consent under review: the run, node and observed sequence shown when it was opened. */
interface ScriptReview {
  gate: WriteGate;
  runId: string;
  nodeId: string;
  observedSeq: number;
}

/** Consent is an action: opening or cancelling this dialog never resumes a script. */
export function ScriptRecovery({
  run,
  availability = OPEN_GATE,
}: {
  run: RunSnapshot;
  availability?: WriteGate;
}) {
  // A review belongs to the gate it was opened under: an outage or a reconnect expires it (#416).
  const [review, setReview] = useState<ScriptReview>();
  const open = review !== undefined && review.gate === availability;
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nodeId = run.failure?.nodeId ?? run.currentNodeId;
  const action = useMutation({
    mutationFn: async ({ kind, review }: { kind: 'resume' | 'replay'; review: ScriptReview }) => {
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
      setReview(undefined);
      if (kind === 'replay') {
        if (review.gate.shown()) void navigate(`/runs/${next.id}`);
      } else {
        void queryClient.invalidateQueries({ queryKey: keys.run(review.runId) });
      }
    },
  });
  if (!run.recovery.scriptConsent || !nodeId) return null;
  const unavailable = availability.blocked !== undefined;
  const replayAction = run.recovery.replay.find((node) => node.nodeId === nodeId)?.action;
  const uncertain =
    run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' ||
    run.failure?.script?.state === 'outcome-uncertain';
  const canResume =
    run.recovery.resume.allowed || run.recovery.resume.code === 'SCRIPT_CONSENT_REQUIRED';
  const send = (kind: 'resume' | 'replay') => {
    if (!review || review.gate !== availability || !availability.open()) return;
    action.mutate({ kind, review });
  };
  return (
    <>
      <Button
        variant="outline"
        disabled={unavailable}
        onClick={() => {
          if (!availability.open()) return;
          action.reset();
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
      {action.isError && !open ? (
        <HelpText tone="bad" role="alert">
          {errorMessage(action.error)}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        onClose={() => {
          if (!action.isPending) setReview(undefined);
        }}
        title="Recover script"
        footer={
          <>
            <Button
              onClick={() => send('resume')}
              disabled={action.isPending || unavailable || !canResume}
            >
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => send('replay')}
              disabled={
                action.isPending ||
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
              onClick={() => setReview(undefined)}
              disabled={action.isPending}
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
        {action.isError ? <HelpText tone="bad">{errorMessage(action.error)}</HelpText> : null}
      </Dialog>
    </>
  );
}
