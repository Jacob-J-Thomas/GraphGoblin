# PR #485 runtime-failure CI evidence

This packet preserves both current-head CI attempts for GraphGoblin PR #485: the original failure on head 5082bc17 and the later successful run on corrected head 656a7321. These are distinct attempt-1 runs on distinct commits, not a rerun of the same workflow attempt. This packet records CI evidence only; it makes no review, merge, or owner-acceptance claim.

## Tested identities and outcomes

| Attempt   | PR head and source tree                                                                 | Run and tested synthetic merge                                                                                                                                                                                                    | Result  |
| --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Original  | 5082bc176e92cf3518abb630a5afc0a59c444815; tree 959942bf3d6ba1a16daccad278c0a8a9aad022bd | Run 43735208367, run 881 attempt 1; merge 5db4567e252e503d44db79e1216f52312616b31f, tree 959942bf3d6ba1a16daccad278c0a8a9aad022bd, parents f91bd69b79dc417a2997ddb9c7670cb33df7597c then 5082bc176e92cf3518abb630a5afc0a59c444815 | Failure |
| Corrected | 656a73214c5d59a25c22a4abf2d8b3bf17976959; tree d6c3dc2f3ebf265133fc3761c775ed37b2077388 | Run 43737977820, run 882 attempt 1; merge 7c8cf9f2b8b099351a9ac138cab43d86ec5ad23f, tree d6c3dc2f3ebf265133fc3761c775ed37b2077388, parents f91bd69b79dc417a2997ddb9c7670cb33df7597c then 656a73214c5d59a25c22a4abf2d8b3bf17976959 | Success |

The original attempt’s three non-Gates jobs passed; Gates failed at Format. Its complete checkout logs and root readback bind the run to 5082, despite the later terminal PR snapshot showing the newer 656a head. The corrected-head run completed successfully in all four jobs. See the [first-run root readback](provenance/first-ci-root-readback.json), [current-run root readback](provenance/current-ci-root-readback.json), [terminal job readback](provenance/root-ci-terminal.json), and [current synthetic-merge identity](attempt-656a/metadata/synthetic-merge-identity.json).

## First attempt: 5082 failure

The Gates workflow ran the Build, seven acceptance steps, Typecheck, and Lint successfully. The Format step ran pnpm format:check (the script invokes Prettier with --check .) and failed because it included six retained inspector-dom.html evidence snapshots. Later layer, migration, design-token, dependency, shipped-template, tooling-browser, unit-coverage, licence, generated-doc, contrast, and audit steps were skipped. The coverage-upload step reported success but found no coverage files; this attempt has no coverage artifact and no Gates test/coverage aggregate.

The Browser job passed 481 tests and skipped 1; it used Edge, one worker, and zero retries. The sole skip was the LIVE-gated UI test. The Windows launcher job passed 14 tests, with no failures or skips, but its upload step found no .tmp/windows-launcher-* files, so no native artifact was produced. The Template image job loaded four installed templates: starter (4 draft nodes), implementation (11), review (10), and qa (11).

The failed first-attempt report was corrected for two derived facts and accepted as a failure-only record. Both its initial version and corrected version are retained as byte-exact .md.txt files: [recovered initial report](attempt-5082/README-initial-recovered.md.txt) and [corrected first-attempt report](attempt-5082/README-final.md.txt). The root receipt confirms the recovered initial report’s original SHA-256 and confirms the final report’s corrected timing/command language.

## Narrow format correction

The follow-up commit 656a changed only .prettierignore, adding scoped exclusions for the six raw HTML captures. A local pnpm format:check on Node v22.23.4 passed; before/after capture hashes confirm all six HTML files were unchanged. The commit was created before the original Browser job finished, but the push was held until that job reached terminal at 16:52:42Z. The 656a CI run began after publication and is a new pull_request attempt, not a rerun. See the [format-correction root receipt](provenance/format-correction-root-readback.json) and [complete local format-correction evidence](provenance/format-correction/).

## Corrected attempt: 656a success

All four jobs passed: Gates, Browser, Windows launcher, and Template image.

- Gates completed all 32 steps. Its test/coverage run reported 9,605 passed and 41 skipped across 13 package coverage groups. All 13 groups met both 90% line and branch floors. The 22-task coverage aggregate included 9 cached dependency-build tasks; the separate standalone build reported 12 successful tasks and 0 cached tasks.
- The downloaded coverage artifact contains 13 coverage-summary.json files, all above both thresholds. The 22,030-byte ZIP has SHA-256 76d8fa902fbb476c5b1832d43ffe10d391fc416fe392eaf22437e7a173874f30.
- Browser passed 481 and skipped 1 (482 total) in 29.5 minutes, with zero retries and one worker on Edge 157.0.4341.60. The only skip was live.spec.ts: it requires LIVE=1, an installed Codex CLI, provider login, and subscription quota; CI set LIVE=0.
- Optional GG_ROUTING_STRICT_PERF bounds were off. The ordinary routing tests passed, but measured frame p95 was 33.4 ms at 100 nodes and 50.0 ms at 300 nodes (about 16.6 ms added at 300); these measurements do not establish the disabled 17 ms bound.
- Windows launcher passed 14/14 tests. Its upload step passed but warned that .tmp/windows-launcher-* had no files; no Windows artifact exists. The Template image job loaded the same four templates as the first attempt.

The dependency audit passed at the configured high threshold and reported 8 low and 13 moderate advisories. Dependency-cruiser completed with four warning-only no-orphan findings and zero errors. Logs also retain Node.js action-runtime deprecation notices (actions targeting Node 20 were forced to Node 24), Node DEP0169 url.parse and DEP0040 punycode warnings, and the Template image shared-lockfile warning. These did not fail the corrected run.

## Original inventories and incomplete capture

Both source evidence manifests and both source SHA256SUMS files are retained unchanged under the attempt folders. The raw Markdown reports were renamed to .md.txt to preserve their exact source bytes; the top-level [source-copy map](source-copy-map.json) maps each original path, byte count, and SHA-256 to its packet path. The top-level [SHA256SUMS](SHA256SUMS) covers every packet file except itself.

The original 5082 packet also has an incomplete, unverified 747,000-byte synthetic-merge REST capture. It is deliberately omitted from this proposed packet and is explicitly listed with its source SHA-256 in the copy map. The original manifest and SHA file remain unchanged and retain their excluded-capture entry; this packet does not parse or use those partial bytes for identity. The 5082 merge SHA/tree/parents are supported by its bounded identity readback, completed job checkout logs, and root readback.

## Evidence files

- First attempt: [raw job logs](attempt-5082/raw-logs/), [step snapshots](attempt-5082/step-snapshots/), and [metadata](attempt-5082/metadata/).
- Corrected attempt: [raw job logs](attempt-656a/raw-logs/), [step snapshots](attempt-656a/step-snapshots/), [metadata](attempt-656a/metadata/), and [coverage artifact](attempt-656a/artifacts/coverage-14172112286.zip).
- Provenance: [first-run root readback](provenance/first-ci-root-readback.json), [format correction](provenance/format-correction-root-readback.json), [current CI root readback](provenance/current-ci-root-readback.json), [current terminal snapshot](provenance/root-ci-terminal.json), and [format-check evidence](provenance/format-correction/).
