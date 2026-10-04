# Loops and Settings actions (#6, #12)

The change gives Loops one bordered, icon-labelled Edit / Export / Delete group and uses the same soft destructive buttons and solid destructive confirmation on Loops, models, secrets, and API keys. A shared native alert dialog names the item and consequences, focuses Keep, wraps Tab, locks cancellation and duplicate submission while pending, retains API errors until dismissal/retry, and restores focus after refreshed rows disappear. No backend, contract, dependency, or model-table redesign changes.

The PR #50 review follow-up fixes native repeated-Escape dismissal, Export focus, stale 404 rows, API-key input focus, and confirmation accessibility. See [review fixes and current verification](review-fixes.md) for each reproduction, regression test, gate result, and remaining review limits. The verification below records the initial implementation.

The second re-check prevents busy Escape focus changes, separates successful revocation from its list refresh, and ignores stale native close events after reopening. See [second re-check verification and merge notes](review-recheck.md) for the current gate results and the PR #48 dialog stand-in overlap.

## Files changed

- Primitives: `apps/web/src/components/ui/button.tsx`, `confirm-action.tsx`, `index.ts`, and `components/icons/icon.tsx`; `buttonStyles` supports links and the soft destructive variant. Button props accept React 19 refs.
- Pages: `apps/web/src/loops/LoopsPage.tsx` and `settings/sections/{ModelCatalogSection,SecretsSection,ApiKeysSection}.tsx`.
- Tests: `LoopsPage.test.tsx`, `SettingsPage.test.tsx`, `components/ui/confirm-action.test.tsx`, `e2e/actions.spec.ts`, and `src/__fixtures__/setup.ts` (jsdom's missing native dialog methods; Edge verifies actual browser behaviour).
- Documentation: `docs/09-frontend-and-pwa.md`, `docs/guide/02-build-a-loop.md`, `docs/guide/06-settings-and-secrets.md`, this README, `capture.mjs`, and 40 PNGs.

## Screenshots

`before-dark`, `before-light`, `after-dark`, and `after-light` each contain five states at **1440×900** and **390×844**: `loops`, `loops-confirm`, `model-confirm`, `secret-confirm`, and `key-confirm`. Before Settings had no confirmation, so those three baseline images show its existing destructive actions without clicking them. The mobile after Loops screenshot scrolls the existing table to reveal the action group; responsive table redesign remains separate work. After screenshots include all three actual Settings dialogs.

Captured from the production build in headless Microsoft Edge using `apps/web/e2e/server.ts`: real API, in-memory database, temporary data directory, fake harness, ephemeral loopback ports. Both capture runs and the E2E runs stop their isolated servers. No owner server or owner data directory is used. Regenerate with `pnpm.cmd build`, then `node docs/qa/2026-10-04-loops-and-settings-actions/capture.mjs before` on the baseline, or `after` on this change.

The review follow-up refreshes only `secret-confirm` and `key-confirm` in the after directories: Jev startup re-seeding adds visible text and Revoke uses a ban icon. Those eight images cover both themes and viewports. The remaining 32 images retain the initial before/after evidence because those states did not visibly change. Capture specific states with `node docs/qa/2026-10-04-loops-and-settings-actions/capture.mjs after secret-confirm key-confirm`.

## Initial implementation verification

| Gate                                                      | Result                                          |
| --------------------------------------------------------- | ----------------------------------------------- |
| `pnpm.cmd typecheck`                                      | Pass, 20 tasks                                  |
| `pnpm.cmd lint`                                           | Pass, 11 tasks                                  |
| `pnpm.cmd format:check`                                   | Pass                                            |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`        | Pass, 31 files / 183 tests                      |
| `pnpm.cmd check:layers`                                   | Pass                                            |
| `pnpm.cmd check:tokens`                                   | Pass, 89 source files                           |
| `pnpm.cmd check:contrast`                                 | Pass, zero failing enforced pairs               |
| `pnpm.cmd check:licenses`                                 | Pass, 225 packages                              |
| `pnpm.cmd check:docs`                                     | Pass, generated references current              |
| `pnpm.cmd build`                                          | Pass, 11 tasks                                  |
| Node 22.14.0 dependency-cruiser, exact prescribed command | Pass, zero errors; existing no-orphans warnings |
| `pnpm.cmd --filter @graphgoblin/web test:e2e`             | Edge: 25 passed, one opt-in LIVE test skipped   |

Web coverage: **statements 98.28% (2001/2036), branches 93.76% (1413/1507), functions 98.28% (688/700), lines 99.26% (1751/1764)**. Thresholds and exclusions are unchanged. New tests cover cancel-without-request, destructive success, consequences, delayed responses and repeat clicks, 409 `LOOP_IN_USE` persistence/retry/dismissal, 404 second-delete errors, keyboard focus and restoration, a 390 px model dialog without horizontal clipping, export downloads, and revoking the browser's actual key to show the API key panel.

Screenshot review found and fixed inherited `whitespace-nowrap` / right alignment from the model action cell; the dialog now explicitly resets both without changing the catalog structure. A CodeMirror syntax-colour test failed once under overlapping gate load; the subsequent quiet coverage run passed all tests without changing that unrelated test. An overlapping lint run read temporary Playwright trace JavaScript; lint passes after E2E teardown. Turbo sometimes reports a cache “Access is denied” warning after otherwise successful tasks; gate exit codes remain zero.

## Decisions, limits, and reviewer probes

- The API does not reveal which listed key this browser sends. Whenever a browser key is stored, every revoke confirmation gives an explicit conditional warning about losing browser access and showing the API key panel. No identity is guessed. The authenticated Edge test revokes the actual browser key and verifies that panel appears. Exact per-row current-key identification would need API support outside this scope; the owner should decide whether that follow-up is wanted.
- Native `role="alertdialog"` is the shared pattern. Keep/Escape dismisses a failed operation; its reason stays visible while the dialog remains open. Review screen-reader announcement with assistive technology, which was not exercised here, and keyboard behaviour in browsers beyond the verified Edge.
- The mobile table still scrolls horizontally; #24 owns the model catalog structure and responsive layout is separate work. Dialogs fit both requested viewports and themes.
- GitHub issue reads returned 401, so the supplied brief was the scope source. The opt-in LIVE Codex test was skipped because this UI change needs no external harness call. No commits, index changes, pushes, or branch changes were made. Claude's PR #50 review led to the linked follow-up; review of those fixes remains for the orchestrator/owner.
