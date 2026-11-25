public enum LaunchStage: Sendable {
    case checking
    case waitingForOtherLaunch
    case waitingForStore
    case waitingForRelease
    case starting
}

public enum ManagementMode: Sendable {
    case running
    case observingShutdown
}

public enum LaunchOutcome: Sendable {
    case openManagement(port: UInt16, mode: ManagementMode)
    case installationInvalid
    case runtimeUnavailable
    case assetsUnavailable
    case keySourceUnavailable
    case portInUse(port: UInt16)
    case storeBlocked
    case cannotVerify
    case launchBusy
    case releaseUnconfirmed
    case diagnosticsUnavailable
    case startFailed
    case childExited
    case startTimedOut
    case startupUnverified
    case cancelled
    case unexpected
}

public enum BrowserOutcome: Sendable {
    case accepted
    case rejected
    case unconfirmed
}

public protocol LaunchEngine: Sendable {
    func run(progress: @escaping @Sendable (LaunchStage) -> Void) async -> LaunchOutcome
    func requestQuit()
}

// The presentation receives only this action capability for validated Show Log.
public typealias ShowLogAction = @MainActor () async -> Void
