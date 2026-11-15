import { useId, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react';
import { Icon } from '../components/icons/index.js';
import { Button } from '../components/ui/index.js';
import type { ViewportGestureGate } from './viewport-gesture.js';

/** The offer panel's measured size in CSS pixels, which its result then keeps. */
export interface OfferBox {
  readonly width: number;
  readonly height: number;
}

// The offer and its result share one wrapper and one box, so the result covers what the offer did.
const WRAPPER = 'nokey pointer-events-none absolute inset-x-0 top-3 z-[5] flex justify-center px-4';
const BOX =
  'pointer-events-auto grid max-w-md min-w-0 gap-2 rounded-lg border border-default bg-surface-raised px-4 py-3 text-sm text-default shadow-2';

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
 *
 * A press that acts reports the panel's box when it is a pointer's click (`detail` of 1 or more),
 * measured before the action, so the canvas can show `SpaceCardsResult` in it. A keyboard press
 * (`detail` 0) reports none and the panel leaves at once.
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
  onSpace: (box: OfferBox | undefined) => void;
  onDismiss: (box: OfferBox | undefined) => void;
}) {
  const titleId = useId();
  const helpId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const gesture = useSyncExternalStore(viewport.subscribe, viewport.state);
  const settling = gesture === 'ready' ? undefined : gesture;
  // A press acts only when the buttons are shown available and the gate agrees right now.
  const guarded = (act: (box: OfferBox | undefined) => void) => (event: MouseEvent) => {
    if (settling || viewport.state() !== 'ready') return;
    const box = event.detail > 0 ? sectionRef.current?.getBoundingClientRect() : undefined;
    act(box && { width: box.width, height: box.height });
  };
  return (
    <div className={WRAPPER}>
      <section
        ref={sectionRef}
        aria-labelledby={titleId}
        data-testid="space-cards-offer"
        className={BOX}
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

/**
 * What a pointer press on the offer leaves behind (#208): a plain, visible line in the offer's own
 * wrapper and box (`box`, measured before it acted), in the same commit that removes the offer.
 * The press that follows a double click, a tap pair or a mouse run would otherwise land on whatever
 * the offer covered (at 512 px, Zoom Out), whatever the browser numbers that press. Here it lands on
 * this box, which does nothing: no control, no focus, no selectable text, no live region (the
 * canvas's own polite announcement already said the result), no handler, and no event is prevented,
 * stopped, delayed or replayed.
 *
 * It ends at the next `pointerdown` anywhere outside it, heard in the document's capture phase on a
 * passive listener that exists only while it shows, so that press goes on untouched to what it hit.
 * It also ends when the canvas drops it (the offer is back, or a new load) and when the canvas
 * unmounts. The cost is plain: the area the offer covered stays covered, and the cards the fit
 * places there stay hidden, until the next press elsewhere. A resize or a layout change while it
 * shows re-centres or shrinks it, and nothing here protects what is then under its old place.
 */
export function SpaceCardsResult({
  message,
  box,
  onEnd,
}: {
  message: string;
  box: OfferBox;
  /** Called at a `pointerdown` outside the result. */
  onEnd: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // A layout effect adds the listener in the commit that shows the result, before any press.
  useLayoutEffect(() => {
    const press = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onEnd();
    };
    document.addEventListener('pointerdown', press, { capture: true, passive: true });
    return () => document.removeEventListener('pointerdown', press, { capture: true });
  }, [onEnd]);
  return (
    <div className={WRAPPER}>
      <section
        ref={ref}
        data-testid="space-cards-result"
        style={{ width: box.width, height: box.height }}
        className={`${BOX} content-start overflow-hidden select-none`}
      >
        <p className="font-semibold">{message}</p>
      </section>
    </div>
  );
}
