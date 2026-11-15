# Issue #361 poll-dedupe old-behavior baseline

This packet preserves the admitted native baseline for issue #361 on merged main **15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd** (tree **57541f0423de585307f5d7db27923ddac41d7181**). The one frozen old-attempt driver exited successfully, while reproducing the predeclared old behavior in all **21 data-bearing requests** and producing **34 unique durable run IDs**. It also served 29 scheduled inert requests. A successful driver exit means the baseline observation completed; it does not mean the old behavior passed the dedupe requirement. See the byte-preserved [baseline result](baseline-result.md.txt).

## What the baseline establishes

The run exercised a real Node 22.23.4 gateway/API process, its scheduler, and a disposable file-backed SQLite database through a real process restart. The poll source was a controlled loopback HTTP fixture with scripted, provider-free responses. These results are native process and SQLite observations; they are not live-provider traffic or raw provider streams.

- The item target had P1–P4 counts of 7, 11, 14, and 18. Lone high, lone low, and trailing malformed identities recurred across item polls; valid ASCII, a complete astral pair, literal U+FFFD, and subsequent controls persisted as expected for the old behavior.
- The single lone-unit target admitted the same high-surrogate identity again at P1/P3 and the same low-surrogate identity again at P2/P4.
- The single split-pair target admitted the malformed 512-code-unit slice of a valid 513-unit source at P1–P4. P5 separately admitted the valid original 511-unit prefix.
- The valid single-key control had counts 1/2/3/3, retaining literal U+FFFD and a complete pair at the 512-code-unit boundary.
- Four deliberate unkeyed admissions produced four distinct run IDs with no **dedupeKey** field.

Every one of the 34 final fixture run IDs had one SQLite run row and a matching raw JSON initial thread. All 21 paged REST lists matched the durable IDs; sampled snapshot, thread, and event reads returned HTTP 200. Durable records remained stable after the final drain. These observations establish repeated admissions through this gateway scheduler. They do not establish lookup absence before refusal, corrected diagnostics, corrected overlap handling, or cross-process admission behavior.

## Exact source and restart identity

The root admission binds the run to main at the merge commit above, source head **e1237593babd4d03466b91685fc05dbe49223b2a**, build source **b043d3b8baafdff742803ae46750c8664067f3c7**, and the frozen fixture manifest. The admitted manifest hash is **ee4ac300e565101e79f999414ca033a4a13d9548ea7556562f30bedb3e8715e8**. Its seven input hashes are retained with the original manifest under [frozen preparation](frozen-preparation/SHA256SUMS). The separate merged-main binding has SHA-256 **ea397ee1d9c127ce3a8022f2fcf260c6f2e204ba96a29954c2b73fa777ba12ce**, matching root readback.

Read-only before/after binding captured 1,691 product/build inputs, 1,227 outputs across 13 trees, and 18 workspace dependency links; both retained bindings have the same digest. The frozen e123 checkout had the same product input bytes as the prior build and the exact merged-main tree. The built gateway was from the prior forced Node 22.23.4 build, so this evidence does not claim a new build at merge.

Both API processes drained with HTTP 202 and exited 0. The restart reused the same file path and NTFS identity and retained the published targets without republishing. The first same-file restart probes arrived 4.745–4.945 seconds after readiness and 62–248 ms after their recorded due times. See [restart rearm](old-attempt-1/restart-rearm.json), [first due requests](old-attempt-1/restart-first-due.json), the [pre-run binding](old-attempt-1/source-and-build.json), [post-run binding](old-attempt-1/source-and-build-after.json), and [post-drain SQLite readback](old-attempt-1/post-drain-readback.json). The [root admission](root-readbacks/root-baseline-admission.json) and [root result readback](root-readbacks/root-baseline-readback.json) preserve the exact binding and totals.

## Cleanup qualification

The first cleanup command exited nonzero. Its retained receipt records SQLite WAL and SHM sidecars remaining after both gateways and the supervisor exited and all three ports stopped listening; it also records that the disposable store was not removed on that pass. Keep this failure as part of the baseline history: [original cleanup receipt](old-attempt-1/cleanup.json).

A separately authorized bounded continuation then checked the exact external scratch path, verified the three owned PIDs and listeners were absent, and held the database, WAL, and SHM simultaneously with exclusive read handles before removing only that disposable store. Its receipt is [cleanup-continuation.json](old-attempt-1/cleanup-continuation.json), and the exact source script is [cleanup-continuation.ps1](cleanup/cleanup-continuation.ps1). This later recovery does not turn the first pass into a clean-first-pass result.

## Packet contents and integrity

[Source-copy-map.json](source-copy-map.json) maps every copied source file to its destination, byte count, and verified SHA-256. The complete old-attempt-1 output directory is retained byte-for-byte, including its native process logs and request/SQLite/REST evidence. The frozen-input inventory is copied exactly; its Markdown handoff and the baseline narrative are named **.md.txt** with bytes unchanged. No database, WAL/SHM, disposable store, build output, dependency directory, provider stream, or credential is included. No corrected-v1 or corrected-v2 evidence is included.

[SHA256SUMS](SHA256SUMS) covers every file in this packet except the inventory itself.
