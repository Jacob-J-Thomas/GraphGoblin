import type { NodeKind } from '@graphgoblin/contracts';
import type { CSSProperties } from 'react';
import { KindIcon } from '../components/icons/index.js';
import { cn } from '../lib/utils.js';
import { KIND_INFO } from './model.js';

/**
 * The kind's colour tokens as the `--k` and `--k-subtle` variables, which the `bg-kind`,
 * `bg-kind-subtle`, `border-kind`, and `text-kind` utilities read (styles/theme.css).
 */
export function kindStyle(kind: NodeKind): CSSProperties {
  const token = KIND_INFO[kind].color;
  return { '--k': `var(--${token})`, '--k-subtle': `var(--${token}-subtle)` } as CSSProperties;
}

const SIZES = {
  md: 'size-7 rounded-md',
  sm: 'size-[22px] rounded-[6px] [&_svg]:size-[13px] [&_svg]:stroke-[2.2]',
  xs: 'size-[18px] rounded-[5px] [&_svg]:size-[11px] [&_svg]:stroke-[2.4]',
};

/** A node kind's icon on its colour: the palette, node cards, and the property panel. */
export function KindChip({
  kind,
  size = 'md',
  className,
}: {
  kind: NodeKind;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-kind={kind}
      style={kindStyle(kind)}
      className={cn(
        'inline-grid shrink-0 place-items-center bg-kind text-kind-on',
        SIZES[size],
        className,
      )}
    >
      <KindIcon kind={kind} />
    </span>
  );
}
