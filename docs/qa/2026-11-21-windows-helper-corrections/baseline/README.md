# #459 D166 correction: independent baseline QA (public subset)

Public-safe subset of the independent baseline QA at held head
`2164cd11624c88d66ae64d1ac86ae26505a6c1ea` (tree `0b1a84d1c881518b4744e2565a2874ec481921fc`,
target `47ca4640793a81efa5bec661dba25627de314774`). The verdict is **BASELINE CHARACTERIZED**: F3
was observed through the compiled public ownership path. **F4 is SOURCE-ONLY** and **candidate QA
is PENDING**. This is not a PASS, review sign-off, owner acceptance or merge permission.

- `REPORT.md`, `case-results.json` and `acceptance-map.json` hold the report and machine-readable
  results.
- `driver/v1/` and `driver/v2/` hold the frozen independent driver, harness and fixture sources.
  Each has a `MANIFEST.sha256`. `driver/freeze-v*.json` records each freeze, and
  `driver/v1-to-v2.cases.diff` is the single expectation correction. Use v2 for candidate QA.
- `runs/<runId>/` holds the path-scrubbed per-case projections written by the driver.
- `setup/` holds scrubbed build/compile hashes, install/build exits, git state before and after,
  and run launch logs.
- `tools/qa459i-aggregate.mjs` derives the projections from the private records only.

Scrubbing replaces the scratch, checkout, output and home roots with `<scratch>`, `<checkout>`,
`<out>` and `<home>`, and the account name with `<user>`. The frozen driver keeps that account
name only as a literal scrub pattern so its bytes match its manifest. Raw original bytes are kept
privately with SHA-256 and byte lengths, including the store sentinel's invalid UTF-8 bytes. Raw
command and environment streams are not published. `MANIFEST.sha256` lists every file here except
itself.
