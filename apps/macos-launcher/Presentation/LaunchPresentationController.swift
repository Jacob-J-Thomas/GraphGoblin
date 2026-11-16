import LaunchContract

/// Presentation-owned timing. None of these values changes the engine's own budget.
enum PresentationTiming {
    /// Delay before the progress panel appears on its own.
    static let progressThreshold: Duration = .seconds(1)
    /// Monotonic completion deadline for the one browser submission, started at submission.
    static let browserDeadline: Duration = .seconds(10)
    /// How long a reached failure waits for the Show Log offer before showing without it.
    static let showLogOfferWait: Duration = .seconds(3)
    /// How long Quit waits for the engine to return after `requestQuit()` before exiting.
    static let quitGrace: Duration = .seconds(2)
}

enum PresentationPhase: Equatable, Sendable {
    /// Created; the engine has not been asked to run.
    case idle
    /// The single engine run is in flight.
    case waiting
    /// One browser submission is awaiting its terminal result.
    case handingOff
    /// A failure was reached; the Show Log offer is being resolved.
    case preparingFailure
    /// The failure window is on screen.
    case showingFailure
    /// The user chose Show Log; the opaque action is running.
    case runningShowLog
    /// Quit was requested. Nothing else is presented or submitted.
    case quitting
    /// A terminal result was presented; the application is exiting.
    case finished
}

private enum EngineEvent: Sendable {
    case stage(LaunchStage, AttemptToken)
    case outcome(LaunchOutcome, AttemptToken)
}

