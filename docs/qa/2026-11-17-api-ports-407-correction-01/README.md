# #407 correction 01

Implementer evidence for the independent Claude QA findings D1 and D2. The candidate is based on `6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1`. The original implementation packet and independent QA record cover the first candidate. This folder records the correction and its Windows tests. The independent QA follow-up, formal review, hosted CI, and dependency audit have separate delivery records.

## D1 Windows wildcard listeners

Independent QA demonstrated that a real built API can bind IPv4 loopback over an existing IPv4 or dual-stack wildcard listener. On the same Windows host, a separate child bound each address in turn. The matching 127.0.0.1, 0.0.0.0, or dual-stack :: probe reported `EADDRINUSE`. Neither wildcard probe on its own detected the other wildcard. Each existing child answered its sentinel after the probes and exited cleanly. The matrix also records IPv6-only modes, which did not claim IPv4 loopback. [Native bind matrix](bind-matrix.log.txt), [command receipt](bind-matrix-receipt.json)

The fixture checks those three Windows binding forms serially and closes each probe listener. The suite still uses an IPv4 loopback bind for the API itself. The maintained regression first failed on both wildcard variants with port 63650 returned. It passed for all three listener forms after correction. The final 13-test helper suite includes the wildcard tests, and each foreign listener still answers its own sentinel. [First failure](red-existing-listeners.log.txt), [D1 corrected cases](green-existing-listeners.log.txt), [final helper tests](corrected-api-port-focused.log.txt)

A controlled bind-error test used the real helper with native IPv4 binds. It injected `EAFNOSUPPORT`, `EPROTONOSUPPORT`, and `EADDRNOTAVAIL` at the optional IPv6 probe and verified IPv4 allocation in each case. IPv6 `EACCES` and `EINVAL` and IPv4 wildcard `EADDRNOTAVAIL` propagated. This is controlled error-path evidence. Windows IPv6 was available during the native test. [Controlled fallback](ipv6-fallback.log.txt), [controlled net adapter](controlled-net.mjs)

## D2 Windows reservation contention

Independent QA counted 25 unexpected mkdir errors across 17,490 attempts and 1,881 grants. A bounded native follow-up recorded 75 `EPERM` mkdir results across 13,858 attempts with the original deletion protocol. All 75 claim intervals overlapped the peers' canonical-directory release intervals. A later directory enumeration missed the name in 74 of those 75 cases. This establishes an association with peer deletion and explains why checking existence afterward cannot reliably distinguish the transient case. [Native operation summary](claim-release-matrix.log.txt), [worker A timing events](claim-delete/A.json), [worker B timing events](claim-delete/B.json)

| Candidate primitive                                            | Native result                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retire the entire named directory with a canonical rename      | Zero contention errors in 13,770 attempts, but a controlled replacement between owner-marker removal and rename moved the replacement claim. The original `rmdir` returned `ENOTEMPTY` for that replacement.     |
| Rename a shared marker in a permanent directory back and forth | Two workers saw 231 nonexclusive observations and 448 release errors across 3,668 attempts.                                                                                                                      |
| Reuse an exclusive-create file and unlink it on release        | 44 claim `EPERM` errors across 18,394 attempts.                                                                                                                                                                  |
| Exclusive creation of a never-reused generation                | 5,196 attempts and 1,524 grants, with zero duplicate generations, nonexclusive observations, or filesystem errors. An old release returned `ENOENT`, preserved the replacement token, and left the port blocked. |

The rejected outcomes and controlled replacement are preserved. [Directory retirement](claim-release-matrix.log.txt), [canonical replacement and shared-marker stress](permanent-slot-probe.log.txt), [file and generation comparison](generation-file-comparison.log.txt)

The corrected helper creates each numeric slot lazily. A reservation reads its generation names once and checks the newest generation's release marker. Exclusive creation of the next generation directory determines the winner. A worker that loses returns to its existing bounded range scan. Release atomically moves only the UUID marker that the lease created within that generation. A crashed or incomplete latest generation stays reserved for the run. Discovery scans prior generations for that numeric port, and the Vitest parent removes all generation metadata after the workers stop.

Both corrected Vitest workers reached authenticated readiness on separate built child APIs at 63650 and 63651. They then contended for one port, issuing 393 grants and 2,446 bounded exhaustion refusals across 2,839 attempts. The grants had zero duplicate generations, multiple-owner observations, or unexpected errors. A native access-control restriction on another owned folder still caused a raw `EPERM mkdir` from the corrected allocator. The ACL and folder were cleaned up. [Worker verification](corrected-native-witness.log.txt), [contention counters](corrected-native-witness-summary.json), [permission refusal](native-permission-refusal.log.txt), [permission cleanup receipt](native-permission-refusal-receipt.json)

## Candidate identity

The candidate source manifest records the 13 author implementation and documentation files and the rebuilt API entry. The correction changed the allocator, its focused tests, and the testing guide. The earlier built candidate and corrected build share the production entry SHA-256 `3160AC2A1339525DC3F63400BBD9ACA29AEA6663442D625CE6728BD35619325C`. [Corrected source manifest](corrected-frozen-sources.json), [API build](corrected-api-build.json)

The native observations in this packet are from one Windows host using Node v22.23.4. Reservations cover fixtures sharing the assigned range in one Vitest run. The bind probes close before startup, and simultaneous invocations require disjoint ranges.

## Final Windows verification

The first corrected API package coverage run passed with 2,086 tests passed and 16 skipped across 135 files. V8 reported 93.90% statements, 90.70% branches, 91.59% functions, and 95.33% lines. The test gate used four Vitest workers and ports 63650–63659. All ten ports accepted a new bind afterward, no designated stores survived, and the observed reservation directory was removed. [Coverage log](corrected-api-coverage.log.txt), [command receipt](corrected-api-coverage.json), [cleanup receipt](corrected-cleanup.json)

API build, typecheck, lint, workspace dependency layers, dependency-cruiser, and formatting passed. Dependency-cruiser reported four orphan warnings in files outside the correction. The first command wrapper split the layers task name and exited before invoking the gate. Its failure is preserved alongside the successful literal command. [Typecheck](corrected-typecheck.log.txt), [lint](corrected-lint.log.txt), [layers](corrected-check-layers.log.txt), [dependency-cruiser](corrected-check-deps.log.txt), [formatting](corrected-format.log.txt), [first wrapper failure](static-wrapper-first-failure.log.txt)

Final verification matched all 14 frozen source and binary hashes and all 50 files in the earlier implementation packet. [Source and publication verification](corrected-frozen-verification.json)

## Publication evidence

This copy preserves all 107 sealed records and the original evidence seal. The publication
manifest maps each source path to its repository path, byte count, and SHA-256. Archived
logs use a `.log.txt` suffix so Git can track their original bytes. [Publication manifest](publication-manifest.json), [original evidence seal](evidence-sha256.json), [raw author report](author-record.md.txt), [first implementation packet](../2026-11-17-api-ports-407-implementation/README.md)
