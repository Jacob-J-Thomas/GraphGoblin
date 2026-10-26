# Before: explicit harness switch (#204)

Baseline: `453aee676882f188429080e948dcd7918f09adfd`, Node 22.14.0, `pnpm.cmd build` passed (11 tasks). Built API and web, Edge headless, disposable `%TEMP%/gg-wp-f2b-native-*` data, port 5830, native synthetic CLI executables built from `tooling/fixtures/model-switch-cli.cs`. Both no-turn probes returned ready. No provider calls.

`pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/harness-switch-native.mjs` exercised configured, absent and disabled defaults and an HTTP 503 catalog fixture in both directions. See [native-before.json](native-before.json).

- Codex to Claude retained `gpt-6-astra` and `minimal` in all four cases. With a loaded catalog the model said “Saved model belongs to Codex”.
- Claude to Codex retained `claude-fable-5-1` and `high` in all four cases, labelled “Saved model belongs to Claude” with a loaded catalog.
- The failed lookup preserved the authored values as `(saved)` and showed the catalog problem. Disabled defaults were not re-enabled.

Regression component cases written before production changes failed with `Expected ... claude-fable-5-1; Received ... gpt-6-astra` (and the inverse). Eight direction/default cases and effort preservation demonstrated the missing switch behavior. A tenth failure was a test synchronization error after the form remount (loading versus failed catalog wording); that assertion was corrected to await the completed lookup. Initial native collector setup also needed attached-option waits and keyboard radio selection; those were collector corrections, not product changes.

## Round 2 baseline: B1, B2 and B3

Reproduced on built HEAD `f6650ce9884576a014bfb27b7990cba6bc1391f7`, before the round 2
production edits. Edge used the native synthetic CLIs, a fresh disposable store on port 5832,
and no paid turns. [round2-before.json](round2-before.json) records all 14 observations; the
collector's retained source is `%TEMP%/gg-wp-f2b-native-B51FnG/results.json`.

| Review item                                                | Codex to Claude                                                               | Claude to Codex                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B1: both node overrides absent, successful initial checks  | Pinned Fable / high instead of staying unset                                  | Pinned Astra / high instead of staying unset                               |
| B2: distinct loop model ahead of owner/ecosystem           | Loop Fable / low lost to owner Opus / high                                    | Loop Astra lost to owner Luna; supported high effort stayed                |
| B3: first Settings/preflight responses delayed 1.5 seconds | Retained old Astra / minimal with a Reload notice, leaving a mismatched draft | Retained old Fable / high with a Reload notice, leaving a mismatched draft |

The component fail-before run had 19 passing and 5 failing tests: both loop-over-owner cases,
both disabled-loop effort-precedence cases, and the early-switch loading case. The inheriting
case's pinning is established by the built-app observations above; round 2 also adds component
checks after successful lookups and with lookups still pending. The old collector's pre-switch
network-idle/readiness waits were removed. Only the isolated inheritance and competing-defaults
cases wait for their first checks to distinguish B1/B2 from B3; the explicit early-switch case
deliberately switches while first checks are pending.
