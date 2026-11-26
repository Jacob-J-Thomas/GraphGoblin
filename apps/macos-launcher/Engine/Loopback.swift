import Darwin
import Foundation
import LaunchContract

struct HTTPResponse {
    let status: Int
    let headers: [String: String]
    let body: Data

    static func parse(_ bytes: Data, bodyCap: Int) throws -> HTTPResponse {
        guard let boundary = bytes.range(of: Data([13, 10, 13, 10])), boundary.lowerBound <= 16_384,
              let raw = String(data: bytes.prefix(boundary.lowerBound), encoding: .utf8),
              raw.utf8.allSatisfy({ $0 == 9 || $0 == 13 || $0 == 10 || (32...126).contains($0) }) else {
            throw OperationRefusal.invalid
        }
        var lines = raw.components(separatedBy: "\r\n")
        let status = lines.removeFirst().split(separator: " ", maxSplits: 2)
        guard status.count >= 2, status[0] == "HTTP/1.1" || status[0] == "HTTP/1.0",
              status[1].count == 3, let code = Int(status[1]), (100...599).contains(code) else {
            throw OperationRefusal.invalid
        }
        var headers: [String: String] = [:]
        for line in lines {
            let pieces = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard pieces.count == 2, !pieces[0].isEmpty,
                  pieces[0].utf8.allSatisfy({
                      (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45
                  }) else { throw OperationRefusal.invalid }
            let name = pieces[0].lowercased()
            let value = pieces[1].trimmingCharacters(in: .whitespaces)
            // Duplicates of identity or framing fields cannot prove a response.
            if headers[name] != nil {
                guard !name.hasPrefix("x-graphgoblin-"), name != "content-length", name != "transfer-encoding" else {
                    throw OperationRefusal.invalid
                }
            }
            headers[name] = value
        }
        let body = Data(bytes.dropFirst(boundary.upperBound))
        guard body.count <= bodyCap else { throw OperationRefusal.invalid }
        if let length = headers["content-length"] {
            guard headers["transfer-encoding"] == nil, let count = Int(length), count == body.count,
                  String(count) == length else { throw OperationRefusal.invalid }
        }
        return HTTPResponse(status: code, headers: headers, body: body)
    }

    var hasExactLength: Bool {
        headers["content-length"] != nil && headers["transfer-encoding"] == nil
    }
}

enum GatewayPhase: String {
    case running, draining, forcing, ready, exiting, stopped
    case awaitingChoice = "awaiting-choice"
    case drainFailed = "drain-failed"
    case forceFailed = "force-failed"

    var mode: ManagementMode? {
        switch self {
        case .running: .running
        case .draining, .awaitingChoice, .forcing, .drainFailed, .forceFailed: .observingShutdown
        case .ready, .exiting, .stopped: nil
        }
    }
}

enum GatewayObservation {
    case refused
    case unrelated
    case ambiguous
    case conflict
    case release
    case lacksAssets
    case usable(ManagementMode)
}

struct HealthIdentity {
    let fingerprint: String
    let pid: pid_t
    let phase: GatewayPhase

    static func parse(_ response: HTTPResponse) throws -> HealthIdentity? {
        let names = ["x-graphgoblin-instance", "x-graphgoblin-pid", "x-graphgoblin-phase"]
        if names.allSatisfy({ response.headers[$0] == nil }) { return nil }
        guard response.status == 200, response.hasExactLength,
              response.body == Data(#"{"status":"ok"}"#.utf8),
              let fingerprint = response.headers[names[0]], asciiHex(fingerprint, count: 64),
              let rawPID = response.headers[names[1]], let pid = Int32(rawPID),
              pid > 0, String(pid) == rawPID,
              let rawPhase = response.headers[names[2]], let phase = GatewayPhase(rawValue: rawPhase) else {
            throw OperationRefusal.invalid
        }
        return HealthIdentity(fingerprint: fingerprint, pid: pid, phase: phase)
    }
}

struct Loopback {
    let port: UInt16

