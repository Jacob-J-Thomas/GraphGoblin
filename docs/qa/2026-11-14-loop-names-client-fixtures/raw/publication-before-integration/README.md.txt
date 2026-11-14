# #209 MCP and API-client fixture correction

**Status: finalized test-only correction proposal. No product runtime source changed.** This small evidence bundle preserves the original correction artifact and its verification, with original phase 3 failures linked from the separate integration bundle.

## Commit and source identity

| Role                                             | Commit                                   |
| ------------------------------------------------ | ---------------------------------------- |
| Immutable test-source baseline                   | c427287b41a4e1b67a397ab4e03e228c6ea62450 |
| Implementation candidate used for focused checks | 35436eddf51482ca9394347228860afe38b0c412 |
| Test-only correction commit                      | 8a057e25c2b30187f4b4a8fab0fee049ec9fc3be |
| Root QA integration head                         | 693e61a367c9d3ea61aee16aeecd730a364d28da |

The original [manifest.json](manifest.json) records 34 artifacts totaling 113,657 bytes. Its SHA-256 is 92f0d62f010fa0d06c30fe364a023eb1f5309848f406c9446d97a34e53013c12. Root verified the committed test files match the prepared versions; the manifest records both committedMatchesPrepared values as true.

The original README is preserved byte-for-byte as [README.md.txt](README.md.txt). This readable [README.md](README.md) fixes the original cross-bundle paths. The raw TypeScript snapshots use .ts.txt names; [source-evidence-manifest.json](source-evidence-manifest.json) maps every original manifest path to its archived path and records the byte count and SHA-256. The exact patch is [names-209-mcp-fixture.patch](names-209-mcp-fixture.patch).

## Correction and runtime boundary

The MCP test no longer attempts to create case-equivalent loops through the real API, which now rejects that pair. A separate controlled upstream response keeps MCP resolver ambiguity handling covered. The three api-client tests now create loops with distinct names in their shared app.

Only these two test files changed. The original manifest records seven relevant API, MCP, and SQLite runtime files as byte-identical to the baseline; this was test-fixture maintenance, not a runtime behavior change.

## Focused checks and preserved first failures

The focused results recorded in the original manifest and logs are:

- MCP tests: 12 files, 60 passed, 2 skipped; coverage 96.95% lines and 94.23% branches.
- API-client tests: 11 files, 103 passed; coverage 100% lines and 97.30% branches.
- Both packages passed typecheck and lint. The final Prettier check passed.

The first MCP lint attempt failed because the synthetic fetch method was marked async without an await. The first Prettier check flagged the API-client test file. Both first failures remain in [logs/corrected](logs/corrected/); subsequent lint and formatting checks passed.

The original four backend fixture failures are **not duplicated here**. They remain in the separate [phase 3 integration evidence](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/README.md): [initial MCP failure](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/logs/14-mcp-plugins.log), [initial API-client failures](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/logs/16-api-client.log), and the [unchanged MCP](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/logs/17-recheck-mcp-mcp-test.log) and [API-client](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/logs/17-recheck-api-client-contract.log) reproductions. Those logs show one MCP and three API-client test failures before this correction; they are historical failures, not current results.

## Build-output readback

No build was run for the readback. The first aggregate-listing reconstruction is preserved in [build-readback-aggregate-attempt1.json](build-readback-aggregate-attempt1.json); its LF-format candidate did not match the recorded aggregate and was not evidence of file drift. The corrected [per-file readback](build-readback.json) compares every path and SHA-256 against the phase 3 listings and reports zero changed, missing, or extra files in all four trees.

The corrected JSON retains the original phase 3 path strings. For readable navigation, use the curated phase 3 [final build hash list](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/build-sha256-final.txt) and its [web dist](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/build-listings/apps_web_dist.txt), [Goblin dist](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/build-listings/apps_web_dist-goblin.txt), [API dist](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/build-listings/apps_api_dist.txt), and [infrastructure dist](../../../../../names-209-phase3-curation/proposed/docs/qa/2026-11-14-loop-names-integration/build-listings/packages_infrastructure_dist.txt) listings. The phase 3 bundle verified that its final listings were byte-identical to these retained copies.

Native #209 QA remains bound to clean integration head 693e. This curation did not inspect or change that checkout or QA evidence.

## Curation and limits

All 34 original manifest artifacts were copied byte-for-byte. The only archive-path changes add .txt to the raw README and four TypeScript snapshots; the source manifest records these mappings. The folder-scoped [.gitattributes](.gitattributes) disables text normalization. The [publication manifest](publication-manifest.json) records sizes and hashes for files in this proposal, excluding itself.

This bundle preserves focused test evidence only. It does not claim a full repository check, independent runtime QA, browser coverage, or a new build. Curation performed only copy, size/hash, relative-link, and Markdown-format checks; no tests, builds, browser sessions, active-worktree, index, or commit operations were performed.
