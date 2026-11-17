import AppKit
import Foundation
import LauncherEngine
import LauncherPresentation

@main
enum LauncherEntry {
    @MainActor
    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        let engine = NativeLaunchEngine(bundlePath: Bundle.main.bundleURL.path)
        switch arguments {
        case []:
            runLauncherPresentation(engine: engine) {
                guard let authorization = await engine.authorizeShowLog() else { return nil }
                return {
                    guard let directory = await engine.revalidateShowLog(authorization) else { return }
                    NSWorkspace.shared.open(directory)
                }
            }
        case ["--ensure-gateway"]:
            HeadlessResult(engine.runHeadless()).printAndExit()
        case ["--validate-installation"]:
            engine.validateStaged().printAndExit()
        default:
            HeadlessResult.usage.printAndExit()
        }
    }
}
