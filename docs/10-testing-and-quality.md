# 10 - Testing and quality

## Coverage policy (Decided)

- Unit tests must cover more than 90% of lines and more than 90% of branches in every package, including `apps/web`. Thresholds are set in each package's Vitest config and enforced in CI. A package below threshold fails the build.
- Generated code, the OpenAPI client, migrations, and fixture files are excluded from the denominator. Nothing else is.
- Coverage is measured with Vitest's v8 provider and reported per package and merged for the repo.

## Test layers (Decided)

| Layer                                 | Tooling                                                                                 | What it proves                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unit: `contracts`, `domain`, `engine` | Vitest with fake ports and a fake clock                                                 | Graph validation, patch application, exit criteria, state machine, every node handler, crash recovery, cancellation |
| Unit: adapters                        | Vitest with recorded fixtures and in-memory SQLite                                      | Event normalisation, repository behaviour, scheduler timing, signature verification                                 |
| Unit: `apps/api`                      | Vitest with Fastify inject and in-memory SQLite                                         | Every route, validation errors, auth, SSE framing and resume                                                        |
| Unit: `apps/web`                      | Vitest with Testing Library and the browser mode where DOM APIs matter; MSW for the API | Components, hooks, stores, thread projection, editor validation, update toast                                       |
| End to end                            | Playwright against a built app with a seeded database and a fake harness                | Draw a loop, publish, run, watch events, provide input, cancel                                                      |
| Live smoke                            | Nightly, behind an environment flag                                                     | A tiny Codex session and a Jev call to detect SDK drift                                                             |

## Fake harness (Decided)

`packages/engine` ships a `FakeHarness` that replays scripted sessions: items, usage, a final text, an optional structured result, and optional failures. It is used by engine tests, API tests, and E2E, so the whole product is testable without tokens. The Codex adapter's fixtures are JSONL captures of real sessions used only by the adapter's own tests.

## Adversarial QA (Decided)

The owner's chosen strategy for UI quality is heavy evaluation by adversarial QA agents rather than restructuring the UI for testability. Each milestone that touches the UI ends with a QA pass run by subagents equipped with the Playwright MCP server and computer use. The playbook:

1. Seed a database with representative loops: a two-node loop, a loop with every node kind, a loop with a subloop, and a loop waiting for input.
2. Give the QA agent the acceptance criteria for the milestone and the instruction to break the feature: unusual inputs, rapid repeated actions, reloads mid-flow, lost connections, narrow viewports, keyboard-only use.
3. The agent records every defect with steps, a screenshot, and the console log, and files them as issues.
4. Defects are fixed before the milestone closes. A regression test is added for each defect that can be reproduced in a unit or E2E test.

This process complements, and never replaces, the coverage gate.

## CI gates (Decided, in order)

1. Install with a frozen lockfile.
2. Typecheck every package.
3. Lint.
4. dependency-cruiser: layer rules and no circular imports.
5. Unit tests with coverage thresholds.
6. Licence allowlist check over the full dependency tree.
7. Dependency audit for known vulnerabilities, failing on high and critical.
8. Build every package and app.
9. Playwright E2E on the built app.
10. Build the container image on the default branch.

Nightly: live smoke suite, and the test matrix against both SQLite and Postgres once `adapter-postgres` exists.

## Fixture and SDK drift management (Decided)

- `@openai/codex-sdk` and `@typesafe-ai/sdk` are pinned to exact versions. Renovate opens upgrade PRs; the nightly live job and the recorded fixtures tell us whether the event shapes changed.
- A fixture is re-recorded with a small script in the adapter package, never hand-edited.

## Definition of done for any change (Decided)

- Tests added or updated, thresholds still met.
- OpenAPI document regenerated if a route changed, and the generated client rebuilt.
- Docs updated: the relevant numbered doc, and an ADR if a decision changed.
- No new dependency without a licence check and a line in `research/licenses.md`.