/// The launcher presentation state machine for exactly one engine attempt.
///
/// All state lives on the main actor. Engine work runs off it; progress and the outcome
/// return through one ordered stream tagged with the private attempt token. Timers use the
/// injected monotonic clock. Every late event is checked against the token and the phase
/// before it can change anything on screen.
@MainActor
final class LaunchPresentationController<C: Clock>: PresentationLifecycle, PresentationEvents
where C.Duration == Duration {
    private let engine: any LaunchEngine
    private let resolveShowLog: @MainActor () async -> ShowLogAction?
    private let opener: any BrowserOpening
    private let surface: any PresentationSurface
    private let clock: C
    private let token = AttemptToken()

    private(set) var phase: PresentationPhase = .idle
    private(set) var runStarted = false
    private(set) var runReturned = false
    private(set) var shownFailure: FailureKind?

    private var stage: LaunchStage?
    private var progressVisible = false
    private var userHidProgress = false
    private var handoffAddress: ManagementAddress?
    private var arbiter: HandoffArbiter<C.Instant>?
    /// The reached failure awaiting its Show Log offer, with the one absolute monotonic instant
    /// that ends the offer for both the expiry timer and the resolver's answer.
    private var pendingFailure: (kind: FailureKind, offerDeadline: C.Instant)?
    private var shownAlert: AlertContent?
    private var showLogAction: ShowLogAction?
    private var awaitingTerminationReply = false

    private var eventTask: Task<Void, Never>?
    private var thresholdTask: Task<Void, Never>?
    private var deadlineTask: Task<Void, Never>?
    private var resolverTask: Task<Void, Never>?
    private var resolverWaitTask: Task<Void, Never>?
    private var showLogTask: Task<Void, Never>?
    private var graceTask: Task<Void, Never>?

    init(
        engine: any LaunchEngine,
        resolveShowLog: @escaping @MainActor () async -> ShowLogAction?,
        opener: any BrowserOpening,
        surface: any PresentationSurface,
        clock: C
    ) {
        self.engine = engine
        self.resolveShowLog = resolveShowLog
        self.opener = opener
        self.surface = surface
        self.clock = clock
    }

    // MARK: - Lifecycle

    /// Starts the one engine run. Any later call, including from reopen, does nothing.
    func start() {
        guard phase == .idle else { return }
        phase = .waiting
        runStarted = true

        let token = self.token
        thresholdTask = after(clock.now.advanced(by: PresentationTiming.progressThreshold)) { controller in
            controller.progressThresholdReached()
        }

        let (events, continuation) = AsyncStream.makeStream(of: EngineEvent.self)
        let engine = self.engine
        Task.detached(priority: .userInitiated) {
            let outcome = await engine.run(progress: { stage in
                continuation.yield(.stage(stage, token))
            })
            continuation.yield(.outcome(outcome, token))
            continuation.finish()
        }
        eventTask = Task { [weak self] in
            for await event in events {
                guard let self else { return }
                self.receive(event)
            }
        }
    }

    /// Finder, Dock or `open` while running: surface the existing state. Never starts a run.
    func reopenRequested() {
        switch phase {
        case .waiting, .handingOff, .preparingFailure:
            userHidProgress = false
            progressVisible = true
            let content = currentProgressContent
            surface.showProgress(content, activation: .activate)
            surface.announce(content.statusLine)
        case .showingFailure:
            surface.raiseAlert()
        case .idle, .runningShowLog, .quitting, .finished:
            return
        }
    }

    /// Every Quit path: menu, panel button, Dock menu, logout.
    ///
    /// Only the first request does the Quit work. A repeated request while that first one still
    /// awaits its reply answers `.later` again and changes nothing else: `requestQuit()` is not
    /// repeated, the grace keeps its original deadline and exactly one reply is ever sent. Once
    /// that reply has been sent, or when none was owed, a repeated request answers `.now`.
    func terminationRequested() -> TerminationDecision {
        switch phase {
        case .finished:
            return .now
        case .quitting:
            // A second Quit must never cut short the wait for the engine's own cleanup.
            return awaitingTerminationReply ? .later : .now
        case .idle, .waiting, .handingOff, .preparingFailure, .showingFailure, .runningShowLog:
            break
        }
        phase = .quitting
        cancelPendingWork()
        progressVisible = false
        surface.closeProgress()
        surface.closeAlert()
        shownAlert = nil
        engine.requestQuit()
        guard runStarted, !runReturned else { return .now }
        awaitingTerminationReply = true
        graceTask = after(clock.now.advanced(by: PresentationTiming.quitGrace)) { controller in
            controller.replyToTermination()
        }
        return .later
    }

    // MARK: - User events

    /// Close box, Esc, Command-period, Command-W or Hide: hide only; the attempt continues.
    func hideRequested() {
        switch phase {
        case .waiting, .handingOff, .preparingFailure:
            userHidProgress = true
            progressVisible = false
            surface.hideProgress()
        case .idle, .showingFailure, .runningShowLog, .quitting, .finished:
            return
        }
    }

    func alertChoiceMade(_ choice: AlertChoice) {
        guard phase == .showingFailure,
              let alert = shownAlert,
              alert.buttons.contains(where: { $0.choice == choice })
        else { return }
        shownAlert = nil
        surface.closeAlert()
        switch choice {
        case .dismiss:
            finish()
        case .copyAddress:
            if let address = shownFailure?.managementAddress {
                surface.writeToPasteboard(address.text)
            }
            finish()
        case .showLog:
            guard showLogAction != nil else {
                finish()
                return
            }
            phase = .runningShowLog
            let token = self.token
            showLogTask = Task { [weak self] in
                guard let action = self?.showLogAction else { return }
                await action()
                self?.showLogFinished(token: token)
            }
        }
    }

    // MARK: - Engine events

    private func receive(_ event: EngineEvent) {
        switch event {
        case .stage(let newStage, let source):
            guard source === token else { return }
            receiveStage(newStage)
        case .outcome(let outcome, let source):
            guard source === token else { return }
            receiveOutcome(outcome)
        }
    }

    private func receiveStage(_ newStage: LaunchStage) {
        guard phase == .waiting, newStage != stage else { return }
        stage = newStage
        let content = PresentationCopy.progress(for: newStage)
        surface.updateProgress(content)
        if progressVisible {
            surface.announce(content.statusLine)
        }
    }

    private func receiveOutcome(_ outcome: LaunchOutcome) {
        runReturned = true
        switch phase {
        case .quitting:
            replyToTermination()
        case .waiting:
            thresholdTask?.cancel()
            thresholdTask = nil
            switch PresentationCopy.disposition(for: outcome) {
            case .handOff(let address, let mode):
                handOff(to: address, mode: mode)
            case .quiet:
                finish()
            case .failure(let kind):
                reachFailure(kind)
            }
        case .idle, .handingOff, .preparingFailure, .showingFailure, .runningShowLog, .finished:
            return
        }
    }

    // MARK: - Delayed progress

    private var currentProgressContent: ProgressContent {
        phase == .handingOff ? PresentationCopy.handoffProgress : PresentationCopy.progress(for: stage)
    }

    private func progressThresholdReached() {
        guard phase == .waiting, !userHidProgress, !progressVisible else { return }
        progressVisible = true
        let content = currentProgressContent
        surface.showProgress(content, activation: .ifAppActive)
        surface.announce(content.statusLine)
    }

    // MARK: - Browser handoff

    private func handOff(to address: ManagementAddress, mode: ManagementMode) {
        switch mode {
        case .running, .observingShutdown:
            // Both modes open the same management address. The page itself shows shutdown state.
            break
        }
        phase = .handingOff
        handoffAddress = address
        let content = PresentationCopy.handoffProgress
        surface.updateProgress(content)
        if progressVisible {
            surface.announce(content.statusLine)
        }

        let deadline = clock.now.advanced(by: PresentationTiming.browserDeadline)
        let arbiter = HandoffArbiter(deadline: deadline)
        self.arbiter = arbiter
        deadlineTask = after(deadline) { controller in
            controller.browserDeadlineReached()
        }

        let clock = self.clock
        let token = self.token
        opener.openManagement(address, completion: { @Sendable [weak self] outcome in
            // Record the observation instant here, on the callback's own thread.
            guard let settled = arbiter.observe(outcome, at: clock.now) else { return }
            let controller = self
            Task { @MainActor in
                controller?.browserSettled(settled, token: token)
            }
        })
    }

    private func browserDeadlineReached() {
        guard phase == .handingOff,
              let arbiter,
              let settled = arbiter.expire(at: clock.now)
        else { return }
        browserSettled(settled, token: token)
    }

    private func browserSettled(_ outcome: BrowserOutcome, token source: AttemptToken) {
        guard source === token, phase == .handingOff, let address = handoffAddress else { return }
        deadlineTask?.cancel()
        deadlineTask = nil
        switch outcome {
        case .accepted:
            finish()
        case .rejected:
            reachFailure(.browserRejected(address))
        case .unconfirmed:
            reachFailure(.browserUnconfirmed(address))
        }
    }

    // MARK: - Failure and Show Log

    private func reachFailure(_ kind: FailureKind) {
        guard kind.offersShowLog else {
            showFailure(kind, showLog: nil)
            return
        }
        phase = .preparingFailure
        // One absolute deadline ends the offer. The expiry timer sleeps until it and the
        // resolver's answer is judged against it, so neither completion order can extend it.
        let deadline = clock.now.advanced(by: PresentationTiming.showLogOfferWait)
        pendingFailure = (kind: kind, offerDeadline: deadline)
        let token = self.token
        resolverTask = Task { [weak self] in
            guard let resolve = self?.resolveShowLog else { return }
            let action = await resolve()
            self?.showLogResolved(action, token: token)
        }
        resolverWaitTask = after(deadline) { controller in
            controller.showLogOfferExpired()
        }
    }

    /// Judges the resolver's answer on the main actor against the offer deadline. An answer
    /// handled at or after that instant is discarded even when the expiry timer's continuation
    /// is still queued behind it: the window then shows without Show Log, as on expiry.
    private func showLogResolved(_ action: ShowLogAction?, token source: AttemptToken) {
        guard source === token, phase == .preparingFailure, let pending = pendingFailure else { return }
        resolverWaitTask?.cancel()
        resolverWaitTask = nil
        let offered: ShowLogAction? = clock.now < pending.offerDeadline ? action : nil
        showFailure(pending.kind, showLog: offered)
    }

    private func showLogOfferExpired() {
        guard phase == .preparingFailure, let pending = pendingFailure else { return }
        resolverTask?.cancel()
        resolverTask = nil
        showFailure(pending.kind, showLog: nil)
    }

    private func showFailure(_ kind: FailureKind, showLog action: ShowLogAction?) {
        phase = .showingFailure
        pendingFailure = nil
        shownFailure = kind
        showLogAction = action
        progressVisible = false
        surface.closeProgress()
        let alert = PresentationCopy.alert(for: kind, showLogAvailable: action != nil)
        shownAlert = alert
        surface.showAlert(alert)
    }

    private func showLogFinished(token source: AttemptToken) {
        guard source === token, phase == .runningShowLog else { return }
        finish()
    }

    // MARK: - Ending

    private func finish() {
        switch phase {
        case .quitting, .finished:
            return
        case .idle, .waiting, .handingOff, .preparingFailure, .showingFailure, .runningShowLog:
            break
        }
        phase = .finished
        cancelPendingWork()
        progressVisible = false
        surface.closeProgress()
        surface.closeAlert()
        surface.terminateApplication()
    }

    private func replyToTermination() {
        guard awaitingTerminationReply else { return }
        awaitingTerminationReply = false
        graceTask?.cancel()
        graceTask = nil
        surface.replyToTermination()
    }

    private func cancelPendingWork() {
        thresholdTask?.cancel()
        thresholdTask = nil
        deadlineTask?.cancel()
        deadlineTask = nil
        resolverWaitTask?.cancel()
        resolverWaitTask = nil
        resolverTask?.cancel()
        resolverTask = nil
    }

    /// Runs `action` on the main actor once the injected clock reaches `deadline`,
    /// unless the returned task is cancelled first.
    private func after(
        _ deadline: C.Instant,
        _ action: @escaping @MainActor @Sendable (LaunchPresentationController) -> Void
    ) -> Task<Void, Never> {
        let clock = self.clock
        return Task { [weak self] in
            do {
                try await clock.sleep(until: deadline, tolerance: nil)
            } catch {
                return
            }
            guard let self, !Task.isCancelled else { return }
            action(self)
        }
    }
}
