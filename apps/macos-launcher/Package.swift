// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "GraphGoblinMacLauncher",
    platforms: [.macOS("15.0")],
    products: [
        .executable(name: "GraphGoblin", targets: ["LauncherEntry"]),
        .executable(name: "GraphGoblinLauncherInstaller", targets: ["InstallerEntry"])
    ],
    targets: [
        .target(name: "LaunchContract", path: ".",
                exclude: ["Entry.swift", "Engine", "Presentation", "Installer", "Tests"],
                sources: ["LaunchContract.swift"]),
        .target(name: "LauncherEngine", dependencies: ["LaunchContract"], path: "Engine"),
        .target(name: "LauncherPresentation", dependencies: ["LaunchContract"], path: "Presentation"),
        .executableTarget(name: "LauncherEntry",
                          dependencies: ["LaunchContract", "LauncherEngine", "LauncherPresentation"],
                          path: ".",
                          exclude: ["LaunchContract.swift", "Engine", "Presentation", "Installer", "Tests"],
                          sources: ["Entry.swift"]),
        .target(name: "LauncherInstaller", dependencies: ["LauncherEngine"], path: "Installer/Core"),
        .executableTarget(name: "InstallerEntry", dependencies: ["LauncherInstaller"],
                          path: "Installer", exclude: ["Core"], sources: ["Entry.swift"]),
        .testTarget(name: "LauncherEngineTests", dependencies: ["LaunchContract", "LauncherEngine"],
                    path: "Tests/Engine"),
        .testTarget(name: "LauncherInstallerTests", dependencies: ["LauncherEngine", "LauncherInstaller"],
                    path: "Tests/Installer"),
        .testTarget(name: "LauncherPresentationTests", dependencies: ["LaunchContract", "LauncherPresentation"],
                    path: "Tests/Presentation"),
        // A test-only GUI child. The installer never includes it in the application bundle.
        .executableTarget(name: "PresentationFixture",
                          dependencies: ["LaunchContract", "LauncherPresentation"],
                          path: "Tests/PresentationFixture", sources: ["PresentationFixture.swift"])
    ]
)
