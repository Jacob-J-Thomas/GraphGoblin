# PR #514 Chat finalization focus diagnosis

**A pre-existing asynchronous test synchronization defect is demonstrated. No product focus defect was established in this bounded diagnosis.** The original assertion waits for the alert to appear, then immediately expects its retry button to own focus. The component deliberately moves focus in a passive effect. Those are separate observable events.

Exact target: `10cdc55a8573e484ceb07a32fba9fe9f513a005f`. Published candidate: `c07ba2904821964829755d79e152955188295880`. Chat, shared UI, fixtures/setup, Vitest configuration, tooling and lockfile have no changes between them. All ten complete captured input files have identical Git blobs and SHA-256 values. Both complete original ChatSurface files pass 57/57 locally with the normal scheduler and the original assertion/deadlines.

The hosted failure in run `44454474852` is retained externally with SHA-256 `d84bf9a77376b0de3f965e1f077338ec8ce8880c487a16b5f5552168ad748a96`: the alert/retry exists but `textarea#chat-message` still owns focus at line 651. The coordinator also retained passing 57-case hosted controls for the exact current target and earlier main. These controls do not establish the failed run's internal ordering.

## Actual discriminators

| Case | Observed result |
| --- | --- |
| Default wrapper, instrumented original focus case | Existing effect runs with the real retry button present and native focus succeeds before the original assertion. No later textarea focus call is observed. |
| Controlled wrapper, original assertion | Preserve RTL's act-environment toggle; omit only its incidental zero-timeout task drain around the final query. Error commit and alert/retry appearance occur while textarea owns focus; the original assertion fails; the existing passive effect then runs and native focus succeeds. The original failure is rethrown after observing eventual focus. |
| Same controlled wrapper, proposed wait | The same captured retry button gains real focus and the bounded native focus assertion passes. |
| Default wrapper, proposed wait | The same captured retry button gains real focus and the assertion passes. |
| Default wrapper, suppress only error-focus transfer | The error effect runs and the button exists, but its focus transfer is deliberately suppressed. The same proposed assertion still fails after approximately 5 seconds, with the textarea focused. This prevents a missing focus transfer from becoming a false pass. |

This proves the appearance-before-focus ordering and the corrective assertion's discrimination. **The failed hosted run's exact callback ordering remains inferred**, because that original run has no effect trace. A scheduled ordering was changed in the controlled test; it is not presented as an unmodified hosted reproduction. The first exploratory wrapper also omitted RTL's act-environment toggle; its original records remain preserved and qualified. The corrected controls hold that toggle constant.

The configured test/hook deadlines remain 20,000 ms and Testing Library's existing async deadline remains 5,000 ms. There are no sleeps, increased timeouts, assertion removals, focus mocks that claim success, or product fixes in the proposed delta. Native focus observations delegate to the original HTMLElement implementation.

## Minimal corrective work

Capture the existing **Try again** button and await the repository's existing `waitFor(() => expect(retry).toHaveFocus())`. This keeps the same element and native focus matcher while waiting for the condition actually required. The test-only corrective commit `babba15fd5aa0444636607c6acbf3ead7ec98c47`, tree `98d3da3d511ee93c579421fde746aea52153088f`, is a sole child of the published candidate and contains exactly that delta. Its immutable diff is included as `minimal-test-delta.patch`.

The narrow correction belongs in an explicit test-only corrective commit on the current PR head. The shared target already contains the fragile assertion; no separate product prerequisite or editor modification is justified by this evidence. The coordinator reports its author checks passing; those are distinguished from the independent experiments recorded here.

## Semantics and limits

React documents that passive effects run after a commit and may run after the browser paints. Testing Library's `findBy` waits for an element to appear; `waitFor` supports retrying the required assertion. These contracts support waiting for focus itself. [React useEffect](https://react.dev/reference/react/useEffect), [Testing Library async methods](https://testing-library.com/docs/dom-testing-library/api-async/).

An alert's presence is not a focus guarantee. WAI-ARIA's alert pattern describes noninterrupting announcements; this application's deliberate recovery focus is separately tested here. [WAI-ARIA alert pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/).

The test spies `document.hidden=true` while `visibilityState` remains `visible` and jsdom reports document focus. Thus this is DOM element focus under the test environment, not a verified OS/window focus or real background-tab mode. No existing real-browser case exercises this finalization-recovery transition. Earlier editor protected-voice browser observations cover a different interaction. There was no real authentication, recording, provider use or owner data.

The original complete-file tests used normal threaded isolation/maxWorkers=2. Two additional normal full-web coverage workloads were started concurrently on disposable Windows checkouts; both encountered the same two unrelated EditorPage.rename timeouts. Named QA stopped only those owned workloads after retaining their logs. They are incomplete workload observations, not successful coverage gates or Chat cause evidence. An instrumented full-file run separately hit an unrelated R2 status-query race; that raw failure is preserved externally and not reclassified as the hosted failure.

`source-identity.json`, `source-excerpts.json`, `cases.json` and `traces.json` retain exact source/input identities, raw artifact hashes and sanitized native focus/effect chronology. Original complete logs and all first errors remain outside this bounded packet. Run `node verify-records.mjs` under Node 22.23.4 to recompute the selected facts without modifying the packet. No published PR/source edits, commits or issue writes were made by the independent QA agent; temporary instrumentation was restored exactly.
