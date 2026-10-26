import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, Dialog, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';
import { ReplayConsequences } from './ReplayConsequences.js';

/** Consent is an action: opening or cancelling this dialog never resumes a script. */
export function ScriptRecovery({ run }: { run: RunSnapshot }) {
  const [open, setOpen] = useState(false);
  const [observedSeq, setObservedSeq] = useState(run.recovery.observedSeq);
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nodeId = run.failure?.nodeId ?? run.currentNodeId;
  const action = useMutation({
    mutationFn: (kind: 'resume' | 'replay') =>
      kind === 'resume'
        ? runs.resume(client, run.id, { observedSeq, retryUncertainScript: true })
        : runs.replay(client, run.id, nodeId!, { observedSeq, retryUncertainScript: true }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
    },
    onSuccess: (next, kind) => {
      setOpen(false);
      if (kind === 'replay') void navigate(`/runs/${next.id}`);
      else {
        void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
      }
    },
  });
  if (!run.recovery.scriptConsent || !nodeId) return null;
  const replayAction = run.recovery.replay.find((node) => node.nodeId === nodeId)?.action;
  const uncertain =
    run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' ||
    run.failure?.script?.state === 'outcome-uncertain';
  const canResume =
    run.recovery.resume.allowed || run.recovery.resume.code === 'SCRIPT_CONSENT_REQUIRED';
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          action.reset();
          setObservedSeq(run.recovery.observedSeq);
          setOpen(true);
        }}
      >
        Recover script
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!action.isPending) setOpen(false);
        }}
        title="Recover script"
        footer={
          <>
            <Button
              onClick={() => action.mutate('resume')}
              disabled={action.isPending || !canResume}
            >
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => action.mutate('replay')}
              disabled={
                action.isPending ||
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
            <Button variant="outline" onClick={() => setOpen(false)} disabled={action.isPending}>
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
