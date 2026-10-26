import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runs } from '@graphgoblin/api-client';
import type { DeletionPreview } from '@graphgoblin/contracts';
import { useApi } from '../api/context.js';
import { Alert, Button, Dialog } from '../components/ui/index.js';
import { errorMessage } from '../lib/utils.js';

/** Freeze the explicit IDs at review time: polling and new history cannot extend consent. */
export function HistoryEligibility({ runIds }: { runIds: string[] }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [review, setReview] = useState<{
    ids: string[];
    action: 'mark' | 'withdraw';
    preview?: DeletionPreview;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generationRef = useRef(0);

  const dismiss = () => {
    generationRef.current++;
    setReview(undefined);
    setError(undefined);
  };
  const begin = async (action: 'mark' | 'withdraw') => {
    const request = ++generationRef.current;
    const ids = [...runIds];
    setReview({ ids, action });
    setError(undefined);
    try {
      const preview = await runs.previewDeletion(client, ids);
      if (generationRef.current === request) setReview({ ids, action, preview });
    } catch (failure) {
      if (generationRef.current === request) setError(errorMessage(failure));
    }
  };
  const confirm = async () => {
    if (!review?.preview || busy) return;
    const request = generationRef.current;
    setBusy(true);
    setError(undefined);
    try {
      await runs.confirmDeletion(client, {
        runIds: review.ids,
        action: review.action,
        token: review.preview.token,
        confirmed: true,
      });
      if (generationRef.current === request) dismiss();
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (failure) {
      if (generationRef.current === request) setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const blocked =
    review?.action === 'mark' && review.preview?.items.some((item) => item.reasons.length > 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!runIds.length || runIds.length > 500}
          onClick={() => void begin('mark')}
        >
          Review delete-ready history
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!runIds.length || runIds.length > 500}
          onClick={() => void begin('withdraw')}
        >
          Withdraw delete-ready mark
        </Button>
        <span className="text-sm text-muted">{runIds.length} selected</span>
      </div>
      <Dialog
        open={review !== undefined}
        onClose={(reason) => {
          if (!busy || reason === 'dismissed') dismiss();
        }}
        title={
          review?.action === 'mark'
            ? 'Mark selected history delete-ready?'
            : 'Withdraw deletion approval?'
        }
        footer={
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              disabled={busy || !review?.preview || Boolean(blocked) || Boolean(error)}
              onClick={() => void confirm()}
            >
              {busy
                ? 'Saving…'
                : review?.action === 'mark'
                  ? 'Confirm delete-ready selection'
                  : 'Confirm withdrawal'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 text-sm">
          <p>
            {review?.action === 'mark'
              ? 'Only the run IDs listed below become eligible for deletion under storage pressure. This does not delete anything now. New history stays retained. You can withdraw approval before cleanup.'
              : 'These runs stay retained. Approval for related parent, child and replay history is also withdrawn so required records remain protected.'}
          </p>
          <p>
            Active, paused and unfinished history is protected. Required parent, child and replay
            records must be reviewed together. Artifacts referenced by retained runs stay protected.
          </p>
          <ul className="grid gap-2">
            {(
              review?.preview?.items ??
              review?.ids.map((runId) => ({ runId, reasons: [] })) ??
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
          {!review?.preview && !error ? <p role="status">Checking selected history…</p> : null}
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
