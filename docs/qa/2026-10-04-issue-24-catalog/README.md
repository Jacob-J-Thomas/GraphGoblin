# Issue #24: Settings model catalog

Captured on 2026-10-05 in headless Microsoft Edge, with a 1440 × 900 viewport, against the built web app served by the E2E server's isolated API and in-memory database. The folder retains the date requested for this issue's evidence.

- [Dark](model-catalog-dark.png) and [Light](model-catalog-light.png) show the Model catalog section with the LiteLLM note and guide link, no Add/Edit/Delete actions, GPT-6 Luna focused through Tab, and GPT-6 Sol disabled.
- The screenshots were inspected in both themes. The switch is 44 × 24 px and its keyboard focus outline is 2 px. The section retains the existing table and design tokens.
- The existing #8 Switch is used unchanged. Each model has its own pending request, hourglass, state announcement, and refusal alert. Native disabled-button focus is restored only when it fell back to the document; another focused control keeps focus.

`SettingsPage.test.tsx` covers harness-only and mixed catalogs, local-model actions, all three catalog refusal sentences, pending and rollback states, retry recovery, Default model choices, and focus restoration. `e2e/actions.spec.ts` covers the real API's PATCH toggles through Tab/Space/Enter, Default model updates, absent harness actions, the note/link, a held refused toggle, and both themes' keyboard focus. Other existing Settings destructive-action scenarios remain in that spec.

To reproduce the screenshots, build from the repository root with `pnpm.cmd build`, then run `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/actions.spec.ts -g "Settings catalog has visible keyboard focus"`. Each test writes its element screenshot under `apps/web/test-results/`; copy the two `model-catalog-<theme>.png` files into this folder.

The contrast gate enforces the existing text, switch, and focus pairs in both themes. The new refusal text on a hovered row measures 8.69:1 in Dark and 7.65:1 in Light; see [the generated contrast table](../design-contrast.md).

## Verification

All requested gates passed from this worktree: `typecheck`, `lint`, `format:check`, `check:layers`, `check:tokens`, `check:contrast`, `check:licenses`, `check:docs`, web `test:coverage`, `build`, and web `test:e2e`. Dependency-cruiser passed through the prescribed Node 22.14.0 binary with zero errors and two existing orphan warnings (`drizzle.config.ts` and `playwright.config.ts`). No gate was blocked by the sandbox.

| Check               | Final result                                                 |
| ------------------- | ------------------------------------------------------------ |
| Web unit tests      | 588 passed in 60 files                                       |
| Coverage lines      | 99.74% (3154/3162)                                           |
| Coverage branches   | 96.31% (2774/2880)                                           |
| Coverage functions  | 99.27% (1092/1100)                                           |
| Coverage statements | 99.01% (3630/3666)                                           |
| Edge E2E            | 144 passed, 1 optional LIVE test skipped, 0 failures (4.9 m) |

These checks establish browser semantics, keyboard operation, and token contrast. Screen-reader speech was not manually exercised. LiteLLM configuration and creation remain future adapter work; a LiteLLM row is the current signal for showing local-model actions.
