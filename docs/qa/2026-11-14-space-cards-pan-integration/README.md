# #208 Space cards after-pan integration evidence

This packet curates the Space cards pan-gate implementation and its integration with the corrected canvas predecessor. The source-worker evidence and later root freeze are kept distinct. This is not an independent review, native verification, release sign-off or owner acceptance.

## Source and integration identity

The worker began at head **c162c486b06e4b642911610c46b9a75eea9a5fd2** with merge head **bc9094fd426fe1c1a4b81b0e490e3887f977dbc7**. It resolved only the Canvas import conflict in the working tree, did not stage or commit, and left the merge index root-owned. Root later froze the integrated source as **efe35fffc6aed752c3506ab7108d5b907cb23800**, tree **27f3d865bb5476ef1f7c3ab7b5dd3a551ff42642**, with those two parent commits. The exact [root committed manifest](evidence/root/predecessor-committed-manifest.json) and [staged manifest](evidence/root/predecessor-staged-manifest.json) are retained.

The worker changed 9 paths and recorded 2 unchanged helpers: space-cards.ts and viewport-gesture.ts. The [final hash list](evidence/worker/final-SHA256.txt) and [patch hash list](evidence/worker/patch-SHA256.txt) preserve the source identities. The [tracked-file patch](evidence/worker/tracked-changes.patch) and [new-file patch](evidence/worker/new-files.patch) are byte-exact.

## Fix scope and focused checks

The change gives the Space cards offer the same Canvas-owned viewport gate as Remove and Reset. While the gate is panning or settling, the Space cards and Dismiss controls remain attached and focusable but report aria-disabled and gesture state. Their handlers refuse actions unless both the rendered state and the live gate state are ready. There is no second gate, additional window listener, timeout or replay. Store action-time eligibility and behavior remain unchanged.

The final focused run passed **396 tests in 19 files**. No-emit typecheck, ESLint and Prettier passed. The [final test log](evidence/worker/logs/10-vitest-final-focused.log), [typecheck](evidence/worker/logs/11-tsc-noemit-final.log), [lint](evidence/worker/logs/12-eslint-final.log), and [format](evidence/worker/logs/13-prettier-check-final.log) are retained. The counterfactual ungated-offer probe failed 11 new gate cases while 7 existing controls passed; this was one bounded probe, not a mutation campaign. Its [log](evidence/worker/logs/04-counterfactual-ungated-offer.log) and [before/after source hashes](evidence/worker/logs/probe-before.sha) are retained; the after hash is [here](evidence/worker/logs/probe-after.sha).

## Preserved setup and format failures

The handoff records an initial shell quoting failure while appending tests; it occurred before any test ran, left the file unchanged and was reapplied with the edit tool. The first Prettier check failed only on Canvas.space-cards.test.tsx. The one-line JSX formatting correction, its [write log](evidence/worker/logs/09-prettier-write.log), and the [before-copy](evidence/worker/logs/Canvas.space-cards.test.tsx.before-prettier) are retained. No new test failed on its first execution except the deliberate counterfactual probe.

The full [worker handoff](evidence/worker/handoff.md.txt), [summary report](evidence/worker/report.md.txt), [prettier first-failure log](evidence/worker/logs/08-prettier-check-first.log), and [first gate run](evidence/worker/logs/02-canvas-space-cards-gate-first.log) carry the detailed chronology and behavior limits.

## Index evidence and its qualification

The worker’s [initial](evidence/worker/index-initial.txt) and [final](evidence/worker/index-final.txt) git ls-files --stage listings are byte-identical, each 21,313 lines, SHA-256 **331ca0d759fd35ab83404d169edb88e7ccc33cdf76675abe0d3f5e71a1a6982c**. This establishes identical recorded staged entries.

It does not establish that the underlying index-file bytes were unchanged from before the worker’s first command. The first read-only git status omitted GIT_OPTIONAL_LOCKS=0 and may have refreshed index stat data; the index file hash was first measured afterward. The [final index check](evidence/worker/final-index-check.txt) records the later matching hash and mtime, unmerged Canvas stages, no conflict markers, and final source-hash matches. The worker did not stage, reset, commit, merge or publish; one git write-tree probe was refused because of the unmerged entry and wrote nothing. The later root freeze is a distinct root-owned action recorded in the root manifests.

## Limits and open gates

The counterfactual and component tests do not establish actual browser delivery after a real pan, hit-testing, geometry, double-click behavior, enlarged-font spacing, coarse targets or theme-specific layout. No browser/native run, build, coverage run, broad suite or pnpm check was performed. Earlier corrected-stack native evidence is not substituted for verification of this integrated source.

Zero formal reviews were consumed. Independent native QA, GPT opposite-family review, fresh Astra, current-target CI with coverage, and owner acceptance remain pending; #208 remains open.

## Metadata and packet integrity

The [safe worker metadata projection](worker-metadata.json) records the verified Claude Sonnet 5.5 model, effort, timestamps and exit code while omitting raw launch path and PID fields. Raw model streams, latest progress, runner output streams and signatures are not included.

The packet contains 27 exact source copies totaling 4,936,332 bytes, largest 2,394,017 bytes. See the [copy manifest](copy-manifest.json), [packet manifest](manifest.json), [link checks](link-checks.json), and [SHA-256 sums](SHA256SUMS.txt). .gitattributes disables text conversion under evidence/.
