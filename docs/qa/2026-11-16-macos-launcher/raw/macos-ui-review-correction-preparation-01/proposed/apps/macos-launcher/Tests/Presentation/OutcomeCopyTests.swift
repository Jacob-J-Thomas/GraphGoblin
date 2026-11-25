import Foundation
import LaunchContract
import Testing
@testable import LauncherPresentation

/// The reviewed copy for one closed failure outcome.
struct FailureExpectation: Sendable, CustomTestStringConvertible {
    let outcome: LaunchOutcome
    let kind: FailureKind
    let title: String
    let message: String
    let offersShowLog: Bool

    var testDescription: String {
        CopyFixtures.caseName(outcome)
    }
}

enum CopyFixtures {
    static let ok = AlertButton(choice: .dismiss, title: "OK", isDefault: true)
    static let showLog = AlertButton(choice: .showLog, title: "Show Log in Finder", isDefault: false)
    static let copyAddress = AlertButton(choice: .copyAddress, title: "Copy Address", isDefault: false)

    /// Compile-time exhaustive: adding a `LaunchOutcome` case breaks this switch.
    static func caseName(_ outcome: LaunchOutcome) -> String {
        switch outcome {
        case .openManagement: "openManagement"
        case .installationInvalid: "installationInvalid"
        case .runtimeUnavailable: "runtimeUnavailable"
        case .assetsUnavailable: "assetsUnavailable"
        case .keySourceUnavailable: "keySourceUnavailable"
        case .portInUse: "portInUse"
        case .storeBlocked: "storeBlocked"
        case .cannotVerify: "cannotVerify"
        case .launchBusy: "launchBusy"
        case .releaseUnconfirmed: "releaseUnconfirmed"
        case .diagnosticsUnavailable: "diagnosticsUnavailable"
        case .startFailed: "startFailed"
        case .childExited: "childExited"
        case .startTimedOut: "startTimedOut"
        case .startupUnverified: "startupUnverified"
        case .cancelled: "cancelled"
        case .unexpected: "unexpected"
        }
    }

    /// Compile-time exhaustive over the five stages.
    static func stageName(_ stage: LaunchStage) -> String {
        switch stage {
        case .checking: "checking"
        case .waitingForOtherLaunch: "waitingForOtherLaunch"
        case .waitingForStore: "waitingForStore"
        case .waitingForRelease: "waitingForRelease"
        case .starting: "starting"
        }
    }

    static let allStages: [LaunchStage] = [
        .checking, .waitingForOtherLaunch, .waitingForStore, .waitingForRelease, .starting,
    ]

    static let everyOutcome: [LaunchOutcome] = [
        .openManagement(port: 4747, mode: .running),
        .openManagement(port: 4747, mode: .observingShutdown),
        .installationInvalid,
        .runtimeUnavailable,
        .assetsUnavailable,
        .keySourceUnavailable,
        .portInUse(port: 4747),
        .storeBlocked,
        .cannotVerify,
        .launchBusy,
        .releaseUnconfirmed,
        .diagnosticsUnavailable,
        .startFailed,
        .childExited,
        .startTimedOut,
        .startupUnverified,
        .cancelled,
        .unexpected,
    ]

