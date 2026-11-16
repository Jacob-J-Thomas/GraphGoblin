import Foundation
import LaunchContract

/// The literal loopback management address, synthesized only from a verified numeric port.
///
/// This is the single source of the browser URL and of the Copy Address text. No engine,
/// response or callback supplies any part of it except the port number.
struct ManagementAddress: Equatable, Sendable {
    let port: UInt16
    let text: String
    let url: URL

    init?(port: UInt16) {
        guard port != 0 else { return nil }
        let text = "http://127.0.0.1:\(port)/app/"
        guard let url = URL(string: text) else { return nil }
        self.port = port
        self.text = text
        self.url = url
    }
}

/// Every terminal failure the presentation can explain. The launch cases mirror the closed
/// `LaunchOutcome` failures one to one; the rest are presentation-owned.
enum FailureKind: Equatable, Sendable {
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
    case unexpected
    /// The engine reported a management outcome without a usable port (contract violation).
    case invalidHandoff
    case browserRejected(ManagementAddress)
    case browserUnconfirmed(ManagementAddress)

    /// Whether this failure may ask the resolver for an opaque Show Log action.
    var offersShowLog: Bool {
        switch self {
        case .installationInvalid, .runtimeUnavailable, .assetsUnavailable, .keySourceUnavailable,
             .portInUse, .storeBlocked, .cannotVerify, .launchBusy, .releaseUnconfirmed,
             .startFailed, .childExited, .startTimedOut, .startupUnverified, .unexpected:
            return true
        case .diagnosticsUnavailable, .invalidHandoff, .browserRejected, .browserUnconfirmed:
            return false
        }
    }

    /// The fixed address for browser failures, used only by Copy Address.
    var managementAddress: ManagementAddress? {
        switch self {
        case .browserRejected(let address), .browserUnconfirmed(let address):
            return address
        case .installationInvalid, .runtimeUnavailable, .assetsUnavailable, .keySourceUnavailable,
             .portInUse, .storeBlocked, .cannotVerify, .launchBusy, .releaseUnconfirmed,
             .diagnosticsUnavailable, .startFailed, .childExited, .startTimedOut,
             .startupUnverified, .unexpected, .invalidHandoff:
            return nil
        }
    }
}

/// What the presentation does with one closed engine outcome.
enum OutcomeDisposition: Equatable, Sendable {
    case handOff(ManagementAddress, ManagementMode)
    case quiet
    case failure(FailureKind)
}

struct ProgressContent: Equatable, Sendable {
    let statusLine: String
    let detail: String
}

enum AlertChoice: Equatable, Sendable {
    case dismiss
    case showLog
    case copyAddress
}

struct AlertButton: Equatable, Sendable {
    let choice: AlertChoice
    let title: String
    /// The default button answers Return. The dismiss button is always the default and
    /// is also the cancel action for Esc, Command-period, Command-W and the close box.
    let isDefault: Bool
}

struct AlertContent: Equatable, Sendable {
    let title: String
    let message: String
    /// In AppKit order: the first button is the default and sits at the trailing edge.
    let buttons: [AlertButton]
}

/// Fixed user-visible copy. The only dynamic value is a port number from a closed outcome.
enum PresentationCopy {
    static let windowTitle = "GraphGoblin"
    static let hideButton = "Hide"
    static let quitButton = "Quit"
    static let hideHelp = "Hide this window. The launch continues, and you can show the window again from the Dock."
    static let quitHelp = "Quit the launcher. Quitting never stops a GraphGoblin that has already started."
    static let spinnerLabel = "Launch in progress"
    static let okButton = "OK"
    static let showLogButton = "Show Log in Finder"
    static let copyAddressButton = "Copy Address"
    static let applicationMenu = "GraphGoblin"
    static let quitMenuItem = "Quit GraphGoblin"
    static let fileMenu = "File"
    static let closeMenuItem = "Close"

    static let waitingDetail = "Hiding this window doesn’t stop the launch. Quitting cancels the launch if GraphGoblin hasn’t started yet, and never stops a GraphGoblin that has already started."
    static let handoffDetail = "Your web browser may take a moment to open. Quitting the launcher doesn’t stop GraphGoblin."

