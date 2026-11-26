import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { runs } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { CredentialChangedError, sendUnder } from '../../api/credential-dispatch.js';
import { keys } from '../../api/queries.js';
import { Button, HelpText } from '../../components/ui/index.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';
import {
  assertOpen,
  crossed,
  notSentByKey,
  requestedBeforeKey,
  sameCredential,
  type WriteGate,
} from './RunControls.js';

type Failed = Extract<RunEvent, { type: 'run.failed' }>;

/** The failure a choice answers, frozen when it is chosen. */
interface Choice {
  /** The inspector visit that made the choice; only that visit shows its state and outcome. */
  owner: object;
  gate: WriteGate;
  runId: string;
  nodeId: string;
  visitId: string;
  failureSeq: number;
}

const CHANGED = 'Not sent: the failure shown has changed. Review the run again.';
const ACTION = 'Start fresh session';

/** The inspector view's Start fresh session choice for the run it shows (#416). */
export interface SessionRecovery {
  /** The recorded failure a choice would answer is in the evidence shown. */
  readonly answerable: boolean;
  /** A choice this visit made is queued or in flight; no other is accepted until it settles. */
  readonly pending: boolean;
  /** Why this visit's latest choice was refused or not sent, until a new choice replaces it. */
  readonly refusal: string | undefined;
  /**
   * This visit's latest choice was sent under an earlier accepted credential and settled under a
   * later one (#562): only that it was requested is reported, never its outcome.
   */
  readonly notice: string | undefined;
  /** Why the view cannot send a choice now; undefined while it can. */
  readonly blocked: string | undefined;
  /** Queue a choice for the failure shown now, under the gate it is shown with. */
  readonly choose: () => void;
}

/**
 * The inspector's Start fresh session action (#416), owned by the view rather than by the run
 * section that presents it. The section is withheld while an unproved row cannot be presented;
 * a choice queued before that stays pending, and reports its actual outcome, once the section is
 * shown again. `run` is the run the section presents, undefined while it is withheld, so a queued
 * choice is compared right before it is sent with what is shown then. A choice belongs to the
 * visit (`owner`) that made it: another run, or a later visit, shows neither its pending state
 * nor its outcome.
 */
export function useSessionRecovery({
  owner,
  run,
  events,
  availability,
}: {
  owner: object;
  run: RunRecord | undefined;
  events: readonly RunEvent[];
  /** Also requires a fresh matching observation after an outage. */
  availability: WriteGate;
}): SessionRecovery {
  const client = useApi();
  const queries = useQueryClient();
  const runId = run?.id;
  const missing = run?.failure?.missingSession;
  const nodeId = run?.failure?.nodeId;
  // The recorded failure of this run's current node and missing-session visit. Its own sequence
  // is sent, even when later audit events follow it; a failure of another visit does not count.
  const failed = events.findLast(
    (event): event is Failed =>
      event.type === 'run.failed' &&
      event.runId === runId &&
      event.failure.code === 'HARNESS_SESSION_MISSING' &&
      event.failure.nodeId === nodeId &&
      event.failure.missingSession?.visitId === missing?.visitId,
  );
  // The identity shown now, compared with a queued choice right before it is sent. Nothing is
  // shown while the section is withheld.
  const shown = useRef({ runId, nodeId, visitId: missing?.visitId, seq: failed?.seq });
  useLayoutEffect(() => {
    shown.current = { runId, nodeId, visitId: missing?.visitId, seq: failed?.seq };
  });
  // The choice that settled under a later accepted credential than it was sent under (#562).
  const [requested, setRequested] = useState<Choice>();
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
      return sendUnder(client, choice.gate.credential, (client) =>
        runs.recoverSession(client, choice.runId, {
          nodeId: choice.nodeId,
          failureSeq: choice.failureSeq,
        }),
      );
    },
    onSuccess: (_result, choice) => {
      void queries.invalidateQueries({ queryKey: keys.run(choice.runId) });
      void queries.invalidateQueries({ queryKey: keys.thread(choice.runId) });
      if (crossed(choice.gate)) setRequested(choice);
    },
    onError: (error, choice) => {
      if (!(error instanceof CredentialChangedError) && crossed(choice.gate)) setRequested(choice);
    },
  });
  // The latest choice this view made, only while the visit that made it is shown.
  const choice = action.variables?.owner === owner ? action.variables : undefined;
  const pending = choice !== undefined && action.isPending;
  // Its outcome is shown only under the accepted credential it was chosen under.
  const refusal =
    choice && action.isError
      ? action.error instanceof CredentialChangedError
        ? notSentByKey(ACTION)
        : requested !== choice && sameCredential(choice.gate, availability)
          ? errorMessage(action.error)
          : undefined
      : undefined;
  return {
    answerable: failed !== undefined,
    pending,
    refusal,
    notice: choice && requested === choice && !pending ? requestedBeforeKey(ACTION) : undefined,
    blocked: availability.blocked,
    choose: () => {
      if (pending || !run || !failed || !nodeId || !missing || !availability.open()) return;
      action.mutate({
        owner,
        gate: availability,
        runId: run.id,
        nodeId,
        visitId: missing.visitId,
        failureSeq: failed.seq,
      });
    },
  };
}

/** Recovery is deliberately separate from plain Resume and never changes the pinned definition. */
export function SessionRecoveryControls({
  run,
  events,
  recovery,
}: {
  run: RunRecord;
  events: readonly RunEvent[];
  /** The view's choice, from `useSessionRecovery` for this run and these events. */
  recovery: SessionRecovery;
}) {
  const missing = run.failure?.missingSession;
  const nodeId = run.failure?.nodeId;
  const eligible =
    run.status === 'failed' &&
    run.failure?.code === 'HARNESS_SESSION_MISSING' &&
    missing &&
    nodeId === run.currentNodeId &&
    missing.visitId.startsWith(run.id + ':');
  const choices = events.filter((event) => event.type === 'run.resumed' && event.freshSession);
  if (!eligible && choices.length === 0 && recovery.notice === undefined) return null;
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
            disabled={!recovery.answerable || recovery.pending || recovery.blocked !== undefined}
            onClick={() => recovery.choose()}
          >
            Start fresh session for {nodeId}
          </Button>
          {recovery.blocked !== undefined ? <HelpText>{recovery.blocked}</HelpText> : null}
          {recovery.refusal !== undefined ? (
            <HelpText tone="bad">{recovery.refusal}</HelpText>
          ) : null}
        </>
      ) : null}
      {recovery.notice !== undefined ? <HelpText role="status">{recovery.notice}</HelpText> : null}
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
