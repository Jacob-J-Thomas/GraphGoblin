# #505 mid-body timeout correction: author evidence

Actual Claude Code authored this correction; root separately confirmed its successful runtime. This is selected **author evidence**, distinct from independent QA, formal review, CI and integration approval. Publication preparation ran no new tests and read no private provider stream.

The working source is based on `c99a93d228646431083c9ca63625674115f5c40a`. Final test SHA-256: `70f06fa3abb5a13b5d525799b2c675c6564f2483aa082708f0bcbc3e321edcfb`. [Source binding](raw/source-binding.json), [final maintained test](raw/sources/final.probe-directory.test.ts.txt), [two-file correction](raw/sources/final-vs-c99.diff). It changes the lifecycle test hook and related regression/documentation; production paths, pre-entry guards, ordinary deadlines, assertions and coverage floors remain unchanged.

The hook reports a late body rejection when it is a different object from `context.signal.reason`. It avoids reporting the already-recorded abort object again. The two new maintained rows require no extra report for that object, and a report for `structuredClone` of it. A different object with the same name, message and stack must remain visible; matching text is not a reason to drop it.

## Old and final native outcomes

All eight selected runs use native Windows, Node 22.23.4 and Vitest 5.0.3. The real builtin import completes in about 1 ms; the witness then withholds its available result until 650 ms after the actual default timeout or requested cancellation. This is an artificial timing control, not evidence of a naturally slow import. [Compact snapshot](snapshot.json) contains exact worker/reporting facts and full error-string hashes.

| Control                                                 | Published c99 source                | Final source                                              | Raw final result                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Maintained row, held past the real 5 s timeout          | Two identical timeout reports       | One timeout report                                        | [Vitest](raw/runs/final-held-timeout/vitest.json), [events](raw/runs/final-held-timeout/events.jsonl)                                |
| Body throws a different copy of the timeout object      | Timeout plus copy                   | Timeout plus copy; identical strings remain intentionally | [Vitest](raw/runs/final-held-timeout-copy/vitest.json), [object-identity observation](raw/runs/final-held-timeout-copy/events.jsonl) |
| A probe fails independently after the timeout           | Two timeout reports plus late error | One timeout plus independent late error                   | [Vitest](raw/runs/final-held-timeout-late/vitest.json), [events](raw/runs/final-held-timeout-late/events.jsonl)                      |
| Programmatic user cancellation while the result is held | Two skips, no error                 | Two skips, no error; queued successor does not run        | [Vitest](raw/runs/final-held-cancel/vitest.json), [controller](raw/runs/final-held-cancel/controller-events.jsonl)                   |

The [original c99 timeout result](raw/runs/c99-held-timeout/vitest.json) is retained, together with all four paired baseline/final records. Every command deliberately exited 1. Timeout controls keep one failed first test and a passing successor. Cancellation interrupts the run and skips its successor; it is not an exit-0 pass. The recorded cases started no fake CLI, and post-run process checks were empty. Runner TEMP was empty after close and before owned disposal.

Copy/independent-late variants do not execute the original row's `localMockRestored` marker, so its false value is preserved. Their direct `rmImplementationRestored`, environment and owned-root observations remain clean; the snapshot does not silently rewrite the marker.

## Maintained regression and gates

The baseline focused suite passed 12/12. Final [focused output](raw/gates/80-focused-final.stdout.txt) passed 14/14; the final [adapter suite](raw/gates/81-adapter-suite.stdout.txt) and [coverage output](raw/gates/82-adapter-coverage.stdout.txt) each report **652 passes and four existing live skips**, with 16 files passed and one live file skipped. Ordinary test children use the repository fake CLI; no live provider CLI was tested. Claude was the author, not the fake CLI.

Coverage: **99.42% lines (521/524), 95.61% branches (480/502), 99.32% functions (148/149), 98.3% statements (579/589)**. Final [lint](raw/gates/83-adapter-lint.receipt.json), [typecheck](raw/gates/84-adapter-typecheck.receipt.json) and [format](raw/gates/85-prettier-check.receipt.json) all exited 0 on the same final hash.

The [exact mutator](raw/harness/mutate.mjs) and its apply/restore receipts retain three discriminating controls. Reverting to the [c99 hook](raw/gates/9x-mutant-c99-hook.stdout.txt) fails the same-object row (1/14 failed). [Text-based deduplication](raw/gates/9x-mutant-message-dedupe.stdout.txt) fails the distinct-copy row (1/14). [Dropping every late error](raw/gates/9x-mutant-drop-all-late.stdout.txt) fails the copy row and existing in-flight case (2/14). Each mutant exited 1 and restored the final hash.

The superseded draft `9fc8ff8d63a6dd74acffa616ced1dc3b1256568765828704b8f74c805cdc18c9` failed [lint](raw/gates/73-adapter-lint.stdout.txt) and [typechecking](raw/gates/74-adapter-typecheck.stdout.txt): unsupported `Promise.withResolvers` typing and `prefer-const`. The final regression uses the normal signal's abort event. [Draft-to-final difference](raw/sources/final-vs-intermediate.diff) and original failed receipts remain; final gates do not erase them.

## Provenance and limits

The authoritative author seal is `9e3c7214a5053fc7f0e6a46df1a84b741c08ff9773fa2373672fd521cf1ef088`, covering 172 payloads. [Original seal](provenance/original-author-SHA256SUMS.txt), [source mapping](source-to-public-manifest.json), [publication checks](publication-verification.json), [component seal](SHA256SUMS.txt). Selected raw bytes are unchanged. Duplicate generated inputs, caches, full documentation copies, empty logs and older runtime attempts are omitted. Historical owned paths remain only where needed in raw records.

The earlier large packet stays at its [immutable public location](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c99a93d228646431083c9ca63625674115f5c40a/docs/qa/2026-11-18-probe-preaborted/independent/README.md). This component makes no claim about natural-stall frequency, other platforms, physical interrupts, worker death or live providers. The separate `probeCase` finish hook is unchanged; a future probe body rethrowing its own abort reason is outside these observed paths. The containing owner supplies root attributes preserving raw bytes and LF READMEs; no nested attributes file is added.
