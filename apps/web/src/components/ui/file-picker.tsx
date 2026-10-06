import { useId, useState, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { buttonStyles } from './button.js';

export type FilePickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** The visible button's text. */
  buttonLabel?: string;
};

/** "sink.json", "3 files", or undefined when nothing was chosen. */
function chosen(files: FileList | null): string | undefined {
  if (!files || files.length === 0) return undefined;
  return files.length === 1 ? files[0]?.name : `${files.length} files`;
}

/**
 * A file picker drawn like an outline button with the chosen file's name beside it. The native
 * `input type="file"` stays the control: it lies transparent over the button, so a click, Tab, and
 * Space or Enter behave natively, a `<Label htmlFor>` names it, and the focus ring is drawn on the
 * button. The name shown is the last file chosen (the input's own value may be cleared by the
 * caller so the same file can be chosen again), and it describes the input to assistive technology.
 */
export function FilePicker({
  className,
  buttonLabel = 'Choose file',
  onChange,
  disabled,
  'aria-describedby': describedBy,
  ...props
}: FilePickerProps) {
  const nameId = useId();
  const [name, setName] = useState<string>();
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="relative inline-flex shrink-0">
        <input
          type="file"
          disabled={disabled}
          aria-describedby={cn(nameId, describedBy)}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={(event) => {
            setName(chosen(event.target.files));
            onChange?.(event);
          }}
          {...props}
        />
        <span
          aria-hidden="true"
          className={buttonStyles({
            variant: 'outline',
            size: 'sm',
            className: [
              'pointer-events-none peer-hover:bg-surface-hover peer-active:translate-y-px',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
              'peer-focus-visible:outline-focus peer-disabled:opacity-45',
            ],
          })}
        >
          <Icon name="upload" />
          {buttonLabel}
        </span>
      </span>
      <span id={nameId} className="min-w-0 truncate text-sm text-muted">
        {name ?? 'No file chosen'}
      </span>
    </div>
  );
}
