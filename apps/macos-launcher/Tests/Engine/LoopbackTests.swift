import Darwin
import Dispatch
import Foundation
import Synchronization
@testable import LauncherEngine
import Testing

/// Binds an ephemeral IPv4 port even when the test needs connection refusal.
struct FixtureSocket: Sendable {
    let handle: OwnedDescriptor
    let port: UInt16

    init() throws {
        let handle = try OwnedDescriptor(Darwin.socket(AF_INET, SOCK_STREAM, 0))
        guard fcntl(handle.fd, F_SETFD, FD_CLOEXEC) == 0 else {
            throw FileRefusal.system(errno)
        }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr = in_addr(s_addr: in_addr_t(0x7F000001).bigEndian)
        var size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(handle.fd, $0, size) }
        }
        guard bound == 0 else { throw FileRefusal.system(errno) }
        let named = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(handle.fd, $0, &size) }
        }
        guard named == 0, address.sin_port != 0 else { throw FileRefusal.invalid }
        self.handle = handle
        self.port = UInt16(bigEndian: address.sin_port)
    }
}

final class ScriptedLoopbackPeer: Sendable {
    enum Reply: Sendable {
        case bytes(Data)
        case reset
        case stallUntilClientCloses
    }

    let port: UInt16
    private let completed = DispatchSemaphore(value: 0)
    private let result = Mutex<Result<[String], any Error>?>(nil)

    init(_ replies: [Reply]) throws {
        let listener = try FixtureSocket()
        self.port = listener.port
        guard listen(listener.handle.fd, 4) == 0 else { throw FileRefusal.system(errno) }
        DispatchQueue.global(qos: .userInitiated).async {
            let observed = Result { try Self.serve(listener.handle, replies: replies) }
            self.result.withLock { $0 = observed }
            self.completed.signal()
        }
    }

    func requests() throws -> [String] {
        guard completed.wait(timeout: .now() + .seconds(12)) == .success else {
            throw OperationRefusal.deadline
        }
        return try #require(result.withLock { $0 }).get()
    }

    private static func serve(_ listener: OwnedDescriptor, replies: [Reply]) throws -> [String] {
        let limit = OperationLimit(time: AttemptTime(seconds: 12), quitting: { false })
        var requests: [String] = []
        for reply in replies {
            try ready(listener, events: POLLIN, limit: limit)
            let client = try OwnedDescriptor(accept(listener.fd, nil, nil))
            var yes: Int32 = 1
            guard fcntl(client.fd, F_SETFD, FD_CLOEXEC) == 0,
                  setsockopt(client.fd, SOL_SOCKET, SO_NOSIGPIPE, &yes,
                             socklen_t(MemoryLayout<Int32>.size)) == 0 else {
                throw FileRefusal.system(errno)
            }
            requests.append(try readRequest(client, limit: limit))
            switch reply {
            case .bytes(let data):
                try ready(client, events: POLLOUT, limit: limit)
                try writeAll(client, data)
            case .reset:
                var immediate = linger(l_onoff: 1, l_linger: 0)
                guard setsockopt(client.fd, SOL_SOCKET, SO_LINGER, &immediate,
                                 socklen_t(MemoryLayout<linger>.size)) == 0 else {
                    throw FileRefusal.system(errno)
                }
            case .stallUntilClientCloses:
                try ready(client, events: POLLIN, limit: limit)
                var buffer: UInt8 = 0
                guard recv(client.fd, &buffer, 1, 0) == 0 else { throw FileRefusal.invalid }
            }
        }
        return requests
    }

    private static func readRequest(_ client: OwnedDescriptor, limit: OperationLimit) throws -> String {
        var bytes = Data()
        var buffer = [UInt8](repeating: 0, count: 512)
        while !bytes.suffix(4).elementsEqual([13, 10, 13, 10]) {
            try ready(client, events: POLLIN, limit: limit)
            let count = buffer.withUnsafeMutableBytes { recv(client.fd, $0.baseAddress, $0.count, 0) }
            guard count > 0, bytes.count + count <= 2_048 else { throw FileRefusal.invalid }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        return try #require(String(data: bytes, encoding: .utf8))
    }

    private static func ready(_ socket: OwnedDescriptor, events: Int32, limit: OperationLimit) throws {
        var entries = [pollfd(fd: socket.fd, events: Int16(events), revents: 0)]
        repeat { try limit.poll(&entries) } while entries[0].revents == 0
    }
}

@Suite struct LoopbackTests {
    static let fingerprint = String(repeating: "a", count: 64)
    static let app = Data("<html>management</html>".utf8)
    static let goblin = Data("<html>Goblin</html>".utf8)

