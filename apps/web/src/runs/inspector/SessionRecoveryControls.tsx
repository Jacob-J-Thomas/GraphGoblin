import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { runs } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef } from 'react';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Button, HelpText } from '../../components/ui/index.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';
import { assertOpen, OPEN_GATE, type WriteGate } from './RunControls.js';

type Failed = Extract<RunEvent, { type: 'run.failed' }>;

/** The failure a choice answers, frozen when it is chosen. */
interface Choice {
  gate: WriteGate;
  runId: string;
  nodeId: string;
  visitId: string;
  failureSeq: number;
}

const CHANGED = 'Not sent: the failure shown has changed. Review the run again.';

/** Recovery is deliberately separate from plain Resume and never changes the pinned definition. */
export function SessionRecoveryControls({
  run,
  events,
  availability = OPEN_GATE,
}: {
  run: RunRecord;
  events: readonly RunEvent[];
  /** In the inspector, also requires a fresh matching observation after an outage (#416). */
  availability?: WriteGate;
}) {
  const client = useApi();
  const queries = useQueryClient();
  const missing = run.failure?.missingSession;
  const nodeId = run.failure?.nodeId;
  // The recorded failure of this run's current node and missing-session visit. Its own sequence
  // is sent, even when later audit events follow it; a failure of another visit does not count.
  const failed = events.findLast(
    (event): event is Failed =>
      event.type === 'run.failed' &&
      event.runId === run.id &&
      event.failure.code === 'HARNESS_SESSION_MISSING' &&
      event.failure.nodeId === nodeId &&
      event.failure.missingSession?.visitId === missing?.visitId,
  );
  // The identity shown now, compared with a queued choice right before it is sent.
  const shown = useRef({ runId: run.id, nodeId, visitId: missing?.visitId, seq: failed?.seq });
  useLayoutEffect(() => {
    shown.current = { runId: run.id, nodeId, visitId: missing?.visitId, seq: failed?.seq };
  });
  const action = useMutation({
    mutationFn: async (choice: Choice) => {
      assertOpen(choice.gate);
      const now = shown.current;
      if (
        now.runId !== choice.runId ||
        now.nodeId !== choice.nodeId ||
        now.visitId !== choice.visitId ||
        now.seq !== choice.failureSeq
      )
        throw new Error(CHANGED);
      return runs.recoverSession(client, choice.runId, {
        nodeId: choice.nodeId,
        failureSeq: choice.failureSeq,
      });
    },
    onSuccess: (_result, { runId }) => {
      void queries.invalidateQueries({ queryKey: keys.run(runId) });
      void queries.invalidateQueries({ queryKey: keys.thread(runId) });
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
  const choose = () => {
    if (!failed || !nodeId || !missing || !availability.open()) return;
    action.mutate({
      gate: availability,
      runId: run.id,
      nodeId,
      visitId: missing.visitId,
      failureSeq: failed.seq,
    });
  };
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
            disabled={!failed || action.isPending || availability.blocked !== undefined}
            onClick={choose}
          >
            Start fresh session for {nodeId}
          </Button>
          {availability.blocked !== undefined ? <HelpText>{availability.blocked}</HelpText> : null}
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
