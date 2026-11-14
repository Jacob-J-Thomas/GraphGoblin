# Save/publish UI #237 — phase 1 evidence curation

Curated package date: 2026-11-14. This historical evidence snapshot is bound to the phase 1 source/build runs and a later native retry diagnostic. It records evidence provenance and limits; it does not itself make acceptance or current CI claims.

## Identity and binding

- Baseline source: parent commit `700ce251bc4c3b7ad29e072d0764ad9a5ca9174e`, tree `b875d92a1f27bbffc3f621472ce15a5008c189e5`. The implementation handoff records a clean, forced baseline build with 1,117 files and digest `19d998c020b68a5c7b8f4dc7c1f846aa8489248d7ce5afde84a09820bff6a76f`.
- Candidate source was tested as a dirty worktree on that same parent. The raw binding names 16 changed source files and their SHA-256 values. This package extracts those exact bytes from the later frozen e12 Git tree and verified all 16 against the original candidate source manifest.
- Root freeze: `e12b81ec9767b9bfd3d6e649025023796b2bc638`, tree `636dcdb5c7344a55bbdbe4c673b8fc707cdfdf2d`. The copied [precommit binding](./binding/ui-237-phase1-precommit-binding.json) and [freeze helper](./binding/freeze-237-phase1.mjs) preserve the parent's verification. At curation time the checkout still had this HEAD/tree but had new worktree changes in progress; candidate bytes were therefore read from the immutable Git tree object. This source identity match does not turn the earlier dirty-source build or native run into a clean-commit build claim.
- Candidate native build: 1,117 files, digest `87d379a6135edf0602cc3258756565f481a5c041efbe77f96c7790e794acfc7d`. Raw build manifests and gateway records are retained for baseline and candidate. The runner reports that served index/assets matched the built artifacts, source/build hashes remained unchanged at gateway close, and cleanup completed.

## What this evidence supports

The baseline records document the implementation team's reproduction of D1–D8 using a built API process with a file-backed SQLite store and a headless Edge browser driven through Playwright. The environment used a separate REST client as the competing writer, real HTTP requests and browser route barriers, and no provider binary, owner store, or API key. First-attempt driver locator failures are retained alongside the corrected second attempt; do not discard them when reading the scenario summaries.

The original candidate run records 17 native observations with no listed defect within those 17 scenarios. They are implementation observations, not independent QA, a formal review, a generic automated pass, or owner acceptance. A later native retry-readback diagnostic on the same e12 candidate confirmed two failures outside that initial set; see the linked diagnostic below. The unit/component fixtures are synthetic fake-API tests. The 866 focused tests, 2,529 web coverage tests (98.52% lines; 94.03% branches), and 38 selected Edge end-to-end checks are scoped checks; the 38 checks are not the full end-to-end suite. The reported source-language coverage and fake-API tests do not establish behavior outside their stated scenarios.

The native baseline report calls D8 a design hypothesis before its reproduced scenario. At the original precommit binding, the unknown-retry readback gap was a source hypothesis. The separate [native retry-readback diagnostic](../2026-11-14-publish-retry-readback-diagnostic/README.md) now confirms the gap on the same phase 1 candidate: the held-input and new-editor variants each returned a real readback GET 200, then issued an extra publish POST after the relevant state changed; each POST returned 200 and created immutable version 2. The healthy control issued only its intended retry POST. The diagnostic README and observations are externally retained and hash-linked in [RELATED-EVIDENCE.json](./RELATED-EVIDENCE.json); this confirms those two race cases, not overall #237 acceptance or a formal review. The precommit binding recorded parent #209 U1/U2 integration as pending; this package does not attest its subsequent status. This package contains no updated CI, formal review, security/audit, or owner-acceptance evidence.

## Provenance and exclusions

- `raw/` contains byte-preserved copies of the original handoff/report, launch identity, drivers, logs, baseline and candidate scenario/gateway/build/cleanup records, source manifests and all captured screenshots. First-failure and correction logs are retained.
- `source/baseline/` contains the 12 tracked source files read directly from the baseline parent Git tree. `source/candidate/` contains the 16 candidate source files extracted from frozen e12 and matched to the original candidate source manifest.
- [Screenshot status index](./SCREENSHOTS.md) distinguishes the five captures explicitly listed as inspected in the handoff from the other captures whose inspection the handoff does not claim.
- No SQLite database, WAL, SHM, master key, profile, API key, authorization header, environment file, or runner-private Claude event/result/latest stream is included. The raw native JSON received a targeted property-name scan for authorization, API-key, credential, cookie, secret, and environment fields; none were found. No auth-bearing record was transformed or redacted.
- The original handoff, report, and baseline note remain unchanged and are stored with `.md.txt` extensions so formatters do not rewrite their bytes. This README adds evidence-tier qualifications and links the later retry diagnostic without rewriting the originals.

## Integrity inventory

[artifact-manifest.json](./artifact-manifest.json) lists every curated file except itself and `artifact-manifest.sha256`, with byte size and SHA-256. The adjacent checksum file hashes the manifest. The source candidate hashes are also independently recorded in the preserved original source manifest and precommit binding.
