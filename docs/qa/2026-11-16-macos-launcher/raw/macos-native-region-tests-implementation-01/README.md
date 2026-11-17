# Native region coverage tests

This test-only batch starts from CI12 source `53f41045516f1e0bfae44e3ef9a58e0b60dc3cf4`. That run passed 154 Swift tests and measured 3,439/3,627 production lines and 1,775/2,056 production regions. It needs 76 more covered regions to reach the approved 90% region threshold. This batch has no measured Swift coverage result yet.

## Changed paths

- `apps/macos-launcher/Tests/Engine/NativeFilesTests.swift` exercises exclusive directory creation, descriptor identity after a name is replaced, exact and exceeded read/hash caps, and real descriptor mode errors. It checks file bytes and inode identity after refusal.
- `apps/macos-launcher/Tests/Engine/ChildTests.swift` refuses embedded NUL in arguments and environment before a marker-writing helper spawns. The valid counterpart verifies its exact output file.
- `apps/macos-launcher/Tests/Engine/DiagnosticsTests.swift` checks separate standard and alternate routes beneath a temporary home, read-only private directory refusal, and admission refusal for a malformed full-width identity.
- `apps/macos-launcher/Tests/Engine/InstalledEngineTests.swift` verifies malformed health retry, subsequent bound identity, wrong shell refusal, no spawn or store creation, and exact failure diagnostics.
- `apps/macos-launcher/Tests/Engine/LaunchInputsTests.swift` verifies saved path alias refusals, closed configuration validation, enabled Ollama propagation, and refusal to use an existing file as a store or store ancestor.
- `apps/macos-launcher/Tests/Installer/PublisherTests.swift` verifies terminal output from actual atomic publication dispositions, malformed receipt refusal with byte and inode preservation, and strict bundle layout and executable requirements.
- `apps/macos-launcher/Tests/Installer/InstallerRecoveryTests.swift` verifies lock refusal and both exact interrupted-exchange states, then rejects changed witnesses while preserving the target, stage and receipt. It requires a canonical private fixture beneath `RUNNER_TEMP` on GitHub Actions and uses unique alternate app names.
- `tooling/scripts/macos-launcher-coverage-fixture.acceptance.mjs` exercises the profiled installer with local database URI checks, first-install staged asset/runtime/helper refusals, bad store/runtime inputs and release preflight refusals. It retains the ordinary launcher for staged validation. Successful refusal checks require exact exits and streams, unchanged owned files, absent new application and store, and unchanged receipt inventory. Only a verified newly created empty stage is removed after a release preflight refusal.

## Verification

Local Node 22.23.4 syntax, focused ESLint and Prettier passed. All 43 coverage checker tests passed. The separate Node control exercised the actual URI and empty-stage validation logic with simulated filesystem and installer operations. It rejected an unexpected application target and retained an unexpected stage entry. It establishes harness behavior only.

The root-operated build-only check exited 1 because the default Command Line Tools search path did not locate `Testing`. A separate module import check found it with an explicit search path to the installed framework. The original receipt is retained externally under `macos-native-test-build-13-85ce7a7d47744078b2e636f4fdbbcfed`. Hosted macOS with Xcode must run the native suite and report measured production coverage. The collector, production inventory, existing coverage checks and thresholds, and deadlines are unchanged. Shipping source is unchanged.
