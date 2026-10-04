import type { ButtonHTMLAttributes } from 'react';
import { variants } from '../../lib/variants.js';
import { ellipsize } from './ellipsis.js';

/**
 * Buttons as in the approved visual direction: the primary is goblin lime with ink text on a
 * pressable ledge; secondary and outline sit on a 3:1 border with a one-pixel ledge; destructive is
 * solid red; ghost has no chrome until hover. Pressing nudges the button onto its ledge. A button
 * never grows wider than its container, nor widens a grid column; an overlong label ends in an
 * ellipsis (ellipsize).
 */
const buttonClasses = variants({
  base: [
    'relative inline-flex max-w-full min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-md border',
    'font-semibold leading-none cursor-pointer select-none no-underline',
    'transition-[background-color,border-color,box-shadow,translate]',
    'active:shadow-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    'disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none',
  ],
  variants: {
    variant: {
      default:
        'border-accent-strong bg-accent text-on-accent shadow-ledge-accent hover:bg-accent-hover active:translate-y-0.5 active:bg-accent-active',
      secondary:
        'border-strong bg-surface-control text-default shadow-ledge hover:bg-surface-hover active:translate-y-px',
      outline:
        'border-strong bg-surface-raised text-default shadow-ledge hover:bg-surface-hover active:translate-y-px',
      destructive:
        'border-danger-hover bg-danger text-on-danger shadow-ledge-danger hover:bg-danger-hover active:translate-y-px',
      ghost:
        'border-transparent bg-transparent text-default hover:bg-surface-hover active:translate-y-px',
    },
    size: {
      sm: 'h-8 gap-1.5 px-[11px] text-sm [&_svg]:size-[15px]',
      md: 'h-9 gap-[7px] px-3.5 text-md',
      icon: 'size-8 p-0 text-sm [&_svg]:size-[15px]',
    },
  },
  defaults: { variant: 'default', size: 'md' },
});

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'icon';

export function Button({
  variant,
  size,
  className,
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button type={type} className={buttonClasses({ variant, size, className })} {...props}>
      {ellipsize(children)}
    </button>
  );
}
