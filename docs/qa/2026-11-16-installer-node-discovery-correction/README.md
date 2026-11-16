# PR #497 missing-Node discovery correction

This packet preserves a narrow local correction to the installer default-Node discovery path and its focused evidence. The root receipt accepts the correction and focused evidence. The corrected hosted 32-case matrix and rollback remain pending; this packet is not a hosted candidate pass, full CI result, formal review, or owner acceptance.

## Change

The correction is limited to `scripts/install-windows-launcher.ps1` and `tooling/scripts/windows-launcher.acceptance.mjs`. When `-NodePath` is omitted and no `node.exe` is discoverable on `PATH`, the parameter default now projects `Source` with `Select-Object -ExpandProperty Source`. The empty result reaches the existing guarded installer path and its missing-Node guidance instead of dereferencing `.Source` under inherited strict mode. Explicit `-NodePath` validation stays on its existing path.

The focused acceptance test exercises omitted `NodePath` for both missing and available Node discovery. The missing control checks exit 1, Node 22 and `-NodePath` guidance, absence of the prior property error, unchanged installed files, and an empty store. The regex does not independently require the literal `22.22.2`.

## Focused evidence and sequence

- The pre-fix regression reproduced the original null `.Source` / `PropertyNotFoundStrict` failure: [output](source/focused-prefixed.log), [exit receipt](source/focused-prefixed-exit.json).
- The first post-fix run refused the positive fixture because its port differed from the valid PWA shortcut's app ID: [output](source/focused-postfix.log), [exit receipt](source/focused-postfix-exit.json). This was a fixture mismatch; the installer correctly refused it.
- After correcting the fixture to use the valid PWA port, the actual Windows PowerShell 5.1 focused group passed 1/1 under Node `v22.23.4`: [output](source/focused-final.log), [exit receipt](source/focused-final-exit.json).
- That focused run preceded a formatting-only edit to the MJS test. No test was rerun after that edit. Scoped lint, final scoped formatting, and `git diff --check` passed; the initial Prettier check failed before the format-only correction. The [logs and receipts](source/) preserve that sequence.

The exact before/after snapshots, two-file diff, source identity receipts, focused logs, and command receipts are in [the complete original packet](source/full-report.md.txt). Its README bytes are unchanged; its original links retain source context.

## Static source binding

The [fresh corrected-candidate source manifest](provenance/launcher-436-discovery-corrected-candidate-source.json) covers six files. It records the corrected installer at 23,999 bytes with SHA-256 `c50646bf4324388b934ddea4c04deb1f55f6919b49c867c0b21ece09cf756d99` and the acceptance MJS at 53,002 bytes with SHA-256 `8ef3002ce1717baaf389ce9306f48757906b7ab352d708c10aed2d758f13209f`; four other files remain unchanged.

The [root static readback](provenance/436-corrected-source-and-seals-root-readback.json) verifies the corrected installer snapshot, five unchanged publisher declarations, and 19 unchanged active QA packet members. This was a static readback, not hosted execution.

The [root correction receipt](provenance/436-node-discovery-root-acceptance.json) verifies all six live files in the candidate source manifest and records acceptance of the narrow correction and focused evidence. It explicitly leaves corrected hosted matrix, rollback, full CI, formal review, and owner acceptance pending. The earlier [failed candidate packet](../2026-11-16-installer-validation-candidate-first-failure/README.md) remains the hosted evidence for the first candidate and is not superseded by this local result.

## Recovery preparation and seals

The [recovery-binding preparation packet](preparation/README.md.txt) is retained byte-for-byte except that its README is named `.md.txt`. It predates the corrected source freeze and contains no correction result; read its checklist as preparation history.

[source-copy-map.json](source-copy-map.json) maps every source, preparation, and provenance copy to its destination with byte count and SHA-256. It also records both original packet seals. [SHA256SUMS.txt](SHA256SUMS.txt) seals every retained file in this curated packet except itself.
