# ADR-0078 — Stationary history controls and a one-owner connection banner

Status: Accepted for the stationarity half of #208 (source implemented; independent native checks, review and owner acceptance are separate). The number is provisional and may move when this lands beside other pending work.

## Context

The owner's #208 asks that Undo and Redo not move while they are used. A native baseline in Edge, headless, at a 16 px root font (desktop, narrow, a 512 by 384 window at 200% reflow, and a coarse pointer) reproduced four causes in the editor's source at `64a95588`:

- **Content width.** Undo and Redo were first in a right-aligned, wrapping group, ahead of controls whose width changes. The validation indicator ("Checking…", "Ready to publish", "N errors") and the Publish label ("Publish", "Publishing…") moved both buttons horizontally by 36.5, 32.7 and 29.8 px. At 512 px the group hit its maximum width and wrapped inside itself (+110 px, header 150 to 194 px).
- **Line wrap.** With a long loop name near a wrap boundary, every label change flipped the whole toolbar between one and two rows (the buttons moved 32 px vertically, four to six times in a three-action sequence).
- **Press movement.** The shared ghost button translates 1 px down while pressed. A press held 250 ms on the top pixel row of an enabled Undo lost the click (`mouseup` landed on the header, no history change).
- **The shell banner.** The offline and API-unreachable banner is drawn by the app shell above the routed screen, so it moved the whole editor, buttons included, down by its height (36.5 px at 1440 wide, 60 px at 768, 79.5 px at 512). It appeared for browser offline and for failed transport with the browser online; an HTTP 500 never showed it.

## Decision

- **A fixed leading slot.** Undo and Redo are the first children of the editor's toolbar, in a non-shrinking, top-aligned slot (`data-testid="history-actions"`; 36 px high, 44 px under a coarse pointer, so the 32 and 44 px buttons sit where the first row's other controls are centred). The rest of the toolbar (breadcrumb, name, badges, save status, Open in Runs, the validation indicator and Publish) is a sibling that is free to wrap beside it. The order is real DOM order, not CSS reordering, so the Tab order agrees with the screen: Undo and Redo are now the first stops of the bar, ahead of the Loops link. Names, tooltips, `aria-keyshortcuts`, `aria-disabled` (not `disabled`), `data-history`, the shortcuts and the history semantics are unchanged.
- **No press movement on these two buttons.** They override the ghost style's `active:translate-y-px` with an `!important` `translate: none`, so no order or specificity of the shared style can win, and show the press as a strong border on an enabled button instead. The shared button styles are untouched.
- **One banner, one owner.** The banner keeps its text, its offline versus API-unreachable distinction, its reconnect grace and its source, `useConnectionStatus`. A loaded editor claims it for as long as it is mounted (`components/layout/connection-banner.ts`: a set of claims, one object each, so overlapping claims and repeated releases cannot miscount) and draws `OfflineBanner` directly under its own toolbar. The shell's `Layout` hides its copy while a claim is held. Everything else keeps the shell's banner: the loading state, the error states, the blocked states (unsupported or unpreserved device drafts, no definition), the voice-staging state (its frame is `inert`, which hides content from assistive technology, so the editor gives the claim back) and every other route. The claim is held by a small component that the loaded frame renders, so it exists exactly while that component is mounted and ends with it, whether by navigation, an error boundary's replacement of a failed screen, or React's strict-mode effect replay; `EditorPage` gains no hook before its early returns. A layout effect makes the claim before paint so the shell and the editor are never drawn together.
- **Unchanged.** Connectivity detection and its grace, retry and probing, HTTP error classification, and the API key panel, shutdown and storage notices (they stay in the shell above the editor, where they have always been).

### Rejected

- **Reserving room.** A fixed-width validation or Publish slot, or an always-present banner strip, hard-codes widths that change with fonts, text size and wording, and spends space on every screen.
- **Overlaying the banner** (fixed or sticky above the toolbar) hides controls and the save status it should sit beside.
- **Reordering with CSS** (`order`, `flex-direction`, grid areas) puts the visual and focus orders at odds.
- **Changing the shared ghost button.** Other ghost buttons keep their ledge press; only the two history buttons are required to stay still.

## Consequences

- The banner moves once when a loaded editor is entered or left, and when voice staging begins or ends. That is a transfer between two owners, not movement during a loaded history session.
- Inside a loaded editor the canvas gives up the banner's height (36 to 80 px at the measured widths) instead of the document growing taller than the window. On a very short window that leaves the canvas less room; the editor's existing minimum height is unchanged.
- The breadcrumb starts after the history slot (about 84 px, 108 px under a coarse pointer), so the name has that much less room before it truncates.
- Geometry, hit testing and announcement are not proved by the component tests that cover this; independent native checks at the sizes above, a coarse pointer and 200% reflow remain, as do the baseline's own limits (one engine, root font 16 px, no real text-size enlargement, unresolved touch hold).
