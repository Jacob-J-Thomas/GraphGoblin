Follow-up from [PR #553](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553), [the retained CI diagnosis](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553#issuecomment-7067769486) and [bounded local diagnostics](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/553#issuecomment-7067985393). Parked outside the approved 26-issue five-intent batch; no implementation is dispatched.

## Observed failure

Ordinary CI run [44934348117 attempt1](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44934348117), head `29e165e14fdda138300ba2a34585ddd47268b475`, target `a60843a9050b3a203726db84f6abf1f45b8bc694`, tree `d50fb576f1ef4498cb30e52521198575d6d0ebd4`, failed the cross-tab voice-upload/update case at `apps/web/e2e/pwa.spec.ts:536` on Linux Edge158.0.4370.33 / Playwright1.63.0.

The first dirty-tab veto and unchanged document/worker assertions passed. After the dirty tab closed, shared leases fell from two to one. The second Update click completed, but the page did not reload. Its toast changed from Checking to “The update could not be verified” about15 seconds later. The test's60-second timeout then disposed the request fixture; the finally `/worker/reset` request failed afterward and masked the first body error. The captured trace lacks the worker/MessagePort transaction stages needed to locate the cause.

Impact: the intended safe update retry can fail its acceptance assertion after the dirty document closes, and cleanup masks the useful failure location. There is no evidence of unsafe activation or lost voice data. Calling the event flaky, a reset-handler hang, or an introduced #486 defect would exceed the evidence.

## Evidence limits

The entire web source tree and relevant lock/config/workflow inputs match main a608 exactly. This excludes a direct web-source edit in #486, not indirect runtime effects or a pre-existing browser/product problem. One instrumented exact-case diagnostic on Windows using the same Edge version passed. A second bounded invocation ran the three preceding PWA cases and the target: a separate offline-banner assertion failed first, Playwright restarted its worker, and the target passed. Thus neither local pass reproduces the original Linux failure, and the second is not a successful same-worker predecessor comparison.

Both local target records captured the expected dirty veto, lease release, second APPLY, exclusive lock, COMMIT, activation/controller transition and one reload. They establish those two observed successes only. The original CI remains failed; no timeout/oracle/retry relaxation or speculative product repair was made.

## Bounded outcome and acceptance

- Establish the failed protocol stage with source-bound evidence on the relevant browser/platform. Preserve the first body error separately from cleanup errors and distinguish an isolated case from a same-worker sequence.
- Capture attempt-correlated APPLY/reply, client preparation/acknowledgement, held and pending locks, exclusive grant, COMMIT/ABORT, activation and controller/reload transitions without recording audio, messages, credentials or owner data.
- Determine whether a production defect, browser limitation, test setup problem or observation gap is responsible. A passing retry alone is not a diagnosis. Document any remaining uncertainty rather than inventing a cause.
- If a correction is warranted, preserve the dirty-tab veto, no automatic activation, one deliberate update/reload, closed/new/unknown-client safety and existing fail-closed behavior. Add evidence appropriate to the established cause and keep ordinary CI's zero retries and unchanged acceptance oracle.
- Preserve the failed attempt and later results separately. No hidden assertion deletion, broad timeout increase, test quarantine or waived browser gate.

## Scope and duplicate check

The #486 change concerns authored engine diagnostics; its web tree is unchanged. This follow-up records an unresolved browser update observation rather than expanding that PR speculatively. #486 still requires fully passing final-head/current-target CI, native evidence and final independent review before merge.

Searches on November21 covered open and closed issues for PWA update, worker/reset, unresolved voice upload, update verification and cleanup/test. Related closed #56 covers update discovery and prompt timing; closed #55/#47 cover connectivity recovery. None records this observed dirty-veto/close/second-APPLY timeout and masked failure. Reuse this issue if the same observation recurs; do not create one issue per failed assertion or retry.

Retained original diagnosis seal: `430913442d6b5b3725e6e4c2d39bd6071c0cd7d6a9dbb8cc3d0af4d31fdda2fb` (87 members). Bounded reproduction seal: `20d5be8f684906bf94e783a3cc2ce0b05f54de0a12160a185109384f4cbed1f8` (67 members). Local originals remain under `G:/ggq/delivery-evidence/2026-11-17-five-intents/`; public comments retain the complete reports and their limitations.