    static let handoffProgress = ProgressContent(
        statusLine: "Opening GraphGoblin in your web browser…",
        detail: handoffDetail
    )

    static func progress(for stage: LaunchStage?) -> ProgressContent {
        guard let stage else {
            return ProgressContent(statusLine: "Opening GraphGoblin…", detail: waitingDetail)
        }
        let line: String
        switch stage {
        case .checking:
            line = "Checking GraphGoblin…"
        case .waitingForOtherLaunch:
            line = "Another GraphGoblin launch is in progress. Waiting for it to finish…"
        case .waitingForStore:
            line = "GraphGoblin’s data is in use. Waiting for it to become available…"
        case .waitingForRelease:
            line = "The previous GraphGoblin session is still shutting down. Waiting for it to finish…"
        case .starting:
            line = "Starting GraphGoblin…"
        }
        return ProgressContent(statusLine: line, detail: waitingDetail)
    }

    static func disposition(for outcome: LaunchOutcome) -> OutcomeDisposition {
        switch outcome {
        case .openManagement(let port, let mode):
            guard let address = ManagementAddress(port: port) else {
                return .failure(.invalidHandoff)
            }
            return .handOff(address, mode)
        case .installationInvalid:
            return .failure(.installationInvalid)
        case .runtimeUnavailable:
            return .failure(.runtimeUnavailable)
        case .assetsUnavailable:
            return .failure(.assetsUnavailable)
        case .keySourceUnavailable:
            return .failure(.keySourceUnavailable)
        case .portInUse(let port):
            return .failure(.portInUse(port: port))
        case .storeBlocked:
            return .failure(.storeBlocked)
        case .cannotVerify:
            return .failure(.cannotVerify)
        case .launchBusy:
            return .failure(.launchBusy)
        case .releaseUnconfirmed:
            return .failure(.releaseUnconfirmed)
        case .diagnosticsUnavailable:
            return .failure(.diagnosticsUnavailable)
        case .startFailed:
            return .failure(.startFailed)
        case .childExited:
            return .failure(.childExited)
        case .startTimedOut:
            return .failure(.startTimedOut)
        case .startupUnverified:
            return .failure(.startupUnverified)
        case .cancelled:
            return .quiet
        case .unexpected:
            return .failure(.unexpected)
        }
    }

    static func alert(for kind: FailureKind, showLogAvailable: Bool) -> AlertContent {
        let text = failureText(for: kind)
        var buttons = [AlertButton(choice: .dismiss, title: okButton, isDefault: true)]
        if kind.managementAddress != nil {
            buttons.append(AlertButton(choice: .copyAddress, title: copyAddressButton, isDefault: false))
        } else if kind.offersShowLog && showLogAvailable {
            buttons.append(AlertButton(choice: .showLog, title: showLogButton, isDefault: false))
        }
        return AlertContent(title: text.title, message: text.message, buttons: buttons)
    }

