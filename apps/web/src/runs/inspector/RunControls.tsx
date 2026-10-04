import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { isTerminal } from '@graphgoblin/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, HelpText } from '../../components/ui/index.js';
import { errorMessage } from '../../lib/utils.js';

/** Pause or resume, and cancel, while the run is not finished. */
export function RunControls({ run }: { run: RunSnapshot }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'pause' | 'resume') => runs[kind](client, run.id),
    onSuccess: refresh,
  });
  if (isTerminal(run.status)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {run.status === 'paused' ? (
        <Button
          variant="outline"
          onClick={() => action.mutate('resume')}
          disabled={action.isPending}
        >
          <Icon name="running" />
          Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => action.mutate('pause')}
          disabled={action.isPending}
        >
          <Icon name="paused" />
          Pause
        </Button>
      )}
      <Button
        variant="destructive"
        onClick={() => action.mutate('cancel')}
        disabled={action.isPending}
      >
        <Icon name="cancelled" />
        Cancel run
      </Button>
      {action.isError ? <HelpText tone="bad">{errorMessage(action.error)}</HelpText> : null}
    </div>
  );
}
