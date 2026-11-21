# CI Browser failure diagnosis — static evidence only

**The body stalled waiting for the main page to reload after the second Update click. The reported `/worker/reset` failure is a later cleanup error that obscures that body failure. The underlying worker/protocol stall is not uniquely determined by the retained trace.** Run **44934348117** remains failed; no retry, waiver, new product execution or passing-CI claim is made.

## Binding and scope

- Integrated commit: `29e165e14fdda138300ba2a34585ddd47268b475`, tree `d50fb576f1ef4498cb30e52521198575d6d0ebd4`.
- Target main: `a60843a9050b3a203726db84f6abf1f45b8bc694`.
- Artifact `14720031919`: 51,023,578 bytes, SHA256 `31b7a2e7ff0bbf766e49a95d19b85dedcd22a2be701be941cbb8aeb2e16a9853`. The selected trace matches its exact archive member: 2,431,130 bytes, SHA256 `33dfb5961c62033259474fe4bedaf4c7cd1a0407485b544afa530f1320cf7bb8`.
- Selected trace extraction rejected absolute paths, traversal, drive/backslash paths, symlinks and oversized members, and resolved every destination inside this new packet. Original packets were read only. `extraction.json` records all extracted member hashes.
- This work read retained CI evidence and immutable Git objects only: **0 browser launches, 0 tests, 0 builds/installs, 0 provider calls, 0 CI reruns**. No source/index/owner-store changes. Delivery checkout readback remained clean at the bound commit.

`input-provenance.json` hashes the retained inputs; `source-binding.json` binds source; `trace-timeline.json` retains selected exact trace times and results; `network-boundary.json` binds relevant captured HTTP bodies. `source-excerpts.json` contains bounded, numbered excerpts rather than wide documentation copies.

## What happened

The failing case is `apps/web/e2e/pwa.spec.ts:536`, “another tab’s unresolved voice upload vetoes update activation until that tab closes.” Browser logs report **487 passed, 1 skipped, 1 failed**. The retained job metadata has Browser failed and the other five jobs successful. Those successes do not make this CI run pass. Browser trace metadata identifies Linux, Playwright 1.63.0 and channel `msedge`; the project label is `chromium`. The configured test timeout is 60,000 ms, one worker and zero retries.

Times below are retained Playwright monotonic milliseconds, primarily runner-side test steps. Browser-side action completion bookkeeping differs by tens of milliseconds.

| Observation | Exact evidence |
| --- | --- |
| Guarded worker build succeeds before either click | `/worker/build` HTTP 200 at `1090124.240`; response `{build:5,mode:guarded}`. Active and waiting capability assertions pass. Captured helper bytes exactly match the bound production `public/chat-update-worker.js`. |
| First dirty-tab veto works | Two shared leases are observed. First click `1090586.599–1090724.304`; dirty warning visible, Update enabled and exactly one guarded APPLY assertion pass. |
| Veto preserves the page and worker | After the 2,100 ms wait, active worker, waiting worker, controller and document identity compare unchanged; navigation count zero and two shared leases pass. |
| Dirty tab really closes and releases its lease | Close `1093221.267–1093225.678`; following poll completes `1093301.726`, with captured browser evaluation returning one shared lease. |
| Second Update click completes | Navigation listener starts `1093302.169` before second click `1093303.000–1093440.221`. Browser action log records physical click done at `1093410.688`. No main-frame navigation arrives. |
| UI waits, then reports verification failure | Retained frame `1093607.814` shows **Checking…**. Last frame `1108433.655` shows the still-visible toast, unknown-verification reason and enabled **Update**. This is `15022.967` ms after physical click completion. Final error-context also contains that reason. Both frames were inspected statically with `view_image`. |
| Global timeout starts teardown | After Hooks begins `1146997.502` (about 60,010 ms after Before Hooks). Request fixture disposes `1146997.845–1147007.112`; context close starts `1147724.314`. |
| Body wait fails before cleanup POST | `pw:api@86` rejects `1147733.396`: `page.waitForEvent: Test timeout of 60000ms exceeded`, stack at spec `616:27`. Execution was awaiting that promise at line 618. |
| Finally masks the body error | `/worker/reset` POST starts `1147734.026`, after request fixture disposal, and rejects `1147734.478` with closed APIRequestContext, stack `fixtures.ts:112`, spec `626:11`. No reset HTTP entry exists in the retained network stream. |

The assertions after `await reloaded` at lines 619–623 **were not executed**: visible Loops, hidden toast, active guarded-worker capability, two APPLY messages and exactly one navigation. In particular, successful second-click dispatch does not establish that its APPLY reached the worker. The observer’s second-message assertion was never reached.

The reset implementation (`e2e/server.ts:348–350`) only restores original worker bytes with `writeFile`. This trace provides no evidence that its handler hung; the POST failed in the already-disposed test request context before any captured dispatch. Increasing the reset timeout alone would not explain or repair the earlier missing reload.