    static func http(_ body: Data, status: Int = 200, headers: [String] = []) -> Data {
        let lines = ["HTTP/1.1 \(status) Fixture", "Content-Length: \(body.count)"] + headers
        return Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8) + body
    }

    static func health(
        fingerprint: String = LoopbackTests.fingerprint, pid: Int32 = 123, phase: String = "running"
    ) -> Data {
        http(Data(#"{"status":"ok"}"#.utf8), headers: [
            "X-GraphGoblin-Instance: \(fingerprint)", "X-GraphGoblin-Pid: \(pid)",
            "X-GraphGoblin-Phase: \(phase)"
        ])
    }

    static func shell(_ body: Data, status: Int = 200, type: String = "text/html; charset=utf-8") -> Data {
        http(body, status: status, headers: ["Content-Type: \(type)"])
    }

    private func observe(port: UInt16, pid: pid_t? = nil) throws -> GatewayObservation {
        try Loopback(port: port).observe(
            fingerprint: Self.fingerprint, expectedChild: pid, appHTML: Self.app, goblinHTML: Self.goblin,
            limit: OperationLimit(time: AttemptTime(seconds: 4), quitting: { false })
        )
    }

    private func expectRequests(_ peer: ScriptedLoopbackPeer, _ paths: [String]) throws {
        let requests = try peer.requests()
        #expect(requests == paths.map {
            "GET \($0) HTTP/1.1\r\nHost: 127.0.0.1:\(peer.port)\r\n"
                + "Connection: close\r\nCache-Control: no-cache\r\n\r\n"
        })
    }

    @Test(arguments: ["running", "draining", "awaiting-choice", "forcing", "drain-failed", "force-failed"])
    func managementRequiresBothShellsAndFinalIdentity(finalPhase: String) throws {
        let peer = try ScriptedLoopbackPeer([
            .bytes(Self.health()), .bytes(Self.shell(Self.app)), .bytes(Self.shell(Self.goblin)),
            .bytes(Self.health(phase: finalPhase))
        ])
        switch try observe(port: peer.port, pid: 123) {
        case .usable(.running): #expect(finalPhase == "running")
        case .usable(.observingShutdown): #expect(finalPhase != "running")
        default: Issue.record("The identity-bound shells must open the expected management mode")
        }
        try expectRequests(peer, ["/healthz", "/app/", "/goblin/", "/healthz"])
    }

    @Test(arguments: ["ready", "exiting", "stopped"])
    func releasingPeerSkipsShellsAndFinalReleaseCancelsHandoff(phase: String) throws {
        let releasing = try ScriptedLoopbackPeer([.bytes(Self.health(phase: phase))])
        guard case .release = try observe(port: releasing.port) else {
            Issue.record("Releasing health must prevent a shell request")
            return
        }
        try expectRequests(releasing, ["/healthz"])
        let transitioning = try ScriptedLoopbackPeer([
            .bytes(Self.health()), .bytes(Self.shell(Self.app)), .bytes(Self.shell(Self.goblin)),
            .bytes(Self.health(phase: phase))
        ])
        guard case .release = try observe(port: transitioning.port, pid: 123) else {
            Issue.record("Final releasing health must prevent management handoff")
            return
        }
        try expectRequests(transitioning, ["/healthz", "/app/", "/goblin/", "/healthz"])
    }

    @Test func foreignAndWrongChildPeersNeverReceiveShellRequests() throws {
        let foreign = Self.health(fingerprint: String(repeating: "b", count: 64))
        let absent = Self.http(Data(#"{"status":"ok"}"#.utf8))
        for response in [foreign, absent] {
            let existing = try ScriptedLoopbackPeer([.bytes(response)])
            guard case .unrelated = try observe(port: existing.port) else {
                Issue.record("An unrelated listener must remain unrelated")
                return
            }
            try expectRequests(existing, ["/healthz"])
            let child = try ScriptedLoopbackPeer([.bytes(response)])
            guard case .conflict = try observe(port: child.port, pid: 123) else {
                Issue.record("An unrelated listener cannot satisfy expected child authority")
                return
            }
            try expectRequests(child, ["/healthz"])
        }
        let wrongChild = try ScriptedLoopbackPeer([.bytes(Self.health(pid: 124))])
        guard case .conflict = try observe(port: wrongChild.port, pid: 123) else {
            Issue.record("A matching fingerprint cannot substitute for the expected PID")
            return
        }
        try expectRequests(wrongChild, ["/healthz"])
    }

    @Test func changedHealthAfterShellsCannotAuthorizeManagement() throws {
        let foreign = Self.health(fingerprint: String(repeating: "b", count: 64))
        let absent = Self.http(Data(#"{"status":"ok"}"#.utf8))
        for response in [Self.health(pid: 124), foreign, absent] {
            for pid: pid_t? in [nil, 123] {
                let peer = try ScriptedLoopbackPeer([
                    .bytes(Self.health()), .bytes(Self.shell(Self.app)), .bytes(Self.shell(Self.goblin)),
                    .bytes(response)
                ])
                switch try observe(port: peer.port, pid: pid) {
                case .ambiguous: #expect(pid == nil)
                case .conflict: #expect(pid == 123)
                default: Issue.record("The final response cannot prove the same peer")
                }
                try expectRequests(peer, ["/healthz", "/app/", "/goblin/", "/healthz"])
            }
        }
    }

    @Test func independentlyRejectsMissingWrongAndUnframedShells() throws {
        let app = Self.shell(Self.app)
        let goblin = Self.shell(Self.goblin)
        for (appReply, goblinReply) in [
            (Self.shell(Self.app, status: 404), goblin),
            (Self.shell(Self.app, type: "application/json"), goblin),
            (Data("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n".utf8) + Self.app, goblin),
            (app, Self.shell(Self.app)),
            (app, Self.shell(Self.goblin, status: 404))
        ] {
            let peer = try ScriptedLoopbackPeer([
                .bytes(Self.health()), .bytes(appReply), .bytes(goblinReply), .bytes(Self.health())
            ])
            guard case .lacksAssets = try observe(port: peer.port) else {
                Issue.record("Both shell responses must prove the expected HTML")
                return
            }
            try expectRequests(peer, ["/healthz", "/app/", "/goblin/", "/healthz"])
        }
    }

    @Test func closedPortDiffersFromMalformedOversizeResetAndStalledPeers() throws {
        let reservation = try FixtureSocket()
        try withExtendedLifetime(reservation) {
            guard case .refused = try observe(port: reservation.port) else {
                Issue.record("A refused TCP connection must permit a store observation")
                return
            }
        }
        for reply: ScriptedLoopbackPeer.Reply in [
            .bytes(Data("unexpected bytes".utf8)),
            .bytes(Self.http(Data(repeating: 97, count: 4_097))),
            .bytes(Data(repeating: 97, count: 21_000)),
            .reset, .stallUntilClientCloses
        ] {
            let peer = try ScriptedLoopbackPeer([reply])
            guard case .ambiguous = try observe(port: peer.port) else {
                Issue.record("A responding socket without authority must never qualify as refused")
                return
            }
            try expectRequests(peer, ["/healthz"])
        }
    }

    @Test func invalidShellTransportMakesAnAuthenticatedPeerAmbiguous() throws {
        let peer = try ScriptedLoopbackPeer([.bytes(Self.health()), .reset])
        guard case .ambiguous = try observe(port: peer.port, pid: 123) else {
            Issue.record("An interrupted shell request cannot authorize handoff")
            return
        }
        try expectRequests(peer, ["/healthz", "/app/"])
    }

    @Test func rejectsAmbiguousHTTPFramingBeforeIdentityParsing() {
        for response in [
            "HTTP/2 200 OK\r\n\r\n",
            "HTTP/1.1 999 Invalid\r\n\r\n",
            "HTTP/1.1 200 OK\r\nBroken header\r\n\r\n",
            "HTTP/1.1 200 OK\r\nInvalid Name: value\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\ncontent-length: 0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 00\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n",
            "HTTP/1.1 200 OK\r\nX-Pad: " + String(repeating: "x", count: 16_384) + "\r\n\r\n"
        ] {
            #expect(throws: OperationRefusal.self) {
                try HTTPResponse.parse(Data(response.utf8), bodyCap: 4_096)
            }
        }
    }
}
