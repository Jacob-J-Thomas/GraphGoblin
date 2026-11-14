# #273 domain correction: paired regression evidence

This packet preserves the focused domain correction for F1 and F2 from PR #474's base `ae8add8a791699e905540465b5ddf929d00c50eb` (tree `ea2dfcfd46f7d5ab79fd98414db214513d830b52`; `origin/main` observed as `a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c`). The corrected diff changes four owned paths, has 19,794 bytes, and SHA-256 `16372bb2b9247528ba790d0d270e966a3f25dd55f5a41e0ceb6ec857ac367240`. Its [identity record](raw/source/identity.json), exact [diff](raw/source/backend-correction.diff), and original [handoff](raw/source/handoff.md.txt) are byte-preserved.

## What the correction covers

F1 repairs node-reference analysis to use the selected message and `$thread` for decision selectors, parent-thread bindings for child input selectors and variable values, and child scope for subloop outputs. The custom output patch keeps the parent view; mutate and inference transform predicates retain item scope. Updated domain documentation records these scopes.

F2 accounts for JSONata filters, groups, and stages attached to functions, generic containers, and path steps. Analysis visits those decorations in the selected item/group scope while retaining explicit original-root and injected-thread bindings. A probe against installed JSONata 2.2.2 records 17 AST/evaluation cases. For a function directly on the right of `~>`, the installed evaluator skips decorations on that function itself; authored references there produce a conservative uncertainty warning rather than claiming repair or a runtime missing reference. Evaluated arguments remain repairable, and an applied direct `$exists` stays optional. The preserved [probe script](raw/scripts/jsonata-attachment-probe.mjs.txt), [readback](raw/source/jsonata-attachment-probe.jsonl), and [source identity](raw/source/identity.json) retain the observations and installed evaluator hash.

## Test history and paired result

The early `focused-before.log` run showed 21 failures and 60 passes, including two fixture-selection errors. After choosing valid existing fixtures, `focused-before-final-fixtures.log` recorded 21 intended assertion failures and 60 passes on the original product source.

Corrected-source iterations exposed fixture issues hidden by those failures: the first corrected run passed 78/81, then passed 90/91 after fixture adjustments, and the final focused run passed 91/91. These adjustments corrected fixture data and expected JSONata result shapes; they did not change production source. All intermediate logs are retained under [raw/logs](raw/logs/).

The final paired replay used the exact final `node-references.test.ts` bytes on both sides. The [mirror source manifest](raw/source/negative-control-source-manifest.json) records 66 byte-verified source/config files per side, base Git blobs, hashes, and dependency junction targets. Only `node-references.ts` and `expression-references.ts` differ between the original and corrected source mirrors; the regression test bytes match. On the original `ae8` source, the four focused files had 23 intended assertion failures and 68 passing controls (exit 1), with no fixture or compile errors. The paired corrected source passed all 91 tests (exit 0). See the preserved [paired logs and JSON results](raw/source/negative-control-results.json), including the [original log](raw/logs/negative-control-ae8.log), [corrected log](raw/logs/negative-control-corrected.log), and their JSON reports.

The exact [mirror preparation script](raw/scripts/prepare-negative-control.mjs) and its bootstrap/preparation logs are retained for provenance. It writes a fresh `negative-control` directory beside itself and links to dependencies from an admitted checkout; it is evidence of the executed setup, not intended to be rerun from this published packet.

## Focused checks and limits

The final focused domain command passed all 91 tests across four files. The handoff also records passing domain no-emit typecheck, focused ESLint, Prettier check, and `git diff --check`. No build or TypeScript emission ran. The [runtime readback](raw/source/runtime-artifact-readback.json) compares 1,227 `dist` files and 11 `.tsbuildinfo` files against baseline; all matched, with no differences.

This packet is focused source and regression evidence. Native verification, a rebuild, full CI, full coverage, and final independent review are outside it and remain separate gates. No provider was called. The mirrored workspaces, dependency trees, build output, secret material, and raw session/event streams are not included. The preserved mirror manifest records dependency junction locations but does not copy dependency contents.

See [manifest.json](manifest.json) for source-to-copy hashes and sizes, [link-checks.json](link-checks.json) for local link verification, and [SHA256SUMS.txt](SHA256SUMS.txt) for packet integrity.
