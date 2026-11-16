# #436 baseline-carrier Gates deadline

This packet preserves the original Gates job from PR #497, run 43804982239 attempt 1. The attempt-specific run readback concluded failure at 05:05:42Z; the Gates job itself was cancelled at the configured maximum execution time. Its separate Windows launcher job also failed, so this note does not attribute the overall attempt result solely to Gates.

## Cancellation evidence

Gates job 133093663934 ran from 04:35:26Z to 05:05:41Z. The “Unit tests with coverage thresholds” step was cancelled at 05:05:38Z. The official check annotation says: “The job has exceeded the maximum execution time of 30m0s.”

The coverage artifact upload succeeded at 05:05:39Z. Artifact 14198683680 is 12,897 bytes with SHA-256 `67b8d48f45af67fb67dcba4435c43a77a2690beef1d191b10f81921d8fa395f4`; it contains nine partial `coverage-summary.json` files. It does not show that every package coverage group or floor passed. The licence, generated-docs, design-token-contrast, and dependency-audit steps were skipped. Full CI remains required; the deadline is not a gate waiver.

The tested synthetic merge was `190ef604417887325ab557edd31884cbed68cd26`, tree `382dcd6fa76f8b04a914787e08d9291d1672d088`, with main/product parent `be633141be5a0cd2b4f960a46761fabbf2cb82c7` and carrier head `36048e8f40cda520c2ec7b5865d3ff8c5bae6624`. The overall run's separate ordinary native Windows failure is documented in the [ordinary native gate failure packet](../2026-11-16-installer-validation-native-gate-failure/README.md).

## Published issue updates

Root published and read back the [deadline recurrence comment on #488](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/488#issuecomment-6908138723) and the [retry update on #471](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/471#issuecomment-6908138461). The original [focused note](gates-deadline-note.md.txt) predates those comments; its closing sentence about no issue update describes its capture time. The unposted local recurrence draft is intentionally excluded.

The [root acceptance receipt](provenance/436-carrier-gates-root-acceptance.json) records the accepted 11-row source seal and exact #488 comment readback. [SHA256SUMS.txt](SHA256SUMS.txt) hashes every file in this packet. The [source-copy map](source-copy-map.json) lists retained inputs, the ZIP inventory, and the excluded unposted draft.
