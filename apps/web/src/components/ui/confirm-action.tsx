import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { Alert } from './alert.js';
import { Button } from './button.js';

/** Shared destructive action: native modal focus containment, safe initial focus, and retry. */
export function ConfirmAction({
  action = 'delete',
  name,
  accessibleName = `Delete ${name}`,
  consequences,
  onConfirm,
}: {
  action?: 'delete' | 'revoke';
  name: string;
  accessibleName?: string;
  consequences: ReactNode;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const verb = action === 'delete' ? 'Delete' : 'Revoke';

  useEffect(() => {
    if (!open) return;
    const modal = dialogRef.current!;
    const opener = triggerRef.current!;
    const fallback = opener.closest('section')?.querySelector('h2');
    modal.showModal();
    keepRef.current!.focus();
    return () => {
      modal.close();
      // Wait for the refreshed list to commit before deciding whether the row survived.
      requestAnimationFrame(() => {
        const target = opener.isConnected
          ? opener
          : fallback?.isConnected
            ? fallback
            : document.querySelector<HTMLElement>('h1');
        if (target) {
          if (target !== opener) target.tabIndex = -1;
          target.focus();
        }
      });
    };
  }, [open]);

  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setError(undefined);
    dialogRef.current!.focus();
    try {
      await onConfirm();
      setOpen(false);
    } catch (failure) {
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
        aria-label={accessibleName}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        <Icon name="trash" />
        {verb}
      </Button>
      {open ? (
        <dialog
          ref={dialogRef}
          role="alertdialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          aria-modal="true"
          aria-busy={pending}
          tabIndex={-1}
          onKeyDown={(event) => {
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
            if (!busyRef.current) setOpen(false);
          }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-[520px] overflow-y-auto rounded-lg border border-strong bg-surface-overlay p-5 text-left whitespace-normal text-default shadow-3 backdrop:bg-surface-inverse/75"
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
              <Icon name="trash" />
              {pending ? (action === 'delete' ? 'Deleting…' : 'Revoking…') : `Confirm ${action}`}
            </Button>
            <Button
              ref={keepRef}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Keep
            </Button>
            <span role="status" className="self-center text-sm text-muted">
              {pending ? 'Please wait…' : ''}
            </span>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