## Causal boundary and remaining hypotheses

**Proved:** dirty-veto preservation and lease release passed, then the second click failed to produce a main-frame reload within the remaining test budget. The page ended in an explicit failed-verification state. This is a failed expected behavior, not merely a cleanup-only failure.

**Strongly consistent with the evidence, not proved:** the second APPLY remained unanswered to the page until `chat-update-guard.ts:205–209` resolved its 15,000 ms timeout with the exact unknown-verification reason. The visible Checking-to-unknown transition aligns within about 23 ms. That reason can also be returned by the worker, so text and timing alone do not prove which timer/result path ran.

The missing causal observations are the second APPLY/port reply, worker-side client enumeration, safe acknowledgements, held **and pending** locks after that click, exclusive-lock grant, COMMIT delivery, `skipWaiting()`/activation resolution, and page controller transitions. The retained browser trace has only page/pageClosed events, not this protocol stream. Consequently:

- A stalled/lost worker transaction or response is plausible. The worker has waits for active capability, preparation, exclusive lock and activation (`public/chat-update-worker.js:19–50,99–200`). In the exclusive callback it clears the 2-second queue timer before later client/activation work; activation awaits worker state. This identifies places to observe, **not a proven defective line**.
- A later controller/reload problem remains possible if an accepted result or COMMIT occurred but was not retained. A simple accepted-result-only reload failure is less consistent with the final visible failure toast, because accepted apply normally clears it (`store.ts:43–47`). No lifecycle event stream is available to settle this.
- The lease count of one proves the dirty tab’s observed shared lease disappeared. It does not prove every enumerated client, pending request or transaction was gone, or that the next exclusive lock completed.
- An immediate local dirty refusal is not what the final warning says. Stale worker `applying`, closed-client preparation races, activation waits and runner scheduling cannot be selected or eliminated solely from this trace. Generic host load or “flakiness” is **not established**.

Nearby cases at lines 213 and 398 passed before this case, and the legacy-worker case at line 630 passed afterward. They bound the failure to this observed attempt; they neither waive it nor prove the dirty-veto/retry transaction reliable.

## Introducedness

The **entire `apps/web` Git tree** is the same object at integrated 29e and target main a608: `b069d670c6b6ab816ed3b03169bba62d96070b89`. Nineteen selected file blob/mode pairs also match exactly, including the failing spec, helpers, fixtures, E2E server, production worker/page guard/registration/toast/store/lock, Vite and Playwright configs, root package/lockfile, CI workflow and the three relevant unit-test files. No diff exists between these commits under `apps/web`, `pnpm-lock.yaml`, `package.json` or `.github/workflows`.

The trace’s three source attachments exactly match the Git bytes for spec/helpers/fixtures. All three captured `chat-update-worker.js` responses match the production source Git bytes. The captured generated waiting worker imports that helper and carries `E2E build 5`; its raw bytes remain in the sealed extraction.

At a608, the latest changes to the production helper and failing spec are respectively `d1fd65e592e17a2c9b1b573382200afc0a5c936d` and `091447275592375903933980502b35274bf40578` (both November 8). Thus **#486 integration did not introduce changes to these web inputs**. This is not an executed a608 baseline and does not exclude an indirect backend/timing/environment effect of other integrated changes. Test presence is not treated as execution or as proof of correctness.

## Bounded next diagnostic design — not executed

The protocol stage cannot be identified uniquely from retained evidence. If further diagnosis is authorized, use one disposable, source-bound reproduction of this exact case with the same browser channel and zero automatic retries. Preserve the current semantic oracle: first dirty veto, unchanged document/worker, lease 2→1 after close, second guarded APPLY and one reload. Do not relax it or lengthen timeouts as a substitute for evidence.

Capture monotonic attempt-correlated page/worker protocol events (APPLY receipt/reply; PREPARE/safe ack; ABORT/COMMIT), worker state/controller changes, scoped client IDs and URLs, held/pending lock snapshots, exclusive grant, and `skipWaiting`/activation start and completion. Preserve the **first** body error before best-effort cleanup, whose own error must be recorded separately. Record exact build/browser/runtime identity and close only task-owned resources. If the isolated case passes without reproducing the boundary, a second bounded diagnostic may include its three immediately preceding PWA cases, with the same observations; that pass still does not erase this failed run or establish a passing normal CI gate. No broader test sweep is needed to answer this narrow causal question.

## Limits and disposition

This packet establishes the first failed wait, cleanup masking, UI outcome and exact source introducedness boundary. **Root cause remains unresolved; Browser acceptance remains failed.** Original CI/QA packets were untouched. No production correction is proposed or applied. Static inspection corrections (UTF-8 decoding, a screencast path and Windows wildcard syntax) affected only evidence reading; no product attempts occurred.

`SHA256SUMS.json` seals every packet member except itself. Its digest is supplied in the handoff.
