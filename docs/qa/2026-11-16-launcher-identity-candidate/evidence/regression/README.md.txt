# Windows launcher alias regression evidence

Draft [PR #492](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/492) published the test-only baseline at `08e60a0ae6d6b7cae853326825365760166f3ad3` over the original product source `9fa8b2474c7290adb800c5e26be73511095cae25`. The only file changed in that commit is `tooling/scripts/windows-launcher.acceptance.mjs`, Git blob `b170ecd596ace46532dc50c8c9bf64b1344f0e9a`.

- [Frozen patch](windows-launcher.acceptance.patch) contains the regression as published. Source SHA-256 is `4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee`.
- [First lint failure](first-lint-failure.tool-result.json) preserves exit 1 and both cleanup `no-unsafe-finally` errors from the original tool result. The subsequent correction records cleanup failures and emits diagnostics before propagating the primary failure.
- [Final static checks](static-checks.json) records passing ESLint, Prettier, syntax, diff and reverse patch checks. The diff check shared a tool call with hash and diff-stat readback, so its recorded output includes those values.

This packet covers static implementation evidence. Hosted Windows execution is tracked in PR #492.
