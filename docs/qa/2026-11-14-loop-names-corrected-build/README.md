# PR #470 corrected build and selected browser checks

This packet records the implementation-level build and selected browser checks for the frozen #209 correction source. It is external QA evidence, not current-head CI, native QA, formal review, or owner acceptance.

## Identity and result

The checked source was commit `2367b15b310eac52d95af77c570d5ce36f741527`, tree `6bcc8e4eb74ee2d82dd793f88538b08d260002d8`, parent `0d2fad63c448bc5591c530d087dd05c9af7821cc`; target main at capture was `7c6e635539e12c56b82f226f1ee734d83b985ad4`. The forced root build completed 12/12 Turbo tasks with 0 cached. The selected Edge specs passed 16/16, with retries disabled.

The build command was `pnpm.cmd build --force --cache-dir=.turbo/local-cache`. Turbo force-executed all tasks, but incremental TypeScript builds considered API and package outputs up to date; those package files were not re-emitted. This is not a claim of a from-scratch TypeScript build. The new web bundle is bound to the five corrected runtime sources by its source map and compiled strings. The 655 prior files across web, goblin-web, API, and infrastructure distributions matched the old baseline before the build.

## Browser evidence tier

The selected specs were `loop-names.spec.ts` and `template-gallery.spec.ts`: 16 passed, 0 failed, 0 flaky, 0 skipped, one attempt each. Headless Edge drove the newly built `apps/web/dist`, served by the real API from workspace TypeScript through `tsx`, using an in-memory database and `FakeHarness`. This did not use the built API or file SQLite. These existing flows do not test the new U1/U2 correction scenarios: newer-file selection, late response after Cancel, double retry activation, unreadable-file handling, **Try again**, or invalid-companion behavior.

The correction's separate component evidence records nine defect cases failing on the original runtime and one stale-token preservation control passing on both old and corrected runtimes. See the [correction packet](../2026-11-14-loop-names-review-corrections/README.md). At the time of this build and browser capture, independent native QA was still outstanding. A later independent run against the corrected built web shell, built API, and fresh file SQLite passed both late import response orders (six explicit POSTs total) and verified that invalid repair stayed local until a fresh explicit retry. See the [later native QA packet](../2026-11-14-loop-name-review-correction-independent/README.md). The [U1 baseline](../2026-11-14-loop-name-import-order-baseline/README.md) and [U2 baseline](../2026-11-14-loop-name-invalid-retry-baseline/README.md) remain separate evidence.

## Evidence files

- [Original handoff](raw/original-handoff.md.txt) and [concise source report](raw/original-report.md.txt), preserved byte-for-byte.
- [Build stdout](artifacts/build-force.stdout.log), [build stderr](artifacts/build-force.stderr.log), and [build output comparison](artifacts/build-before-after-comparison.json).
- [Bundle-to-source binding](artifacts/bundle-source-binding.json), plus the [after-build](artifacts/after-build/identity.json) and [after-E2E](artifacts/after-e2e/identity.json) identity snapshots and 13 output-tree hash listings per snapshot.
- [Selected E2E stdout](artifacts/e2e-selected.stdout.log), [stderr](artifacts/e2e-selected.stderr.log), [Playwright results](artifacts/e2e-selected.results.json), and [result summary](artifacts/e2e-selected.results-summary.json).
- Three screenshots were captured by the selected gallery tests and were not inspected during this curation: [1440 px](artifacts/playwright-test-results/template-gallery-gallery-f-783c0-he-opener-in-keyboard-order-chromium/gallery-1440.png), [390 px](artifacts/playwright-test-results/template-gallery-gallery-f-2462f-he-opener-in-keyboard-order-chromium/gallery-390.png), and [320 px](artifacts/playwright-test-results/template-gallery-gallery-f-55f12-he-opener-in-keyboard-order-chromium/gallery-320.png).
- [Process list before build](artifacts/processes-before-build.txt), [after E2E](artifacts/processes-after-e2e.txt), and [final cleanup](artifacts/processes-final.txt) document quiescence. The source handoff reports no runner-owned process/listener remained and no owner process was disturbed.
- [Curated runtime identity](runtime-identity.json), [link checks](link-checks.json), [manifest](manifest.json), and [SHA-256 list](SHA256SUMS.txt) bind this packet.

The source manifest SHA-256 is `5ab37edca68950795bd19bac1bcb9b036f0c52ac17817829f3ff900292562acd` and listed 63 files (1,395,165 bytes). Sixty-two listed files are copied byte-for-byte here; the 726-byte `artifacts/runtime-and-identity-final.txt` was omitted because it records environment-variable status. The exact source handoff and report are also included. Raw runner event streams, usage metadata, and environment-bearing process data are not included. Historical command helpers under `tools/` are preserved as provenance and should not be rerun; their output paths bind to the original capture location.

## Remaining gates

This packet makes no current-head CI, full coverage, formal review, or owner-acceptance claim. The previous [review and CI packet](../2026-11-14-loop-names-review/README.md) documents earlier-head results; it does not attest to this candidate. The independent native run completed later and is linked above; this packet does not replace current-head CI or the final whole-PR audit.
