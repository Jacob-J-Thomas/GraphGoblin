# Windows launcher rejection-marker correction

The [final audit finding](audit/finding.md.txt) identified a non-string value in the rejection-marker field for #496 on PR #508. The producer now maps unsupported record types to the string `unknown`. The reader requires a primitive supported string or `unknown`.

Claude Code Opus 5.5 implemented the correction. Its [author report](author/report.md.txt) records three failing tests on the original helper, 36 passing focused tests after correction and all 214 tooling tests passing coverage.

[Independent behavior QA](independent/report.md.txt) passed 83 of 83 public-interface cases on the correction. Ten cases failed on the original. The [archive replay](independent/corrected-archive-replay/replay-results.json) matched three previously downloaded hosted outcomes, including the native failure and its retained diagnostics. The [receipt](receipt.json) binds the corrected source and these results by SHA-256.

The independently observed local results cover the recorded bytes. The [PR conversation](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/508) records the Fable correction review, fresh hosted checks and integration disposition as they occur.

The author also observed a separate limit when manually passing null in place of the entire fields object. All maintained native callers supply an object. That unsupported call returns no observation and supplies no evidence of a defect in a hosted native run.
