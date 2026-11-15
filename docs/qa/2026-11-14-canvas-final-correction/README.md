# Issue #207 final correction evidence

This packet preserves the completed source-correction handoff and its focused verification. The worker metadata projection is derived only from `launch.json` and `exit.json`; raw worker result and event streams are not included.

## Source identity

- The worker started from HEAD `64a955887962f72287e532824be1b8cb32c5f055`, tree `a6691516210eb25887cb92abdcbd8c7abe1a4bb3`. Its [working-source manifest](raw/changed-files.sha256) lists 18 changed source, test, and documentation paths.
- Root later froze those exact 18 source paths as commit `bc9094fd426fe1c1a4b81b0e490e3887f977dbc7`, tree `c8841e39d83bf292553d840de4bf3cadc6097824`, parent `64a955887962f72287e532824be1b8cb32c5f055`. The [committed manifest](root-supplement/final-correction-committed-manifest.json) records 18 verified blobs and zero evidence files/bytes in that commit; the [root source inspection](root-supplement/final-correction-root-source-inspection.md.txt) explains its acceptance boundary.
- Worker: `claude-opus-5-5`, `xhigh`, exit code 0, from the safe [metadata projection](worker-metadata.json).
- The patch addresses two causes: d3 `click.drag` can cancel the first Remove after a pan, and blank-ID edges have no direct recovery in the validation UI. The tracked and new-file patches, plus the three new source/test files, are preserved under [patches](raw/patches/).

## Worker-focused evidence

- Final focused Vitest: **203/203 passed** across 12 files. The final log is [here](raw/logs/21-final-focused-vitest.log).
- Web `tsc --noEmit` (including e2e source), ESLint on 14 changed web files, Prettier, and diff checks passed: [typecheck](raw/logs/22-final-tsc.log), [lint](raw/logs/23-final-eslint.log), [format](raw/logs/24-final-prettier.log), and [diff checks](raw/logs/26-final-diff-check-noindex.log).
- The real xyflow/d3 jsdom contract needed two fixture corrections (event `view`/ResizeObserver `contentRect`, then using `jsdom.window`) and one observation adjustment because Remove stops propagation before window bubble. Attempt 4 passed **5/5**, then five sequential stability runs also passed **5/5** each. Earlier failures remain in [attempts 1](raw/logs/03-contract-attempt-1.log), [2](raw/logs/04-contract-attempt-2.log), and [3](raw/logs/06-contract-attempt-3.log); the final pass and stability evidence are [attempt 4](raw/logs/07-contract-attempt-4.log) and [5× stability](raw/logs/10-contract-stability-5x.log).
- Against old production code, the contract control was **4 failures / 1 pass**; the old recovery UI had **2 failures**. See [old-code contract controls](raw/old-code-run/contract-on-old-code-2.log) and [recovery control](raw/old-code-run/recovery-indicator-on-old-code.log). The `EditorPage` NaN warning was also checked against old code and is inherited: [old-code warning record](raw/old-code-run/editorpage-nan-on-head.log).

## Process note and remaining boundary

The worker briefly used `git add -N` on three new files, then immediately reset those paths. Root verified afterward that the index was empty relative to HEAD and the files were untracked. No commit was made by the worker; the later root freeze is the separate commit recorded above.

The worker did not execute browser e2e, native, build, coverage, or current-target CI. At the later root inspection, source was accepted for freezing and bounded independent native checks, not release; current-target CI/coverage, opposite-family review, fresh Astra, final-main integration, and owner acceptance were still pending. Root recorded zero formal scans at that inspection.

The D3 node-drag behavior remains a source-inferred caveat requiring bounded reachable QA. Root specifically calls for checking whether the selected-edge toolbar remains reachable immediately after an ordinary node drag or supported modifier drag. If an available Remove control loses its first trusted click under the D3 blocker, this packet does not waive that case or reclassify it as out of scope.

## Preserved records

- [Full exact handoff](raw/handoff.md.txt) and [worker report](raw/report.md.txt)
- [18-path working-source hash manifest](raw/changed-files.sha256)
- [Old-code restoration hash records](raw/old-code-run/new-hashes-before.txt) and [interim old-code hashes](raw/old-code-run/old-hashes-during.txt)
- [Copy manifest](copy-manifest.json), [link audit](link-check.json), and [SHA-256 inventory](SHA256SUMS.txt)