    func observe(
        fingerprint: String, expectedChild: pid_t?, appHTML: Data, goblinHTML: Data, limit: OperationLimit
    ) throws -> GatewayObservation {
        let first: HealthIdentity
        do {
            let health = try read("/healthz", limit: limit, bodyCap: 4_096)
            guard let identity = try HealthIdentity.parse(health) else {
                return expectedChild == nil ? .unrelated : .conflict
            }
            first = identity
        } catch OperationRefusal.disconnected {
            return .refused
        } catch OperationRefusal.cancelled {
            throw OperationRefusal.cancelled
        } catch {
            return .ambiguous
        }
        guard first.fingerprint == fingerprint else {
            return expectedChild == nil ? .unrelated : .conflict
        }
        guard expectedChild == nil || expectedChild == first.pid else { return .conflict }
        if first.phase.mode == nil { return .release }

        do {
            let app = try read("/app/", limit: limit, bodyCap: max(4_096, appHTML.count))
            let goblin = try read("/goblin/", limit: limit, bodyCap: max(4_096, goblinHTML.count))
            let current = try read("/healthz", limit: limit, bodyCap: 4_096)
            guard let last = try HealthIdentity.parse(current) else {
                return expectedChild == nil ? .ambiguous : .conflict
            }
            guard last.pid == first.pid, last.fingerprint == first.fingerprint else {
                return expectedChild == nil ? .ambiguous : .conflict
            }
            guard let mode = last.phase.mode else { return .release }
            guard matches(app, appHTML), matches(goblin, goblinHTML) else { return .lacksAssets }
            return .usable(mode)
        } catch OperationRefusal.cancelled {
            throw OperationRefusal.cancelled
        } catch {
            return .ambiguous
        }
    }

    private func matches(_ response: HTTPResponse, _ data: Data) -> Bool {
        response.status == 200 && response.hasExactLength
            && response.headers["content-type"]?.lowercased().hasPrefix("text/html") == true
            && response.body == data
    }

    private func read(_ path: String, limit: OperationLimit, bodyCap: Int) throws -> HTTPResponse {
        let operation = OperationLimit(time: limit.time.window(milliseconds: 1_000), quitting: limit.quitting)
        try operation.check()
        let socket = try OwnedDescriptor(Darwin.socket(AF_INET, SOCK_STREAM, 0))
        var yes: Int32 = 1
        guard setsockopt(socket.fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size)) == 0,
              fcntl(socket.fd, F_SETFD, FD_CLOEXEC) == 0,
              fcntl(socket.fd, F_SETFL, O_NONBLOCK) == 0 else { throw FileRefusal.system(errno) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr = in_addr(s_addr: in_addr_t(0x7F000001).bigEndian)
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(socket.fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if connected != 0 {
            if errno == ECONNREFUSED { throw OperationRefusal.disconnected }
            guard errno == EINPROGRESS || errno == EINTR else { throw FileRefusal.system(errno) }
            try ready(socket, events: POLLOUT, limit: operation)
            var result: Int32 = 0
            var size = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(socket.fd, SOL_SOCKET, SO_ERROR, &result, &size) == 0 else {
                throw FileRefusal.system(errno)
            }
            if result == ECONNREFUSED { throw OperationRefusal.disconnected }
            guard result == 0 else { throw FileRefusal.system(result) }
        }
        let request = Data(("GET \(path) HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\n"
                            + "Connection: close\r\nCache-Control: no-cache\r\n\r\n").utf8)
        try request.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                try ready(socket, events: POLLOUT, limit: operation)
                let count = send(socket.fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
                if count < 0 && (errno == EINTR || errno == EAGAIN) { continue }
                guard count > 0 else { throw FileRefusal.system(errno) }
                offset += count
            }
        }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            try ready(socket, events: POLLIN, limit: operation)
            let count = buffer.withUnsafeMutableBytes { recv(socket.fd, $0.baseAddress, $0.count, 0) }
            if count == 0 { break }
            if count < 0 && (errno == EINTR || errno == EAGAIN) { continue }
            guard count > 0, result.count + count <= bodyCap + 16_388 else {
                throw OperationRefusal.invalid
            }
            result.append(contentsOf: buffer.prefix(count))
        }
        return try HTTPResponse.parse(result, bodyCap: bodyCap)
    }

    private func ready(_ socket: OwnedDescriptor, events: Int32, limit: OperationLimit) throws {
        var entries = [pollfd(fd: socket.fd, events: Int16(events), revents: 0)]
        repeat { try limit.poll(&entries) } while entries[0].revents == 0
    }
}
