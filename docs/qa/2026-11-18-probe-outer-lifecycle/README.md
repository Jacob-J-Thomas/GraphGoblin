# Probe lifecycle correction after the enclosing Vitest case times out

On PR #505, a real five-second Vitest timeout allowed the successor case to begin before a lifecycle regression case had restored its temporary directory and mocks. The [formal finding](formal/finding.md.txt) records that overlap on the reviewed parent.

Claude Code Opus 5.5 corrected the five affected test cases. They bind their work to the enclosing Vitest context and wait for the body and cleanup to settle. The [author report](author/README.md.txt) records the old and corrected outcomes, focused tests, typecheck, lint and adapter coverage.

[Independent Windows QA](independent/report.md.txt) exercised real deadlines. Each timed-out case retained its failure. At the start of each successor the prior body had finished, the temporary root was gone, and the environment and mock implementations had been restored. A combined failure retained the timeout, early assertion, late body failure and cleanup error. A separate witness observed a native child exit before removal. The maintained suite passed nine of nine cases.

The [six scenario results](independent/result-summary.json) and [source and evidence hashes](receipt.json) bind those observations to the specific corrected files. The [PR conversation](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/505) records formal re-review, current-target CI and final audit as they occur.
