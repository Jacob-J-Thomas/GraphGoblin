I've made the D242 correction in the eight allowed files. Nothing has been run: no tests, typecheck, lint, Prettier or browser. Line widths were checked by hand against a 100-column Prettier layout, so formatting may still need fixing.

## What changed
- **`inspector/ScriptRecovery.tsx`**: new `useScriptRetry({ owner, availability })` hook. RunInspectorPage calls it unconditionally, so it is no longer inside the run section that gets withheld. It holds the TanStack mutation and tags each retry with the visit that sent it, so it reports pending, failure and success only to that visit. The `ScriptRecovery` component now takes `{ run, retry }` and keeps only the review dialog. The old `availability` prop is removed, with no fallback.
- **`HistoryEligibility.tsx`**: new `useHistoryConfirmation({ owner, availability, onConfirmed })` hook. It holds the confirmation in flight, the browser-dismissal "released" flag, and the settled result. The new `HistoryEligibilityControls` view keeps the review, preview, preview error and late-preview check. `HistoryEligibility({ runIds, onConfirmed })` keeps the Runs list's exact contract by combining the hook and the view.
- **`RunInspectorPage.tsx`**: calls both hooks next to `useSessionRecovery` with `owner: visit` and the page's write gate, and passes them to the views in the section.
- **`docs/09-frontend-and-pwa.md`** (#416 section) and **`CHANGELOG.md`** (the unreleased #416 entry): describe action lifetime through withholding, where outcomes are reported, and that a transport failure is never shown as a server refusal.

All the write guards are unchanged: the gate identity and `open()` check before sending, `assertOpen` inside the mutation, the frozen script run/node/observed sequence with explicit retry consent, the frozen deletion IDs/action/token, and one command at a time per visit. Invalidations and the shown-visit check on replay navigation are the same.

## Design critique
- **Reviews stay in the section on purpose.** If the hooks owned the dialogs, a review could come back after a withholding that didn't replace the gate (a refused read, or a data reset when the key is forgotten). That would widen the parked #562 credential problem, so only the pending action and its outcome moved to the page.
- **Deletion is still a plain async call, not a TanStack mutation.** A mutation would pause while the browser is offline and resume by itself afterwards, which in the Runs list would replay a confirmation automatically. It would also pick up any global mutation handlers I couldn't inspect.
- **Behaviour differences I chose:**
  - Where a deletion failure is shown is now decided when the page renders, not when the request settles. A failure shown in its review moves beside the controls if an outage or withholding then closes that review; before, it was simply lost. Cancelling the review still dismisses the failure.
  - A successful confirmation now stops counting as pending when the POST returns. The old flag also covered the `['runs']` refresh that follows.
- **Weak points:**
  - Ownership relies on `useMemo` keeping the `visit` object stable, which is the same assumption session recovery already makes.
  - Returning to a run (A → B → A) is a new visit, so it can send a second command while the first is unresolved. That is consistent with "not a global operation ledger".
  - The page's deletion hook keeps only the latest confirmation, so a late outcome from an earlier visit is dropped.
  - The pending checks still read React state at click time, as before; I added no synchronous guard.

## Regression intent
- **`RunInspectorPage.offline.test.tsx`**, each for both a transport failure and a success, on the real app with the real query client:
  - Script: send Resume and hold it, take the browser offline and back, and let a fresh matching run read commit. A storage event from another tab then swaps the API key with the run read held: the original header and control are gone and the row is withheld. Release the read with the same run. The new control is a different element and stays disabled, clicking it does nothing, and only one POST exists. After settlement the new header shows the failure (or, on success, the control disappears), and only then does a new deliberate choice send a second POST.
  - Deletion: the same sequence and checks, including that no new preview is read while the first confirmation is pending.
  - Different run: for both actions, opening another run while the first is pending leaves its controls enabled, the first run's late failure doesn't appear there, and its own action sends once.
- **`HistoryEligibility.test.tsx`**: the existing harness now uses the hook and view, with a withhold toggle. Two new tests cover a pending hold surviving withholding, and a browser dismissal surviving withholding, where the newer review can't be confirmed and the first outcome appears beside it. The existing explicit-dismissal tests are unchanged.
- **`ScriptRecovery.test.tsx`**: one new hook/view harness test covering withholding, the disabled replacement control, and the outcome after settlement.

These tests were not run against this branch or the shipping code. The expectation that they would fail on shipping code is inferred from reading the old source.

## Source-only limits and open concerns
- I couldn't search for other users of the removed `availability` props on `ScriptRecovery` and `HistoryEligibility`; anything found there would be a type error.
- `lib/utils` (`errorMessage`, `isOfflineError`) and the app's bootstrap setup were outside my read list. I used them exactly as the existing code did.
- Two small guard branches (`reset` while pending, `release` while not pending) aren't reached by any test.
- #561, #562 and #563 are untouched.