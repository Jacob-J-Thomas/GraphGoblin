import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Expand a schema-driven form's Advanced disclosure (the one inside `container`, else the only one
 * on the page), as a click on it would, and return its toggle. An open one is left open.
 */
export function openAdvanced(container?: HTMLElement): HTMLElement {
  const scope = container ? within(container) : screen;
  const toggle = scope.getByRole('button', { name: /^Advanced\b/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return toggle;
}
