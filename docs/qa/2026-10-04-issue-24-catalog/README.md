# Issue #24: Settings model catalog

Captured on 2026-10-05 in headless Microsoft Edge, with a 1440 × 900 viewport, against the built web app served by the E2E server's isolated API and in-memory database. The folder retains the date requested for this issue's evidence.

- Idle: [Dark](model-catalog-dark.png) and [Light](model-catalog-light.png) show the LiteLLM note naming the Settings guide section, no Add/Edit/Delete actions, GPT-6 Luna focused through Tab, and GPT-6 Sol disabled.
- Pending: [Dark](model-catalog-dark-pending.png) and [Light](model-catalog-light-pending.png) show a held PATCH with an hourglass and Disabling announcement. The switch retains keyboard focus, uses aria-disabled and aria-busy, and ignores further activation.
- Refused: [Dark](model-catalog-dark-refused.png) and [Light](model-catalog-light-refused.png) show a controlled 403 refusal, its announced reason, and the restored Enabled state. The Default model choices remain unchanged.
- The existing #8 Switch is used, with aria-disabled styling and activation guarding added. Only the pending thumb is dimmed, preserving focus-ring contrast. Each row uses the shared Settings EnableSwitch for pending state, rollback, and announcements; no focus-restoration effect is needed.

LiteLLM row presence is a temporary proxy for provider configuration until #25 supplies a provider-configured signal. The product note names the Settings guide, Choose a model and effort, without a network link, and waits until the catalog loads.

`SettingsPage.test.tsx` covers harness-only and mixed catalogs, local-model actions, the loading note, vanished-model refresh and heading focus (without stealing focus from another control), and saved disabled/missing defaults. `settings/shared.test.tsx` covers generic refusal-message mapping, pending state, rollback, retry, and two held PATCH requests resolving in either order while focus stays on the second switch. The mapping tests do not claim that PATCH returns LiteLLM creation or harness metadata refusal codes.

Edge `e2e/actions.spec.ts` checks the real API's PATCH toggles through Tab/Space/Enter, absent harness actions, the guide note without a link, saved-default truthfulness against GET /settings, keyboard selection of (server default), a controlled vanished-model 404 with refreshed list and heading focus, and both themes' held/refused states. A LiteLLM row seeded by the control endpoint exercises real PUT editing without enabled and real 409 LITELLM_NOT_CONFIGURED on Add with source: litellm. Route handlers only answer requests; assertions run outside them.

To reproduce the screenshots, build from the repository root with `pnpm.cmd build`, then run `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/actions.spec.ts -g "Settings catalog has visible keyboard focus"`. Each test writes three element screenshots under `apps/web/test-results/`; copy the six model-catalog PNG files into this folder. Repeat the catalog scenarios with `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/actions.spec.ts -g "Settings (catalog|harness switches)" --repeat-each=3`.

The contrast gate enforces the existing text, switch, and focus pairs in both themes. Refusal text on a hovered row measures 8.69:1 in Dark and 7.65:1 in Light; see [the generated contrast table](../design-contrast.md). No contrast pairs or counts changed for these review fixes.

These checks establish browser semantics, keyboard operation, and token contrast. Screen-reader speech was not manually exercised. LiteLLM configuration and creation remain future adapter work.

## Review-fix verification

The requested gates pass: typecheck, lint, format:check, check:tokens, check:contrast, check:docs, web test:coverage, the contrast unit tests, build, and Edge test:e2e. Layer and licence checks also pass. No gate was blocked by the sandbox.

| Check               | Result                                                       |
| ------------------- | ------------------------------------------------------------ |
| Web unit tests      | 596 passed in 61 files                                       |
| Coverage lines      | 99.74% (3166/3174)                                           |
| Coverage branches   | 96.42% (2806/2910)                                           |
| Coverage functions  | 99.27% (1095/1103)                                           |
| Coverage statements | 99.10% (3644/3677)                                           |
| Contrast unit tests | 6 passed                                                     |
| Edge catalog repeat | 18 passed: six scenarios repeated three times (28.9 s)       |
| Full Edge E2E       | 145 passed, 1 optional LIVE test skipped, 0 failures (4.1 m) |

The first focused unit run had a failure in the unchanged API-key revocation focus test; it passed unchanged on rerun and in the complete coverage run. Initial type/lint errors in the extraction were corrected. The first Edge catalog run caught an ellipsis converted to a question mark in the test assertion; correcting that text produced the passing repeat run above.

Turbo reports shared-cache write warnings (`Access is denied`, OS error 5), without failing the tasks. Edge reports the existing NO_COLOR/FORCE_COLOR environment warning. The prescribed Node 22 dependency-cruiser invocation passed with zero errors and the two existing orphan warnings for drizzle.config.ts and playwright.config.ts. No coverage thresholds or exclusions changed. Coverage artifacts remain because command policy rejected both directory cleanup and file-only cleanup as blocked by policy.
