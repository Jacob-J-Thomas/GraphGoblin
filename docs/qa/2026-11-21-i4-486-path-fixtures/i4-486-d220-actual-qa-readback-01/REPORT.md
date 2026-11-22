# D220 actual QA evidence readback

**PASS for sealed-byte integrity and the bounded cross-artifact checks below. No substantive discrepancy found.** This verifies the completed Opus5.5/xhigh D216 supplement at e630; it does not admit archive publication, integration or merge, renew a general review, or rerun product QA. Root's full semantic readback is separate.

Every manifest member's byte count and SHA-256 matched, with exact physical membership. QA paths are relative to the attempt root despite the manifest living under `qa/`.

| Seal | Members | SHA-256 |
| --- | ---: | --- |
| QA | 181 | `3eaa90f1a2169c21b74ece8862d38131bc5736936a9904f3946870cbd0a31def` |
| Orchestration | 211 | `9191b7fd92cb9f986e9787500b0421ac12dcf0698f0271be2d2d89b11539db01` |
| Controller | 18 | `146cb37c2b5eefc7a85e6524838e586868c1304d612f9a9be1c143375e5d73d4` |

Counts overlap: orchestration includes the QA files. Controller members were stream-hashed only; private route/config metadata was not decoded, copied or displayed. The actual credential, private pin and auth/config directory were not accessed.

[Actual REPORT.md](G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-independent-02/REPORT.md) is 26,439 bytes, SHA-256 `07730a5fd022d72de3240a7288511ed6184cac6a5e33a31e8cea8c29b47a59a1`.

Exactly one raw result terminal equals `result.json`, and its result bytes equal the final-message file. It is successful/completed, `is_error:false`; actual assistant and modelUsage identities are only `claude-opus-5-5`, with requested effort `xhigh`. Provider, runner, dispatch and orchestration exits are 0. There is no cutoff/timeout/secret refusal or termination request; closure is recorded. The run finished before both the absolute cutoff and two-hour bound. The terminal reports 75 turns and **$5.2079258 estimated cost**. Actual billing remains unknown; this is not an invoiced-charge or account-balance check.

Archived source-before, QA source-after and orchestration source-after match exactly: e630 head, tree0713, parent6de, empty status, index bytes/hash, tracked-index hash, fixture and lock. Archived index stages are all zero; dependency metadata matches the original binding. Evidence fixture blobs reproduce their recorded Git blob IDs without Git execution. Replacing exactly the two native-resolver sites in baseline bytes gives candidate bytes ignoring whitespace, preserving all other text. The recorded parent tree comparison reports only `fs.test.ts` changed, with equal 38,434-entry trees. The live checkout was not probed by this verifier.

The nine Vitest invocation records agree with raw JSON reporters, worker fixture records and restoration artifacts:

| Run | Fixture/environment | Executed | Pass | Fail | Filtered | Exit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| S1a | 6de, uppercase G | 1 | 0 | 1 | 19 | 1 |
| S1b | e630, uppercase G | 1 | 1 | 0 | 19 | 0 |
| S2a | 6de, genuine C short alias | 3 | 0 | 3 | 17 | 1 |
| S2b | e630, same alias, record-only | 3 | 3 | 0 | 17 | 0 |
| S2c | e630, same alias, tapped | 3 | 3 | 0 | 17 | 0 |
| S3 | e630, ordinary G, full file | 20 | 20 | 0 | 0 | 0 |
| S4 | e630, native G junction | 3 | 3 | 0 | 17 | 0 |
| S5a | e630, worker C TEMP / cwd G, adapter | 1 | 1 | 0 | 19 | 0 |
| S5b | e630, worker C TEMP / cwd G, engine | 1 | 1 | 0 | 19 | 0 |

These per-invocation counts are not additive coverage totals. Four additional argument/resolver probes are distinct from these nine tests. Both negative controls retain the expected assertion failures and restore exact candidate bytes before positive runs. All worker fixture hashes and instrumentation modes agree; there is one runner revision, no test timeout or watcher error, and recorded post-status/relative leftovers are empty.

The observed C 8.3 alias is consistent across setup, uninstrumented resolver and worker records: long/short dev, inode and birth time match; it is not a reparse point; native and promises realpath agree; marker readback and recorded removal succeed. The existing QA-parent short component is qualified. The volume-policy query's access denial remains retained. Uppercase and native-junction identity records and the C-worker/G-cwd volumes agree. Cleanup records identity-check empty directories, unlink only the junction, use nonrecursive removals and record absent owned prefixes/relative leftovers. These are archived observations, not new filesystem probes.

Limits remain the original report's: controlled fixtures and one-file 6de byte swaps, one Windows host, worker-only TEMP in selected cases, some positive properties established by test assertions, no broad regression/gates, no NTFS-table cleanup guarantee, and no independent exclusion of harness tool-output spill on C. Root's current-target CI/native/coverage/capped completion/signed merge and owner acceptance remain separate.

The first verifier stopped after seal/provider/source checks because it confused flattened RESULTS swap fields with nested raw swap fields. Its source and failure are retained; `verify-evidence-02.py` corrected only that mapping and rechecked existing partial proofs without rewriting them. Original evidence was unchanged; no QA was rerun.

[Seals](./seal-verification.json) · [Provider](./provider-verification.json) · [Source](./source-verification.json) · [Matrix](./invocation-matrix.json) · [Native artifacts](./native-artifact-consistency.json) · [Timing](./timing-scope-verification.json)
