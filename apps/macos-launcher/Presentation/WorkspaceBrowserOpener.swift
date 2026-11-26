import AppKit
import LaunchContract

/// Translation of the native `NSWorkspace` completion into the closed browser outcome.
enum BrowserCallback {
    /// An error means `rejected`; an application without an error means `accepted`;
    /// neither means `unconfirmed`. `accepted` is OS acceptance, never a loaded page.
    static func outcome(applicationReturned: Bool, errorReturned: Bool) -> BrowserOutcome {
        if errorReturned {
            return .rejected
        }
        if applicationReturned {
            return .accepted
        }
        return .unconfirmed
    }
}

/// Submits the fixed management address once to the default handler, with activation.
@MainActor
struct WorkspaceBrowserOpener: BrowserOpening {
    func openManagement(
        _ address: ManagementAddress,
        completion: @escaping @Sendable (BrowserOutcome) -> Void
    ) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open(address.url, configuration: configuration) { @Sendable (application, error) in
            completion(
                BrowserCallback.outcome(
                    applicationReturned: application != nil,
                    errorReturned: error != nil
                )
            )
        }
    }
}
