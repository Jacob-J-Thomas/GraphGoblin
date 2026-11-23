I've made the test query fix and the docs/CHANGELOG rewording, in only the three authorized files. Nothing has been run: no tests, typecheck, lint or formatter, and no Git. None of the remaining gates (QA cases, browser, CI, review, merge) has passed on the strength of reading the source.

## 1. `apps/web/src/runs/RunInspectorPage.offline.test.tsx`
At lines 711–715, in the `'fails in transport'` branch of the failing test, the plural-prone text lookup:
```ts
expect(
  await within(header).findByText('The GraphGoblin API cannot be reached.'),
).toBeVisible();
```
is now a role lookup followed by a visibility check and an exact, anchored text check:
```ts
const outcome = await within(header).findByRole('alert');
expect(outcome).toBeVisible();
expect(outcome).toHaveTextContent(/^The GraphGoblin API cannot be reached\.$/);
```
- Nothing else changed: the header lookup, the re-enable `waitFor`, both single-POST assertions, the `'succeeds'` branch, the test name, schedule and timeouts are all as before.
- I named the variable `outcome` rather than `alert` so it doesn't shadow the browser's global `alert`.

**The source supports your diagnosis:**
- `ScriptRecovery.tsx` line 89 shows the error with `role="alert"` once the review is closed.
- Line 153 repeats the same message with no role, inside the native `<dialog>`, which stays in the DOM while closed. That is the second match.
- The only other alerts that could sit in the header are in `RunControls.tsx` (lines 177 and 262), and they appear only when its own action fails, which this test never triggers.
- So exactly one alert should match. I took the "it's a paragraph" detail from your DOM evidence, not by reading `HelpText`, which isn't on the allowed read list.

## 2. `docs/09-frontend-and-pwa.md` (outage section)
- **Script recovery:** its hold is described alone now, in the same terms as before.
- **Sent delete-ready confirmation:** it keeps the launchers disabled while its review is open or has been closed by an outage. An outage or reconnect doesn't release that.
- **The one exception:** if the browser has already dismissed the review (repeated Esc), the confirmation is still pending but a new review may open and fetch a new preview. That review can't be confirmed while the first is pending. Once the first settles, confirming it is a separate, explicit choice.
- **Outcome:** the first confirmation's outcome appears beside the controls, never in the newer review. A newer review opened before it settles neither discards that outcome nor is closed by it. The outcome is the success message, "may or may not have been saved" when the API couldn't be reached, or "**Not saved: …**" with the reason otherwise. This matches `HistoryEligibility.tsx` lines 40, 78–94 and 138.
- **Runs list sentence:** it now says the list shares the hold, its exception after a browser dismissal, and the report beside the controls.

## 3. `CHANGELOG.md` (#416 entry)
I replaced the sentence claiming a universal hold "including for a delete-ready review the browser dismissed". It now says:
- A sent script recovery still blocks replacement reviews.
- A delete-ready confirmation holds while its review is open or closed by an outage, and an outage or reconnect doesn't release it.
- Only after the browser dismisses the review may a new review open and fetch a preview, and it can't be confirmed until the first settles.
- The first outcome is reported beside the controls, not in the newer review; a lost connection reads "may or may not have been saved".

The existing wording on wrong-run, schema-invalid and later transport errors is unchanged in both documents.

## Concerns (not changed, all out of scope)
- **Docs09, line ~180:** it still says a confirmation whose review expired in flight reports "may or may not have been saved". That is only true for a lost connection; if the API answers with an HTTP refusal after the review expired, the code shows "Not saved: …".
- **`HistoryEligibility.tsx` lines 38–39:** the code comment "no replacement review opens over it" still reads as universal. It's production code, so I didn't touch it.
- **Dismissal case:** while the first confirmation is pending, the newer review's Confirm button reads "Saving…", even though it's the first confirmation that is saving. This is existing behaviour.