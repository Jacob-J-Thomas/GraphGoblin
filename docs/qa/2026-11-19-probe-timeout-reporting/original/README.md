# #505 original mid-body timeout A/B

This component preserves the original finite A/B observation after the pre-aborted entry repair, before the later mid-body repair. It is evidence preparation only: no new run, review, fix or publication was performed. The historical raw label `corrected` means the entry-guard revision, not a resolution of this later observation.

The same maintained `without an abort` combined-fault branch was exercised on two source revisions. The [shared extracted case](raw/inputs/shared-extracted-maintained-case.ts.txt) has SHA-256 `f7729b7e27cc6660a5b51b607bf235158537fe08a82d9a0cdaf0fe7883c30438` in both original inputs.

| Revision                                                                                                                            | Selected worker and JSON reporter result                                                             | Successor                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Parent `0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7`, test SHA `e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75`      | Four distinct failures: default 5000 ms timeout, assertion, late body failure, root-removal failure. | Passed; one late-created root removed, zero children, environment and mocks restored. |
| Entry-guard `c99a93d228646431083c9ca63625674115f5c40a`, test SHA `bf35aebd27666194aec20fd08c4168a16c452c7706f18353e6f1afee70f590d4` | Two identical complete timeout error strings, including identical stacks.                            | Passed; no case root, zero children, environment and mocks restored.                  |

Read the [compact snapshot](snapshot.json), [original parent Vitest JSON](raw/parent-midbody-01/vitest.json), and [original entry-guard Vitest JSON](raw/corrected-midbody-01/vitest.json). The snapshot retains exact full-error-string hashes; the raw JSON preserves the complete strings. Both commands exited 1, with one failed first test and one passed successor. Neither failed result is replaced by its passing successor.

## Artificial hold and actual timing

The control calls and awaits the real first `vi.importActual<typeof probeFs>('node:fs/promises')`. It records that operation finishing, then deliberately withholds the available result until 650 ms after the actual enclosing timeout signal. Original lifecycle ownership and fault cleanup remain in the extracted source. This is a synthetic withheld result, not evidence that the import naturally blocked for five seconds.

| Worker observation, ms              | Parent | Entry guard |
| ----------------------------------- | ------ | ----------- |
| Real import resolved                | 9      | 10          |
| Actual asynchronous import await    | 0.80   | 1.33        |
| Actual default outer timeout signal | 5025   | 5015        |
| Withheld result released            | 5678   | 5680        |
| Synchronous successor observation   | 5692   | 5683        |

At release, outer and controlled signals were aborted with the same reason object. The parent started a late nested root and reached its distinct fault assertions. The entry guard prevented nested work, while the reporter serialized the timeout twice. [Parent events](raw/parent-midbody-01/events.jsonl), [entry-guard events](raw/corrected-midbody-01/events.jsonl), and both [driver summaries](raw/corrected-midbody-01/driver-summary.json) retain the worker/reporter boundary; the corresponding parent summary is [here](raw/parent-midbody-01/driver-summary.json).

There were exactly two native Windows runs, Node 22.23.4 and Vitest 5.0.3. No user-cancellation request or watchdog intervention occurred. Each successor observed settled state synchronously before any awaiting or repair. Both reporter closures left empty runner TEMP directories; the command receipts record subsequent disposal and no owned fake process: [parent receipt](raw/parent-midbody-01/command-receipt.json), [entry-guard receipt](raw/corrected-midbody-01/command-receipt.json).

## Retained input and provenance

Only the two selected generated [parent input](raw/inputs/parent/case.test.ts) and [entry-guard input](raw/inputs/corrected/case.test.ts) are retained, with their exact metadata/configs. The small [generator](raw/generate.mjs), [Vitest driver](raw/run-case.mjs) and [native command wrapper](raw/run-native.ps1) explain the control and handshake. They retain historical owned paths and dependencies; replay requires a new disposable path binding. No replay is claimed by this publication task.

The larger prior QA packet is linked rather than copied: [immutable prior independent evidence](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c99a93d228646431083c9ca63625674115f5c40a/docs/qa/2026-11-18-probe-preaborted/independent/README.md). [Immutable parent source](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7/packages/adapter-codex/src/probe-directory.test.ts) and [entry-guard source](https://github.com/Jacob-J-Thomas/GraphGoblin/blob/c99a93d228646431083c9ca63625674115f5c40a/packages/adapter-codex/src/probe-directory.test.ts) bind the maintained helpers. The [recorded package/runtime scope difference](raw/production-scope-path-diff.txt) names only the test source within that reused scope; this does not assert that no documentation changed elsewhere.

The authoritative original seal has SHA-256 `d4bdb3a0d1d8af68d1dac8c1e9193ae79c7dccd863ee71231b262559584d762f`, covering 34 payloads. [Original seal](provenance/original-note-MANIFEST.sha256), [source mapping](source-to-public-manifest.json), [publication verification](publication-verification.json), [component seal](SHA256SUMS.txt). Full source copies, duplicate extracted cases, stdout/stderr duplicates and the prior large packet are omitted. Selected raw bytes remain exact. The containing packet owner supplies root attributes preserving raw bytes and LF rendered READMEs; no nested attributes file is added.
