# Captures not kept

Disposable stores, coverage directories and Playwright result folders remain local for the orchestrator to remove. No directory deletion was performed by this worker.

- Baseline `apps/web/test-results/shutdown/.last-run.json`: 96 bytes; SHA-256 `755d6a474590c6d903d6bdb68b7cae69e0770d9a1a94f824162fab85c201f8a8`. Not retained as a tracked capture; the missing-notice result and browser text are recorded in `baseline-result.log.txt`.
- Baseline `apps/web/test-results/shutdown/shutdown-drain-is-visible--96b85-nd-completion-exits-cleanly/error-context.md`: 9302 bytes; SHA-256 `239448a41f3fe891c50bf30c4e90f5e126068d11c660acc34a8f097aa4a6bf58`. Not retained as a tracked capture; the missing-notice result and browser text are recorded in `baseline-result.log.txt`.
- Baseline `apps/web/test-results/shutdown/shutdown-drain-is-visible--96b85-nd-completion-exits-cleanly/trace.zip`: 4330561 bytes; SHA-256 `07486e515172ca872c37692df8e9f0f05dd92a0465d40db1f4432f0e73c340c3`. Not retained as a tracked capture; the missing-notice result and browser text are recorded in `baseline-result.log.txt`.

- Full formatting diagnostic: 4759352 bytes; SHA-256 `1911e2238c9d9e8780baf9616bf8fa950c0cfbcd29fe690a6106155d8d9258e8`. Raw bytes kept locally at `%TEMP%/gg-wp-c7-319-evidence-876vypca/final-format-debug.log.txt`; the tracked log contains the opening and completion output.

- Final wait scenario `apps/web/test-results/shutdown/shutdown-drain-is-visible--96b85-nd-completion-exits-cleanly/trace.zip`: 6625477 bytes; SHA-256 `0628bc77dbefba89b7a74fd3b95bf2399fb68b4934066cbf72b9d971e885ccb0`. Raw local trace retained; selected text snapshots and screenshots are kept here under `final-*` names.

- Final force scenario `apps/web/test-results/shutdown/shutdown-confirmed-force-i-90d68-ves-interruption-on-restart/trace.zip`: 4179177 bytes; SHA-256 `a83af4e89ca0584c4932aa684707ffe7c32d02a945fffac56d9fd7d52422813f`. Raw local trace retained; selected restart evidence and confirmation screenshot are kept here under `final-*` names.
