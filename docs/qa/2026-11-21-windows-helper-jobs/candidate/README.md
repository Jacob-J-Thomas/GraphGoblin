# #459 independent native QA: candidate `11214dad` (public evidence)

The path-scrubbed public copy of the independent native behaviour QA for #459 (ADR-0086, Windows
launcher helpers own a private job). The QA ran at candidate commit
`11214dadbde049af01dd0280b9b701ad10a0f50a` (tree `409fc7e0fcefd23b68541926ad72cfbfe70d5244`)
against target `47ca4640793a81efa5bec661dba25627de314774`.

**Result: PASS for independent native QA at the exact candidate.**

- 23 criteria PASS, 0 FAIL and 8 LIMIT (`acceptance-map.json`).
- No product failure was observed.
- The LIMIT criteria are QA boundaries, not defects:
  - C14: a UI-restriction incompatibility is not constructible on this Windows build.
  - C25 to C28: setup-failure branches with source inspection or maintained-control evidence only.
  - C29: uncovered scenarios.
  - C30: cold-WMI provenance is unknown.
  - C31: the WMI service process was not witnessed.

## Contents

- `runs/`: per-lane run evidence as written by the driver. Each run has `run.json`, `summary.json`, `cases/<id>.json`, a console log and a start time. Raw folders are excluded.
  - `matched/candidate-20261121T014803Z-3edac9`: the unchanged baseline driver on the candidate (detached host, `--job-exit-code 3762750553`), 20/20 candidate-pass.
  - `job-host/candidate-20261121T015345Z-4619c4`: the unchanged baseline driver with `--launcher-host job`, 20/20 candidate-pass.
  - `ext/candidate-20261121T020839Z-081d57`: `qa459-ext/1` on the candidate, 11/11 candidate-pass.
  - `ext-baseline/baseline-20261121T021033Z-3c576e`: `qa459-ext/1` on main.
    - Results: 9 expected baseline failures, 1 control pass and 1 baseline-prediction mismatch.
    - The mismatch is `ext-compatible-job-success/short-none-quiesced-before-exit`. Main waited on a sibling member's pipe EOF for the same 2 s, so this assertion does not discriminate there.
    - The read-only main checkout state before and after the run is in `main-checkout-*.txt`.
  - `ext-dev/`: two development runs of the extension before it was frozen, retained as first results.
    - Run 1 recorded a setup fault in the two incompatible-job cases. Job accounting counts console hosts, but the active-process limit does not, so the job was not verified incompatible.
    - Run 2 validated the setup-only correction.
- `driver/`:
  - `qa459-ext/`: reusable extended driver sources, byte-identical to `qa459-ext-v1-frozen.sha256`.
  - `qa459-ext-vs-baseline.diff`: every change against the baseline driver.
  - `baseline-driver-copy-initial.sha256`: hashes of the verified copy of the untouched baseline driver.
- `setup-exploration/`: in-job nesting probes for each UI restriction, combined restrictions, inner UI-restricted jobs and active-process limits. Includes the scripts, their JSON results and the hashes of the witness builds used.
- `filesystem/`: post-run inventories of every scratch run folder (relative paths, sizes, sha256).
- `maintained-control/maintained-helper-checks.json`: the checkout's own `NativeChecks --helper-checks`, run unmodified, which passed.
- `analysis.json`: cross-run comparison.
  - Base suite: all 23 baseline expected-failure assertions flip to pass, and all 66 baseline-passing assertions still pass.
  - Ext suite: 27 expected failures flip, and all 40 baseline-passing assertions still pass.
- `acceptance-map.json`: 31 criteria. Each PASS is re-derived from the referenced candidate assertions, and referenced run files are bound by sha256.
- `tools/`: `analyze.mjs`, `acceptance-map.mjs` and `run-maintained-helper-checks.mjs` (verbatim). `package.scrubbed.mjs` is the packager with its local roots replaced by tokens, so it does not run as-is.

## Scrubbing

Case evidence is scrubbed by the driver's own `scrub`: run, scratch, checkout, driver, Node and home roots become tokens, and any other absolute path becomes `<ABS_PATH>` and the user name `<USER>`. The raw originals are not included here:

- unscrubbed launcher stdout/stderr bytes
- `events.ndjson`
- `launcher.log`
- configs and probe reports

They stay in each run's private `raw-private/` folder. A leak scan of this folder found no user name, user-profile path or scratch path. The only hits were the two generic `'C:\\Windows'` fallback literals in the driver sources, which are also present in the baseline driver.

## Exit codes (in addition to the baseline driver README)

| Code                    | Meaning                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 3762750553 (0xE0470459) | the candidate launcher's `TerminateJobObject` code (`Launcher.cs:713`)              |
| 17820 (0x459C)          | ext creator death: the witness terminated the exact launcher handle                 |
| 42078 (0xA45E)          | never-resumed probe child or refused job assignment                                 |
| 0 after creator death   | OS-assigned kill-on-close exit of the private job's members (no natural exit event) |