    static let launchFailures: [FailureExpectation] = [
        FailureExpectation(
            outcome: .installationInvalid,
            kind: .installationInvalid,
            title: "GraphGoblin can’t start from its saved setup",
            message: "The GraphGoblin folder this launcher was set up with has moved, isn’t built, or its saved settings can’t be read, so the launcher didn’t start GraphGoblin. Build that folder if needed, then run the macOS launcher installer again from it.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .runtimeUnavailable,
            kind: .runtimeUnavailable,
            title: "GraphGoblin can’t find a usable Node.js",
            message: "The Node.js this launcher was set up with has moved, can’t run on this Mac, or isn’t Node 22 (22.22.2 or later), so the launcher didn’t start GraphGoblin. Install Node 22, then run the macOS launcher installer again and choose it.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .assetsUnavailable,
            kind: .assetsUnavailable,
            title: "GraphGoblin’s web pages aren’t available",
            message: "GraphGoblin’s built web pages are missing or couldn’t be loaded, so the launcher didn’t open them. Build the GraphGoblin folder again, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .keySourceUnavailable,
            kind: .keySourceUnavailable,
            title: "GraphGoblin can’t use the key for its data",
            message: "The launcher couldn’t confirm a key file it can use for the data folder it was set up with, so it didn’t start GraphGoblin. If you start GraphGoblin another way, keep using that way. Don’t delete or replace files to get around this.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .portInUse(port: 4747),
            kind: .portInUse(port: 4747),
            title: "Port 4747 is already in use",
            message: "Something is using port 4747, and it isn’t the GraphGoblin this launcher is set up for, so the launcher didn’t start GraphGoblin. Nothing was stopped. Close whatever is using the port, or run the macOS launcher installer again with a different port, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .storeBlocked,
            kind: .storeBlocked,
            title: "Access to GraphGoblin’s data is blocked",
            message: "The launcher couldn’t confirm that the data folder it was set up with is free to use, so it didn’t start GraphGoblin. Nothing was stopped. Another GraphGoblin session may be using this data. If you recognize one, close it as you normally would, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why. Don’t delete files to get around this.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .cannotVerify,
            kind: .cannotVerify,
            title: "GraphGoblin couldn’t check its status",
            message: "The launcher couldn’t confirm whether GraphGoblin is already running, so it didn’t start another copy. Nothing was stopped. Wait a moment, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .launchBusy,
            kind: .launchBusy,
            title: "Another GraphGoblin launch didn’t finish in time",
            message: "Another launch of GraphGoblin was still in progress when this launcher stopped waiting, so it didn’t start GraphGoblin. Nothing was stopped. Wait a moment, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .releaseUnconfirmed,
            kind: .releaseUnconfirmed,
            title: "GraphGoblin was still shutting down",
            message: "The previous GraphGoblin session was shutting down, and the launcher couldn’t confirm that it finished in time, so it didn’t start GraphGoblin. The launcher never cuts a shutdown short. Wait for the shutdown to finish, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .diagnosticsUnavailable,
            kind: .diagnosticsUnavailable,
            title: "The launcher can’t use its log folder",
            message: "The launcher couldn’t safely open its log folder, so it didn’t start GraphGoblin. Make sure your Mac has free disk space, then open GraphGoblin again. If this keeps happening, run the macOS launcher installer again.",
            offersShowLog: false
        ),
        FailureExpectation(
            outcome: .startFailed,
            kind: .startFailed,
            title: "GraphGoblin couldn’t be started",
            message: "macOS couldn’t start GraphGoblin, so nothing was started. Make sure the GraphGoblin folder and Node.js this launcher was set up with are still in place, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .childExited,
            kind: .childExited,
            title: "GraphGoblin stopped while starting",
            message: "GraphGoblin quit before it was ready, so the launcher didn’t open it. The launcher’s log may say why. Fix the cause, then open GraphGoblin again.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .startTimedOut,
            kind: .startTimedOut,
            title: "GraphGoblin didn’t finish starting in time",
            message: "GraphGoblin was started but didn’t become ready in time, so the launcher stopped waiting. It may still finish starting, and nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .startupUnverified,
            kind: .startupUnverified,
            title: "The launcher couldn’t confirm that GraphGoblin started",
            message: "The launcher tried to start GraphGoblin but couldn’t confirm the result, so it didn’t open it. GraphGoblin may or may not be running. Nothing was stopped. Wait a moment, then open GraphGoblin again. If this keeps happening, the launcher’s log may say why.",
            offersShowLog: true
        ),
        FailureExpectation(
            outcome: .unexpected,
            kind: .unexpected,
            title: "The launcher ran into a problem",
            message: "Something unexpected stopped the launch, so the launcher didn’t start GraphGoblin. Nothing was stopped. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why.",
            offersShowLog: true
        ),
    ]

    static var showLogFailures: [FailureExpectation] {
        launchFailures.filter { $0.offersShowLog }
    }

