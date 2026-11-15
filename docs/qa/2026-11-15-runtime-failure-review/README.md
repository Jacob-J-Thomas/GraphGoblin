# PR #485 runtime-failure independent review

Claude Opus 5.5 (`claude-opus-5-5`) at xhigh effort completed formal scan 1 of
3 for #381 and #414. The provider exited successfully and the reviewer
returned **CHANGES REQUIRED** for one documentation finding. The full review
found no product or test blocker. The review used source, existing QA and
exact-head CI evidence. It ran no product tests, builds or fixtures.

[Full reviewer report](review/full-report.md.txt) ·
[Provider final summary](review/provider-final-message.md.txt) ·
[Published review comment](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/485#issuecomment-6898705327)

## Reviewed revision

- PR head `656a73214c5d59a25c22a4abf2d8b3bf17976959` and tree
  `d6c3dc2f3ebf265133fc3761c775ed37b2077388`.
- Target main `f91bd69b79dc417a2997ddb9c7670cb33df7597c` and accepted product
  source commit `615d50bc358d73bc55ad0591f4f625f1a46cb671`.
- CI run `43737977820`, attempt 1, passed all four jobs at tested merge
  `7c8cf9f2b8b099351a9ac138cab43d86ec5ad23f`. That merge has the reviewed
  tree, with target and head as parents in that order. This records CI for
  the reviewed head.

The [admission](provenance/runtime-381-opus-admission.json) binds the reviewed
revision, raw CI inputs and QA readbacks. The [launch](review/launch.json),
[provider result](review/result.json) and [exit](review/exit.json) record the
actual model, effort and process completion. The
[root disposition](provenance/runtime-485-opus-root-disposition.json)
includes the exact GET of the full published review comment.

## Disposition

- **F1, documentation-only fix in PR #485.** The execution-engine
  resiliency text still promised full diagnostics on persisted internal
  failures. Describe the safe public diagnostic and the correlated server
  log. Document the author impact at the remaining expression and template
  paths that retain the `INTERNAL_ERROR` classification.
- **FU2, guide correction in PR #485.** Add the new `MUTATION_ERROR` row
  and its recovery guidance. Existing guide-table drift remains out of scope.
- **FU1, parked.** Consider typed authored failures separately for the
  remaining evaluation boundaries. FU3 records evaluator-timeout behavior
  under the accepted contract.
  [Follow-up #486](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/486)

## Documentation correction verification

Independent documentation QA passed F1 and the scoped FU2 guide row on the
three frozen, unstaged Markdown files at the reviewed base head. The live
diff exactly matches the retained final patch. The verification checked the
safe public and raw logged diagnostics, historical fidelity, classification
and child projection, and the guide's corrected publish-and-start path.
The documentation readback is separate from formal scan 1.

[Independent QA report](documentation/qa/report.md.txt) ·
[Hash and command readback](documentation/qa/readback.json) ·
[Luna handoff](documentation/correction/handoff.md.txt) ·
[Final patch](documentation/correction/documentation-final.patch) ·
[Final scoped format check](documentation/correction/prettier-check-final.stdout.txt)

## Evidence qualifications

- Current-head CI curation finished after the reviewer's initial read. Root
  independently verified 13 valid evidence entries across the 15-row
  inventory and confirmed the review-bound raw inputs were unchanged. This
  supersedes the review's time-specific curation note. The CI packet
  preserves both attempts.
  [CI root readback](provenance/runtime-485-current-ci-root-readback.json) ·
  [CI packet](../2026-11-15-runtime-failure-ci/README.md)
- The local full check failed. Domain ADV-007's null child exit status
  remains unexplained. The later isolated pass leaves the cause unresolved.
  The policy-assertion correction was confined to six engine test files.
  CI supplies the full-suite pass.
- Exact corrected-head CI and fresh Astra max sign-off remain pending.
  Merge and intent completion are outside this checkpoint.
  #381 and #414 have no owner-only acceptance gate. The batch's separate
  owner acceptance items remain open.

## Copy integrity

The reviewer-authored full report and the separate provider summary are
byte-exact `.md.txt` copies. The
[source-copy map](source-copy-map.json) records their source locations,
sizes and SHA-256 digests along with the original JSON receipts. It also
records the path, size and digest of the raw provider event stream retained
externally. [SHA256SUMS.txt](SHA256SUMS.txt) covers the packet contents.
