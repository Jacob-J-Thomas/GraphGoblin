# PR #50 second re-check: three minor fixes

All work stayed in this worktree on `codex-i6-12-actions`, without commits or index changes. No backend, contracts, dependencies, coverage thresholds, owner server, or owner data were changed. `setup.ts`, Card landmarks, API-key panel code, and the Model catalog Edit style were left unchanged.

## Reproduce, fix, verify

Before runtime edits, the new tests produced **four unit failures** and **six Edge failures** against the built app. Existing behaviour assertions remained intact.

1. **Busy Escape focus changes.** A cancelable keydown unit assertion showed Escape's default action was not prevented. With ten Escapes, Edge recorded nine native closes / eighteen focus changes after mouse Confirm, and four / eight after keyboard Confirm, for both 409 and success outcomes. The keydown handler now prevents busy Escape before native dismissal; `onClose` still reopens a genuinely closed connected busy dialog as a backstop. The Edge matrix covers mouse/keyboard Confirm, 409/success, and twelve Escape counts (1 through 10, 12, 20): **48 cases**, each asserting zero native closes and zero focus changes while busy. Error cases retain the API reason, Keep works, and idle Escape after reopening dismisses and returns focus to the trigger; success cases delete the row and focus the Loops heading.
2. **Revoking the browser's key waits for refetch.** Unit tests held the key-list refetch after a successful DELETE and proved the dialog remained open; the two equivalent Edge cases also failed. Revocation now completes on DELETE success. An optional `onConfirmed` refresh runs without extending pending state, reusing shared focus restoration after that background refresh settles. Tests cover late successful row removal and a held 401, including the real browser-key panel. Edge requires the confirmation to close before releasing the held request, the panel input to focus within 500 ms once visible, and that focus to survive the default retry and final list error. Query retry policy and panel behaviour after entering a new key are unchanged.
3. **Stale native close after reopen.** A unit test delivered a queued native close as a task after closing and reopening an idle confirmation; the reopened dialog disappeared. `onClose` now ignores a close event when the dialog is already open. Programmatic-close counters, genuine idle native closes, idle Escape, and busy-close recovery keep their existing tests.

The targeted fixed unit set passes **38 tests**; the full web run passes **201 tests in 31 files**. The existing tests for fallback headings, API-key panel focus, confirmations, and error persistence remain passing. No new screenshot capture is needed because layouts, labels, icons, and settled visual states did not change; Edge verifies interaction timing and focus directly.

## Changed files

- Runtime: `apps/web/src/components/ui/confirm-action.tsx`, `apps/web/src/settings/sections/ApiKeysSection.tsx`.
- Regression tests: `apps/web/src/components/ui/confirm-action.test.tsx`, `apps/web/src/settings/SettingsPage.test.tsx`, `apps/web/e2e/actions.spec.ts`.
- Docs: `docs/09-frontend-and-pwa.md`, `docs/guide/06-settings-and-secrets.md`, QA README, and this report.

## Gates

| Command                                            | Result                                                |
| -------------------------------------------------- | ----------------------------------------------------- |
| `pnpm.cmd typecheck`                               | Pass, 20 tasks; test files included                   |
| `pnpm.cmd lint`                                    | Pass, 11 tasks                                        |
| `pnpm.cmd format:check`                            | Pass                                                  |
| `pnpm.cmd --filter @graphgoblin/web test:coverage` | Pass, 201 tests / 31 files                            |
| `pnpm.cmd check:layers`                            | Pass                                                  |
| `pnpm.cmd check:tokens`                            | Pass, 89 files                                        |
| `pnpm.cmd check:contrast`                          | Pass, zero failing enforced pairs                     |
| `pnpm.cmd check:licenses`                          | Pass, 225 packages                                    |
| `pnpm.cmd check:docs`                              | Pass, generated references current                    |
| `pnpm.cmd build`                                   | Pass, 11 tasks                                        |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`      | Edge: 77 passed; one opt-in LIVE test skipped         |
| Node 22.14.0 dependency-cruiser                    | Pass, zero errors; three existing no-orphans warnings |

Coverage: **statements 98.34% (2078/2113), branches 93.97% (1467/1561), functions 98.18% (702/715), lines 99.29% (1820/1833)**. Web is the only changed package; thresholds and exclusions are unchanged.

Dependency checking used the prescribed command:

```powershell
& "$env:APPDATA\nvm\v22.14.0\node.exe" node_modules/dependency-cruiser/bin/dependency-cruiser.mjs packages apps --config .dependency-cruiser.cjs
```

Turbo sometimes prints a cache-access warning after successful tasks. Gates are judged by their exit codes; no exceptions or threshold changes were added. Edge runs use the production build with the repository's isolated E2E server, temporary data, and ephemeral loopback ports; teardown stops the server.

## PR #48 stand-in merge note

`apps/web/src/__fixtures__/setup.ts` was not changed in this follow-up. Its current dialog stand-in has `showModal()` setting `open = true`, and `close()` ignoring already-closed dialogs, setting `open = false`, then dispatching `close` in `queueMicrotask`. The PR #48 stand-in described in the brief should replace these overlapping dialog-method definitions; its task-based close delivery supersedes this microtask scheduling and matches the browser's event timing better. Preserve the open-state updates and closed-dialog no-op semantics in the chosen version. The other layout stubs and test cleanup are unrelated. The newly added stale-close test explicitly queues a task and does not depend on the local stand-in's scheduling. No code was imported from PR #48.

## Left open

The Card landmark nit, key-panel focus after entering a new key, and Model catalog Edit style (#24) remain outside this change. The API still cannot identify the current browser key's row; the existing owner question about conditional warnings on every revoke row remains unchanged. No new owner decision is needed. Reviewer probes remain screen-reader behaviour and native dialog timing in browsers beyond Edge, which were not exercised with assistive technology here. The opt-in LIVE Codex test stays outside this UI verification.