    static func unconfirmedAlert(port: UInt16) -> AlertContent? {
        guard let address = ManagementAddress(port: port) else { return nil }
        return PresentationCopy.alert(for: .browserUnconfirmed(address), showLogAvailable: false)
    }

    static func rejectedAlert(port: UInt16) -> AlertContent? {
        guard let address = ManagementAddress(port: port) else { return nil }
        return PresentationCopy.alert(for: .browserRejected(address), showLogAvailable: false)
    }
}

/// Finds implementation details, paths and stray numbers in user-visible text.
enum CopyCanary {
    static let forbiddenWords: Set<String> = [
        "gateway", "helper", "pid", "pids", "lock", "locks", "lease", "leases", "sqlite",
        "token", "fingerprint", "stderr", "stdout", "errno", "posix", "spawn", "env",
        "json", "config", "localhost", "exception", "stack",
    ]
    static let forbiddenFragments = ["GG_", "exit code", ".log", ".json", "/", "\\", "~", "$", "%", "{", "}"]

    /// `allowed` fragments (the fixed address, a port) are removed before checking.
    static func violations(in text: String, allowing allowed: [String] = []) -> [String] {
        var scrubbed = text
        for fragment in allowed {
            scrubbed = scrubbed.replacingOccurrences(of: fragment, with: " ")
        }
        scrubbed = scrubbed.replacingOccurrences(of: "Node.js", with: "Node")
        scrubbed = scrubbed.replacingOccurrences(of: "22.22.2", with: " ")
        scrubbed = scrubbed.replacingOccurrences(of: "Node 22", with: "Node")

        var found: [String] = []
        for fragment in forbiddenFragments where scrubbed.contains(fragment) {
            found.append(fragment)
        }
        if scrubbed.contains(".js") {
            found.append(".js")
        }
        if scrubbed.contains(where: { $0.isNumber }) {
            found.append("digit")
        }
        let words = scrubbed.lowercased()
            .split(whereSeparator: { !$0.isLetter && $0 != "_" })
            .map(String.init)
        for word in words where forbiddenWords.contains(word) {
            found.append(word)
        }
        return found
    }
}

@Suite("Outcome mapping and fixed copy")
struct OutcomeCopyTests {
    @Test("The fixtures name all 17 closed outcomes and all 15 failures")
    func fixturesCoverEveryOutcome() {
        let names = Set(CopyFixtures.everyOutcome.map { CopyFixtures.caseName($0) })
        #expect(names.count == 17)
        let failureNames = Set(CopyFixtures.launchFailures.map { CopyFixtures.caseName($0.outcome) })
        #expect(failureNames.count == 15)
        #expect(failureNames.isDisjoint(with: ["openManagement", "cancelled"]))
        #expect(Set(CopyFixtures.allStages.map { CopyFixtures.stageName($0) }).count == 5)
    }

    @Test("Each failure outcome maps to its own fixed alert", arguments: CopyFixtures.launchFailures)
    func failureCopy(_ expected: FailureExpectation) {
        #expect(PresentationCopy.disposition(for: expected.outcome) == .failure(expected.kind))
        #expect(expected.kind.offersShowLog == expected.offersShowLog)
        #expect(expected.kind.managementAddress == nil)

        let withoutLog = PresentationCopy.alert(for: expected.kind, showLogAvailable: false)
        #expect(withoutLog.title == expected.title)
        #expect(withoutLog.message == expected.message)
        #expect(withoutLog.buttons == [CopyFixtures.ok])

        let withLog = PresentationCopy.alert(for: expected.kind, showLogAvailable: true)
        #expect(withLog.title == expected.title)
        #expect(withLog.message == expected.message)
        if expected.offersShowLog {
            #expect(withLog.buttons == [CopyFixtures.ok, CopyFixtures.showLog])
        } else {
            #expect(withLog.buttons == [CopyFixtures.ok])
        }
    }

    @Test("Failure titles are distinct")
    func distinctTitles() {
        let titles = CopyFixtures.launchFailures.map { $0.title }
        #expect(Set(titles).count == titles.count)
    }

