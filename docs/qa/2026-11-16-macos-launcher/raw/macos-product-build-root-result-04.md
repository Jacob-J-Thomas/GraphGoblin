# Owner Mac build 04 on the locale correction

Prepared by a delegated evidence worker. Root verification is pending.

Build 04 completed at 2026-11-16 21:27:52 UTC with local SSH exit 0 and a remote product-build-exit-zero result. The retained build was commit 4341d1f8882f4b69651bfb0b5988345b7f074339 and tree a5f8fa3e13fb297cbcdb386ae445cb8159156617. Relative to build 03's freeze, the two changed rows are apps/macos-launcher/Engine/Diagnostics.swift and tooling/scripts/macos-launcher.acceptance.mjs. The freeze and its local archive were independently rehashed against the receipt. [Source freeze](macos-product-source-freeze-04/source-freeze.json) · [Build result](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/result.json) · [Validation](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/validation.json)

| Bound object | Observed value |
| --- | --- |
| Build token | d75d293f66da44ffb60198a07d8fa2e2 |
| Stage | /Users/jake/Library/Caches/graphgoblin-456-product-build-d75d293f66da44ffb60198a07d8fa2e2 |
| Stage identity | Inode 178893353, device 16777232, UID 501, mode 0700, empty ACL |
| Source freeze | 1,765 files and 26,268,959 source bytes. Freeze JSON 383,408 bytes, SHA-256 31a26763478b6e8c6e31ca3b64275a8eb3573a67b45cf92431341edcd1aa385d |
| Source archive | 10,404,911 bytes, SHA-256 a0eb35a86e9a37e034e356f108bd0495660b4e68a91b635b071c656869ee176a |
| Build result JSON | SHA-256 738c56a109a49f4c7b266ff97e6e5db8a7fc8fcb1e1ed0a623269045fb011656 |
| Build validation JSON | SHA-256 746502860ff36cafb49c838a8e39efeffa77817c27c73f0dd4fe8149a476903e |
| SSH stdout | 30,734 bytes, SHA-256 0643aebcf04fa3e11275149a8bcccf47e621cc535e4623faf02bbb608e592a88 |
| SSH stderr | Empty, SHA-256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Transport seal and combined executor | c290e6b795a3de011c20ca56ea977dd2ba5e127707a79d1b4c8c40ededd872cc and ab7edac8cf26abaeeda0a33739c919ebd2bc212956c2565b598aa7951727f0fd |

The exact phase JSON records agreed with the returned result. Every retained raw pipe independently matched its byte count and SHA-256. All phases observed an exit, both EOFs and zero overflow. Application build output reports 12 of 12 tasks successful, zero cache hits and 13.877 seconds. Swift build output records completion of both release products. [Exit](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/exit.json) · [Pipe close](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/pipe-close.json) · [Application build](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/pnpm-build-stdout.raw) · [Swift app](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/swift-release-app-stdout.raw) · [Swift installer](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/swift-release-installer-stdout.raw)

| Phase | PID | Exit | Pipe EOFs | Stdout / stderr bytes |
| --- | ---: | ---: | --- | ---: |
| pnpm-install | 46061 | 0 | both | 1,882 / 0 |
| pnpm-build | 46094 | 0 | both | 5,001 / 18 |
| swift-release-app | 46390 | 0 | both | 411 / 0 |
| swift-release-installer | 46446 | 0 | both | 357 / 0 |
| swift-release-bin-path | 46471 | 0 | both | 131 / 0 |

The owner host reported macOS 26.6.2 build 25G83 on arm64, pinned Node 22.22.2, pnpm 12.8.1 and Apple Swift 6.3.1 under Command Line Tools with macOS SDK 26.4.1. The pre- and post-build pnpm records matched across 437 files with manifest SHA-256 11bbc14f157f770b27690fd530e6f1be1a5d54331a36efb0a4d918f03241cc00. The receipt verified original source bytes before and after build. Both Swift release executables were thin arm64 with minimum deployment macOS 15.0. The eight emitted API and web artifacts matched build 03 byte counts and digests. [Build and toolchain receipt](macos-product-build-transport-implementation-01/receipts/product-build-d75d293f66da44ffb60198a07d8fa2e2/result.json)

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| GraphGoblin | 725,816 | afb4f00697e82d76cc50d2d9d5f150202cf5b8cff9718f1e142dec06028faa12 |
| GraphGoblinLauncherInstaller | 587,616 | dca34a397e4c50959264dabd007076e361874f348d74e882b2e796939db298da |
| apps/api/dist/main.js | 3,311 | 77340d74ad07bebe5875984fee0c92cbeac57afff13585a9bbe7fb3ab62c219c |
| apps/api/dist/instance-identity.js | 3,369 | e8a04bf57d544d1cf62bc34f9694cd836f936dd2e24429df06da54e9abcddb29 |
| apps/api/dist/macos-log/guard.js | 9,834 | 592938b5f55ee0512b3a506d813edbe587e96606d564fb7444cf458ea2b8283b |
| apps/api/dist/managed-log/guard.js | 6,884 | ab07081a1cf867a34259a48a990207739678ffeca375ce1b76e474feb9bcbab4 |
| apps/api/dist/managed-log/gateway-log-writer.js | 26,980 | caa505a4320dfce95b0dc28ee5cb43eb41f96a4edd4f628416613411bc39678b |
| apps/api/dist/windows-log/guard.js | 1,470 | dab8226975e877ca4694353302d5f6e4dab27d6b80a639805a960afb4996feea |
| apps/web/dist/index.html | 2,404 | c606991f0f8e9b819297f5ee88f712c819bbf239ed98ca7814dd1f2b554e2fef |
| apps/web/dist-goblin/index.html | 2,167 | f74c415b93fa0f89dca358ea10ce819e29245fd70f00d68dc962f331592610af |

The build phases retained the 600, 300, 240, 240 and 30 second limits and separate five-second pipe drains. The transport ended after artifact verification. Corrected engineering acceptance, independent native behavior QA, interactive Finder/Dock observations and final audit remain separate evidence for this head. The prior build and acceptance receipts remain the historical record of their own attempts. [Transport scope](macos-product-build-transport-implementation-01/README.md)
