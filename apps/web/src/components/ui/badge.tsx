import type { HTMLAttributes } from 'react';
import { variants } from '../../lib/variants.js';

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';

/**
 * Status tones: blue means success and orange failure (colour-blind safe), amber waiting or
 * attention, violet running or information. Anything that carries meaning pairs a tone with an
 * icon or a word, never colour alone.
 */
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-status-neutral-bg text-status-neutral-fg',
  good: 'bg-status-good-bg text-status-good-fg',
  bad: 'bg-status-bad-bg text-status-bad-fg',
  warn: 'bg-status-warn-bg text-status-warn-fg',
  info: 'bg-status-info-bg text-status-info-fg',
};

const badgeClasses = variants({
  // The transparent border becomes visible in forced-colours mode, where backgrounds are dropped.
  base: 'inline-flex items-center rounded-full border border-transparent font-semibold leading-none whitespace-nowrap',
  variants: {
    tone: TONE_CLASSES,
    size: {
      sm: 'h-5 gap-1 px-[7px] text-[11px] [&_svg]:size-[11px]',
      md: 'h-6 gap-[5px] px-2.5 text-xs has-[svg]:pl-[7px] [&_svg]:size-[13px] [&_svg]:stroke-[2.5]',
    },
  },
  defaults: { tone: 'neutral', size: 'md' },
});

export function Badge({
  tone,
  size,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; size?: 'sm' | 'md' }) {
  return <span className={badgeClasses({ tone, size, className })} {...props} />;
}
