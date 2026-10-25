import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { runs } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, HelpText } from '../../components/ui/index.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';

/** Recovery is deliberately separate from plain Resume and never changes the pinned definition. */
export function SessionRecoveryControls({
  run,
  events,
}: {
  run: RunRecord;
  events: readonly RunEvent[];
}) {
  const client = useApi();
  const queries = useQueryClient();
  const failed = events.findLast((event) => event.type === 'run.failed');
  const missing = run.failure?.missingSession;
  const nodeId = run.failure?.nodeId;
  const action = useMutation({
    mutationFn: () =>
      runs.recoverSession(client, run.id, { nodeId: nodeId!, failureSeq: failed!.seq }),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: keys.run(run.id) });
      void queries.invalidateQueries({ queryKey: keys.thread(run.id) });
    },
  });
  const eligible =
    run.status === 'failed' &&
    run.failure?.code === 'HARNESS_SESSION_MISSING' &&
    missing &&
    nodeId === run.currentNodeId &&
    missing.visitId.startsWith(run.id + ':');
  const choices = events.filter((event) => event.type === 'run.resumed' && event.freshSession);
  if (!eligible && choices.length === 0) return null;
  // Node IDs may be 64 characters: wrap them rather than widening the inspector at 390 px.
  return (
    <div className="grid min-w-0 gap-2 wrap-anywhere">
      {eligible ? (
        <>
          <p>
            Start a fresh session for node {nodeId}. Its prior provider conversation will not be
            carried over. The configured context mode, selected loop inputs, model {missing.model}{' '}
            and effort {missing.effort} stay the same. Earlier provider actions are not undone.
            Leave this choice untouched to keep the run failed.
          </p>
          <Button
            variant="outline"
            disabled={!failed || action.isPending}
            onClick={() => action.mutate()}
          >
            Start fresh session for {nodeId}
          </Button>
          {action.isError ? <HelpText tone="bad">{errorMessage(action.error)}</HelpText> : null}
        </>
      ) : null}
      {choices.map((event) =>
        event.type === 'run.resumed' && event.freshSession ? (
          <p key={event.seq} className="text-sm text-muted">
            {formatDateTime(event.ts)}: {event.actor.kind} {event.actor.id} chose a fresh session
            for {event.freshSession.nodeId}; prior provider context was not carried over (
            {event.freshSession.origin}, {event.freshSession.sessionId ?? 'no recorded handle'}).
          </p>
        ) : null,
      )}
    </div>
  );
}
