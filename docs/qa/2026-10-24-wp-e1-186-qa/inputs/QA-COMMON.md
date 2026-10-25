# Common instructions for independent QA (2026-10-18 batch)

You test a reviewed work package against the running product and its public interfaces. You are not the implementer or the reviewer. You change no production code; you may add failing regression tests as `test.todo` or clearly skipped tests with the exact reason, and you write a QA report. Read `COMMON.md` first, then the package brief, then the bolt issue bodies (the `qa:touched-systems` scope applies: enumerate every system the change touches and test each with positive and negative cases).

## Setup

- Work in the worktree and branch you are given. With Node 22 first on PATH: `pnpm install --frozen-lockfile` if needed, `pnpm build`, then start a disposable instance: a temporary data directory (inside the worktree or the system temp folder), a free port in 5600 to 5699, an API key created by the binary, the fake harness unless the brief authorises live turns. Never touch ports 4747/4748, the owner's store or the main checkout.
- Browser testing uses Playwright on Microsoft Edge (`GG_E2E_BROWSER_CHANNEL=msedge`), either through the repository's e2e server (`apps/web/e2e/server.ts`) or a Playwright script against your disposable instance.

## What to test

1. Every acceptance criterion of every bolt in the package, through the UI, the REST API, the MCP tools or the CLI as appropriate: positive case, negative case, and the failure, concurrency, cancellation and restart cases the criterion implies. Restart means stopping the process and starting a new one on the same data directory.
2. The systems the change touches beyond the bolts' own surface: adjacent routes, inspector views, settings, MCP tools, exports, the CHANGELOG's upgrade note (does it describe what an operator must do?).
3. Adversarial inputs: boundary sizes, malformed payloads, rapid repeated actions, stale clients, reloads mid-flow, two tabs, narrow viewport, keyboard-only navigation for any UI change.
4. Native claims (shutdown, restart, subprocess): verify with the real built process, never by reading the code.

## Record

Write `docs/qa/2026-10-18-<package>.md` in the worktree with: build revision, environment (data directory, port, browser), the systems enumerated, a table of every check (system, case, steps, expected, actual, pass/fail, evidence such as a response body, a screenshot path under `docs/qa/2026-10-18-<package>/`, or a log excerpt), every defect with severity (blocker, major, minor) and reproduction steps, and the list of criteria you could not test with the reason. Fake-only evidence is labelled fake-only. Do not call a human-reported defect disproven if you could not reproduce it; record what you tested.

## Report shape

1. **Verdict:** pass, pass with minor defects, or fail, with the revision tested.
2. **Defects:** numbered, severity, steps, expected, actual, evidence.
3. **Coverage of criteria:** per bolt, per criterion: tested and passed, tested and failed, or not testable (why).
4. **Report path and evidence folder.**
5. **Observations outside scope.**

Codex QA workers: work alone in your thread, never commit, never delete directories (list them for the orchestrator), and finish with this report.
