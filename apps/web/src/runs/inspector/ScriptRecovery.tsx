import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, Dialog, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';

/** Consent is an action: opening or cancelling this dialog never resumes a script. */
export function ScriptRecovery({ run }: { run: RunSnapshot }) {
  const [open, setOpen] = useState(false);
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nodeId = run.failure?.nodeId ?? run.currentNodeId;
  const action = useMutation({
    mutationFn: (kind: 'resume' | 'replay') =>
      kind === 'resume' ? runs.resume(client, run.id) : runs.replay(client, run.id, nodeId!),
    onSuccess: (next, kind) => {
      setOpen(false);
      if (kind === 'replay') void navigate(`/runs/${next.id}`);
      else {
        queryClient.setQueryData(keys.run(run.id), next);
        void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
      }
    },
  });
  const scriptFailure =
    run.failure?.script !== undefined ||
    run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' ||
    run.failure?.code === 'SCRIPT_START_FAILED';
  if (run.status !== 'failed' || !run.failure?.resumable || !scriptFailure || !nodeId) return null;
  const uncertain = run.failure.code === 'SCRIPT_OUTCOME_UNCERTAIN';
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          action.reset();
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
            <Button onClick={() => action.mutate('resume')} disabled={action.isPending}>
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => action.mutate('replay')}
              disabled={action.isPending}
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
        <p>
          Replay starts a new run from this node and runs the script again. Cancel leaves this run
          failed without running anything.
        </p>
        {action.isError ? <HelpText tone="bad">{errorMessage(action.error)}</HelpText> : null}
      </Dialog>
    </>
  );
}
