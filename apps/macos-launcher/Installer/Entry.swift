import Darwin
import Foundation
import LauncherInstaller

@main
enum InstallerEntry {
    static func main() {
        let result = LauncherInstaller.run(
            Array(CommandLine.arguments.dropFirst()), environment: ProcessInfo.processInfo.environment
        )
        let destination = result.exitCode == 0 ? FileHandle.standardOutput : FileHandle.standardError
        destination.write(Data((result.output + "\n").utf8))
        exit(result.exitCode)
    }
}
