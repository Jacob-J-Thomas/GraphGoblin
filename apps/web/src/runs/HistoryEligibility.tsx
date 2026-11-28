import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runs } from '@graphgoblin/api-client';
import type { DeletionPreview } from '@graphgoblin/contracts';
import { useApi } from '../api/context.js';
import { CredentialChangedError, sendUnder } from '../api/credential-dispatch.js';
import { Alert, Button, Dialog } from '../components/ui/index.js';
import { errorMessage, isOfflineError } from '../lib/utils.js';
import {
  crossed,
  expiredReviewFocus,
  notSentByKey,
  OPEN_GATE,
  requestedBeforeKey,
  reviewClosedByKey,
  sameCredential,
  sendWrite,
  useClosedByKey,
  WRAPPING_LABEL,
  type WriteGate,
} from './inspector/RunControls.js';

/** A delete-ready review: the explicit run IDs and action frozen when it opened, under its gate. */
export interface HistoryReview {
  readonly ids: string[];
  readonly action: 'mark' | 'withdraw';
  readonly gate: WriteGate;
  readonly preview?: DeletionPreview;
}

/** What the API answered a sent confirmation. */
export type HistoryResult =
  { readonly saved: true } | { readonly saved: false; readonly error: unknown };

/** A confirmation as sent, with the review it was sent from, and what happened to it. */
interface Sent {
  /** This confirmation's identity: a later one replaces it, and its late answer is dropped. */
  readonly ticket: object;
  readonly owner: object;
  readonly review: HistoryReview;
  /** The browser itself has dismissed the review it was sent from. */
  readonly released: boolean;
  /** Absent while it is in flight. */
  readonly result?: HistoryResult;
  /** It settled after the accepted credential it was sent under changed (#562). */
  readonly crossed?: boolean;
}

/** One owner's delete-ready confirmation (#416). */
export interface HistoryConfirmation {
  /** The write gate now: a review opens under it, and a confirmation is sent only under it. */
  readonly availability: WriteGate;
  /** A confirmation this owner sent is in flight; no other is sent until it settles. */
  readonly pending: boolean;
  /** It still holds the review controls: the browser has not dismissed its review. */
  readonly holding: boolean;
  /**
   * This owner's latest settled confirmation, until a new review or a dismissal clears it.
   * `crossed`: it settled under a later accepted credential than it was sent under (#562).
   */
  readonly settled:
    | { readonly review: HistoryReview; readonly result: HistoryResult; readonly crossed: boolean }
    | undefined;
  /** Send the confirmation `review` asks for; it must be open, current and previewed. */
  readonly confirm: (review: HistoryReview) => void;
  /** The browser dismissed the review of the pending confirmation. */
  readonly release: () => void;
  /** Clear a settled confirmation; a pending one keeps its report. */
  readonly clear: () => void;
}

/**
 * The delete-ready confirmation, owned apart from the controls that present it. The inspector
 * calls this for the view (`owner` is its visit), so a confirmation sent before its run section
 * was withheld keeps holding the controls shown again, and reports there, until it settles;
 * another run or a later visit shows neither its pending state nor its outcome. The review
 * itself, with its preview, stays with the controls and ends with them.
 */
