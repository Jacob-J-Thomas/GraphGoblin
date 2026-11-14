# Issue #209 / PR #470 API fixture corrections

**Source:** baseline `02567f879230f8b8eebb353ea87d22ea347febdd`; test-only correction commit `d43d212335122af8a4e7856f22add5ca43b86d4a`. Corrected full CI for the source commit is pending.

CI run `43600331688` ran against the pre-correction baseline and reported **45 API failures, 1,870 passes, and 20 skips across 12 failed test files**. The same run had **1,149 infrastructure passes and 8 skips across 74 files**, after correction of the earlier 17 infrastructure fixture failures. Browser, Windows, and template jobs passed; the full run remained failed on the API suite. The [raw CI failure log](./ci/ci43600331688-gates-failure.log) is included exactly once. The [job summary](./ci/ci43600331688-final-jobs.json) records companion gate statuses.

The failures came from independent loop fixtures reusing equivalent names in one owner/store. The correction assigns explicit distinct names to separate test entities while preserving same-loop edits and existing assertions. The three [minimal patches](./patches/names-209-api-admission.patch), [runtime](./patches/names-209-api-runtime.patch), and [model/readiness](./patches/names-209-api-models.patch) groups account for 13, 14, and 18 failures respectively. Root inspected the 12 test-only diffs; no runtime code changed. The fixes do not auto-uniquify names, retry conflicts, or weaken assertions.

Focused formatting, lint, diff, bundle-integrity, and patch checks passed. See the [admission logs](./checks/admission/), [runtime check results](./checks/runtime/prep-checks.json), and [model/readiness checks](./checks/models/rawprepchecks.json). No tests, coverage, build, typecheck, or browser checks were run by the fixture-correction delegations. Run the full corrected CI before treating the fixes as verified.

See the [manifest](./manifest.json) and [artifact hash inventory](./artifact-files.sha256). The nested [`.gitattributes`](./.gitattributes) preserves hashed logs and patches byte-for-byte. Source files are not duplicated.
