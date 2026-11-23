**Verdict: CONDITIONAL.** No product failure was found in candidate `633d9ac` (tree `d0e38c6c`). In the final attempts of the 02 continuation all 430 new checks passed, and original01's domain lane (D1: 36/36) is carried forward unchanged. It is CONDITIONAL rather than PASS because some controls from the architecture-03 verification matrix were not executed (listed below) and need root to accept them or cover them elsewhere. `BLOCKERS.md` lists no product blockers.

**What ran.** I re-checked identity first: commit/tree/parent, empty checkout status, the 52 frozen source files and all 1,189 built output files were unchanged, with no rebuild. The original binding step and D1 are labelled inherited and were not re-run. The new lanes drove a disposable built API through the existing `loadConfig` → `createContainer(overrides)` → `start` → `buildApp` → `listen` path, with API keys required. Behind it were real disk SQLite, real child scripts appending to counter files, a real loopback HTTP listener and real workspace files. The harness, decider, classifier and structured-completion ports were scripted, and their counters are reported separately from the native effects.

| Area | Result |
| --- | --- |
| All 26 boundaries (B01–B26) | Every one executed through the public API. Effect counts held: zero dispatch on bad args, before/after heartbeat counts, first context file kept with no later writes, file-return receipt only. Stored row, `run.failed` event and REST snapshot matched, and deterministic Resume was refused with no new events. |
| JSONata variants at a real engine site | Literal, grouped, conditional, nested, dynamic, assert, length, special characters, type error and `$eval` (malformed, unsafe regex, input-supplied) all get the neutral fixed copy; malformed/unsafe `$eval` never gets the compile/unsafe-regex reason. Only real depth and time limits get their own reasons, and no evaluator text was logged at the new sites. |
| B17 canonical rerender | The failure itself is only reachable through a QA-owned module-resolution seam (no product change); it gives the engine-owned internal error, resumable, with no harness start. The real canonical history trim succeeded through the public API. |
| Preserved contracts | P01, P02, B20 and B25 behave as before (B25's rejected signal added zero events and kept the same wait). A01–A03 (poll and event-trigger expression failures) kept their pre-run and request-side handling. |
| External lookalikes (genuine domain error, name spoof, code spoof) | Probe port, script runner, classifier, LLM decider, structured coerce and harness `start` all stay on their existing paths; none becomes an authored error. |
| Inference recovery | Exact retry survived a later resumable prep failure and a clean restart, with the same prompt and turn ID and no repeated retry object. The unusable-session guard fires before the model resolver. Session-missing with a temporarily disabled model reached the actionable failure after restore. Explicit fresh session works with and without a saved prompt. Stronger outcomes win over the after-result failure: cancel, node timeout and termination-unconfirmed cleanup. |
| Children | Same failure inline, at depth 1 and at depth 2. Child inference evidence stays in the child. Both resumable mapping-fault dedup controls passed: one child, one completion, one wake, child never resumed. |
| Surfaces and persistence | Unauthenticated or bad keys get 401; the read-only key gets 403 to start. Built MCP over stdio (`get_run`, `wait_for_run`, `list_runs`) matched REST. In the real browser inspector, alerts, Resume enable/disable and child links were correct; I looked at the screenshots. Row/event bytes were unchanged after new publications and reads, and across a clean shutdown and reopen. |

**Attempts.** Three drivers needed a second attempt, all for QA-side bugs. D2 needed a dummy classifier secret in the scratch store, D3 had a wrong usage key in my scripted harness, and D4 had an unconnected decision port and a broken fault re-arm. Every attempt is kept and the fixes are recorded as dated amendments in `PLAN.md`. No driver needed a third attempt.

**Not executed:**
- Harness `resume`/repair synchronous-throw lookalikes, the transport-retry path, pinned model refusal, and init-only inherited sessions without durable acceptance.
- Structured-completion timeout, artifact-write failure, final thread/serialization faults, and the coerce repair-prompt/target-write sites.
- Decision transient/≥500 mapping, run-deadline and forced-stop races, and the inference timeout before context admission.
- Workspace, context-file and secret port lookalikes: no existing override exists for those ports. Script-probe runner rejection was also not run.
- B13 `output.artifacts.where`, the Liquid position fallback, 1,000-character cause clipping (synthetic only), and A04 web preview.
- Rows written by the pre-change build. The history checks cover only rows this candidate wrote earlier.
- Draft PR553's integrated head was not tested. I did not rerun full Windows coverage.

**Cleanup.** Every API was stopped with an authenticated drain. Ports 5871–5879 refuse connections, the MCP child exited, and no browser or node process from my checkout, scratch or Chromium build remains. Two caveats:
- **Browser PID:** `chromium.launch()` gives no PID, so I replaced the vacuous in-driver browser check with a targeted absence check.
- **Overbroad listing:** one read-only process listing used too wide a filter and showed eight of your own MCP processes from `C:\Users\98jak\source\repos\GraphGoblin`. Nothing was touched; it's disclosed in the report.

The checkout is still clean at `633d9ac`, and all 62 original01/checkpoint file locations recorded in `checkpoint.json` re-hash unchanged. No product, index, git or GitHub changes and no installs.

Everything is in `C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-486-independent-02`:
- `REPORT.md`
- `PLAN.md`
- `BLOCKERS.md`
- `SHA256SUMS.json` (200 files)
- `results/<driver>/attempt-N/`