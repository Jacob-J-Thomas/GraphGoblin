import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon, type IconName } from '../icons/index.js';
import type { Tone } from './badge.js';

const ALERT_TONES: Record<Tone, { box: string; accent: string; icon: IconName }> = {
  neutral: {
    box: 'bg-status-neutral-bg border-status-neutral-border',
    accent: 'text-status-neutral-fg',
    icon: 'info',
  },
  good: {
    box: 'bg-status-good-bg border-status-good-border',
    accent: 'text-status-good-fg',
    icon: 'check-circle',
  },
  bad: {
    box: 'bg-status-bad-bg border-status-bad-border',
    accent: 'text-status-bad-fg',
    icon: 'failed',
  },
  warn: {
    box: 'bg-status-warn-bg border-status-warn-border',
    accent: 'text-status-warn-fg',
    icon: 'alert',
  },
  info: {
    box: 'bg-status-info-bg border-status-info-border',
    accent: 'text-status-info-fg',
    icon: 'info',
  },
};

/**
 * A tinted message with a tone edge and icon. `bad` is announced as an alert; the other tones are
 * polite status messages.
 */
export function Alert({
  tone = 'bad',
  title,
  className,
  children,
}: {
  tone?: Tone;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const style = ALERT_TONES[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md border-l-4 px-4 py-3',
        'text-sm leading-snug text-default',
        style.box,
        className,
      )}
    >
      <Icon name={style.icon} className={cn('row-span-2 mt-px size-[18px]', style.accent)} />
      {title ? <p className={cn('font-semibold', style.accent)}>{title}</p> : null}
      {children !== undefined && children !== null ? (
        <div className="min-w-0 [&_a]:text-link">{children}</div>
      ) : null}
    </div>
  );
}
