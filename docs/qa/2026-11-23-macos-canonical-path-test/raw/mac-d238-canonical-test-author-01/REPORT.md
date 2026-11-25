# D238 canonical database-lock test correction

The shared-database test now resolves the already-created fixture database with Node's `realpath` after the original owner is ready. It appends the lock suffix to that physical path. The contender still gets the original aliased input. The two-line diff preserves the exact one-line refusal, control-character checks, writer and database records, contender release and authenticated HTTP response assertions. [Changed source](G:/ggq/gg-macos-current-main/GraphGoblin/apps/api/src/main.test.ts:234) · [Patch](canonical-test.patch)

The first Mac CI attempt reported 210 passes, eight skips and one failure. Its expected name started with `/var` and the real API diagnostic named `/private/var`. That attempt skipped the Swift and installer acceptance steps, and artifact upload separately timed out. The correction follows the admitted test-only scope. [Original Mac log](G:/ggq/delivery-evidence/2026-11-17-five-intents/mac-d237-ci-first-failure-01/mac-job.log:510) · [D238 decision](G:/ggq/delivery-evidence/2026-11-17-five-intents/mac-d238-canonical-test-admission-01/decision-238.md)

| Check under Node 22.23.4 | Result |
| --- | --- |
| Prettier check of the changed file | Pass |
| ESLint on the changed file | Pass |
| Full API package typecheck | Pass |
| Focused existing test with a single worker and zero retries | 1 passed, 20 filtered out |
| Git diff whitespace and path scope | Pass |

Vitest 5.0.3 rejected the initial command's `--minWorkers` flag before selecting or running a test. The second invocation removed that unsupported flag and retained `--maxWorkers=1` and `--retry=0`. The first command receipt and its output remain alongside the successful invocation. [First command](04-focused-case.json) · [Successful command](05-focused-case.json) · [Test output](05-focused-case.stdout)

Source readback found one unstaged path at integration commit `504afbc6d799aa21b16158248ade424783ecc2ce` and tree `3bdfeac6dded28ac73d4796de86955a115fc56a6`. The index SHA-256 matches pre-edit and the staged diff is empty. The built API entry and production lock implementation hashes match their pre-edit values. [Before](source-before.json) · [After](source-after.json)

The author heavy slot is released to independent alias QA. The focused pass is from the Windows-hosted integration checkout. Native Darwin alias behavior, current seven-job CI and the next admission gates remain pending.

