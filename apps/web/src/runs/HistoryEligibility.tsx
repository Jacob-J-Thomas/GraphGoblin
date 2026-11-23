import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runs } from '@graphgoblin/api-client';
import type { DeletionPreview } from '@graphgoblin/contracts';
import { useApi } from '../api/context.js';
import { Alert, Button, Dialog } from '../components/ui/index.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import { OPEN_GATE, type WriteGate } from './inspector/RunControls.js';

/** Freeze the explicit IDs at review time: polling and new history cannot extend consent. */
export function HistoryEligibility({
  runIds,
  onConfirmed,
  availability = OPEN_GATE,
}: {
  runIds: string[];
  onConfirmed?: (confirmedIds: string[]) => void;
  /** The inspector's write gate (#416); the Runs list keeps ordinary behaviour. */
  availability?: WriteGate;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [review, setReview] = useState<{
    ids: string[];
    action: 'mark' | 'withdraw';
    gate: WriteGate;
    preview?: DeletionPreview;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  const selectionRef = useRef<HTMLSpanElement>(null);
  const generationRef = useRef(0);
  // A review belongs to the gate it was opened under: an outage, a reconnect or another visit
  // expires it, together with any preview that arrives late for it.
  const active = review?.gate === availability ? review : undefined;
  const unavailable = availability.blocked !== undefined;
  // A sent confirmation keeps its review, open or expired by an outage, until it settles: no
  // replacement review opens over it, so its outcome is still reported here (#416).
  const holding = busy && review !== undefined;

  const dismiss = () => {
    generationRef.current++;
    setReview(undefined);
    setError(undefined);
  };
  const begin = async (action: 'mark' | 'withdraw') => {
    const gate = availability;
    if (holding || !gate.open()) return;
    const request = ++generationRef.current;
    const ids = [...runIds];
    setReview({ ids, action, gate });
    setError(undefined);
    setOutcome(undefined);
    try {
      const preview = await runs.previewDeletion(client, ids);
      if (generationRef.current === request && gate.open())
        setReview({ ids, action, gate, preview });
    } catch (failure) {
      if (generationRef.current === request) setError(errorMessage(failure));
    }
  };
  const confirm = async () => {
    const current = active;
    if (!current?.preview || busy || !current.gate.open()) return;
    const request = generationRef.current;
    setBusy(true);
    setError(undefined);
    try {
      await runs.confirmDeletion(client, {
        runIds: current.ids,
        action: current.action,
        token: current.preview.token,
        confirmed: true,
      });
      const count = current.ids.length;
      const noun = count === 1 ? 'run' : 'runs';
      setOutcome(
        current.action === 'mark'
          ? `${count} ${noun} marked delete-ready.`
          : `Deletion approval withdrawn for ${count} ${noun}.`,
      );
      onConfirmed?.(current.ids);
      if (generationRef.current === request) dismiss();
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (failure) {
      // A sent confirmation always reports what happened to it: in its review while that is still
      // open and current, otherwise beside the controls, leaving any newer review intact.
      if (generationRef.current === request && current.gate.open()) setError(errorMessage(failure));
      else
        setOutcome(
          isOfflineError(failure)
            ? 'The change may or may not have been saved: the GraphGoblin API could not be reached. Review the history again once connected.'
            : `Not saved: ${errorMessage(failure)}`,
        );
    } finally {
      setBusy(false);
    }
  };
  const blocked =
    active?.action === 'mark' && active.preview?.items.some((item) => item.reasons.length > 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!runIds.length || runIds.length > 500 || unavailable || holding}
          onClick={() => void begin('mark')}
        >
          Review delete-ready history
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!runIds.length || runIds.length > 500 || unavailable || holding}
          onClick={() => void begin('withdraw')}
        >
          Withdraw delete-ready mark
        </Button>
        <span
          ref={selectionRef}
          tabIndex={-1}
          className="text-sm text-muted"
          aria-live="polite"
          aria-atomic="true"
        >
          {runIds.length} selected
        </span>
        <span className="text-sm text-muted" aria-live="polite" aria-atomic="true">
          {outcome}
        </span>
      </div>
      <Dialog
        open={active !== undefined}
        returnFocus={() => (outcome ? selectionRef.current : undefined)}
        onClose={(reason) => {
          if (!busy || reason === 'dismissed') dismiss();
        }}
        title={
          active?.action === 'mark'
            ? 'Mark selected history delete-ready?'
            : 'Withdraw deletion approval?'
        }
        footer={
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              disabled={
                busy || unavailable || !active?.preview || Boolean(blocked) || Boolean(error)
              }
              onClick={() => void confirm()}
            >
              {busy
                ? 'Saving…'
                : active?.action === 'mark'
                  ? 'Confirm delete-ready selection'
                  : 'Confirm withdrawal'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 text-sm">
          <p>
            {active?.action === 'mark'
              ? 'Only the run IDs listed below become eligible for deletion under storage pressure. Cleanup can permanently remove this history and its owned, unshared workspaces and artifacts. New history stays retained. You can withdraw approval before cleanup starts.'
              : 'These runs stay retained. Approval for related parent, child and replay history is also withdrawn so required records remain protected.'}
          </p>
          <p>
            Active, paused and unfinished history is protected. Required parent, child and replay
            records must be reviewed together. Artifacts referenced by retained runs stay protected.
          </p>
          <ul className="grid gap-2">
            {(
              active?.preview?.items ??
              active?.ids.map((runId) => ({ runId, reasons: [] })) ??
              []
            ).map((item) => (
              <li key={item.runId} className="wrap-anywhere">
                <code>{item.runId}</code>
                {item.reasons.map((reason) => (
                  <p key={reason} className="text-muted">
                    {reason}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {!active?.preview && !error ? <p role="status">Checking selected history…</p> : null}
          {blocked ? (
            <Alert>
              No history will be marked. Resolve every protected record and review the selection
              again.
            </Alert>
          ) : null}
          {error ? <Alert>{error} Cancel and review again.</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}
