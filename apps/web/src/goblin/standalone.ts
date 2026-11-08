import { useState } from 'react';

/** iOS exposes navigator.standalone; other browsers expose the display-mode media query. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    Reflect.get(navigator, 'standalone') === true
  );
}

/** Installation context is fixed for this window; do not transfer pairing on a mode change. */
export function useStandalone(): boolean {
  const [installed] = useState(isStandalone);
  return installed;
}
