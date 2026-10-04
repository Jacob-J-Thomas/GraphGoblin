import { Fragment, type ReactNode } from 'react';

/** Add children in order to `into`, nested arrays flattened, leaving out what React does not render. */
function flatten(children: ReactNode, into: ReactNode[]): void {
  if (Array.isArray(children)) {
    for (const child of children as ReactNode[]) flatten(child, into);
  } else if (children !== null && children !== undefined && typeof children !== 'boolean') {
    into.push(children);
  }
}

/**
 * Children for a one-line control (a badge or a button) that ends its text in an ellipsis when the
 * control is cut short at the width of its container, instead of spilling out of it. Each run of
 * plain text becomes one shrinkable span; elements such as icons pass through at full size. The
 * span clips sideways only, so descenders are never cut, and the whole text stays in the DOM and
 * the accessible name. A label that fits renders exactly as before.
 */
export function ellipsize(children: ReactNode): ReactNode[] {
  const parts: ReactNode[] = [];
  let text = '';
  const flush = () => {
    // Whitespace between elements is no flex item of its own, so it is dropped as CSS would.
    if (text.trim() !== '') {
      parts.push(
        <span key={`text-${parts.length}`} className="min-w-0 overflow-x-clip text-ellipsis">
          {text}
        </span>,
      );
    }
    text = '';
  };
  const flat: ReactNode[] = [];
  flatten(children, flat);
  for (const child of flat) {
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child);
    } else {
      flush();
      // The parts are rendered as a list, so each element gets a key by its position.
      parts.push(<Fragment key={`node-${parts.length}`}>{child}</Fragment>);
    }
  }
  flush();
  return parts;
}
