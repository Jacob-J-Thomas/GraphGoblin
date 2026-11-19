# One timeout report for the test that timed out

The #466 probe tests preserve the original five-second timeout and separately report failures reached during cleanup. If a suspended test resumes and encounters the same timeout it already reported, that error belongs in the result once. Two different errors with identical text still belong in the result twice.

Independent native QA made that distinction observable by deliberately holding an already-resolved import across the timeout in a maintained combined-fault case. At commit `c99a93d2` Vitest's reporter recorded the same timeout twice. The first case still failed, its successor passed and no child survived. The unblocked import itself completed in about one millisecond. [Original A/B](original/README.md)

The correction compares the body failure with the enclosing signal's original reason by object identity. The maintained suite covers both the original object and a distinct error with the same wording. The Windows checks also exercise the two pre-entry cancellations and the distinct body and cleanup errors from the previous correction. [Author verification](author/README.md) and [independent behavior QA](independent/README.md)

The [prior correction and its full evidence](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c99a93d228646431083c9ca63625674115f5c40a/docs/qa/2026-11-18-probe-preaborted/README.md) remain available at the tested revision. The [publication receipt](receipt.json) identifies the subsequent source and retained files.