    @Test("Start failures distinguish no child, a verified exit, a timeout and an unknown result")
    func startFailureDistinctions() {
        let byName = Dictionary(
            uniqueKeysWithValues: CopyFixtures.launchFailures.map { (CopyFixtures.caseName($0.outcome), $0.message) }
        )
        let startFailed = byName["startFailed"] ?? ""
        let childExited = byName["childExited"] ?? ""
        let timedOut = byName["startTimedOut"] ?? ""
        let unverified = byName["startupUnverified"] ?? ""
        let assets = byName["assetsUnavailable"] ?? ""
        // Only the definite no-child failure says nothing was started.
        #expect(startFailed.contains("nothing was started"))
        for message in [childExited, timedOut, unverified, assets] {
            #expect(!message.contains("nothing was started"))
            #expect(!message.contains("didn’t start GraphGoblin"))
        }
        #expect(childExited.contains("quit before it was ready"))
        #expect(timedOut.contains("was started but didn’t become ready in time"))
        #expect(unverified.contains("may or may not be running"))
        // No failure claims GraphGoblin is running now.
        for expected in CopyFixtures.launchFailures {
            #expect(!expected.message.contains("is still running"))
            #expect(!expected.message.contains("GraphGoblin is running"))
        }
    }

    @Test("Quit and blocked-data copy promise only what the launcher can know")
    func uncertainCopy() {
        // Quit cancels a pending launch only; a start already under way may still finish.
        let detail = PresentationCopy.waitingDetail
        #expect(detail.hasPrefix("Hiding this window doesn’t stop the launch."))
        #expect(detail.contains("Quitting cancels the launch if it’s still pending"))
        #expect(detail.contains("if GraphGoblin has already begun starting, it may still finish starting"))
        #expect(detail.contains("Quitting never stops a GraphGoblin that’s already running"))

        // Access to the data is blocked or unconfirmed; nothing asserts that another session uses it.
        let waiting = PresentationCopy.progress(for: .waitingForStore).statusLine
        let blocked = PresentationCopy.alert(for: .storeBlocked, showLogAvailable: true)
        #expect(waiting.hasPrefix("Access to GraphGoblin’s data is blocked."))
        #expect(blocked.title == "Access to GraphGoblin’s data is blocked")
        for text in [waiting, blocked.title, blocked.message] {
            #expect(!text.contains("in use"), "\(text)")
            #expect(!text.contains("is using"), "\(text)")
            #expect(!text.contains("Another process"), "\(text)")
        }
        #expect(blocked.message.contains("couldn’t confirm that the data folder it was set up with is free to use"))
        #expect(blocked.message.contains("Another GraphGoblin session may be using this data."))
        // Closing a session is suggested only for one the user recognizes, never forced.
        #expect(blocked.message.contains("If you recognize one, close it as you normally would"))
        #expect(blocked.message.contains("Nothing was stopped."))
        #expect(blocked.message.contains("If this keeps happening, the launcher’s log may say why."))
        #expect(blocked.message.contains("Don’t delete files to get around this."))
        #expect(blocked.buttons == [CopyFixtures.ok, CopyFixtures.showLog])
    }

    @Test(
        "Management outcomes hand off the literal loopback address",
        arguments: [UInt16(1), 80, 4747, 65535],
        [ManagementMode.running, .observingShutdown]
    )
    func managementHandoff(port: UInt16, mode: ManagementMode) throws {
        let address = try #require(ManagementAddress(port: port))
        #expect(PresentationCopy.disposition(for: .openManagement(port: port, mode: mode)) == .handOff(address, mode))
        #expect(address.port == port)
        #expect(address.text == "http://127.0.0.1:\(port)/app/")
        #expect(address.url.absoluteString == address.text)
        let components = try #require(URLComponents(url: address.url, resolvingAgainstBaseURL: false))
        #expect(components.scheme == "http")
        #expect(components.host == "127.0.0.1")
        #expect(components.port == Int(port))
        #expect(components.path == "/app/")
        #expect(components.query == nil)
        #expect(components.fragment == nil)
        #expect(components.user == nil)
        #expect(components.password == nil)
    }

