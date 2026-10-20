# Before: explicit harness switch (#204)

Baseline: `453aee676882f188429080e948dcd7918f09adfd`, Node 22.14.0, `pnpm.cmd build` passed (11 tasks). Built API and web, Edge headless, disposable `%TEMP%/gg-wp-f2b-native-*` data, port 5830, native synthetic CLI executables built from `tooling/fixtures/model-switch-cli.cs`. Both no-turn probes returned ready. No provider calls.

`pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs` exercised configured, absent and disabled defaults and an HTTP 503 catalog fixture in both directions. See [native-before.json](native-before.json).

- Codex to Claude retained `gpt-6-astra` and `minimal` in all four cases. With a loaded catalog the model said “Saved model belongs to Codex”.
- Claude to Codex retained `claude-fable-5-1` and `high` in all four cases, labelled “Saved model belongs to Claude” with a loaded catalog.
- The failed lookup preserved the authored values as `(saved)` and showed the catalog problem. Disabled defaults were not re-enabled.

Regression component cases written before production changes failed with `Expected ... claude-fable-5-1; Received ... gpt-6-astra` (and the inverse). Eight direction/default cases and effort preservation demonstrated the missing switch behavior. A tenth failure was a test synchronization error after the form remount (loading versus failed catalog wording); that assertion was corrected to await the completed lookup. Initial native collector setup also needed attached-option waits and keyboard radio selection; those were collector corrections, not product changes.