export function useHistoryConfirmation({
  owner,
  availability,
  onConfirmed,
}: {
  owner: object;
  /** The inspector's write gate (#416); the Runs list keeps ordinary behaviour. */
  availability: WriteGate;
  onConfirmed?: ((confirmedIds: string[]) => void) | undefined;
}): HistoryConfirmation {
  const client = useApi();
  const queryClient = useQueryClient();
  const [sent, setSent] = useState<Sent>();
  const own = sent?.owner === owner ? sent : undefined;
  const pending = own !== undefined && own.result === undefined;
  const update = (ticket: object, change: (current: Sent) => Sent | undefined) =>
    setSent((current) => (current?.ticket === ticket ? change(current) : current));
  return {
    availability,
    pending,
    holding: own !== undefined && own.result === undefined && !own.released,
    settled: own?.result && {
      review: own.review,
      result: own.result,
      crossed: own.crossed === true,
    },
    confirm: (review) => {
      const { preview } = review;
      if (!preview || pending || review.gate !== availability || !review.gate.open()) return;
      const ticket = {};
      setSent({ ticket, owner, review, released: false });
      const send = async () => {
        try {
          await sendWrite(client, review.gate, (client) =>
            runs.confirmDeletion(client, {
              runIds: review.ids,
              action: review.action,
              token: preview.token,
              confirmed: true,
            }),
          );
        } catch (error) {
          const late = !(error instanceof CredentialChangedError) && crossed(review.gate);
          update(ticket, (current) => ({
            ...current,
            result: { saved: false, error },
            crossed: late,
          }));
          return;
        }
        const late = crossed(review.gate);
        update(ticket, (current) => ({ ...current, result: { saved: true }, crossed: late }));
        if (!late) onConfirmed?.(review.ids);
        await queryClient.invalidateQueries({ queryKey: ['runs'] });
      };
      void send();
    },
    release: () => {
      if (own !== undefined && own.result === undefined)
        update(own.ticket, (current) => ({ ...current, released: true }));
    },
    clear: () => {
      if (own?.result !== undefined) update(own.ticket, () => undefined);
    },
  };
}

const UNCERTAIN =
  'The change may or may not have been saved: the GraphGoblin API could not be reached. Review the history again once connected.';

const CONFIRM_NAME = { mark: 'Confirm delete-ready selection', withdraw: 'Confirm withdrawal' };
const TRIGGER_NAME = {
  mark: 'Review delete-ready history',
  withdraw: 'Withdraw delete-ready mark',
};

/**
 * Where a settled confirmation is reported: its failure in the review it was sent from while that
 * review is open and current, everything else beside the controls, never in a newer review. Only
 * under the accepted credential it was sent under (#562): one that settled under a later one says
 * only that it was requested, and an earlier credential's outcome is not shown.
 */
function report(
  settled: HistoryConfirmation['settled'],
  active: HistoryReview | undefined,
  availability: WriteGate,
): { review?: string; controls?: string } {
  if (!settled) return {};
  const { review, result } = settled;
  const name = CONFIRM_NAME[review.action];
  if (!result.saved && result.error instanceof CredentialChangedError)
    return { controls: notSentByKey(name) };
  if (settled.crossed) return { controls: requestedBeforeKey(name) };
  if (!sameCredential(review.gate, availability)) return {};
  if (result.saved) {
    const count = review.ids.length;
    const noun = count === 1 ? 'run' : 'runs';
    return {
      controls:
        review.action === 'mark'
          ? `${count} ${noun} marked delete-ready.`
          : `Deletion approval withdrawn for ${count} ${noun}.`,
    };
  }
  const reason = errorMessage(result.error);
  if (review === active) return { review: reason };
  return { controls: isOfflineError(result.error) ? UNCERTAIN : `Not saved: ${reason}` };
}

