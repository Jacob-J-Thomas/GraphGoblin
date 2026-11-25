# Isolate the presentation test compiler failure

Actual Claude Code Opus5.5 xhigh focused implementation diagnosis, not a formal review or final audit. Read-only; no edits, commands, Mac access or native execution. Do not consume/reset the formal review budget. Read AGENTS.md/docs15; repo C:/Users/98jak/.codex/worktrees/gg-20261116-macos-launcher/GraphGoblin.

Your earlier focused diagnosis02 found no demonstrated source cause. CI07 now gives narrower actual evidence. Exact CI head8282861940f52d059e926e41a34bdf3894e52468; current local5c074328be3cfd6c402434b459fac69066c85c4d only adds evidence docs. Root verified product/test Swift unchanged from CI05. Shipping product source remains18089bba. No tests have executed in these failed attempts; no production coverage counts exist.

Read external files under C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-pr501-ci-07/artifacts/extracted/macos-launcher-coverage/:
- swift-tests-diagnostic-build-files.json: before diagnostic,21/28 expected test objects exist. EXACT seven missing objects are LiveCompositionTests.swift, OutcomeCopyTests.swift, QuitTests.swift, ShowLogTests.swift, Support/FixtureChild.swift, Support/Harness.swift, Support/LiveAppKit.swift. All other Engine/Installer/Presentation objects exist, as do all three executables. Generated runner source exists; runner object/test binary/link filelist absent.
- swift-tests-diagnostic-build.json/stdout/stderr: failure-only same-scratch swift build --build-tests --enable-code-coverage --jobs1 --very-verbose exits1, no signal/error. It replays the exact seven-primary-file frontend batch and emits the presentation module; then ends silently. No error/fatal diagnostic in either stream.
- swift-tests-diagnostic-reports.json: runner/system DiagnosticReports scans complete, zero matching compiler/crash reports.
- swift-tests-failure.json:3CPUs,7GiB physical RAM,~1GiB free after original failure; not proof of memory cause.

Inspect those seven sources, primarily your new LiveCompositionTests, FixtureChild, LiveAppKit interactions with existing Harness. Look for concrete compile/macro/type/actor issues and distinguish verified source facts from hypotheses. Missing objects identify the failed batch, not a specific defective source. Do not recommend removing assertions, disabling coverage, dropping tests, or production seams merely for coverage.

GPT is checking Swift6.1.2 driver support for a NEW fresh primary test build with -Xswiftc -disable-batch-mode (possibly --jobs1) to expose per-file diagnostics, preserving all tests/thresholds/timeouts. Assess this narrow isolation and any more informative alternative. No source change unless a concrete defect can be justified; return precise reasoning and smallest correction/probe proposal. You have no native compiler here, so don't claim compile validation.
