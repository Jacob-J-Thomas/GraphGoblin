import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { focusFallback } from '../../lib/focus.js';
import { errorMessage } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { Alert } from './alert.js';
import { Button } from './button.js';

/** Shared destructive action: modal background blocking, safe focus, and retry. */
export function ConfirmAction({
  action = 'delete',
  name,
  accessibleName,
  'aria-describedby': describedBy,
  consequences,
  onConfirm,
  onConfirmed,
  onDismiss,
  returnFocusTo,
}: {
  action?: 'delete' | 'revoke';
  name: string;
  accessibleName?: string;
  /** Description of the opener, separate from the confirmation's consequences. */
  'aria-describedby'?: string | undefined;
  consequences: ReactNode;
  onConfirm: () => Promise<unknown>;
  /** Optional list refresh; never extends the destructive request's pending state. */
  onConfirmed?: () => Promise<unknown>;
  /** Called after dismissal, retaining the original failure for list refresh decisions. */
  onDismiss?: (error: unknown) => void | Promise<unknown>;
  /** Element id to focus after removal; defaults to the owning section's labelled heading. */
  returnFocusTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const programmaticClosesRef = useRef({ count: 0 });
  const failureRef = useRef<unknown>(undefined);
  const restoreFocusRef = useRef<() => void>(() => {});
  const id = useId();
  const verb = action === 'delete' ? 'Delete' : 'Revoke';
  const icon = action === 'delete' ? 'trash' : 'cancelled';

  const restoreAfter = (refreshed: void | Promise<unknown>) => {
    const restoreFocus = restoreFocusRef.current;
    // A list refresh can remove the opener after the dialog has already returned focus to it.
    const afterRefresh = () => requestAnimationFrame(restoreFocus);
    void Promise.resolve(refreshed).then(afterRefresh, afterRefresh);
  };

  const dismiss = () => {
    setOpen(false);
    setError(undefined);
    restoreAfter(onDismiss?.(failureRef.current));
    failureRef.current = undefined;
  };

  useEffect(() => {
    if (!open) return;
    const modal = dialogRef.current!;
    const opener = triggerRef.current!;
    const closeEvents = programmaticClosesRef.current;
    const fallbackId =
      returnFocusTo ?? opener.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby');
    const restoreFocus = () => {
      if (modal.open) return;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== opener &&
        active !== modal &&
        !modal.contains(active)
      )
        return;
      const target = opener.isConnected
        ? opener
        : fallbackId
          ? document.getElementById(fallbackId)
          : null;
      if (target) {
        if (target === opener) target.focus();
        else focusFallback(target);
      }
    };
    restoreFocusRef.current = restoreFocus;
    modal.showModal();
    keepRef.current!.focus();
    return () => {
      if (modal.open) {
        // close events are queued: consume our own event even if this dialog reopens first.
        closeEvents.count++;
        modal.close();
      }
      // Wait for React to remove a successful deletion's row before restoring focus.
      requestAnimationFrame(restoreFocus);
    };
  }, [open, returnFocusTo]);

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setError(undefined);
    failureRef.current = undefined;
    dialogRef.current!.focus();
    try {
      await onConfirm();
      setOpen(false);
      if (onConfirmed) restoreAfter(onConfirmed());
    } catch (failure) {
      failureRef.current = failure;
      setError(errorMessage(failure));
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="destructive-soft"
        aria-label={accessibleName ?? `${verb} ${name}`}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        <Icon name={icon} />
        {verb}
      </Button>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        aria-modal="true"
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && busyRef.current) {
            event.preventDefault();
            return;
          }
          if (event.key !== 'Tab') return;
          if (busyRef.current) {
            event.preventDefault();
          } else if (!event.shiftKey && document.activeElement === keepRef.current) {
            event.preventDefault();
            confirmRef.current!.focus();
          } else if (event.shiftKey && document.activeElement === confirmRef.current) {
            event.preventDefault();
            keepRef.current!.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!busyRef.current) dismiss();
        }}
        onClose={(event) => {
          if (programmaticClosesRef.current.count > 0) {
            programmaticClosesRef.current.count--;
            return;
          }
          const modal = event.currentTarget;
          // A queued close can arrive after the same dialog has already reopened.
          if (modal.open) return;
          if (busyRef.current && modal.isConnected) {
            modal.showModal();
            modal.focus();
          } else dismiss();
        }}
        className={`fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-[520px] overflow-y-auto rounded-lg border border-strong bg-surface-overlay p-5 text-left whitespace-normal text-default shadow-3 backdrop:bg-surface-inverse/75 ${pending ? 'select-none' : ''}`}
      >
        <h2 id={`${id}-title`} className="mb-3 text-lg font-semibold wrap-anywhere">
          {verb} “{name}”?
        </h2>
        <div id={`${id}-description`} className="grid gap-3 text-sm wrap-anywhere">
          {consequences}
          <p>This cannot be undone.</p>
        </div>
        {error ? (
          <Alert className="mt-4" title={`Could not ${action} “${name}”.`}>
            {error}
          </Alert>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            ref={confirmRef}
            size="sm"
            variant="destructive"
            disabled={pending}
            aria-label={`Confirm ${action} ${name}`}
            onClick={() => void confirm()}
          >
            <Icon name={icon} />
            {pending ? (action === 'delete' ? 'Deleting…' : 'Revoking…') : `Confirm ${action}`}
          </Button>
          <Button ref={keepRef} size="sm" variant="outline" disabled={pending} onClick={dismiss}>
            Keep
          </Button>
          <span role="status" className="self-center text-sm text-muted">
            {pending ? 'Please wait…' : ''}
          </span>
        </div>
      </dialog>
    </>
  );
}
