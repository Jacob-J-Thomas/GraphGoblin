# CI10 installed-engine fixture correction

The hosted run at `c2b3f34c60f4ecb642ace4727f60ac72999dc644` reached Swift Testing after compilation and an empty XCTest run. The retained JSONL ends when child-exit argument 71 starts. The five issue events identify the closed-port control, the cold fixture child exit, diagnostics admission refusal, Quit during held-store observation, and committed child-exit argument 70. The four child-composition cases passed in 7.489 seconds and the live AppKit suite passed in 2.896 seconds. The primary command still timed out before the complete package suite or coverage export. [CI10 stdout](../macos-pr501-ci-10/artifacts/extracted/macos-launcher-coverage/swift-tests.stdout), [events](../macos-pr501-ci-10/artifacts/extracted/macos-launcher-coverage/swift-testing-events.jsonl), [receipt](../macos-pr501-ci-10/artifacts/extracted/macos-launcher-coverage/swift-tests.json).

## Refused TCP fixture

The original `FixtureSocket` binds an ephemeral address and does not itself call `listen`. CI10's standalone assertion of `.refused` while retaining this bound descriptor failed before any malformed, oversize, reset, or stalled-response subcase ran. The three installed tests retained the same kind of descriptor while expecting the engine to advance after a refusal. Diagnostic admission and held-store cancellation instead returned 22 after 60.030 and 60.149 seconds. Child-exit argument 70 returned `cannot-verify` instead of a committed child outcome. The cold fixture, which released its temporary descriptor, reached both authenticated cold and warm outcomes before its subsequent drain assertion. The exact Darwin socket errno is unavailable. The evidence establishes the invalid test precondition.

`FixturePortReservation` now holds the unique ephemeral descriptor through fixture assembly, releases it immediately before the production observation, and requires `.refused` before the engine case proceeds. The standalone loopback test has the same prerequisite and retains all original malformed, oversize, reset and stalled-response checks. The installed tests retain their exact outcomes, progress transitions, file/child assertions and deadlines.

## Fixture shutdown

CI10 reached the token-guarded 202 response and exact response body, then still observed the Node child as running after the existing three-second exit bound. A Windows Node 22.23.4 control used a persistent HTTP client and the fixture's `response.end()` then `server.close()` order. With the original response, the client received status 202 and `{"closed":true}` with `Connection: keep-alive`; listener closure did not complete within three seconds. Adding only `Connection: close` to the drain response preserved the exact status and body and completed closure within three seconds.

The patched fixture sets that response header only on the existing token-guarded drain route. The real embedded JS extracted from the changed Swift file ran as a tracked local Node child against a persistent client. It returned health 200 for the tracked PID and both exact shells, refused the wrong token with 404, returned 202 with `{"closed":true}` and `Connection: close` for the correct token, and exited 0 with both child streams closed and empty after 20.8 ms. The Swift test still requires the exact 202 body, tracked PID and normal zero exit within three seconds.

## Retained local rerun

The 20.8 ms above is the previous tool observation. The separate retained rerun used Windows Node 22.23.4 on 2026-11-17 at 04:27:37 UTC. Child 36824 matched the health header and PID witness, served both exact shells, returned 404 for the wrong token, and returned 202 with the exact body and `Connection: close` for the valid token. It exited 0 with both streams empty and at EOF within 18.7 ms.

The JSON is the control's captured stdout. It binds the control file, changed Swift file, extracted source text and executed child program by SHA-256. The control retains source indentation and substitutes the single Swift token interpolation before execution. [Control source](embedded-fixture-probe.mjs), [executed child program](embedded-fixture.mjs), [captured stdout](embedded-fixture-probe.stdout.json), [captured stderr](embedded-fixture-probe.stderr).

## Verification boundary

The changes are confined to `apps/macos-launcher/Tests/Engine/InstalledEngineTests.swift` and `LoopbackTests.swift`. Targeted `git diff --check` passed. The Node experiments establish JavaScript fixture behavior on Windows. The next hosted run must compile and execute the corrected Swift tests, prove the real Darwin TCP prerequisite, and measure the package through the existing gates.
