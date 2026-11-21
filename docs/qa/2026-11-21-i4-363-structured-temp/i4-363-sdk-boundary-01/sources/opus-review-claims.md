# Review 1 of 3: #363 short exclusive scratch allocation (Claude opposite-family, read-only)

**Decision: CHANGES_REQUIRED.** The runtime change is correct and I'm not asking for any code change. The blocker is that the docs and CHANGELOG added by this patch say the 226-character temp root is supported. In the production Codex path, structured calls under that root very likely still fail. The fix is a short wording correction in two files.

## Binding
- **Head:** `76beeb0f2e99343697578c2713ac06f80d59e7b5`. I confirmed this by reading the branch ref `refs/heads/codex/gg-i4-363-structured`.
- **Tree / parent:** `2544bc2913f9cec0d95a215ea631ab62c7985c1d` / `02351e2fb932b3be44e7cc3fb3943a61d568226c`. Both come from `source-binding.json`; I couldn't check them myself.
- **Checkout vs patch:** I read `structured.ts` and `structured.test.ts` in full, plus the docs/06 and CHANGELOG hunks in place. They match the `author.patch` post-image.
- **Unchanged method:** `complete()` is byte-identical to the baseline file in `baseline-structured.original.ts`.

## Findings

### F1 (P2, in scope, blocking): the docs claim the 226-character root works, but the real Codex path still fails there
Signature: `structured-long-temp/sdk-output-schema-mkdtemp`

**Root cause.** Every structured call sends an output schema to the Codex SDK:
- `structured.ts:76` always sets `outputSchema`, and `harness.ts:249` passes it on.
- The production harness uses the real SDK client (`adapters.ts:17`, `harness.ts:104-115`, `client.ts:48`).
- In `@openai/codex-sdk` 0.160.0, the turn calls `createOutputSchemaFile` (`dist/index.js:55`). That calls `fs.mkdtemp(path.join(os.tmpdir(), "codex-output-schema-"))` (`dist/index.js:13`), with no fallback.
- No code in `apps` or `packages` changes the process temp root, so this directory goes under the same root as the scratch directory.

**The arithmetic.** At a 226-character root, the SDK's template is 226 + 1 + 20 + 6 = **253 characters**. The repo's own measurement says Windows `mkdtemp` fails with `ENAMETOOLONG` from 248 to 258 characters (`docs/qa/2026-10-19-wp-f5-launch-diagnosis.md:108`). The author's own baseline also shows Node 22.23.4 `mkdtemp` failing at 256 on this host.

**Impact.**
- **Production callers:** the engine's decision and coerce-repair calls pass no working directory (`docs/06:606-608`), so they use exactly this path.
- **What changes:** the failure still happens; it just moves later. After the patch, the scratch directory is created and a `codex mcp list` check runs (`client.ts:45`, no paid turn). The SDK's `mkdtemp` then fails, and the error comes back through the harness's generic error classification instead of the allocator's raw error.
- **Why the existing hedges don't cover it:** they mention paths created *inside* the scratch directory and "arbitrary" CLI operations. The SDK directory sits next to the scratch directory, is created on every call, and fails for the same `mkdtemp` reason the patch says it avoids.
- **Wording that is wrong:** `docs/06:601` says "This supports the tested 226-character temporary root". `CHANGELOG.md:9` says "This avoids the Windows `mkdtemp` failure under the tested 226-character temp root". That breaks AGENTS.md "Keep docs in sync" and the brief's rules: no general long-path claim, and docs bounded to the real case.
- **Delivery risk:** #363 / U4.4 could be closed on a claim the production path contradicts.
- **Why the tests missed it:** they use `FakeHarness`, which never reaches the SDK.

**Required in this PR (docs only, no runtime change):**
- `docs/06:601-602` and `CHANGELOG.md:9` should say only that the adapter's own scratch directory no longer fails at the tested root.
- Both should say that real Codex structured turns at that root are still limited by the SDK creating its output-schema directory with `mkdtemp` under the same temp root, and link a follow-up.
- The handoff report should say the same.