/** Freeze the explicit IDs at review time: polling and new history cannot extend consent. */
export function HistoryEligibilityControls({
  runIds,
  confirmation,
}: {
  runIds: string[];
  /** The owner's confirmation, from `useHistoryConfirmation`. */
  confirmation: HistoryConfirmation;
}) {
  const client = useApi();
  const { availability } = confirmation;
  const [review, setReview] = useState<HistoryReview>();
  const [error, setError] = useState<string>();
  const selectionRef = useRef<HTMLSpanElement>(null);
  const reportRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const generationRef = useRef(0);
  // A review belongs to the gate it was opened under: an outage, a reconnect, another visit or
  // another accepted API key expires it, together with any preview that arrives late for it. A
  // saved one is finished.
  const done = confirmation.settled?.result.saved && confirmation.settled.review === review;
  const active = review?.gate === availability && !done ? review : undefined;
  const expiry = useClosedByKey(availability, active?.gate, confirmation.pending);
  const reported = report(confirmation.settled, active, availability);
  const closed =
    expiry.closed && review ? reviewClosedByKey(TRIGGER_NAME[review.action]) : undefined;
  const shownError = error ?? reported.review;
  const unavailable = availability.blocked !== undefined;
  // A sent confirmation keeps its review, open or expired by an outage, until it settles: no
  // replacement review opens over it, so its outcome is still reported here (#416). Withholding
  // these controls ends the review but not that hold.
  const held = confirmation.holding || (confirmation.pending && review !== undefined);

  const dismiss = () => {
    generationRef.current++;
    // A failure reported in this review is dismissed with it.
    if (reported.review !== undefined) confirmation.clear();
    setReview(undefined);
    setError(undefined);
  };
  const begin = async (action: 'mark' | 'withdraw') => {
    const gate = availability;
    if (held || !gate.open()) return;
    const request = ++generationRef.current;
    const ids = [...runIds];
    setReview({ ids, action, gate });
    setError(undefined);
    expiry.clear();
    confirmation.clear();
    try {
      // The preview's token is taken only under the credential the review was opened under.
      const preview = await sendUnder(client, gate.credential, (client) =>
        runs.previewDeletion(client, ids),
      );
      if (generationRef.current === request && gate.open())
        setReview({ ids, action, gate, preview });
    } catch (failure) {
      if (generationRef.current === request) setError(errorMessage(failure));
    }
  };
  const blocked =
    active?.action === 'mark' && active.preview?.items.some((item) => item.reasons.length > 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={markRef}
          size="sm"
          variant="outline"
          className={WRAPPING_LABEL.sm}
          disabled={!runIds.length || runIds.length > 500 || unavailable || held}
          onClick={() => void begin('mark')}
        >
          Review delete-ready history
        </Button>
        <Button
          ref={withdrawRef}
          size="sm"
          variant="ghost"
          className={WRAPPING_LABEL.sm}
          disabled={!runIds.length || runIds.length > 500 || unavailable || held}
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
        <span
          ref={reportRef}
          tabIndex={-1}
          className="text-sm text-muted"
          aria-live="polite"
          aria-atomic="true"
        >
          {reported.controls ?? closed}
        </span>
      </div>
      <Dialog
        open={active !== undefined}
        returnFocus={() =>
          expiredReviewFocus(
            expiry.expired,
            review?.action === 'withdraw' ? withdrawRef.current : markRef.current,
            reportRef.current,
          ) ?? (reported.controls ? selectionRef.current : undefined)
        }
        onClose={(reason) => {
          if (confirmation.pending && reason !== 'dismissed') return;
          // The browser has already closed the review of a pending confirmation: that review no
          // longer holds the controls, though a new one cannot be confirmed until it settles.
          if (confirmation.pending) confirmation.release();
          dismiss();
        }}
        title={
          active?.action === 'mark'
            ? 'Mark selected history delete-ready?'
            : 'Withdraw deletion approval?'
        }
        footer={
          <>
            <Button
              variant="outline"
              className={WRAPPING_LABEL.md}
              disabled={confirmation.pending}
              onClick={dismiss}
            >
              Cancel
            </Button>
            <Button
              className={WRAPPING_LABEL.md}
              disabled={
                confirmation.pending ||
                unavailable ||
                !active?.preview ||
                Boolean(blocked) ||
                shownError !== undefined
              }
              onClick={() => {
                if (active) confirmation.confirm(active);
              }}
            >
              {confirmation.pending
                ? 'Saving…'
                : active?.action === 'mark'
                  ? 'Confirm delete-ready selection'
                  : 'Confirm withdrawal'}
            </Button>
          </>
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
          {!active?.preview && shownError === undefined ? (
            <p role="status">Checking selected history…</p>
          ) : null}
          {blocked ? (
            <Alert>
              No history will be marked. Resolve every protected record and review the selection
              again.
            </Alert>
          ) : null}
          {shownError !== undefined ? <Alert>{shownError} Cancel and review again.</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}

/** The Runs list's delete-ready controls: one owner, ordinary availability. */
export function HistoryEligibility({
  runIds,
  onConfirmed,
}: {
  runIds: string[];
  onConfirmed?: (confirmedIds: string[]) => void;
}) {
  const [owner] = useState(() => ({}));
  const confirmation = useHistoryConfirmation({ owner, availability: OPEN_GATE, onConfirmed });
  return <HistoryEligibilityControls runIds={runIds} confirmation={confirmation} />;
}
