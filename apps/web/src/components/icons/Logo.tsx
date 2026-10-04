import { cn } from '../../lib/utils.js';

const SKIN = 'fill-mascot-skin stroke-mascot-ink stroke-[0.9] [stroke-linejoin:round]';
const SHADE = 'fill-mascot-shade';
const INK = 'fill-mascot-ink';
const PORT = 'fill-mascot-port stroke-mascot-ink stroke-[0.9]';
const BROW =
  'fill-none stroke-mascot-ink stroke-[2.1] [stroke-linecap:round] [stroke-linejoin:round]';
const MOUTH =
  'fill-none stroke-mascot-ink stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]';
const GLINT = 'fill-mascot-glint';
const TOOTH = 'fill-mascot-tooth stroke-mascot-ink stroke-[0.45] [stroke-linejoin:round]';

/**
 * The goblin mark (the "smirk" face from the approved visual direction; a placeholder until #10):
 * the favicon's node with sharp ears, port dots for cheeks, slit eyes with a magenta glint, and a
 * crooked smirk with one fang. Decorative: the wordmark beside it carries the name.
 */
export function GoblinMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn('size-[30px] shrink-0', className)}
    >
      <path className={SKIN} d="M10.4 11.1 .3 3 6 17.4Z" />
      <path className={SKIN} d="M21.6 11.1 31.7 3 26 17.4Z" />
      <path className={SHADE} d="M8.7 11.9 2.6 6.2l3.5 9.2Z" />
      <path className={SHADE} d="M23.3 11.9 29.4 6.2l-3.5 9.2Z" />
      <rect className={SKIN} x="5" y="8.8" width="22" height="17.4" rx="6.2" />
      <circle className={PORT} cx="5" cy="20.2" r="2.2" />
      <circle className={PORT} cx="27" cy="20.2" r="2.2" />
      <path className={BROW} d="M9.1 12.3 14.5 15M22.9 12.3 17.5 15" />
      <path className={INK} d="M9.8 17.4q2.5-1.9 5-.1-2.5 1.5-5 .1Z" />
      <path className={INK} d="M22.2 17.4q-2.5-1.9-5-.1 2.5 1.5 5 .1Z" />
      <circle className={GLINT} cx="13.3" cy="17.2" r=".7" />
      <circle className={GLINT} cx="18.7" cy="17.2" r=".7" />
      <path className={MOUTH} d="M11.4 21.1q3.8 1.7 7.3.5 1.6-.6 2.6-2.1" />
      <path className={TOOTH} d="M16.6 21.9l1.9-.5-.6 2.3Z" />
    </svg>
  );
}

/**
 * The header lockup: the mark and the "GraphGoblin" wordmark (`variant="wordmark"` drops the mark).
 * "Goblin" takes the accent on the dark header and the deeper accent on a light surface.
 */
export function Logo({
  variant = 'full',
  surface = 'inverse',
  className,
}: {
  variant?: 'full' | 'wordmark';
  surface?: 'inverse' | 'raised';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 text-lg font-semibold tracking-[-0.015em]',
        surface === 'inverse' ? 'text-inverse' : 'text-default',
        className,
      )}
    >
      {variant === 'full' ? <GoblinMark /> : null}
      <span>
        Graph
        <span className={surface === 'inverse' ? 'text-accent' : 'text-accent-strong'}>Goblin</span>
      </span>
    </span>
  );
}
