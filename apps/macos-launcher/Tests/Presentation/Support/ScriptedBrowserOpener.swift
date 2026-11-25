import LaunchContract
@testable import LauncherPresentation

/// Counts default-browser submissions and releases scripted native callbacks.
@MainActor
final class ScriptedBrowserOpener: BrowserOpening {
    private(set) var submissions: [ManagementAddress] = []
    private var completions: [@Sendable (BrowserOutcome) -> Void] = []

    func openManagement(
        _ address: ManagementAddress,
        completion: @escaping @Sendable (BrowserOutcome) -> Void
    ) {
        submissions.append(address)
        completions.append(completion)
    }

    /// Invokes the native callback synchronously on the calling thread.
    func deliver(_ outcome: BrowserOutcome, submission index: Int = 0) {
        completions[index](outcome)
    }

    /// Invokes the native callback from a background thread, as AppKit may.
    func deliverOffMain(_ outcome: BrowserOutcome, submission index: Int = 0) async {
        let completion = completions[index]
        await Task.detached {
            completion(outcome)
        }.value
    }
}