    @Test("A management outcome without a usable port never becomes a browser address")
    func zeroPortHandoff() {
        #expect(ManagementAddress(port: 0) == nil)
        #expect(PresentationCopy.disposition(for: .openManagement(port: 0, mode: .running)) == .failure(.invalidHandoff))
        #expect(PresentationCopy.disposition(for: .openManagement(port: 0, mode: .observingShutdown)) == .failure(.invalidHandoff))
        #expect(!FailureKind.invalidHandoff.offersShowLog)
        let alert = PresentationCopy.alert(for: .invalidHandoff, showLogAvailable: true)
        #expect(alert.title == "The launcher couldn’t open GraphGoblin")
        #expect(alert.message == "Something unexpected stopped the launcher from opening GraphGoblin. Open GraphGoblin again. If this keeps happening, the launcher’s log may say why.")
        #expect(alert.buttons == [CopyFixtures.ok])
    }

    @Test("Port conflicts name only the reported port", arguments: [UInt16(1), 80, 65535])
    func portInUseCopy(port: UInt16) {
        let alert = PresentationCopy.alert(for: .portInUse(port: port), showLogAvailable: false)
        #expect(alert.title == "Port \(port) is already in use")
        #expect(alert.message == "Something is using port \(port), and it isn’t the GraphGoblin this launcher is set up for, so the launcher didn’t start GraphGoblin. Nothing was stopped. Close whatever is using the port, or run the macOS launcher installer again with a different port, then open GraphGoblin again.")
        #expect(CopyCanary.violations(in: alert.title, allowing: ["\(port)"]).isEmpty)
        #expect(CopyCanary.violations(in: alert.message, allowing: ["\(port)"]).isEmpty)
    }

    @Test("A port conflict with no usable port uses the generic wording")
    func portInUseWithoutPort() {
        let alert = PresentationCopy.alert(for: .portInUse(port: 0), showLogAvailable: false)
        #expect(alert.title == "GraphGoblin’s port is already in use")
        #expect(alert.message == "Something is using GraphGoblin’s port, and it isn’t the GraphGoblin this launcher is set up for, so the launcher didn’t start GraphGoblin. Nothing was stopped. Close whatever is using the port, or run the macOS launcher installer again with a different port, then open GraphGoblin again.")
        #expect(CopyCanary.violations(in: alert.title + " " + alert.message).isEmpty)
    }

    @Test("Browser failures show the fixed address and offer only Copy Address", arguments: [UInt16(1), 4747, 65535])
    func browserCopy(port: UInt16) throws {
        let address = try #require(ManagementAddress(port: port))
        let url = "http://127.0.0.1:\(port)/app/"

        let rejected = PresentationCopy.alert(for: .browserRejected(address), showLogAvailable: true)
        #expect(rejected.title == "Your browser didn’t open GraphGoblin")
        #expect(rejected.message == "macOS reported a problem opening \(url) in your default web browser. Copy the address into a web browser, or check your default web browser, then open GraphGoblin again.")
        #expect(rejected.buttons == [CopyFixtures.ok, CopyFixtures.copyAddress])

        let unconfirmed = PresentationCopy.alert(for: .browserUnconfirmed(address), showLogAvailable: true)
        #expect(unconfirmed.title == "macOS didn’t confirm that your browser opened")
        #expect(unconfirmed.message == "The launcher asked macOS to open \(url) in your default web browser, but macOS didn’t confirm it. The page may still open. If it doesn’t, copy the address into a web browser, or open GraphGoblin again.")
        #expect(unconfirmed.buttons == [CopyFixtures.ok, CopyFixtures.copyAddress])

        #expect(FailureKind.browserRejected(address).managementAddress == address)
        #expect(FailureKind.browserUnconfirmed(address).managementAddress == address)
        #expect(!FailureKind.browserRejected(address).offersShowLog)
        #expect(!FailureKind.browserUnconfirmed(address).offersShowLog)
        for alert in [rejected, unconfirmed] {
            #expect(!alert.message.contains("still running"))
            #expect(CopyCanary.violations(in: alert.title + " " + alert.message, allowing: [url]).isEmpty)
        }
    }

