# #456 native implementation handoff

Authored 19 owned files in the isolated checkout based on merged #438 commit 6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1. The paired source inventory binds the exact authored bytes. The placed LaunchContract.swift retains SHA-256 60cde1d6d8d64bfe42b316b174c70c7d71f5fea1070c8f27cc0fb78aaff75fdc. I did not edit Claude's presentation, API code, Git index, CI or documentation in the repository.

## Integration

- Final SwiftPM package has the selected module graph. Its two executable products are GraphGoblin and the build-only GraphGoblinLauncherInstaller. GraphGoblin activates AppKit only through the no-argument branch. The launch engine runs directly for headless ensure and checks the authenticated receipt-bound private stage for installer-only validation. Installer assembly writes the regular Dock-app plist Claude selected, the closed JSON config, and a copied thin arm64 executable. The private external receipt pins the Applications inode, the stable approved basename, and exact witness digests. Updates retain both witnessed bundle generations until the exchange/readback resolves. A questionable destination or stage is preserved.
- The runtime checks the exact Mac marker in the first 4,096 bytes and the three required emitted guard/writer files. The helper/runtime and detached gateway use fixed argv and clean environment. A literal raw IPv4 socket proves refusal or verifies health, both local built shells and final health identity. The gateway alone gets the bounded Mac log admission record. API writer authority stays in TypeScript. Native advisory anchors are in the authenticated user's Library/Application Support/GraphGoblin/LauncherLocks. Only the test fixture's verified scoped anchors can be considered for cleanup.
- The helper pipe collector uses direct child wait ownership and polls both streams with at most 25 ms between Quit checks. Cancellation terminates only that owned read-only child and bounds its reaping attempt to 250 ms within the original deadline. A test checks kernel absence and ECHILD after cancellation. A gateway receives no signal, including on Quit. Its exact wait status, verified health PID and startup deadline feed the existing headless outcomes. The fixed native log pair is launcher.log and launcher.log.1. The alternate root is Library/Logs/GraphGoblin/LauncherInstances/<id>; gateway names there are gateway.log and gateway.log.1.
- The shell needs mode 100755 when root stages it. The fully equivalent explicit invocation is /bin/sh with the script path and unchanged public arguments. Root can also inspect the product compiler failures directly through the command sequence below.

## Native command contract

From a bound source archive in a private fixture, bind the macOS SDK and toolchain first. Configure the staged environment's HOME/TMPDIR, SwiftPM and Clang module caches, XDG paths and exact Node/pnpm separately as selected by root. Set pkg to the canonical apps/macos-launcher package path and qa_scope to the newly exclusive fixture.

~~~sh
for product in GraphGoblin GraphGoblinLauncherInstaller; do
    /usr/bin/xcrun --sdk macosx swift build --package-path "$pkg" \
      --scratch-path "$qa_scope/swift-release" --cache-path "$qa_scope/swift-cache" \
      --config-path "$qa_scope/swift-config" --arch arm64 --configuration release --product "$product"
done
/usr/bin/xcrun --sdk macosx swift build --package-path "$pkg" \
  --scratch-path "$qa_scope/swift-release" --cache-path "$qa_scope/swift-cache" \
  --config-path "$qa_scope/swift-config" --arch arm64 --configuration release --show-bin-path
/usr/bin/xcrun --sdk macosx swift test --package-path "$pkg" \
  --scratch-path "$qa_scope/swift-test" --cache-path "$qa_scope/swift-cache" \
  --config-path "$qa_scope/swift-config" --arch arm64
~~~

The owner Command Line Tools compiled the isolated presentation source but could not import Testing in root's earlier attempt. Use the full hosted Xcode test runner for Test targets. The owner path can verify exact release products and actual native behavior. Inspect arm64 Mach-O and minimum macOS deployment from the unchanged release bin path before using a bundle.

## Authored cases and evidence limits

The engine test targets cover exact headless byte/exit results, F1 high/adjacent/far identity values and the 4 KiB cap, F2 absent/present/empty/deny/allow/error/overflow and cleanup, both Quit/commit orders, native runtime floor, closed configuration with an odd-byte URI, unique headers and malformed identity, independently drained pipes, nonzero completion, overflow, hanging helper cancellation and exact reap. Installer component fixtures reach actual exclusive publish, absent rollback, real exchange, verified previous-bundle rollback after injected readback refusal, independent receipt continuity, foreign destination preservation and argument validation. Synthetic test bundle bytes stand in for release files at the publisher seam. Public installer and actual API/native readiness, deadline, Finder, Dock and browser observations remain their own gates.

Static checks read the merged base and exact authorized sources; all 19 owned files decode as UTF-8 with LF-only content and a final LF. No Swift compiler, Swift test, installer, process, Mac, browser, protected port or owner-state action ran from this Windows implementation turn. The package and every new test require the first admitted Darwin product compilation before any native success is asserted.
