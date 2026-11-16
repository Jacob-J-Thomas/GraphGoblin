import LaunchContract
import Testing
@testable import LauncherPresentation

@Suite("Browser completion deadline arbitration")
struct HandoffArbiterTests {
    typealias Instant = ManualClock.Instant

    static let deadline = Instant(offset: .seconds(10))
    static let allOutcomes: [BrowserOutcome] = [.accepted, .rejected, .unconfirmed]

    @Test("Before the deadline the translated callback stands", arguments: HandoffArbiterTests.allOutcomes)
    func beforeDeadline(_ outcome: BrowserOutcome) {
        let arbiter = HandoffArbiter(deadline: Self.deadline)
        #expect(arbiter.observe(outcome, at: Instant(offset: .milliseconds(9_999))) == outcome)
        #expect(arbiter.expire(at: Self.deadline) == nil)
        #expect(arbiter.observe(.accepted, at: Instant(offset: .seconds(1))) == nil)
    }

    @Test(
        "At or after the deadline every callback is unconfirmed",
        arguments: HandoffArbiterTests.allOutcomes,
        [Duration.seconds(10), .seconds(11), .seconds(600)]
    )
    func atOrAfterDeadline(_ outcome: BrowserOutcome, observedAt offset: Duration) {
        let arbiter = HandoffArbiter(deadline: Self.deadline)
        #expect(arbiter.observe(outcome, at: Instant(offset: offset)) == .unconfirmed)
        #expect(arbiter.observe(.accepted, at: Instant(offset: .seconds(1))) == nil)
    }

    @Test("An early timer does not settle; the later callback still can")
    func earlyExpiryIgnored() {
        let arbiter = HandoffArbiter(deadline: Self.deadline)
        #expect(arbiter.expire(at: Instant(offset: .milliseconds(9_999))) == nil)
        #expect(arbiter.observe(.rejected, at: Instant(offset: .milliseconds(9_999))) == .rejected)
    }

    @Test("Expiry settles once; later callbacks and timers are ignored")
    func expirySettlesOnce() {
        let arbiter = HandoffArbiter(deadline: Self.deadline)
        #expect(arbiter.expire(at: Self.deadline) == .unconfirmed)
        #expect(arbiter.observe(.accepted, at: Instant(offset: .seconds(2))) == nil)
        #expect(arbiter.expire(at: Instant(offset: .seconds(20))) == nil)
    }

    @Test("Concurrent callbacks and timers settle exactly once")
    func concurrentSettlement() async {
        let arbiter = HandoffArbiter(deadline: Self.deadline)
        let results: [BrowserOutcome?] = await withTaskGroup(of: BrowserOutcome?.self) { group in
            for index in 0..<64 {
                group.addTask {
                    if index.isMultiple(of: 2) {
                        return arbiter.observe(.accepted, at: Instant(offset: .seconds(1)))
                    }
                    return arbiter.expire(at: Instant(offset: .seconds(10)))
                }
            }
            var collected: [BrowserOutcome?] = []
            for await result in group {
                collected.append(result)
            }
            return collected
        }
        #expect(results.count == 64)
        #expect(results.compactMap { $0 }.count == 1)
    }
}
