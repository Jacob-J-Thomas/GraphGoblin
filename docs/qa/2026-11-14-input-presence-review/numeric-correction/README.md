# #235 numeric Omit correction evidence

The implementation handoff records the state before native verification. It correctly says that, at that time, the production build and native browser test had not run. Subsequent independent evidence is now retained separately; neither evidence bundle is duplicated here.

## Implementation record

- handoff.md.txt preserves the original implementation handoff bytes. handoff.md is its formatted readable copy.
- patches/ contains the full and product-only diffs, base head and source hashes, all unchanged from the external implementation archive.
- logs/ contains the focused unit success, the intentional no-fix mutation failure, the first typecheck failure JSON, corrected typecheck, ESLint, Prettier, focused unit coverage, comparable four-file unit set and Playwright list-only output.
- session-metadata.json carries requested and reported model/effort/exit metadata with source hashes. It omits pid, cwd, cost, token and thinking details. The source launch requested Claude Sonnet 5.5 at xhigh; the reported canonical model is Sonnet 5.5. Effective effort was not independently verified.
- exit.json is the original small exit record. The full session result remains in the external archive; the sanitized result fields and its source SHA are recorded in session-metadata.json.

The implementation handoff records **60 focused unit passes**, the passing model-based test, and a negative-control mutant failure. These checks alone do not execute Chromium's native number-input editing buffer. The retained typecheck first failure is logs/03-typecheck-web-first-failure-retained.json, followed by the corrected pass. Its native test and build statements are historical as of handoff time.

## Later native verification

The later [numeric browser bundle](../2026-11-14-input-numeric-native/README.md) rebuilt the web app and ran all nine form-control browser cases on Edge on the first corrected-build attempt. The bundle also preserves the intended failure against the pre-correction build. The separate [independent native QA](../2026-11-14-input-numeric-omit-independent/README.md) passed desktop and coarse profiles for both - and 1e inputs, with required-number refusal, sibling preservation, SQLite persistence and 44 × 44 px representative touch targets.

These later checks establish the behavior they exercised; they do not replace full current-head CI, the reserved fresh Astra audit or owner acceptance. Neither native bundle is copied into this review proposal.
