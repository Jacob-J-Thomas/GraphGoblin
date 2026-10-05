/**
 * The app's stroke icons: original 24 px glyphs drawn for the approved visual direction
 * (docs/design/visual-direction/sample.html). They draw in `currentColor`, so a parent's text
 * colour token colours them, and they are decorative (`aria-hidden`): the control or text beside an
 * icon carries the accessible name.
 */
import type { ReactNode, SVGProps } from 'react';
import { cn } from '../../lib/utils.js';

const GLYPHS = {
  // Node kinds
  trigger: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />,
  decision: (
    <>
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12Z" />
      <path d="M12 8.5v4l2.5 2" />
    </>
  ),
  inference: (
    <>
      <path d="M10.5 3.5c.7 4.6 3 6.9 7.5 7.5-4.5.6-6.8 2.9-7.5 7.5-.7-4.6-3-6.9-7.5-7.5 4.5-.6 6.8-2.9 7.5-7.5Z" />
      <path d="M19 3v4M17 5h4" />
    </>
  ),
  script: <path d="m5 7.5 4.5 4.5L5 16.5M12.5 17H19" />,
  mutate: (
    <>
      <path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  subloop: (
    <>
      <rect x="8" y="8" width="12.5" height="12.5" rx="3" />
      <path d="M16 8V6.5a3 3 0 0 0-3-3H6.5a3 3 0 0 0-3 3V13a3 3 0 0 0 3 3H8" />
    </>
  ),
  wait: <path d="M6 3h12M6 21h12M7.5 3v2.5a4.5 4.5 0 0 0 9 0V3M7.5 21v-2.5a4.5 4.5 0 0 1 9 0V21" />,
  heartbeat: <path d="M2.5 12.5h4l2.5-6 4.5 11 2.5-5h5.5" />,
  exit: <path d="M5.5 21V3.5M5.5 4h12.5l-2.5 4.5L18 13H5.5" />,
  // Run status (waiting reuses the wait hourglass)
  queued: (
    <>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  running: <path d="M7.5 5v14l11-7Z" fill="currentColor" />,
  paused: <path d="M9 5.5v13M15 5.5v13" />,
  succeeded: <path d="m4.5 12.5 5 5L19.5 7" />,
  failed: <path d="M6 6l12 12M18 6 6 18" />,
  cancelled: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  exhausted: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20.5 3.5v4h-4" />
    </>
  ),
  // Interface
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 10v4M12 17.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  offline: (
    <path d="M2.5 8.5a15 15 0 0 1 5-3M21.5 8.5A15 15 0 0 0 11 4.6M5.5 12a10 10 0 0 1 3.4-2.3M18.5 12a10 10 0 0 0-2.7-2M9 15.5a5 5 0 0 1 6 0M12 19.5h.01M3 3l18 18" />
  ),
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5Z" />,
  export: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  edit: <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" />,
  upload: <path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  // A window with a side panel on the right: show or hide a side panel.
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  // An arrow leaving to another screen: links that open somewhere else in the app.
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  loop: (
    <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 3.5v5h-5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20.5v-5h5" />
  ),
  // A hooked arrow back (undo) and its mirror image (redo).
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { name: IconName };

/** One stroke icon, 16 px by default; size and colour come from the classes passed in. */
export function Icon({ name, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      {GLYPHS[name]}
    </svg>
  );
}
