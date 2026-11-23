# D223 — retain failed local broad-check evidence and require the unchanged CI gates

## Decision and authority

Under the owner's delegated blocker authority, continue bounded source verification and draft preparation while retaining the failed Windows `pnpm check` result. This is a verification routing decision, not a test or coverage exception. No implementation acceptance, formal review approval or merge follows from the partial result. The existing exact-head/current-target Linux whole-repository coverage, browser, policy and native Windows CI gates remain mandatory.

## Evidence and limits

On the #386/#385 candidate based on signed `3a6943a`, `pnpm check` passed typechecking, lint, layers, migrations, design tokens and dependency boundaries, then stopped in coverage. Two unchanged Claude plugin tests exceeded their 5000 ms deadlines while broad coverage ran concurrently. A single isolated diagnostic of that unchanged package passed all8 tests with95% lines/95.23% branches. This does not establish the timeout cause or turn the first result green. No timeout was raised and no retry-to-green result is used as a full-repository pass.

The aborted broad run also recorded filesystem symlink-test failures. A separate single-case diagnostic failed in fixture setup at `fs.symlink` with Windows EPERM, before the product assertion. No elevation, Developer Mode/security-policy change, exclusion or test weakening is selected. The tested infrastructure/plugin production and test paths have no candidate changes. This one diagnosis does not establish every failure in the aborted run.

Full repository formatting passed. Ordinary dependency audit passed its high/critical gate with7 low,13 moderate,0 high,0 critical; the #503 exception remains unused. Templates, licence and generated-doc checks passed separately. Contrast initially failed because sparse checkout omitted the tracked baseline table. Local Git lacked that historical blob, so root fetched only `docs/qa/design-contrast.md` at signed3a through the GitHub connector, verified Git blob1957f5e21c6abad9f4a1f778ea3c62189ac675d3, and materialized its unchanged bytes. The normal contrast gate then passed with0 failing enforced pairs. This is fixture materialization, not regeneration or a candidate change.

Complete web coverage and independent public browser/component QA remain in progress. Preserve all original failures and evidence tiers in the delivery report. Final CI must execute the ordinary configured suites; local partial results cannot substitute.

## Alternatives not chosen

- Repeatedly run the same broad Windows command until it happens to pass: obscures the original failure and cannot solve the established symlink permission limit.
- Raise test timeouts, skip symlink cases or lower coverage: changes gates without correcting the feature and is unnecessary.
- Change host security policy or use owner/admin environments: unnecessary for a bounded web change whose full platform gates already exist in CI.
- Expand this inspector PR into unrelated plugin/filesystem changes based only on those failures: no introduced source link or confirmed product defect was established.
- Claim the isolated plugin pass proves concurrency caused the initial failure: unsupported; retain the cause as unestablished.

## Owner QA catalogue

Present this decision for consolidated sign-off/rework with the rest of the catalogue. It waives no technical or owner-acceptance gate. Next unused decision D224.
