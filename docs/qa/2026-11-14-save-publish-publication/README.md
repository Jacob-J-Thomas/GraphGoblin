# Save/publish evidence publication

The runtime and tests remain the independently verified `8fe52989` source. Publication adds the evidence below, a guide paragraph explaining validation blocked by name/draft conflicts, and the delivery checkpoint. [Source lineage](source-lineage.json) records the one guide hash change and unchanged runtime/build anchors. Current-head CI, independent review and final audit remain required; owner acceptance remains open.

- [Phase 1 implementation](../2026-11-14-save-publish-implementation/README.md)
- [First independent retry-readback failure](../2026-11-14-publish-retry-readback-diagnostic/README.md)
- [Integration and pre-send correction](../2026-11-14-save-publish-integration/README.md)
- [Second independent local-refusal failure](../2026-11-14-publish-local-refusal-native/README.md)
- [Uncertainty correction and negative controls](../2026-11-14-save-publish-uncertainty/README.md)
- [Final independent native QA](../2026-11-14-publish-independent-corrected-native/README.md)

The first assembly preflight confused listed evidence counts with complete packet counts. It stopped before copying; the [record](raw/first-assembly-preflight.txt) explains the corrected accounting. Every original manifest entry and the complete file sets were then verified.

The [first formatting run](raw/five-packets-format.log) found two historical raw TSX backups. Existing policy preserves raw TypeScript QA bytes, but its extension list omitted TSX. Adding only `docs/qa/**/*.tsx` preserves those exact bytes and leaves product formatting and all coverage/test gates intact. The [same formatting command passed](raw/five-packets-format-corrected.log). The [disposition](raw/raw-tsx-format-disposition.md.txt) and [guide application record](raw/guide-applied.json) retain both publication changes.

The supplementary Git diff check also reports three expected conflict markers in the preserved pre-correction `useAutosave.ts.conflicted-working` backup. Its full hash and exact marker lines match the original artifact. The [archive check record](archived-conflict-marker-check.json) retains that result and the passing check of every other staged path. The historical backup remains intact; active source and repository gates are unchanged.

The node-reference parent `ae8add8a` was then integrated into publication checkpoint `657fe51e`. The [integration record](parent-integration.json) verifies all 749 combined evidence files and a documentation-only merge. Both sides of the sole QA-attribute conflict were retained. Existing raw parent logs/diffs keep their original trailing spaces; their exact bytes are authenticated, and the supplementary check of non-QA changes passes. Product/configuration and bound guide sources do not change in this merge.