    @Test("Cancelled ends quietly")
    func cancelledIsQuiet() {
        #expect(PresentationCopy.disposition(for: .cancelled) == .quiet)
    }

    @Test("Every stage has its own fixed progress line")
    func stageCopy() {
        let detail = "Hiding this window doesn’t stop the launch. Quitting cancels the launch if it’s still pending, but if GraphGoblin has already begun starting, it may still finish starting. Quitting never stops a GraphGoblin that’s already running."
        let expected: [String: String] = [
            "checking": "Checking GraphGoblin…",
            "waitingForOtherLaunch": "Another GraphGoblin launch is in progress. Waiting for it to finish…",
            "waitingForStore": "Access to GraphGoblin’s data is blocked. Waiting for it to become available…",
            "waitingForRelease": "The previous GraphGoblin session is still shutting down. Waiting for it to finish…",
            "starting": "Starting GraphGoblin…",
        ]
        for stage in CopyFixtures.allStages {
            let line = expected[CopyFixtures.stageName(stage)]
            #expect(PresentationCopy.progress(for: stage) == ProgressContent(statusLine: line ?? "", detail: detail))
        }
        #expect(PresentationCopy.progress(for: nil) == ProgressContent(statusLine: "Opening GraphGoblin…", detail: detail))
        #expect(PresentationCopy.handoffProgress == ProgressContent(
            statusLine: "Opening GraphGoblin in your web browser…",
            detail: "Your web browser may take a moment to open. Quitting the launcher doesn’t stop GraphGoblin."
        ))
        let lines = CopyFixtures.allStages.map { PresentationCopy.progress(for: $0).statusLine }
            + [PresentationCopy.progress(for: nil).statusLine, PresentationCopy.handoffProgress.statusLine]
        #expect(Set(lines).count == 7)
    }

    @Test("No user-visible text carries paths, process details or implementation vocabulary")
    func vocabulary() {
        var texts: [String] = [
            PresentationCopy.windowTitle, PresentationCopy.hideButton, PresentationCopy.quitButton,
            PresentationCopy.hideHelp, PresentationCopy.quitHelp, PresentationCopy.spinnerLabel,
            PresentationCopy.okButton, PresentationCopy.showLogButton, PresentationCopy.copyAddressButton,
            PresentationCopy.applicationMenu, PresentationCopy.quitMenuItem, PresentationCopy.fileMenu,
            PresentationCopy.closeMenuItem, PresentationCopy.waitingDetail, PresentationCopy.handoffDetail,
            PresentationCopy.handoffProgress.statusLine, PresentationCopy.progress(for: nil).statusLine,
        ]
        texts += CopyFixtures.allStages.map { PresentationCopy.progress(for: $0).statusLine }
        for expected in CopyFixtures.launchFailures where CopyFixtures.caseName(expected.outcome) != "portInUse" {
            let alert = PresentationCopy.alert(for: expected.kind, showLogAvailable: true)
            texts += [alert.title, alert.message] + alert.buttons.map { $0.title }
        }
        let invalid = PresentationCopy.alert(for: .invalidHandoff, showLogAvailable: true)
        texts += [invalid.title, invalid.message]
        for text in texts {
            #expect(CopyCanary.violations(in: text).isEmpty, "\(text)")
        }
    }

    @Test("The canary scanner detects the raw details it guards against")
    func canaryScannerDetects() {
        #expect(!CopyCanary.violations(in: "Log: ~/Library/Logs/GraphGoblin/Launcher").isEmpty)
        #expect(!CopyCanary.violations(in: "helper exited with exit code 70").isEmpty)
        #expect(!CopyCanary.violations(in: "gateway PID 4242 holds the lock").isEmpty)
        #expect(!CopyCanary.violations(in: "apps/api/dist/main.js").isEmpty)
        #expect(!CopyCanary.violations(in: "GG_DATA_DIR is set").isEmpty)
        #expect(!CopyCanary.violations(in: "{\"status\":\"ok\"}").isEmpty)
        #expect(CopyCanary.violations(in: "Install Node 22 (22.22.2 or later) and Node.js").isEmpty)
    }
}
