import { useId, useSyncExternalStore } from 'react';
import { Icon } from '../components/icons/index.js';
import { Button } from '../components/ui/index.js';
import type { ViewportGestureGate } from './viewport-gesture.js';

/**
 * The Space cards offer (#208, ADR-0077): a small panel at the top centre of the canvas while
 * every card of the loop sits in one spot. It floats over the canvas (absolutely placed in the
 * canvas root, which is `relative`), so it moves neither the toolbar nor the canvas when it comes
 * and goes. `nokey` keeps the canvas's Delete and Backspace and xyflow's Space-to-pan away from
 * its buttons, so a key pressed on them never removes the selected card or pans. Its DOM order is
 * its visual order: the text, then **Space cards**, then **Dismiss suggestion**.
 *
 * Its buttons sit outside the flow, but inside the page-wide capture path of d3-drag's click
 * blocker, so after a mouse pan the next click on them can be swallowed while they look available
 * (#207). They therefore follow the canvas's own viewport gate, the one that guards Reset route and
 * Remove connection (`viewport`, never a second one): from a pan's first move until its release has
 * settled they say they are unavailable (`aria-disabled` and `data-gesture`, not `disabled`, so
 * they keep their place, hit target and focus), and a press then does nothing and says nothing.
 * The offer is not hidden, so no press falls through to the canvas below it.
 */
export function SpaceCardsOffer({
  count,
  viewport,
  onSpace,
  onDismiss,
}: {
  count: number;
  /** The canvas's gate: only `ready` lets the buttons act. */
  viewport: Pick<ViewportGestureGate, 'state' | 'subscribe'>;
  onSpace: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const helpId = useId();
  const gesture = useSyncExternalStore(viewport.subscribe, viewport.state);
  const settling = gesture === 'ready' ? undefined : gesture;
  // A press acts only when the buttons are shown available and the gate agrees right now.
  const guarded = (act: () => void) => () => {
    if (settling || viewport.state() !== 'ready') return;
    act();
  };
  return (
    <div className="nokey pointer-events-none absolute inset-x-0 top-3 z-[5] flex justify-center px-4">
      <section
        aria-labelledby={titleId}
        data-testid="space-cards-offer"
        className="pointer-events-auto grid max-w-md min-w-0 gap-2 rounded-lg border border-default bg-surface-raised px-4 py-3 text-sm text-default shadow-2"
      >
        <p id={titleId} className="font-semibold">
          {count} cards are stacked in one spot
        </p>
        <p id={helpId} className="text-xs text-muted">
          Space cards puts them in columns that follow the connections. Only card positions change;
          Undo puts them back.
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-describedby={helpId}
            aria-disabled={settling ? true : undefined}
            data-gesture={settling}
            onClick={guarded(onSpace)}
          >
            Space cards
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss suggestion"
            aria-disabled={settling ? true : undefined}
            data-gesture={settling}
            onClick={guarded(onDismiss)}
          >
            <Icon name="close" />
          </Button>
        </div>
      </section>
    </div>
  );
}
