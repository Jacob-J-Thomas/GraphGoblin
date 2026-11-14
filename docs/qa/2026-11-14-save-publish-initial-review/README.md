# PR #475 initial UI review

This packet preserves formal scan 1 of 3 for PR #475 at head `1dcee36b16cc4662e8acb691e9166aff52949ad9`, tree `2936f795e624932fd7d42747f8316066fa4af7ec`, compared with parent PR #474 at `ae8add8a791699e905540465b5ddf929d00c50eb`. The snapshot records `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c` as main at preparation; the child comparison was against the stacked parent branch. The original [UI report](raw/ui-sol-report.md.txt) and dispatched [review brief](raw/ui-sol-brief.md.txt) are preserved byte-for-byte.

The scan was a static GPT-6.1 Sol xhigh review. It found four introduced child issues and required corrections:

- **F1 · P1:** retrying an uncertain publish after readback reveals a divergent server draft can dispatch a POST for that different draft.
- **F2 · P2:** a failed retry check can describe the earlier uncertain request as if the later click had tried to publish its newer draft.
- **F3 · P2:** a delayed response for an older immutable release can make the notice say the current editor draft is unpublished even after a newer matching version was published.
- **F4 · P2:** a late dependent validation result can clear publication invalidation and keep a stale `SUBLOOP_NOT_PUBLISHED` error fresh.

Root accepted **F1–F4 as FIX-IN-PR**; there are no deferred findings in this scan. Claude's source correction is active. That does not change the original report's findings or constitute a correction pass. Corrected-source native verification, integration into actual `main` and retargeting, current-target CI, and a fresh Astra max sign-off remain pending. Owner acceptance remains open.

## Baseline evidence and limits

The linked [stacked-head CI packet](../2026-11-14-save-publish-stacked-ci/README.md) reports green CI for this reviewed head while it was stacked on PR #474. That run predates these F1–F4 findings and does not verify their corrections. The [independent native packet](../2026-11-14-publish-independent-corrected-native/README.md) is historical baseline evidence for earlier scenarios; the review explicitly says those scenarios did not cover the four schedules above. Neither packet establishes current corrected-source behavior or final CI against actual main.

The [initial snapshot](raw/review-snapshot/identity.json), [product diff](raw/review-snapshot/non-qa.diff), [non-QA paths](raw/review-snapshot/non-qa-paths.txt), and [all changed paths](raw/review-snapshot/all-changed-paths.txt) retain the exact reviewed inventory and bindings. The snapshot's `reviewGate` text says “PREPARATION ONLY” and “no scan consumed”; it predates the dispatched brief and completed scan and is historical metadata, not the current review state.

The root disposition is preserved in the [public comment readback](raw/initial-review-comment-readback.json) and linked as [comment 6882651485](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/475#issuecomment-6882651485). Root verified the readback body against the published comment before preserving it. The comment accepts F1–F4 for correction in the PR and keeps scan 1 of 3 consumed; it requires parent #474 correction/integration, corrected independent QA and current-target CI before the fresh Astra max scan 2, with scan 3 reserved. It claims no merge or owner acceptance. See [manifest.json](manifest.json) for source-to-copy hashes, [link-checks.json](link-checks.json) for local and sibling link verification, and [SHA256SUMS.txt](SHA256SUMS.txt) for packet integrity. Raw source markdown uses `.md.txt`; worker event/result streams are excluded.
