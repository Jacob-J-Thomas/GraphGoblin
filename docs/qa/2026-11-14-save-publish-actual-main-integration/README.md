# Save/publish actual-main integration evidence

This packet records the first bounded integration freeze of the save/publish correction stack onto actual main. It is evidence of source integration and focused checks only; it is not final review, current-target CI, native verification or owner acceptance.

## Freeze identity and merge

The integration freeze records head **da1681e4d22939033f1fc03d45ac812439c4c223**, tree **b009dd501e7f06801295f41d6c168d553d124b4d**, with parents **35bb3fbdc724a82064d0d9e65b551608542c6b22** and actual-main target **8fadcb0d44ac2caf80ff6279fe4648ce9398afd9**; common ancestor **164c01a2e3a52bf0ef69a409e1a428b45817b1b8**. See the exact [integration freeze record](evidence/actual-main-integration-freeze.json).

All product files auto-merged. The two product sides had 13 and 15 files and shared only apps/web/src/editor/store.ts; its automatic merge contains two parent comment changes that root read. This yields 27 unique, verified product source hashes. The only merge conflict was docs/qa/.gitattributes; the [resolution record](evidence/main-attributes-resolution.json) documents preserving both attribute sets. All 19,980 inherited QA blobs were verified against Git objects. The freeze record includes the 27 source hashes and the QA blob count.

## First integration checks

The first focused run passed **173 tests in 12 files**. Web no-emit typecheck, store lint and merged documentation formatting also exited 0. The exact [check summary](evidence/actual-main-checks-first.json) and four [focused test](evidence/actual-main-focused-first.log), [format](evidence/actual-main-format-first.log), [lint](evidence/actual-main-lint-first.log), and [typecheck](evidence/actual-main-types-first.log) logs are preserved. The lint and typecheck logs are empty files; their exit-zero status is recorded in the check summary and freeze record.

The [check runner](evidence/scripts/run-237-main-integration-checks.ps1), [freeze script](evidence/scripts/freeze-237-actual-main.mjs), and [attribute resolver](evidence/scripts/resolve-237-main-attributes.mjs) are included as byte-exact provenance. They document the source-hash and inherited-evidence checks used for the freeze.

## Limits and open gates

The native measurements and stack CI from the earlier 35bb corrected-stack baseline are historical evidence, not verification of this actual-main head. The actual-main source was not built or independently verified in this packet. Native geometry/action QA, final review, current-target CI and owner acceptance remain pending. One of three formal scans has been consumed; the owner item for #237 remains open. The freeze is not published.

## Copy integrity

This packet contains 10 exact source copies totaling 15,352 bytes, largest 6,898 bytes. See the [copy manifest](copy-manifest.json), [packet manifest](manifest.json), [local link checks](link-checks.json), and [SHA-256 sums](SHA256SUMS.txt). .gitattributes disables text conversion under evidence/.
