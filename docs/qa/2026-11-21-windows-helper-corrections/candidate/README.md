# #459 D166 corrected-source independent QA (public subset)

Public-safe subset of the independent corrected-source QA of
`37803eeef9f55c2a316289aa502798025a7873be` (tree `647d297990837f7f21e0054c5be15a0109fab2f1`,
parent `2164cd11624c88d66ae64d1ac86ae26505a6c1ea`, target
`47ca4640793a81efa5bec661dba25627de314774`).

**Verdict: PASS (bounded).** The frozen F3 replay conformed 16/16, with 176/176 controls. F4 passed
8/8 through the product's `HelperProcess.AwaitCleanup` seam, and 3/3 relevant native regressions
passed. No setup correction was used. This is not hosted CI, review, owner acceptance or merge
permission. All limits are listed in `REPORT.md`.

- `REPORT.md`, `case-results.json` and `acceptance-map.json` hold the report and machine-readable
  results.
- `sources/f4/v1/` and `sources/native/v1/` are byte-unchanged copies of the frozen extensions,
  each with its own `MANIFEST.sha256`. Their freeze records are `sources/*/freeze-v1.json`.
  `sources/tools/` holds byte-unchanged copies of the freeze, aggregate, scrub, verify, manifest
  and scan helpers.
- `runs/<runId>/` holds the per-case projections that the frozen F3 driver v2 wrote and scrubbed.
  The driver itself is reused unchanged from the baseline public subset (`driver/v2`, manifest
  `766811a8…`).
- `f4/<runId>/` and `native/<runId>/` hold the scrubbed run records.
- `setup/` holds scrubbed git state, build and run meta/stdout, the F3 build record, the
  pre-freeze compile checks and post-QA verification.

Scrubbing replaces the scratch, checkout, output, baseline and home roots with `<scratch>`,
`<checkout>`, `<out>`, `<baseline>` and `<home>`, and the account name with `<user>`. The two
frozen extension drivers keep the account name only as a literal scrub pattern, so their bytes
still match their manifests. Raw original bytes, including invalid-UTF-8 sentinels and escaped
payloads, are kept privately with SHA-256 and byte counts. `MANIFEST.sha256` lists every file here
except itself.