**This finding can be refuted without a paid turn.** An existing test setup runs the real SDK against a fake CLI (`isolation.test.ts:84-99`); the test at `:287-308` already sends a `CodexStructured` call through it and checks `--output-schema`. If that call, with no working directory and the temp root stubbed to 226 characters, succeeds on Windows, F1 is withdrawn.

**Decision for the coordinator or owner.** If #363 / U4.4 requires real structured turns to *succeed* at that root, the SDK-owned directory needs an approach choice. That is a scope increase needing human direction, not part of this PR.

### F2 (P3, non-blocking): the CHANGELOG miscounts the retries
`CHANGELOG.md:7-8` says "retrying at most four `EEXIST` collisions". The code makes four attempts in total (`structured.ts:24`), so it retries at most three times; the fourth collision is thrown. The test at `structured.test.ts:167-179` confirms this. `docs/06:598` ("tries at most four names") is correct. This can be fixed in the same edit as F1.

## Areas reviewed with no findings
- **Correctness:** the allocator change matches the contract.
  - Non-collision errors are thrown at once.
  - The caller only gets a cleanup handle after `mkdir` succeeds.
  - The working-directory precedence (`request ?? option`), the rule that configured paths are never cleaned, and the abort/cancel/cleanup/primary-failure order are all unchanged.
- **Security and ownership:**
  - Mode `0o700` matches `mkdtemp`.
  - The exclusive `mkdir` never reuses an existing name, including a planted symlink (that gives `EEXIST`).
  - Names use 4 bytes from the crypto random generator.
  - A colliding directory is never removed.
  - This is the same pattern as `cli.ts:110-124` and `claude/harness.ts:83-97`.
- **Path limits:** the old allocator worked up to a root of about 217 characters; the new one should work up to about 235, given the 258-character working-directory limit. The docs make no claim beyond that, apart from F1.
- **Random collisions:** with 32-bit names and four attempts, the risk is negligible. The 1-collision test would also catch a name that isn't random, because a repeated name would need a third attempt.
- **Layering:** `node:crypto` is built in and already used in this package. No new dependency, injection point or schema.
- **Test quality:** good for what it tests.
  - Collisions are real `EEXIST` errors from a second actual `mkdir`, and the marker files are checked afterwards.
  - Errors are checked by identity, and abort-during-allocation uses a real `mkdir`.
  - Cleanup failures don't hide the primary error.
  - The precedence test confirms nothing is allocated or removed.
  - Injected errors are labelled as injected.
  - Its only limit is staying at the fake-harness level, which is F1.

## Optional follow-ups (not blocking, for the coordinator to decide and file)
1. **The SDK's output-schema `mkdtemp` under long temp roots:** the issue-ready follow-up from F1, with current behaviour, the 253-character arithmetic and the evidence above. I couldn't check GitHub for duplicates.
2. **Three copies of the allocator (P3, low priority):** the same loop exists in `cli.ts`, `claude/harness.ts` and `structured.ts`, and `structured.ts` uses a literal `4` where the others use a named constant. The contract rules out a shared helper in this PR.

## Limits of this review
- **Nothing executed:** I only read files. I ran no commands, tests, lint, typecheck, coverage or CI. Every result in this review that comes from running something is author-reported.
- **Author evidence I read:** the baseline log (1 failed, `ENAMETOOLONG` from `mkdtemp`), the candidate log (21/21 passed) and `command-outcomes.json`.
- **Not verified:** the tree and parent SHAs, all hashes (not recomputed), and whether the working tree is clean.
- **F1 is an inference from reading code, not reproduced:** it rests on the SDK source, the path arithmetic, the repo's measured range and the author's baseline.
- **No GitHub access:** I haven't read the #363 text or checked for duplicate issues.
- **Still pending:** final Astra MAX review, independent QA, and CI on the exact head and current target.