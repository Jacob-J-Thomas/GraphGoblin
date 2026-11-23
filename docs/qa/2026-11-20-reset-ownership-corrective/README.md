# #434 Windows Unicode and attribution QA supplement

Independent Claude Code Opus 5.5 xhigh behavior QA compared baseline `71bf970cd070c1856a0ee1dab30fe09b7e4f1315` (tree `99e334fc6e46bffeba85d71f946d77f4d11eaf3e`) with frozen corrective source `fd3b8458923eb7095f18873b1971ac8bcfa7b2bf` (tree `9cceda4c80ea0926540bfd7cbd9badea471e6d67`, sole parent the baseline). The source target is `42adbb5f38614b804a3f5355f33e84a1a6e53cf5`. Both fresh physical QA checkouts built with Node v22.23.4 and remained clean. The genuine baseline and candidate provider terminals were verified after exit 0, separately from the corrective author and auditor. This is standalone-source evidence.

| Native execution                          | Cases | Assertions | Pass | Fail | Skip |
| ----------------------------------------- | ----: | ---------: | ---: | ---: | ---: |
| First baseline, preserved                 |    14 |        228 |  187 |   41 |    1 |
| Corrected baseline driver, fresh fixtures |    15 |        238 |  215 |   23 |    1 |
| Corrective candidate, one run             |    15 |        238 |  238 |    0 |    1 |

All 238 corrected-baseline assertion IDs match the candidate. The 23 F1 failures became passes; the other 215 remained passing. F1 includes the auditor's uppercase-listed Greek sigma example, the reverse spelling, and distinct look-alikes. Native directory names, file identities and CREATE_NEW checks established equivalence or distinctness before interpreting manifests. On the candidate, owned lock/guard entries appeared once under Removes using their listed spelling; dry runs preserved bytes; confirmed resets removed exactly owned/store entries while preserving unrelated names, hardlinks and distinct final-sigma/Kelvin entries.

The first baseline's 41 failed assertions remain retained: 18 valid F1 failures, 19 mistaken refusal-stage assertions and four invalid manifest-failure labels. One additional passing row was invalid because no manifest existed. A same-directory database hardlink correctly caused an earlier read-only refusal. The corrected driver used a static subdirectory hardlink for later refusal and added that early refusal as an explicit control. No original row was rewritten. Candidate setup also retained a shell-escaping error in a pre-driver Git launch probe; it occurred before its sole native run.

F2's isolated success, post-first-acquisition refusal and sequential reset controls were consistent with actual snapshots. The independent candidate provider's focused source assessment found that attribution now uses this acquisition's own `reclaimed` actions. **No live peer interval or `already gone` branch was observed natively.** Post-locked-plan refusals were also unexercised. These native controls do not reproduce the auditor's interleaving.

The ASCII case-sensitive control was skipped after CREATE_NEW returned EEXIST with the same native identity; no filesystem flag or privilege was changed. Distinct final-sigma and Kelvin entries were exercised. Other limits: one Windows volume (filesystem type inferred), root-level databases only, no nested Unicode-alias case or new ambiguous-canonical-name refusal, and no broad regression. Integrated/current-target hosted CI, opposite-family review, final audit and owner acceptance remain separate.

[Machine summary](summary.json) · [Per-case execution projections](runs.json) · [Sealed private raw references](raw-records.json). The raw corpus contains local paths and stays private. Its in-place manifest SHA-256 is `99446431001c40ce92fde720f742106a33afd6e16c8e45ffdff031f07ff1118e`. Provider final report digests and actual terminal timestamps are in the summary. Public projections omit native volume/file-ID values, environment values, private paths and raw console bytes.

## Replaying the ordinary fixtures

Build the selected exact source checkout with supported Node 22 and `pnpm.cmd build`. Supply fresh absolute evidence/work directories and an absolute checkout path. From this packet directory, run the applicable original driver:

```text
node drivers/baseline-corrected.mjs --repo <absolute-baseline-checkout> --evidence <fresh-evidence-directory> --work <fresh-fixture-directory> --label baseline
node drivers/candidate.mjs --repo <absolute-candidate-checkout> --evidence <fresh-evidence-directory> --work <fresh-fixture-directory> --label candidate
```

The files are under [drivers/](drivers/). They use synthetic fixture content and ordinary built CLI transactions, record real identities and raw results, and preserve first outputs. [The historical first driver](drivers/baseline-first.mjs) retains its incorrect stage predictions for provenance. [The corrected baseline driver](drivers/baseline-corrected.mjs) and [candidate driver](drivers/candidate.mjs) use the same fixtures and assertion predicates. The [candidate diff](drivers/candidate.diff) changes the 23 expectation labels and F2 observation interpretation; it does not weaken predicates. Original driver bytes and their digests are preserved by the [file manifest](evidence-manifest.json).