    private static func failureText(for kind: FailureKind) -> (title: String, message: String) {
        switch kind {
        case .installationInvalid:
            return (
                "GraphGoblin can’t start from its saved setup",
                "The GraphGoblin folder this launcher was set up with has moved, isn’t built, or its saved settings can’t be read, so the launcher didn’t start GraphGoblin. Build that folder if needed, then run the macOS launcher installer again from it."
            )
        case .runtimeUnavailable:
            return (
                "GraphGoblin can’t find a usable Node.js",
                "The Node.js this launcher was set up with has moved, can’t run on this Mac, or isn’t Node 22 (22.22.2 or later), so the launcher didn’t start GraphGoblin. Install Node 22, then run the macOS launcher installer again and choose it."
            )
        case .assetsUnavailable:
            return (
                "GraphGoblin’s web pages aren’t available",
                "GraphGoblin’s built web pages are missing or couldn’t be loaded, so the launcher didn’t open them. Build the GraphGoblin folder again, then open GraphGoblin again."
            )
        case .keySourceUnavailable:
            return (
                "GraphGoblin can’t use the key for its data",
                "The launcher couldn’t confirm a key file it can use for the data folder it was set up with, so it didn’t start GraphGoblin. If you start GraphGoblin another way, keep using that way. Don’t delete or replace files to get around this."
            )
        case .portInUse(let port):
            let title = port == 0 ? "GraphGoblin’s port is already in use" : "Port \(port) is already in use"
            let subject = port == 0 ? "GraphGoblin’s port" : "port \(port)"
            return (
                title,
                "Something is using \(subject), and it isn’t the GraphGoblin this launcher is set up for, so the launcher didn’t start GraphGoblin. Nothing was stopped. Close whatever is using the port, or run the macOS launcher installer again with a different port, then open GraphGoblin again."
            )
        case .storeBlocked:
            return (
                "GraphGoblin’s data is in use",
                "Another process is using the data folder this launcher is set up for, so the launcher didn’t start another copy of GraphGoblin. Nothing was stopped. Wait for the other process to finish, or close it deliberately, then open GraphGoblin again. Don’t delete files to get around this."
            )
        case .cannotVerify:
            return (
                "GraphGoblin couldn’t check its status",
                "The launcher couldn’t confirm whether GraphGoblin is already running, so it didn’t start another copy. Nothing was stopped. Wait a moment, then open GraphGoblin again."
            )
        case .launchBusy:
            return (
                "Another GraphGoblin launch didn’t finish in time",
                "Another launch of GraphGoblin was still in progress when this launcher stopped waiting, so it didn’t start GraphGoblin. Nothing was stopped. Wait a moment, then open GraphGoblin again."
            )
        case .releaseUnconfirmed:
            return (
                "GraphGoblin was still shutting down",
                "The previous GraphGoblin session was shutting down, and the launcher couldn’t confirm that it finished in time, so it didn’t start GraphGoblin. The launcher never cuts a shutdown short. Wait for the shutdown to finish, then open GraphGoblin again."
            )
        case .diagnosticsUnavailable:
            return (
                "The launcher can’t use its log folder",
                "The launcher couldn’t safely open its log folder, so it didn’t start GraphGoblin. Make sure your Mac has free disk space, then open GraphGoblin again. If this keeps happening, run the macOS launcher installer again."
            )
        case .startFailed:
            return (
                "GraphGoblin couldn’t be started",
                "macOS couldn’t start GraphGoblin, so nothing was started. Make sure the GraphGoblin folder and Node.js this launcher was set up with are still in place, then open GraphGoblin again."
            )
        case .childExited:
            return (
                "GraphGoblin stopped while starting",
                "GraphGoblin quit before it was ready, so the launcher didn’t open it. The launcher’s log may say why. Fix the cause, then open GraphGoblin again."
            )
        case .startTimedOut:
            return (
                "GraphGoblin didn’t finish starting in time",
                "GraphGoblin was started but didn’t become ready in time, so the launcher stopped waiting. It may still finish starting, and nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why."
            )
        case .startupUnverified:
            return (
                "The launcher couldn’t confirm that GraphGoblin started",
                "The launcher tried to start GraphGoblin but couldn’t confirm the result, so it didn’t open it. GraphGoblin may or may not be running. Nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why."
            )
        case .unexpected:
            return (
                "The launcher ran into a problem",
                "Something unexpected stopped the launch, so the launcher didn’t start GraphGoblin. Nothing was stopped. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why."
            )
        case .invalidHandoff:
            return (
                "The launcher couldn’t open GraphGoblin",
                "Something unexpected stopped the launcher from opening GraphGoblin. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why."
            )
        case .browserRejected(let address):
            return (
                "Your browser didn’t open GraphGoblin",
                "macOS reported a problem opening \(address.text) in your default web browser. Copy the address into a web browser, or check your default web browser, then open GraphGoblin again."
            )
        case .browserUnconfirmed(let address):
            return (
                "macOS didn’t confirm that your browser opened",
                "The launcher asked macOS to open \(address.text) in your default web browser, but macOS didn’t confirm it. The page may still open. If it doesn’t, copy the address into a web browser, or open GraphGoblin again."
            )
        }
    }
}
