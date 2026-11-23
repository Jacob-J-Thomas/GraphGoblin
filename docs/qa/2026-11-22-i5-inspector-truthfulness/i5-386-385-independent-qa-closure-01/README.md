# Independent QA closure: #386 / #385, candidate 03

**Disposition: PASS for independent touched-system QA at commit `58227ea02a00fcfe67775ddc8d337b3bab61406d`, tree `0585acf06f5f6a2ff7974ae1e8358b4ba09c4fb3`, within the evidence tiers and limits recorded below and in the sealed interim report.** Both changed browser cases passed once, with zero retries. Candidate 02's supplied-browser-fixture blocker is closed by this targeted verification. No product runtime changes or additional behavior-suite reruns were needed.

The [sealed interim report](../i5-386-385-independent-qa-01/README.md) remains unchanged and retains its historical NOT PASS disposition, candidate 01/02 failures, raw traces, fixture corrections, 15-criterion matrix, original Claude assertion result, and tiered behavior evidence. This closure supplies the subsequent candidate 03 result; it does not rewrite earlier failures.

## Immutable source and retained evidence

- Original signed baseline: `3a6943a136594162665667a7a55e2b46520912eb`, tree `a88175975c42062a08e3012a7f106396be0c685f`.
- Candidate 03 receipt SHA-256: `0578b53c83139b661d57082156683c9b6f0d69e295c59be74ad7c09b2fbc1567`; exact receipt retained as `candidate03-receipt.json`.
- Candidate 03 parent: `0776ad604e69d17f42a03b52ea27fd5e30b1318e`. All 11 literal files were independently verified against both the QA checkout and commit blobs before and after execution. Only `apps/web/e2e/inspector-truthfulness.spec.ts` changed from candidate 02; its SHA-256 is `61322359a4e2fc0be4e02e10f5baf706f0ac203db094024ce7f79d30c845e218` (6,340 bytes).
- The other ten candidate members, including product runtime and unit-test inputs, remain byte-identical to the prior qualified candidate. The prior owned build and behavioral evidence therefore apply. Receipts: `verified-source-and-parity-before.json` and `verified-source-and-parity.json`.
- Original `apps/web/e2e/claude-harness.spec.ts` SHA-256 remains `e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0`. Its original succeeded assertion was not edited or rerun during this bounded closure; its earlier browser pass is retained in the interim evidence.
- Both QA-only overlay files and the sealed interim report/SEAL hashes were independently checked unchanged. No product edits, index actions, commits, publication, credentials, provider calls, private configuration, owner stores, or owner processes were involved.

## Targeted independent execution

Existing built UI served by the real loopback HTTP API, in-memory test database, fake clock and fake harness; Microsoft Edge through Playwright. Node `v22.23.4`, pnpm `12.8.1`. Owned TMP/TEMP and ports `18786`/`18787`; execution command is retained in `run-browser.ps1`. The command ran only `e2e/inspector-truthfulness.spec.ts`, explicitly `--retries=0`, with traces retained for both cases. No timeout or assertion was changed by QA.

| Changed browser case | Result |
| --- | --- |
| Timeline outcome while refreshed run record is held | PASS, 1.7 seconds |
| Timeline outcome while run record still says running at the outcome sequence | PASS, 1.2 seconds |

**2/2 passed, first execution, total 10.4 seconds.** Raw results: `browser.log.txt`, `browser-results.json`; both passing `trace.zip` artifacts are under `output/playwright/`. The corrected fixture holds both run and observation reads, observes the streamed terminal row and succeeded header while observation stays blocked, completes the stale running HTTP responses at the terminal sequence, then checks the rendered header and stale-position suppression. Its explicit active-route drain completed without either prior route handling error.

## What the response and rendering checks establish

These browser checks establish actual browser HTTP response completion and parsed stale body values, followed by the public rendered-header assertions after two animation frames, while observation responses remain held. Run-query reads and attempt-follower reads share `/runs/:id`; the browser does **not** identify which completed response was installed into the React Query run cache or establish consumption of every returned response by that query.

Actual stale-query consumption is independently established by the sealed public-component case `independent S1/S2/S10`: observation remains blocked, a stale equal-sequence running row is released, the test witnesses that row's unique `currentNodeId` in the actual run query cache, and the public header remains succeeded. The product source for that evidence is byte-identical to candidate 03. This combination preserves the distinction between HTTP/rendered-browser evidence and controlled query-cache evidence.

## Preservation and remaining gates

Post-run source verification passed for all 11 commit blobs and the original Claude file. Both owned QA ports are unbound. Common repository HEAD remains `a60843a9050b3a203726db84f6abf1f45b8bc694`, with its index absent; the QA checkout stays detached at the signed baseline with the explicitly recorded candidate/QA overlay. `post-run-state.json` records these observations.

Independent QA passes for this pair and exact candidate. Cross-family/general review, final audit, current-target CI, repository gates, merge, and owner acceptance remain separate root-orchestrator obligations. This closure makes no real-provider, native-persistence, full-regression, #416 offline-retention, or deployment claim. The prior trace does not establish run-row request cancellation or its precise cleanup cause; successful candidate 03 closure establishes that the corrected fixture completed correctly in this controlled execution.
